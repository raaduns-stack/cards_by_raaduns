import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { db } from "../db.js";

const createOrderSchema = z.object({
  productCode: z.string().min(1).max(40),
  amount: z.number().finite().positive().max(100000),
  email: z.string().trim().email().max(254),
});

type ProductRow = RowDataPacket & { id: number; code: string };
type PricingRow = RowDataPacket & { currency: string; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null };

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/api/orders", async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid order details.", details: parsed.error.flatten() });
    const { productCode, amount, email } = parsed.data;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [products] = await connection.query<ProductRow[]>(
        "SELECT id, code FROM card_products WHERE code = ? AND is_active = 1 FOR UPDATE",
        [productCode],
      );
      const product = products[0];
      if (!product) {
        await connection.rollback();
        return reply.code(400).send({ error: "This card product is not available." });
      }
      const [settings] = await connection.query<PricingRow[]>(
        "SELECT currency, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1",
      );
      const pricing = settings[0];
      if (!pricing) {
        await connection.rollback();
        return reply.code(503).send({ error: "Pricing is not configured." });
      }
      const [fixed] = await connection.query<Array<RowDataPacket & { amount: number }>>(
        "SELECT amount FROM fixed_denominations WHERE amount = ? AND is_enabled = 1",
        [amount],
      );
      const isFixed = fixed.length > 0;
      const isCustom = Boolean(pricing.custom_enabled)
        && pricing.custom_min !== null && pricing.custom_max !== null && pricing.custom_step !== null
        && amount >= pricing.custom_min && amount <= pricing.custom_max
        && Math.abs((amount - pricing.custom_min) / pricing.custom_step - Math.round((amount - pricing.custom_min) / pricing.custom_step)) < 1e-8;
      if (!isFixed && !isCustom) {
        await connection.rollback();
        return reply.code(400).send({ error: "The requested amount is not available." });
      }
      const id = randomUUID();
      const orderNumber = `CR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      await connection.execute(
        "INSERT INTO orders (id, order_number, product_id, customer_email, currency, amount) VALUES (?, ?, ?, ?, ?, ?)",
        [id, orderNumber, product.id, email.toLowerCase(), pricing.currency, amount],
      );
      await connection.commit();
      return reply.code(201).send({
        orderId: id,
        orderNumber,
        status: "pending_payment",
        paymentStatus: "pending",
        amount,
        currency: pricing.currency,
        nextStep: "initialize_payment",
      });
    } catch (error) {
      await connection.rollback();
      request.log.error(error);
      return reply.code(500).send({ error: "Unable to create order." });
    } finally {
      connection.release();
    }
  });

  app.get("/api/orders/:orderId", async (request, reply) => {
    const params = z.object({ orderId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid order ID." });
    const [rows] = await db.query<Array<RowDataPacket & {
      order_number: string; currency: string; amount: number;
      order_status: string; payment_status: string; fulfilment_status: string; created_at: Date;
    }>>(
      "SELECT order_number, currency, amount, order_status, payment_status, fulfilment_status, created_at FROM orders WHERE id = ?",
      [params.data.orderId],
    );
    const order = rows[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    return {
      orderNumber: order.order_number,
      currency: order.currency,
      amount: order.amount,
      status: order.order_status,
      paymentStatus: order.payment_status,
      fulfilmentStatus: order.fulfilment_status,
      createdAt: order.created_at,
    };
  });
}
