import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { issueCardForOrder } from "../providers/kripicard.js";
import { getProviderConfig } from "../provider-config.js";
import { authenticateCustomer } from "./customer-auth.js";
import { enqueuePaymentReceipt } from "../notifications.js";

const initializeSchema = z.object({ orderId: z.string().uuid() });
const webhookSchema = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]), tx_ref: z.string(), status: z.string() }).passthrough(),
}).passthrough();
type OrderRow = RowDataPacket & {
  id: string; order_number: string; customer_email: string;
  payment_currency: string; payment_amount: number; payment_status: string;
};
type AttemptRow = RowDataPacket & { id: number; order_id: string; provider_reference: string };
const apiBase = "https://api.flutterwave.com/v3";
function isValidWebhookHash(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false;
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerPaymentRoutes(app: FastifyInstance) {
  app.post("/api/payments/flutterwave/initialize", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply, true);
    if (!customer) return reply;
    const parsed = initializeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid orderId is required." });
    const providerConfig = await getProviderConfig("flutterwave");
    const secret = providerConfig.secretKey;
    if (!secret || !providerConfig.webhookSecret) return reply.code(503).send({ error: "Flutterwave Secret Key and Webhook Secret Hash must both be configured before payments can be accepted." });
    const connection = await db.getConnection();
    let order: OrderRow | undefined;
    let attemptId = 0;
    const txRef = `CRW-${randomUUID()}`;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<OrderRow[]>(
        "SELECT id, order_number, customer_email, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, payment_status FROM orders WHERE id = ? AND customer_id = ? FOR UPDATE", [parsed.data.orderId, customer.id],
      );
      order = orders[0];
      if (!order) { await connection.rollback(); return reply.code(404).send({ error: "Order not found." }); }
      if (order.payment_status === "successful") { await connection.rollback(); return reply.code(409).send({ error: "Order is already paid." }); }
      const [activeAttempts] = await connection.query<Array<RowDataPacket & { provider: string; status: string; checkout_url: string | null; provider_reference: string | null }>>(
        "SELECT provider, status, checkout_url, provider_reference FROM payment_attempts WHERE order_id = ? AND status IN ('initialized','pending') ORDER BY id DESC LIMIT 1 FOR UPDATE", [order.id],
      );
      const activeAttempt = activeAttempts[0];
      if (activeAttempt) {
        await connection.commit();
        if (activeAttempt.provider === "flutterwave" && activeAttempt.checkout_url) return reply.code(200).send({ paymentUrl: activeAttempt.checkout_url, txRef: activeAttempt.provider_reference, orderNumber: order.order_number, resumed: true });
        return reply.code(409).send({ error: "A payment attempt is already being reconciled. Check this order's status before starting another payment." });
      }
      const [insert] = await connection.execute(
        "INSERT INTO payment_attempts (order_id, provider, provider_reference, status) VALUES (?, 'flutterwave', ?, 'initialized')",
        [order.id, txRef],
      );
      attemptId = (insert as { insertId: number }).insertId;
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    try {
      const response = await fetch(`${apiBase}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_ref: txRef, amount: order.payment_amount.toFixed(2), currency: order.payment_currency,
          redirect_url: `${(process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "")}/payment/callback?orderId=${encodeURIComponent(order.id)}`,
          customer: { email: order.customer_email },
          customizations: { title: "Cards by Raaduns", description: `Order ${order.order_number}` },
          meta: { order_number: order.order_number },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const payload = await response.json() as { status?: string; message?: string; data?: { link?: string } };
      if (!response.ok || payload.status !== "success" || !payload.data?.link) {
        await db.execute("UPDATE payment_attempts SET status = 'failed', raw_response = ? WHERE id = ?", [JSON.stringify(payload), attemptId]);
        request.log.error({ statusCode: response.status, providerMessage: payload.message }, "Flutterwave payment initialization failed");
        return reply.code(502).send({ error: "Unable to initialize payment. Please retry." });
      }
      await db.execute("UPDATE payment_attempts SET status = 'pending', checkout_url = ?, raw_response = ? WHERE id = ?", [payload.data.link, JSON.stringify(payload), attemptId]);
      return reply.code(201).send({ paymentUrl: payload.data.link, txRef, orderNumber: order.order_number });
    } catch (error) {
      // Preserve ambiguous attempts for reconciliation rather than implying the provider did not create a checkout.
      await db.execute("UPDATE payment_attempts SET status = 'pending' WHERE id = ?", [attemptId]);
      request.log.error(error, "Flutterwave request outcome is unknown");
      return reply.code(502).send({ error: "Payment initialization outcome is being reconciled. Check order status before retrying." });
    }
  });

  app.post("/api/payments/flutterwave/reconcile", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply, true);
    if (!customer) return reply;
    const parsed = initializeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid orderId is required." });
    const config = await getProviderConfig("flutterwave");
    if (!config.secretKey) return reply.code(503).send({ error: "Flutterwave is not configured." });

    const [orders] = await db.query<OrderRow[]>(
      "SELECT o.id, o.order_number, o.customer_email, o.payment_currency, COALESCE(o.payment_amount_ngn, o.amount) AS payment_amount, o.payment_status FROM orders o WHERE o.id = ? AND o.customer_id = ?",
      [parsed.data.orderId, customer.id],
    );
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (order.payment_status === "successful") return { status: "paid", message: "Payment is already confirmed." };

    const [attempts] = await db.query<Array<RowDataPacket & { id: number; provider_reference: string; status: string }>>(
      "SELECT id, provider_reference, status FROM payment_attempts WHERE order_id = ? AND provider = 'flutterwave' AND status IN ('initialized','pending') ORDER BY id DESC LIMIT 1",
      [order.id],
    );
    const attempt = attempts[0];
    if (!attempt?.provider_reference) return reply.code(409).send({ error: "There is no unresolved Flutterwave payment attempt for this order." });

    try {
      const response = await fetch(`${apiBase}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(attempt.provider_reference)}`, {
        headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({})) as { status?: string; data?: { id?: number | string; tx_ref?: string; status?: string; currency?: string; amount?: number | string } };
      if (!response.ok || result.status !== "success" || !result.data) return reply.code(202).send({ status: "pending", message: "Flutterwave has not returned a final transaction record yet. Check again shortly." });
      const transaction = result.data;
      const referenceMatches = transaction.tx_ref === attempt.provider_reference;
      const amountMatches = Number.isFinite(Number(transaction.amount)) && Math.abs(Number(transaction.amount) - Number(order.payment_amount)) < 0.01;
      const currencyMatches = transaction.currency === order.payment_currency;

      if (transaction.status === "successful" && referenceMatches && amountMatches && currencyMatches) {
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute("UPDATE payment_attempts SET status = 'successful', provider_transaction_id = ? WHERE id = ? AND status <> 'successful'", [String(transaction.id ?? ""), attempt.id]);
          await connection.execute("UPDATE orders SET payment_status = 'successful', order_status = 'paid', fulfilment_status = 'queued' WHERE id = ? AND payment_status <> 'successful'", [order.id]);
          await enqueuePaymentReceipt(connection, { id: order.id, order_number: order.order_number, customer_email: order.customer_email, currency: order.payment_currency, amount: order.payment_amount });
          await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
        await issueCardForOrder(order.id, request.log);
        return { status: "paid", message: "Payment verified. Card fulfilment is now in progress." };
      }

      if (["failed", "cancelled"].includes(transaction.status ?? "")) {
        await db.execute("UPDATE payment_attempts SET status = ? WHERE id = ? AND status IN ('initialized','pending')", [transaction.status === "cancelled" ? "cancelled" : "failed", attempt.id]);
        return { status: "failed", message: "This payment attempt was not successful. You can safely retry checkout." };
      }

      if (transaction.status === "successful" && (!referenceMatches || !amountMatches || !currencyMatches)) {
        await db.execute("UPDATE orders SET order_status = 'manual_review', fulfilment_status = 'manual_review' WHERE id = ? AND payment_status <> 'successful'", [order.id]);
        request.log.error({ orderId: order.id, referenceMatches, amountMatches, currencyMatches }, "Flutterwave reconciliation returned a transaction that did not match the order");
        return reply.code(409).send({ status: "review", message: "The payment details need manual review. Do not pay again." });
      }
      return reply.code(202).send({ status: "pending", message: "Payment is not yet confirmed. Check again shortly." });
    } catch (error) {
      request.log.error({ orderId: order.id, error }, "Flutterwave payment reconciliation failed");
      return reply.code(502).send({ error: "Unable to check payment status right now. Please try again shortly." });
    }
  });

  app.post("/webhooks/flutterwave", async (request, reply) => {
    const providerConfig = await getProviderConfig("flutterwave");
    if (!isValidWebhookHash(request.headers["verif-hash"] as string | undefined, providerConfig.webhookSecret)) {
      return reply.code(401).send({ error: "Invalid webhook signature." });
    }
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid webhook payload." });
    const event = parsed.data.data; const eventId = String(event.id); const payloadJson = JSON.stringify(request.body);
    await db.execute("INSERT IGNORE INTO webhook_events (provider, event_id, payload) VALUES ('flutterwave', ?, ?)", [eventId, payloadJson]);
    const [existingEvents] = await db.query<Array<RowDataPacket & { processing_status: string }>>(
      "SELECT processing_status FROM webhook_events WHERE provider = 'flutterwave' AND event_id = ?", [eventId],
    );
    if (existingEvents[0]?.processing_status === "processed") return reply.code(200).send({ received: true });
    const [attempts] = await db.query<AttemptRow[]>(
      "SELECT id, order_id, provider_reference FROM payment_attempts WHERE provider = 'flutterwave' AND provider_reference = ?", [event.tx_ref],
    );
    const attempt = attempts[0];
    if (!attempt) {
      await db.execute("UPDATE webhook_events SET processing_status = 'processed', processed_at = NOW() WHERE provider = 'flutterwave' AND event_id = ?", [eventId]);
      return reply.code(200).send({ received: true });
    }
    try {
      const providerConfig = await getProviderConfig("flutterwave");
    const secret = providerConfig.secretKey;
      if (!secret) throw new Error("Flutterwave secret key is not configured.");
      const verifyResponse = await fetch(`${apiBase}/transactions/${encodeURIComponent(String(event.id))}/verify`, {
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000),
      });
      if (!verifyResponse.ok) throw new Error(`Flutterwave verification returned HTTP ${verifyResponse.status}`);
      const verification = await verifyResponse.json() as {
        data?: { status?: string; tx_ref?: string; currency?: string; amount?: number | string; id?: number };
      };
      const transaction = verification.data;
      const [orders] = await db.query<OrderRow[]>(
        "SELECT id, order_number, customer_email, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, payment_status FROM orders WHERE id = ?", [attempt.order_id],
      );
      const order = orders[0];
      const valid = Boolean(order && transaction && transaction.status === "successful"
        && transaction.tx_ref === attempt.provider_reference && transaction.currency === order.payment_currency
        && Math.abs(Number(transaction.amount) - Number(order.payment_amount)) < 0.01);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        if (valid && order) {
          await connection.execute("UPDATE payment_attempts SET status = 'successful', provider_transaction_id = ? WHERE id = ?", [String(transaction?.id ?? event.id), attempt.id]);
          await connection.execute("UPDATE orders SET payment_status = 'successful', order_status = 'paid', fulfilment_status = 'queued' WHERE id = ? AND payment_status <> 'successful'", [order.id]);
          await enqueuePaymentReceipt(connection, { id: order.id, order_number: order.order_number, customer_email: order.customer_email, currency: order.payment_currency, amount: order.payment_amount });
        } else {
          await connection.execute("UPDATE payment_attempts SET status = 'failed', provider_transaction_id = ? WHERE id = ? AND status <> 'successful'", [String(event.id), attempt.id]);
        }
        await connection.execute("UPDATE webhook_events SET processing_status = 'processed', processed_at = NOW() WHERE provider = 'flutterwave' AND event_id = ?", [eventId]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }

      if (valid && order) {
        const [freshOrders] = await db.query<OrderRow[]>(
          "SELECT id, order_number, customer_email, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, payment_status FROM orders WHERE id = ?", [order.id],
        );
        if (freshOrders[0]?.payment_status === "successful") {
          await issueCardForOrder(order.id, request.log);
        }
      }
      return reply.code(200).send({ received: true, verified: valid });
    } catch (error) {
      await db.execute("UPDATE webhook_events SET processing_status = 'failed' WHERE provider = 'flutterwave' AND event_id = ?", [eventId]);
      request.log.error(error, "Flutterwave webhook verification or fulfilment failed");
      return reply.code(500).send({ error: "Webhook processing failed." });
    }
  });
}