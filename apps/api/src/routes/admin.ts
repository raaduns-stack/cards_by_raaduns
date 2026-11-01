import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { decryptConfig, encryptConfig, getProviderConfig, type ProviderName } from "../provider-config.js";
import nodemailer from "nodemailer";

type AdminRole = "admin" | "operations" | "support";
type AdminIdentity = { id: number; email: string; displayName: string; role: AdminRole };
type AdminRow = RowDataPacket & { id: number; email: string; display_name: string; password_hash: string; role: AdminRole; is_active: number };
type SessionRow = RowDataPacket & { id: number; email: string; display_name: string; role: AdminRole; csrf_hash: string };

const SESSION_COOKIE = "cards_admin_session";
const CSRF_COOKIE = "cards_admin_csrf";
const SESSION_HOURS = 12;
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) });
const manualReviewSchema = z.object({ note: z.string().trim().min(5).max(1000) });
const pricingSchema = z.object({
  customEnabled: z.boolean(),
  customMin: z.number().positive().max(100000).nullable(),
  customMax: z.number().positive().max(100000).nullable(),
  customStep: z.number().positive().max(100000).nullable(),
  denominations: z.array(z.object({ amount: z.number().refine((n) => [20, 30, 50, 100, 150, 200].includes(n)), enabled: z.boolean() })).length(6),
}).superRefine((value, ctx) => {
  if (value.customEnabled && (value.customMin === null || value.customMax === null || value.customStep === null || value.customMax < value.customMin)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valid custom amount bounds and step are required." });
  }
  if (new Set(value.denominations.map((d) => d.amount)).size !== 6) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each approved denomination must appear exactly once." });
  if (!value.denominations.some((d) => d.enabled)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one fixed denomination must remain enabled." });
});

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, digest] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !digest || !/^[a-f0-9]{128}$/i.test(digest)) return false;
  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function cookieValue(request: FastifyRequest, name: string) {
  const header = request.headers.cookie ?? "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return null; }
}
function cookieOptions(secure: boolean) { return `Path=/api/admin; SameSite=Strict${secure ? "; Secure" : ""}`; }
function appendCookie(reply: FastifyReply, value: string) {
  const current = reply.getHeader("set-cookie");
  const values = current ? (Array.isArray(current) ? current.map(String) : [String(current)]) : [];
  values.push(value);
  reply.header("set-cookie", values);
}
function setSessionCookies(reply: FastifyReply, session: string, csrf: string, secure: boolean) {
  const base = cookieOptions(secure);
  appendCookie(reply, `${SESSION_COOKIE}=${encodeURIComponent(session)}; ${base}; HttpOnly; Max-Age=${SESSION_HOURS * 3600}`);
  appendCookie(reply, `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; ${base}; Max-Age=${SESSION_HOURS * 3600}`);
}
function clearSessionCookies(reply: FastifyReply, secure: boolean) {
  const base = cookieOptions(secure);
  appendCookie(reply, `${SESSION_COOKIE}=; ${base}; HttpOnly; Max-Age=0`);
  appendCookie(reply, `${CSRF_COOKIE}=; ${base}; Max-Age=0`);
}
async function authenticate(request: FastifyRequest, reply: FastifyReply, requireCsrf = false): Promise<AdminIdentity | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 256) { reply.code(401).send({ error: "Authentication required." }); return null; }
  const [rows] = await db.query<SessionRow[]>(
    `SELECT u.id, u.email, u.display_name, u.role, s.csrf_hash
     FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = 1 LIMIT 1`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) { clearSessionCookies(reply, process.env.NODE_ENV === "production"); reply.code(401).send({ error: "Session expired. Sign in again." }); return null; }
  if (requireCsrf) {
    const cookie = cookieValue(request, CSRF_COOKIE);
    const header = request.headers["x-csrf-token"];
    if (!cookie || typeof header !== "string" || cookie !== header || sha256(cookie) !== row.csrf_hash) {
      reply.code(403).send({ error: "CSRF validation failed." }); return null;
    }
  }
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}
function allowed(identity: AdminIdentity, roles: AdminRole[], reply: FastifyReply) {
  if (!roles.includes(identity.role)) { reply.code(403).send({ error: "Insufficient permissions." }); return false; }
  return true;
}
async function audit(identity: AdminIdentity, request: FastifyRequest, action: string, entityType: string, entityId: string | null, details: unknown) {
  await db.execute(
    "INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
    [identity.id, action, entityType, entityId, JSON.stringify(details ?? null), request.ip],
  );
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const secure = process.env.NODE_ENV === "production";

  app.post("/api/admin/auth/login", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid email and password." });
    const [rows] = await db.query<AdminRow[]>(
      "SELECT id, email, display_name, password_hash, role, is_active FROM admin_users WHERE email = ? LIMIT 1",
      [parsed.data.email.toLowerCase()],
    );
    const user = rows[0];
    if (!user || !user.is_active || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    await db.execute("DELETE FROM admin_sessions WHERE expires_at <= UTC_TIMESTAMP() OR admin_user_id = ?", [user.id]);
    await db.execute(
      "INSERT INTO admin_sessions (admin_user_id, token_hash, csrf_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))",
      [user.id, sha256(token), sha256(csrf)],
    );
    await audit({ id: user.id, email: user.email, displayName: user.display_name, role: user.role }, request, "auth.login", "admin_user", String(user.id), {});
    setSessionCookies(reply, token, csrf, secure);
    return { user: { email: user.email, displayName: user.display_name, role: user.role }, csrfToken: csrf };
  });

  app.get("/api/admin/auth/session", async (request, reply) => {
    const identity = await authenticate(request, reply);
    return identity ? { user: identity, csrfToken: cookieValue(request, CSRF_COOKIE) } : reply;
  });

  app.post("/api/admin/auth/logout", async (request, reply) => {
    const identity = await authenticate(request, reply, true);
    if (!identity) return reply;
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.execute("DELETE FROM admin_sessions WHERE token_hash = ?", [sha256(token)]);
    await audit(identity, request, "auth.logout", "admin_user", String(identity.id), {});
    clearSessionCookies(reply, secure);
    return { success: true };
  });

  app.get("/api/admin/overview", async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (!identity) return reply;
    const [counts] = await db.query<Array<RowDataPacket & { total_orders: number; awaiting_payment: number; paid: number; manual_review: number; fulfilled: number }>>(
      `SELECT COUNT(*) AS total_orders,
       SUM(payment_status = 'pending') AS awaiting_payment,
       SUM(payment_status = 'successful') AS paid,
       SUM(order_status = 'manual_review' OR fulfilment_status = 'manual_review') AS manual_review,
       SUM(fulfilment_status = 'completed') AS fulfilled FROM orders`,
    );
    const [recent] = await db.query<Array<RowDataPacket & { order_number: string; amount: number; currency: string; order_status: string; payment_status: string; fulfilment_status: string; created_at: Date }>>(
      "SELECT order_number, amount, currency, order_status, payment_status, fulfilment_status, created_at FROM orders ORDER BY created_at DESC LIMIT 8",
    );
    return { metrics: counts[0], recentOrders: recent };
  });

  app.get("/api/admin/orders", async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (!identity) return reply;
    const query = z.object({
      search: z.string().trim().max(120).optional(),
      status: z.enum(["all","pending_payment","paid","fulfilment_pending","fulfilled","cancelled","failed","manual_review"]).default("all"),
      page: z.coerce.number().int().min(1).default(1),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid order filters." });
    const { search = "", status, page } = query.data;
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (status !== "all") { where.push("o.order_status = ?"); params.push(status); }
    if (search) { where.push("(o.order_number LIKE ? OR o.customer_email LIKE ? OR o.id = ?)"); params.push(`%${search}%`, `%${search}%`, search); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT o.id, o.order_number, o.customer_email, o.currency, o.amount, o.order_status, o.payment_status, o.fulfilment_status, o.created_at, c.issuance_status, c.last4
       FROM orders o LEFT JOIN issued_cards c ON c.order_id = o.id ${clause}
       ORDER BY o.created_at DESC LIMIT 50 OFFSET ?`,
      [...params, (page - 1) * 50],
    );
    const [totals] = await db.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM orders o ${clause}`, params,
    );
    return { orders: rows, total: totals[0]?.total ?? 0, page, pageSize: 50 };
  });

  app.post("/api/admin/orders/:orderId/manual-review", async (request, reply) => {
    const identity = await authenticate(request, reply, true);
    if (!identity) return reply;
    if (!allowed(identity, ["admin","operations"], reply)) return reply;
    const params = z.object({ orderId: z.string().uuid() }).safeParse(request.params);
    const body = manualReviewSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "A valid order ID and review note are required." });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<Array<RowDataPacket & { payment_status: string; fulfilment_status: string }>>(
        "SELECT payment_status, fulfilment_status FROM orders WHERE id = ? FOR UPDATE", [params.data.orderId],
      );
      if (!rows[0]) { await connection.rollback(); return reply.code(404).send({ error: "Order not found." }); }
      if (rows[0].payment_status !== "successful" || rows[0].fulfilment_status === "completed") {
        await connection.rollback();
        return reply.code(409).send({ error: "Only payment-verified, unfulfilled orders can be moved to manual review." });
      }
      await connection.execute(
        "UPDATE orders SET order_status = 'manual_review', fulfilment_status = 'manual_review' WHERE id = ?", [params.data.orderId],
      );
      await connection.execute(
        "INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'order.manual_review', 'order', ?, ?, ?)",
        [identity.id, params.data.orderId, JSON.stringify({ note: body.data.note }), request.ip],
      );
      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      request.log.error(error);
      return reply.code(500).send({ error: "Unable to update order." });
    } finally { connection.release(); }
  });

  app.get("/api/admin/pricing", async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (!identity) return reply;
    const [settings] = await db.query<Array<RowDataPacket & { currency: string; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null }>>(
      "SELECT currency, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1",
    );
    const [denominations] = await db.query<Array<RowDataPacket & { amount: number; is_enabled: number }>>(
      "SELECT amount, is_enabled FROM fixed_denominations ORDER BY sort_order",
    );
    return { settings: settings[0] ?? null, denominations };
  });

  app.put("/api/admin/pricing", async (request, reply) => {
    const identity = await authenticate(request, reply, true);
    if (!identity) return reply;
    if (!allowed(identity, ["admin"], reply)) return reply;
    const parsed = pricingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid pricing configuration.", details: parsed.error.flatten() });
    const value = parsed.data;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [beforeSettings] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
        "SELECT currency, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1 FOR UPDATE",
      );
      const [beforeDenominations] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
        "SELECT amount, is_enabled FROM fixed_denominations ORDER BY sort_order FOR UPDATE",
      );
      if (!beforeSettings[0]) { await connection.rollback(); return reply.code(503).send({ error: "Pricing is not configured." }); }
      await connection.execute(
        "UPDATE pricing_settings SET custom_enabled = ?, custom_min = ?, custom_max = ?, custom_step = ? WHERE id = 1",
        [value.customEnabled, value.customEnabled ? value.customMin : null, value.customEnabled ? value.customMax : null, value.customEnabled ? value.customStep : null],
      );
      for (const item of value.denominations) {
        await connection.execute("UPDATE fixed_denominations SET is_enabled = ? WHERE amount = ?", [item.enabled, item.amount]);
      }
      await connection.execute(
        "INSERT INTO admin_audit_log (admin_user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'pricing.updated', 'pricing', '1', ?, ?)",
        [identity.id, JSON.stringify({ before: { settings: beforeSettings[0], denominations: beforeDenominations }, after: value }), request.ip],
      );
      await connection.commit();
      return { success: true };
    } catch (error) {
      await connection.rollback();
      request.log.error(error);
      return reply.code(500).send({ error: "Unable to save pricing configuration." });
    } finally { connection.release(); }
  });

  app.get("/api/admin/providers", async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (!identity) return reply;
    if (!allowed(identity, ["admin"], reply)) return reply;
    const providers: ProviderName[] = ["flutterwave", "kripicard", "smtp"];
    const [stored] = await db.query<Array<RowDataPacket & { provider: ProviderName; encrypted_config: string; environment: string; verification_status: string; last_verified_at: Date | null }>>("SELECT provider, encrypted_config, environment, verification_status, last_verified_at FROM provider_settings");
    const result = [];
    for (const provider of providers) {
      const row = stored.find((item) => item.provider === provider);
      const config = row ? decryptConfig(row.encrypted_config) : await getProviderConfig(provider);
      const required = provider === "flutterwave" ? ["secretKey", "webhookSecret"] : provider === "kripicard" ? ["apiKey"] : ["host", "port", "user", "password"];
      result.push({ provider, configured: required.every((key) => Boolean(config[key]?.trim())), configuredFields: required.filter((key) => Boolean(config[key]?.trim())), environment: row?.environment ?? config.environment ?? "production", verificationStatus: row?.verification_status ?? "not_tested", lastVerifiedAt: row?.last_verified_at ?? null });
    }
    return { providers: result };
  });

  app.put("/api/admin/providers/:provider", async (request, reply) => {
    const identity = await authenticate(request, reply, true);
    if (!identity) return reply;
    if (!allowed(identity, ["admin"], reply)) return reply;
    const params = z.object({ provider: z.enum(["flutterwave", "kripicard", "smtp"]) }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Unknown provider." });
    const provider = params.data.provider;
    const schemas = {
      flutterwave: z.object({ secretKey: z.string().max(500).optional(), webhookSecret: z.string().max(500).optional(), environment: z.enum(["test", "live"]) }),
      kripicard: z.object({ apiKey: z.string().max(500).optional(), bin: z.string().regex(/^\d{6}$/).optional() }),
      smtp: z.object({ host: z.string().trim().max(255).optional(), port: z.coerce.number().int().min(1).max(65535).optional(), user: z.string().trim().max(254).optional(), password: z.string().max(500).optional(), from: z.string().trim().max(254).optional() }),
    };
    const parsed = schemas[provider].safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid provider configuration." });
    try {
      const current = await getProviderConfig(provider);
      const next = { ...current, ...Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined && value !== "")) } as Record<string, string>;
      const required = provider === "flutterwave" ? ["secretKey", "webhookSecret"] : provider === "kripicard" ? ["apiKey"] : ["host", "port", "user", "password"];
      if (!required.every((key) => Boolean(next[key]?.trim()))) return reply.code(400).send({ error: "All required provider fields must be configured before saving." });
      const environment = provider === "flutterwave" ? (next.environment ?? "test") : "production";
      await db.execute("INSERT INTO provider_settings (provider, encrypted_config, environment, verification_status, configured_by) VALUES (?, ?, ?, 'not_tested', ?) ON DUPLICATE KEY UPDATE encrypted_config = VALUES(encrypted_config), environment = VALUES(environment), verification_status = 'not_tested', last_verified_at = NULL, configured_by = VALUES(configured_by)", [provider, encryptConfig(next), environment, identity.id]);
      await audit(identity, request, "provider.credentials_updated", "provider", provider, { configuredFields: required.filter((key) => Boolean(next[key])), environment });
      return { success: true, message: "Provider credentials saved securely. Secret values are not returned." };
    } catch (error) {
      request.log.error({ provider, error: error instanceof Error ? error.message : "unknown" }, "Provider settings save failed");
      return reply.code(503).send({ error: "Secure provider storage is unavailable. Configure APP_ENCRYPTION_KEY and apply database migrations." });
    }
  });

  app.post("/api/admin/providers/:provider/verify", async (request, reply) => {
    const identity = await authenticate(request, reply, true);
    if (!identity) return reply;
    if (!allowed(identity, ["admin"], reply)) return reply;
    const params = z.object({ provider: z.enum(["flutterwave", "kripicard", "smtp"]) }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Unknown provider." });
    const provider = params.data.provider;
    try {
      const config = await getProviderConfig(provider);
      if (provider === "kripicard") return reply.code(501).send({ error: "Kripicard has no documented non-issuing credential verification endpoint. Credentials are stored but cannot be safely connection-tested." });
      if (provider === "smtp") {
        const port = Number(config.port ?? 587);
        const transport = nodemailer.createTransport({ host: config.host, port, secure: port === 465, requireTLS: port === 587, auth: { user: config.user, pass: config.password }, tls: { rejectUnauthorized: true }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
        try { await transport.verify(); } finally { transport.close(); }
      } else {
        if (!config.secretKey) return reply.code(400).send({ error: "Flutterwave credentials are not configured." });
        const response = await fetch("https://api.flutterwave.com/v3/balances/NGN", { headers: { Authorization: "Bearer " + config.secretKey }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Flutterwave returned HTTP " + response.status);
      }
      await db.execute("UPDATE provider_settings SET verification_status = 'verified', last_verified_at = UTC_TIMESTAMP() WHERE provider = ?", [provider]);
      await audit(identity, request, "provider.connection_verified", "provider", provider, { success: true });
      return { success: true, verificationStatus: "verified" };
    } catch (error) {
      await db.execute("UPDATE provider_settings SET verification_status = 'failed', last_verified_at = UTC_TIMESTAMP() WHERE provider = ?", [provider]);
      await audit(identity, request, "provider.connection_verification_failed", "provider", provider, { success: false });
      request.log.warn({ provider }, "Provider connection verification failed");
      return reply.code(502).send({ error: "Provider verification failed. Check credentials and network configuration." });
    }
  });

  app.get("/api/admin/audit", async (request, reply) => {
    const identity = await authenticate(request, reply);
    if (!identity) return reply;
    if (!allowed(identity, ["admin"], reply)) return reply;
    const parsed = z.object({ page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid page." });
    const [rows] = await db.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.ip_address, a.created_at, u.email, u.display_name
       FROM admin_audit_log a LEFT JOIN admin_users u ON u.id = a.admin_user_id
       ORDER BY a.created_at DESC LIMIT 50 OFFSET ?`, [(parsed.data.page - 1) * 50],
    );
    return { events: rows, page: parsed.data.page, pageSize: 50 };
  });
}

[executed on device: mail.quicrefill.com (657bc0f0-b268-4295-8ef1-fac3aa0eceb5)]