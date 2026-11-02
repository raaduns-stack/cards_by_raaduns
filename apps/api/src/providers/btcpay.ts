import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { getProviderConfig } from "../provider-config.js";
import { authenticateCustomer } from "../routes/customer-auth.js";
import { issueCardForOrder } from "./kripicard.js";
import { enqueuePaymentReceipt } from "../notifications.js";

type OrderRow = RowDataPacket & { id: string; order_number: string; customer_email: string; payment_currency: string; payment_amount: number; payment_status: string };
type BtcpayEvent = { deliveryId: string; type: string; storeId: string; invoiceId: string; metadata?: { orderId?: string } };
const baseUrl = (value: string) => value.replace(/\/$/, "");

export async function registerBtcpayRoutes(app: FastifyInstance) {
  app.post("/api/payments/btcpay/initialize", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply, true);
    if (!customer) return reply;
    const parsed = z.object({ orderId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid orderId is required." });
    const config = await getProviderConfig("btcpay");
    if (config.enabled !== "true" || !config.apiKey || !config.storeId || !config.webhookSecret) return reply.code(503).send({ error: "BTCPay is not fully configured and enabled." });
    const [providerRows] = await db.query<Array<RowDataPacket & { verification_status: string }>>("SELECT verification_status FROM provider_settings WHERE provider = 'btcpay' LIMIT 1");
    if (providerRows[0]?.verification_status !== "verified") return reply.code(503).send({ error: "Verify BTCPay credentials in Admin before accepting payments." });
    const connection = await db.getConnection();
    let order: OrderRow | undefined;
    let attemptId = 0;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query<OrderRow[]>("SELECT id, order_number, customer_email, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, payment_status FROM orders WHERE id = ? AND customer_id = ? FOR UPDATE", [parsed.data.orderId, customer.id]);
      order = orders[0];
      if (!order) { await connection.rollback(); return reply.code(404).send({ error: "Order not found." }); }
      if (order.payment_status === "successful") { await connection.rollback(); return reply.code(409).send({ error: "Order is already paid." }); }
      const [activeAttempts] = await connection.query<Array<RowDataPacket & { provider: string; status: string; checkout_url: string | null; provider_reference: string | null }>>(
        "SELECT provider, status, checkout_url, provider_reference FROM payment_attempts WHERE order_id = ? AND status IN ('initialized','pending') ORDER BY id DESC LIMIT 1 FOR UPDATE", [order.id],
      );
      const activeAttempt = activeAttempts[0];
      if (activeAttempt) {
        await connection.commit();
        if (activeAttempt.provider === "btcpay" && activeAttempt.checkout_url) return reply.code(200).send({ paymentUrl: activeAttempt.checkout_url, invoiceId: activeAttempt.provider_reference, orderNumber: order.order_number, resumed: true });
        return reply.code(409).send({ error: "A payment attempt is already being reconciled. Check this order's status before starting another payment." });
      }
      const [insert] = await connection.execute("INSERT INTO payment_attempts (order_id, provider, status) VALUES (?, 'btcpay', 'initialized')", [order.id]);
      attemptId = (insert as { insertId: number }).insertId;
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    const root = baseUrl(config.serverUrl || "https://btcpay.scrapee.uk");
    if (!/^https:\/\//i.test(root)) { await db.execute("UPDATE payment_attempts SET status = 'failed' WHERE id = ?", [attemptId]); return reply.code(400).send({ error: "BTCPay server URL must use HTTPS." }); }
    try {
      const response = await fetch(`${root}/api/v1/stores/${encodeURIComponent(config.storeId)}/invoices`, { method: "POST", headers: { Authorization: `token ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(order.payment_amount).toFixed(2), currency: order.payment_currency, metadata: { orderId: order.id, orderNumber: order.order_number }, checkout: { redirectURL: `${(process.env.APP_URL || "https://cards.raaduns.com").replace(/\/$/, "")}/payment/callback?orderId=${encodeURIComponent(order.id)}` } }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) { const detail = (await response.text()).slice(0, 300); const ambiguous = response.status >= 500; await db.execute("UPDATE payment_attempts SET status = ?, raw_response = ? WHERE id = ?", [ambiguous ? "pending" : "failed", JSON.stringify({ statusCode: response.status, detail }), attemptId]); request.log.warn({ statusCode: response.status }, "BTCPay invoice creation rejected"); return reply.code(502).send({ error: ambiguous ? "BTCPay invoice outcome is being reconciled. Check order status before retrying." : "BTCPay could not create the invoice. Check store currency and API permissions." }); }
      const invoice = await response.json() as { id?: string; checkoutLink?: string };
      if (!invoice.id || !invoice.checkoutLink) { await db.execute("UPDATE payment_attempts SET status = 'pending', raw_response = ? WHERE id = ?", [JSON.stringify({ responseIncomplete: true }), attemptId]); return reply.code(502).send({ error: "BTCPay returned an incomplete invoice. Check order status before retrying." }); }
      await db.execute("UPDATE payment_attempts SET provider_reference = ?, status = 'pending', checkout_url = ?, raw_response = ? WHERE id = ?", [invoice.id, invoice.checkoutLink, JSON.stringify({ id: invoice.id }), attemptId]);
      return reply.code(201).send({ paymentUrl: invoice.checkoutLink, invoiceId: invoice.id, orderNumber: order.order_number });
    } catch (error) { await db.execute("UPDATE payment_attempts SET status = 'pending' WHERE id = ?", [attemptId]); request.log.error(error, "BTCPay invoice initialization outcome is ambiguous"); return reply.code(502).send({ error: "BTCPay invoice outcome is being reconciled. Check order status before retrying." }); }
  });

  app.post("/api/webhooks/btcpay", async (request, reply) => {
    const config = await getProviderConfig("btcpay");
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const signature = request.headers["btcpay-sig"];
    if (!raw || typeof signature !== "string" || !config.webhookSecret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return reply.code(401).send({ error: "Invalid BTCPay signature." });
    const expected = `sha256=${createHmac("sha256", config.webhookSecret).update(raw).digest("hex")}`;
    const actualBytes = Buffer.from(signature); const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return reply.code(401).send({ error: "Invalid BTCPay signature." });
    const parsed = z.object({ deliveryId: z.string().min(1), type: z.string().min(1), storeId: z.string().min(1), invoiceId: z.string().min(1), metadata: z.object({ orderId: z.string().uuid().optional() }).passthrough().optional() }).passthrough().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid BTCPay event." });
    const event = parsed.data as BtcpayEvent;
    if (event.storeId !== config.storeId) return reply.code(401).send({ error: "Webhook store does not match configured store." });
    const [insert] = await db.execute("INSERT IGNORE INTO webhook_events (provider, event_id, payload, processing_status) VALUES ('btcpay', ?, ?, 'received')", [event.deliveryId, raw.toString("utf8")]);
    if ((insert as { affectedRows: number }).affectedRows === 0) {
      const [retry] = await db.execute("UPDATE webhook_events SET processing_status = 'received', payload = ? WHERE provider = 'btcpay' AND event_id = ? AND processing_status = 'failed'", [raw.toString("utf8"), event.deliveryId]);
      if ((retry as { affectedRows: number }).affectedRows === 0) return { received: true, duplicate: true };
    }
    try {
      if (event.type === "InvoiceSettled") {
        if (!config.apiKey || !config.storeId) throw new Error("BTCPay API credentials are missing.");
        const root = baseUrl(config.serverUrl || "https://btcpay.scrapee.uk");
        const response = await fetch(`${root}/api/v1/invoices/${encodeURIComponent(event.invoiceId)}`, { headers: { Authorization: `token ${config.apiKey}` }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`BTCPay invoice lookup returned HTTP ${response.status}`);
        const invoice = await response.json() as { id?: string; status?: string; amount?: string; currency?: string; metadata?: { orderId?: string } };
        if (invoice.id !== event.invoiceId || invoice.status !== "Settled" || !invoice.metadata?.orderId || (event.metadata?.orderId && event.metadata.orderId !== invoice.metadata.orderId)) throw new Error("BTCPay invoice identity or settlement status did not match.");
        const connection = await db.getConnection(); let paidOrderId = "";
        try {
          await connection.beginTransaction();
          const [attempts] = await connection.query<Array<RowDataPacket & { id: number; order_id: string }>>("SELECT id, order_id FROM payment_attempts WHERE provider = 'btcpay' AND provider_reference = ? FOR UPDATE", [event.invoiceId]);
          const attempt = attempts[0]; if (!attempt) throw new Error("No matching BTCPay payment attempt.");
          const [orders] = await connection.query<OrderRow[]>("SELECT id, order_number, customer_email, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, payment_status FROM orders WHERE id = ? FOR UPDATE", [attempt.order_id]);
          const order = orders[0];
          if (!order || invoice.metadata.orderId !== order.id || invoice.currency !== order.payment_currency || Math.abs(Number(invoice.amount) - Number(order.payment_amount)) > 0.000001) throw new Error("BTCPay invoice amount, currency or order does not match the order snapshot.");
          if (order.payment_status !== "successful") { await connection.execute("UPDATE payment_attempts SET status = 'successful', provider_transaction_id = ? WHERE id = ?", [event.invoiceId, attempt.id]); await connection.execute("UPDATE orders SET payment_status = 'successful', order_status = 'paid', fulfilment_status = 'queued' WHERE id = ? AND payment_status <> 'successful'", [order.id]); await enqueuePaymentReceipt(connection, { id: order.id, order_number: order.order_number, customer_email: order.customer_email, currency: order.payment_currency, amount: order.payment_amount }); }
          paidOrderId = order.id;
          await connection.execute("UPDATE webhook_events SET processing_status = 'processed', processed_at = UTC_TIMESTAMP() WHERE provider = 'btcpay' AND event_id = ?", [event.deliveryId]);
          await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        if (paidOrderId) await issueCardForOrder(paidOrderId, request.log);
      } else {
        await db.execute("UPDATE webhook_events SET processing_status = 'processed', processed_at = UTC_TIMESTAMP() WHERE provider = 'btcpay' AND event_id = ?", [event.deliveryId]);
      }
      return { received: true };
    } catch (error) {
      await db.execute("UPDATE webhook_events SET processing_status = 'failed' WHERE provider = 'btcpay' AND event_id = ?", [event.deliveryId]);
      request.log.error(error, "BTCPay webhook processing failed");
      return reply.code(500).send({ error: "BTCPay webhook processing failed; delivery can be retried." });
    }
  });
}