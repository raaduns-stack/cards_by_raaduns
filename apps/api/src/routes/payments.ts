import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { issueCardForOrder } from "../providers/kripicard.js";
import { getProviderConfig } from "../provider-config.js";

const initializeSchema = z.object({ orderId: z.string().uuid() });
const webhookSchema = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]), tx_ref: z.string(), status: z.string() }).passthrough(),
}).passthrough();
type OrderRow = RowDataPacket & {
  id: string; order_number: string; customer_email: string;
  currency: string; amount: number; payment_status: string;
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
    const parsed = initializeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid orderId is required." });
    const providerConfig = await getProviderConfig("flutterwave");
    const secret = providerConfig.secretKey;
    if (!secret) return reply.code(503).send({ error: "Payment provider is not configured." });
    const [orders] = await db.query<OrderRow[]>(
      "SELECT id, order_number, customer_email, currency, amount, payment_status FROM orders WHERE id = ?", [parsed.data.orderId],
    );
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (order.payment_status === "successful") return reply.code(409).send({ error: "Order is already paid." });
    const txRef = `CRW-${randomUUID()}`;
    const [insert] = await db.execute(
      "INSERT INTO payment_attempts (order_id, provider, provider_reference, status) VALUES (?, 'flutterwave', ?, 'initialized')",
      [order.id, txRef],
    );
    const attemptId = (insert as { insertId: number }).insertId;
    try {
      const response = await fetch(`${apiBase}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_ref: txRef, amount: order.amount.toFixed(2), currency: order.currency,
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
        "SELECT id, order_number, customer_email, currency, amount, payment_status FROM orders WHERE id = ?", [attempt.order_id],
      );
      const order = orders[0];
      const valid = Boolean(order && transaction && transaction.status === "successful"
        && transaction.tx_ref === attempt.provider_reference && transaction.currency === order.currency
        && Number(transaction.amount) >= order.amount);
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        if (valid && order) {
          await connection.execute("UPDATE payment_attempts SET status = 'successful', provider_transaction_id = ? WHERE id = ?", [String(transaction?.id ?? event.id), attempt.id]);
          await connection.execute("UPDATE orders SET payment_status = 'successful', order_status = 'paid', fulfilment_status = 'queued' WHERE id = ? AND payment_status <> 'successful'", [order.id]);
        } else {
          await connection.execute("UPDATE payment_attempts SET status = 'failed', provider_transaction_id = ? WHERE id = ? AND status <> 'successful'", [String(event.id), attempt.id]);
        }
        await connection.execute("UPDATE webhook_events SET processing_status = 'processed', processed_at = NOW() WHERE provider = 'flutterwave' AND event_id = ?", [eventId]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }

      if (valid && order) {
        const [freshOrders] = await db.query<OrderRow[]>(
          "SELECT id, order_number, customer_email, currency, amount, payment_status FROM orders WHERE id = ?", [order.id],
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