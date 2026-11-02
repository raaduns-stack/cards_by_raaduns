import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { db } from "../db.js";
import { authenticateCustomer } from "./customer-auth.js";
const createOrderSchema = z.object({ productCode: z.string().min(1).max(40), amount: z.number().finite().positive().max(100000) });
type ProductRow = RowDataPacket & { id: number; code: string };
type PricingRow = RowDataPacket & { currency: string; exchange_rate_ngn_per_usd: number; issuance_fee_usd: number; gross_profit_ngn: number; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null };
export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/api/orders", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply, true);
    if (!customer) return reply;
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid order details.", details: parsed.error.flatten() });
    const { productCode, amount: cardAmountUsd } = parsed.data;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query<ProductRow[]>("SELECT id, code FROM card_products WHERE code = ? AND is_active = 1 FOR UPDATE", [productCode]);
      const product = products[0];
      if (!product) { await connection.rollback(); return reply.code(400).send({ error: "This card product is not available." }); }
      const [settings] = await connection.query<PricingRow[]>("SELECT currency, exchange_rate_ngn_per_usd, issuance_fee_usd, gross_profit_ngn, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1 FOR UPDATE");
      const pricing = settings[0];
      if (!pricing) { await connection.rollback(); return reply.code(503).send({ error: "Pricing is not configured." }); }
      const [fixed] = await connection.query<Array<RowDataPacket & { amount: number }>>("SELECT amount FROM fixed_denominations WHERE amount = ? AND is_enabled = 1", [cardAmountUsd]);
      const isFixed = fixed.length > 0;
      const isCustom = Boolean(pricing.custom_enabled) && pricing.custom_min !== null && pricing.custom_max !== null && pricing.custom_step !== null
        && cardAmountUsd >= pricing.custom_min && cardAmountUsd <= pricing.custom_max
        && Math.abs((cardAmountUsd - pricing.custom_min) / pricing.custom_step - Math.round((cardAmountUsd - pricing.custom_min) / pricing.custom_step)) < 1e-8;
      if (!isFixed && !isCustom) { await connection.rollback(); return reply.code(400).send({ error: "The requested card amount is not available." }); }
      const paymentAmount = Number((((cardAmountUsd + pricing.issuance_fee_usd) * pricing.exchange_rate_ngn_per_usd) + pricing.gross_profit_ngn).toFixed(2));
      const id = randomUUID();
      const orderNumber = "CR-" + Date.now().toString(36).toUpperCase() + "-" + randomUUID().slice(0, 6).toUpperCase();
      await connection.execute(
        "INSERT INTO orders (id, order_number, product_id, customer_email, customer_id, currency, amount, card_amount_usd, payment_currency, payment_amount_ngn, issuance_fee_usd_snapshot, exchange_rate_snapshot, gross_profit_ngn_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, orderNumber, product.id, customer.email, customer.id, pricing.currency, paymentAmount, cardAmountUsd, pricing.currency, paymentAmount, pricing.issuance_fee_usd, pricing.exchange_rate_ngn_per_usd, pricing.gross_profit_ngn],
      );
      await connection.commit();
      return reply.code(201).send({ orderId: id, orderNumber, status: "pending_payment", paymentStatus: "pending", cardAmountUsd, paymentAmount, paymentCurrency: pricing.currency, pricing: { issuanceFeeUsd: pricing.issuance_fee_usd, exchangeRateNgnPerUsd: pricing.exchange_rate_ngn_per_usd, grossProfitNgn: pricing.gross_profit_ngn }, nextStep: "initialize_payment" });
    } catch (error) { await connection.rollback(); request.log.error(error); return reply.code(500).send({ error: "Unable to create order." }); }
    finally { connection.release(); }
  });
  app.get("/api/orders/:orderId", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply);
    if (!customer) return reply;
    const params = z.object({ orderId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid order ID." });
    const [rows] = await db.query<Array<RowDataPacket & { order_number: string; payment_currency: string; payment_amount: number; card_amount_usd: number | null; order_status: string; payment_status: string; fulfilment_status: string; created_at: Date }>>(
      "SELECT order_number, payment_currency, COALESCE(payment_amount_ngn, amount) AS payment_amount, card_amount_usd, order_status, payment_status, fulfilment_status, created_at FROM orders WHERE id = ? AND customer_id = ?",
      [params.data.orderId, customer.id],
    );
    const order = rows[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    return { orderNumber: order.order_number, paymentCurrency: order.payment_currency, paymentAmount: order.payment_amount, cardAmountUsd: order.card_amount_usd, status: order.order_status, paymentStatus: order.payment_status, fulfilmentStatus: order.fulfilment_status, createdAt: order.created_at };
  });
}