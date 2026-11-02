import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { sendEmail } from "../mailer.js";

const SESSION_COOKIE = "cards_customer_session";
const SESSION_DAYS = 30;
const sendOtpSchema = z.object({ orderId: z.string().uuid() });
const verifyOtpSchema = z.object({ orderId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });
type CustomerOrder = RowDataPacket & { id: string; order_number: string; customer_email: string; currency: string; amount: number; order_status: string; payment_status: string; fulfilment_status: string; created_at: Date };
type SessionRow = RowDataPacket & { customer_email: string };

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function otpHash(code: string, orderId: string, email: string) {
  const pepper = process.env.SESSION_SECRET;
  if (!pepper || pepper.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return sha256(`${pepper}:${orderId}:${email}:${code}`);
}
function readCookie(request: FastifyRequest) {
  const item = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(SESSION_COOKIE.length + 1)); } catch { return null; }
}
function setCustomerCookie(reply: FastifyReply, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
async function customerEmail(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const token = readCookie(request);
  if (!token || token.length > 256) { reply.code(401).send({ error: "Verify your email to access this order." }); return null; }
  const [rows] = await db.query<SessionRow[]>(
    "SELECT customer_email FROM customer_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1",
    [sha256(token)],
  );
  if (!rows[0]) { reply.code(401).send({ error: "Your customer session has expired. Verify your email again." }); return null; }
  return rows[0].customer_email;
}

export async function registerCustomerRoutes(app: FastifyInstance) {
  app.post("/api/customer/otp/send", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = sendOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid order ID is required." });
    const [orders] = await db.query<CustomerOrder[]>(
      "SELECT id, order_number, customer_email, currency, amount, order_status, payment_status, fulfilment_status, created_at FROM orders WHERE id = ? LIMIT 1",
      [parsed.data.orderId],
    );
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (order.payment_status === "successful") return reply.code(409).send({ error: "This order has already been paid." });
    const [recent] = await db.query<Array<RowDataPacket & { created_at: Date }>>(
      "SELECT created_at FROM customer_email_otps WHERE order_id = ? ORDER BY id DESC LIMIT 1", [order.id],
    );
    if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) {
      return reply.code(429).send({ error: "A verification code was sent recently. Check your inbox before requesting another." });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.execute(
      "INSERT INTO customer_email_otps (order_id, customer_email, otp_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))",
      [order.id, order.customer_email, otpHash(code, order.id, order.customer_email)],
    );
    try {
      await sendEmail({
        to: order.customer_email,
        subject: `Verify your Cards by Raaduns order ${order.order_number}`,
        text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
        html: `<p>Use this code to verify your email for order <strong>${order.order_number}</strong>:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes.</p>`,
      });
    } catch (error) {
      await db.execute("DELETE FROM customer_email_otps WHERE order_id = ? AND otp_hash = ?", [order.id, otpHash(code, order.id, order.customer_email)]);
      request.log.error(error, "Customer verification email could not be sent");
      return reply.code(503).send({ error: "We could not send the verification email. Please try again later." });
    }
    return reply.code(202).send({ sent: true, destination: order.customer_email.replace(/^(.).+(@.*)$/, "$1***$2"), expiresInSeconds: 600 });
  });

  app.post("/api/customer/otp/verify", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter the six-digit code sent to your email." });
    const [orders] = await db.query<CustomerOrder[]>(
      "SELECT id, order_number, customer_email, currency, amount, order_status, payment_status, fulfilment_status, created_at FROM orders WHERE id = ? LIMIT 1",
      [parsed.data.orderId],
    );
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "Order not found." });
    const [codes] = await db.query<Array<RowDataPacket & { id: number; otp_hash: string }>>(
      "SELECT id, otp_hash FROM customer_email_otps WHERE order_id = ? AND customer_email = ? AND verified_at IS NULL AND expires_at > UTC_TIMESTAMP() AND attempts < 5 ORDER BY id DESC LIMIT 1",
      [order.id, order.customer_email],
    );
    const stored = codes[0];
    if (!stored) return reply.code(400).send({ error: "The code has expired or reached its attempt limit. Request a new code." });
    const expected = Buffer.from(stored.otp_hash, "hex");
    const actual = Buffer.from(otpHash(parsed.data.code, order.id, order.customer_email), "hex");
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
    await db.execute("UPDATE customer_email_otps SET attempts = attempts + 1, verified_at = IF(?, UTC_TIMESTAMP(), verified_at) WHERE id = ?", [valid, stored.id]);
    if (!valid) return reply.code(400).send({ error: "The verification code is incorrect." });
    const token = randomBytes(32).toString("hex");
    await db.execute("DELETE FROM customer_sessions WHERE customer_email = ? OR expires_at <= UTC_TIMESTAMP()", [order.customer_email]);
    await db.execute(
      "INSERT INTO customer_sessions (customer_email, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))",
      [order.customer_email, sha256(token)],
    );
    setCustomerCookie(reply, token);
    return { verified: true, email: order.customer_email, orderNumber: order.order_number };
  });

  app.get("/api/customer/orders", async (request, reply) => {
    const email = await customerEmail(request, reply);
    if (!email) return reply;
    const [orders] = await db.query<CustomerOrder[]>(
      "SELECT id, order_number, customer_email, currency, amount, order_status, payment_status, fulfilment_status, created_at FROM orders WHERE customer_email = ? ORDER BY created_at DESC LIMIT 50",
      [email],
    );
    return { orders: orders.map((order) => ({ orderId: order.id, orderNumber: order.order_number, currency: order.currency, amount: order.amount, status: order.order_status, paymentStatus: order.payment_status, fulfilmentStatus: order.fulfilment_status, createdAt: order.created_at })) };
  });

  app.post("/api/customer/auth/logout", async (request, reply) => {
    const token = readCookie(request);
    if (token) await db.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [sha256(token)]);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    reply.header("set-cookie", `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
    return { success: true };
  });
}

export async function requireOrderOwner(request: FastifyRequest, reply: FastifyReply, orderEmail: string) {
  const email = await customerEmail(request, reply);
  if (!email) return false;
  if (email !== orderEmail) { reply.code(403).send({ error: "This order belongs to a different verified email address." }); return false; }
  return true;
}