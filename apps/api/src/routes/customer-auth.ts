import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { sendEmail } from "../mailer.js";

type CustomerIdentity = { id: number; email: string };
type CustomerSessionRow = RowDataPacket & { id: number; email: string; csrf_hash: string };
const SESSION_COOKIE = "cards_customer_session";
const CSRF_COOKIE = "cards_customer_csrf";
const SESSION_HOURS = 24 * 7;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const emailSchema = z.object({ email: z.string().trim().email().max(254) });
function cookieValue(request: FastifyRequest, name: string) {
  const item = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return null; }
}
function appendCookie(reply: FastifyReply, value: string) {
  const current = reply.getHeader("set-cookie");
  const values = current ? (Array.isArray(current) ? current.map(String) : [String(current)]) : [];
  values.push(value); reply.header("set-cookie", values);
}
function setCookies(reply: FastifyReply, token: string, csrf: string, secure: boolean) {
  const base = `Path=/api; SameSite=Strict${secure ? "; Secure" : ""}; Max-Age=${SESSION_HOURS * 3600}`;
  appendCookie(reply, `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${base}; HttpOnly`);
  appendCookie(reply, `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; ${base}`);
}
function clearCookies(reply: FastifyReply, secure: boolean) {
  const base = `Path=/api; SameSite=Strict${secure ? "; Secure" : ""}; Max-Age=0`;
  appendCookie(reply, `${SESSION_COOKIE}=; ${base}; HttpOnly`);
  appendCookie(reply, `${CSRF_COOKIE}=; ${base}`);
}
export async function authenticateCustomer(request: FastifyRequest, reply: FastifyReply, requireCsrf = false): Promise<CustomerIdentity | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 256) { reply.code(401).send({ error: "Customer sign-in required." }); return null; }
  const [rows] = await db.query<CustomerSessionRow[]>(
    `SELECT c.id, c.email, s.csrf_hash FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`, [sha256(token)],
  );
  const row = rows[0];
  if (!row) { clearCookies(reply, process.env.NODE_ENV === "production"); reply.code(401).send({ error: "Session expired. Sign in again." }); return null; }
  if (requireCsrf) {
    const cookie = cookieValue(request, CSRF_COOKIE); const header = request.headers["x-csrf-token"];
    if (!cookie || typeof header !== "string" || cookie !== header || sha256(cookie) !== row.csrf_hash) {
      reply.code(403).send({ error: "CSRF validation failed." }); return null;
    }
  }
  return { id: row.id, email: row.email };
}

export async function registerCustomerAuthRoutes(app: FastifyInstance) {
  const secure = process.env.NODE_ENV === "production";
  app.post("/api/customer/auth/request-code", { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid email address." });
    const email = parsed.data.email.toLowerCase();
    const [recent] = await db.query<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM customer_login_codes WHERE email = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)", [email],
    );
    if (Number(recent[0]?.count ?? 0) >= 3) return reply.code(429).send({ error: "Too many codes requested. Try again later." });
    const code = randomBytes(4).readUInt32BE(0) % 1000000;
    const codeText = String(code).padStart(6, "0");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(codeText, salt, 64).toString("hex");
    await db.execute("UPDATE customer_login_codes SET consumed_at = UTC_TIMESTAMP() WHERE email = ? AND consumed_at IS NULL", [email]);
    await db.execute(
      "INSERT INTO customer_login_codes (email, code_hash, code_salt, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))",
      [email, hash, salt],
    );
    try {
      await sendEmail({ to: email, subject: "Your Cards by Raaduns sign-in code", text: `Your sign-in code is ${codeText}. It expires in 10 minutes. If you did not request this code, you can ignore this email.` });
    } catch (error) {
      request.log.error({ error: error instanceof Error ? error.message : "unknown" }, "Customer OTP email delivery failed");
      await db.execute("UPDATE customer_login_codes SET consumed_at = UTC_TIMESTAMP() WHERE email = ? AND code_hash = ?", [email, hash]);
      return reply.code(503).send({ error: "We could not send your code. Please try again later." });
    }
    return { success: true, message: "If the address can receive mail, a sign-in code has been sent." };
  });

  app.post("/api/customer/auth/verify-code", { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const parsed = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter your email and six-digit code." });
    const email = parsed.data.email.toLowerCase();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [codes] = await connection.query<Array<RowDataPacket & { id: number; code_hash: string; code_salt: string; attempts: number }>>(
        "SELECT id, code_hash, code_salt, attempts FROM customer_login_codes WHERE email = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY id DESC LIMIT 1 FOR UPDATE", [email],
      );
      const challenge = codes[0];
      if (!challenge || challenge.attempts >= 5) { await connection.rollback(); return reply.code(400).send({ error: "Invalid or expired code. Request a new code." }); }
      const actual = scryptSync(parsed.data.code, challenge.code_salt, 64);
      const expected = Buffer.from(challenge.code_hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await connection.execute("UPDATE customer_login_codes SET attempts = attempts + 1 WHERE id = ?", [challenge.id]);
        await connection.commit();
        return reply.code(400).send({ error: "Invalid or expired code. Request a new code." });
      }
      await connection.execute("UPDATE customer_login_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = ?", [challenge.id]);
      await connection.execute("INSERT INTO customers (email, email_verified_at) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE email = VALUES(email)", [email]);
      const [customers] = await connection.query<Array<RowDataPacket & { id: number }>>("SELECT id FROM customers WHERE email = ? LIMIT 1", [email]);
      const customerId = customers[0]!.id;
      await connection.execute("UPDATE orders SET customer_id = ? WHERE customer_id IS NULL AND customer_email = ?", [customerId, email]);
      const token = randomBytes(32).toString("hex"); const csrf = randomBytes(32).toString("hex");
      await connection.execute("DELETE FROM customer_sessions WHERE expires_at <= UTC_TIMESTAMP() OR customer_id = ?", [customerId]);
      await connection.execute("INSERT INTO customer_sessions (customer_id, token_hash, csrf_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))", [customerId, sha256(token), sha256(csrf)]);
      await connection.commit();
      setCookies(reply, token, csrf, secure);
      return { success: true, customer: { email }, csrfToken: csrf };
    } catch (error) {
      await connection.rollback(); request.log.error(error);
      return reply.code(500).send({ error: "Unable to verify sign-in code." });
    } finally { connection.release(); }
  });

  app.get("/api/customer/orders", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply);
    if (!customer) return reply;
    const [orders] = await db.query<Array<RowDataPacket & { id: string; order_number: string; payment_currency: string; payment_amount: number; card_amount_usd: number | null; order_status: string; payment_status: string; fulfilment_status: string; created_at: Date; last4: string | null; issuance_status: string | null; latest_payment_provider: string | null; latest_payment_status: string | null; latest_payment_url: string | null }>>(
      `SELECT o.id, o.order_number, o.payment_currency, COALESCE(o.payment_amount_ngn, o.amount) AS payment_amount, o.card_amount_usd, o.order_status, o.payment_status, o.fulfilment_status, o.created_at, c.last4, c.issuance_status,
       (SELECT pa.provider FROM payment_attempts pa WHERE pa.order_id = o.id ORDER BY pa.id DESC LIMIT 1) AS latest_payment_provider,
       (SELECT pa.status FROM payment_attempts pa WHERE pa.order_id = o.id ORDER BY pa.id DESC LIMIT 1) AS latest_payment_status,
       (SELECT pa.checkout_url FROM payment_attempts pa WHERE pa.order_id = o.id ORDER BY pa.id DESC LIMIT 1) AS latest_payment_url
       FROM orders o LEFT JOIN issued_cards c ON c.order_id = o.id
       WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 100`, [customer.id],
    );
    return { orders };
  });

  app.get("/api/customer/auth/session", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply);
    return customer ? { customer, csrfToken: cookieValue(request, CSRF_COOKIE) } : reply;
  });
  app.post("/api/customer/auth/logout", async (request, reply) => {
    const customer = await authenticateCustomer(request, reply, true);
    if (!customer) return reply;
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.execute("DELETE FROM customer_sessions WHERE token_hash = ?", [sha256(token)]);
    clearCookies(reply, secure);
    return { success: true };
  });
}