import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../db.js";
import { getProviderConfig } from "../provider-config.js";

type OrderRow = RowDataPacket & { id: string; customer_email: string; amount: number; payment_status: string };
type IssuanceRow = RowDataPacket & {
  id: number; order_id: string; provider_card_id: string | null;
  provider_order_id: string | null; provider_reference: string | null; issuance_status: string;
};

const baseUrl = "https://appapi.kripicard.com";
function cardholderName(email: string) {
  const localPart = email.split("@")[0] ?? "";
  const normalized = localPart.replace(/[^a-zA-Z]+/g, " ").trim().toUpperCase().slice(0, 26);
  return normalized.length >= 2 ? normalized : "CARD CUSTOMER";
}
async function providerRequest(path: string, body: Record<string, unknown>) {
  const config = await getProviderConfig("kripicard");
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error("Kripicard is not configured.");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...body, api_key: apiKey }), signal: AbortSignal.timeout(25000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  return { statusCode: response.status, payload };
}

export async function issueCardForOrder(orderId: string, logger?: { error: (obj: unknown, message: string) => void }) {
  const [orders] = await db.query<OrderRow[]>(
    "SELECT id, customer_email, amount, payment_status FROM orders WHERE id = ?", [orderId],
  );
  const order = orders[0];
  if (!order || order.payment_status !== "successful") return { status: "not_payable" };

  await db.execute(
    "INSERT IGNORE INTO issued_cards (order_id, provider, issuance_status, name_on_card, bin) VALUES (?, 'kripicard', 'queued', ?, ?)",
    [order.id, cardholderName(order.customer_email), (await getProviderConfig("kripicard")).bin ?? "539502"],
  );
  const [rows] = await db.query<IssuanceRow[]>(
    "SELECT id, order_id, provider_card_id, provider_order_id, provider_reference, issuance_status FROM issued_cards WHERE order_id = ? AND provider = 'kripicard'",
    [order.id],
  );
  const issuance = rows[0];
  if (!issuance) return { status: "missing" };
  if (issuance.issuance_status !== "queued") return { status: issuance.issuance_status };

  const [claim] = await db.execute(
    "UPDATE issued_cards SET issuance_status = 'issuing' WHERE id = ? AND issuance_status = 'queued'",
    [issuance.id],
  );
  if ((claim as { affectedRows: number }).affectedRows !== 1) return { status: "already_claimed" };

  const [details] = await db.query<Array<RowDataPacket & { name_on_card: string; bin: string }>>(
    "SELECT name_on_card, bin FROM issued_cards WHERE id = ?", [issuance.id],
  );
  const cardConfig = details[0];
  if (!cardConfig) {
    await db.execute("UPDATE issued_cards SET issuance_status = 'manual_review' WHERE id = ?", [issuance.id]);
    return { status: "manual_review" };
  }
  try {
    const { statusCode, payload } = await providerRequest("/api/external/cards/createcard", {
      bin: cardConfig.bin, amount: Number(order.amount),
      name_on_card: cardConfig.name_on_card, email: order.customer_email,
    });
    if (statusCode === 200 && payload.success === true && payload.card_id) {
      await db.execute(
        "UPDATE issued_cards SET provider_card_id = ?, last4 = ?, issuance_status = 'active' WHERE id = ?",
        [String(payload.card_id), payload.last_4 ? String(payload.last_4).slice(-4) : null, issuance.id],
      );
      await db.execute(
        "UPDATE orders SET fulfilment_status = 'completed', order_status = 'fulfilment_pending' WHERE id = ? AND order_status <> 'manual_review'", [order.id],
      );
      return { status: "active" };
    }
    if (statusCode === 202 || payload.pending === true || payload.code === "ISSUANCE_PENDING") {
      await db.execute(
        "UPDATE issued_cards SET provider_reference = ?, provider_order_id = ?, issuance_status = 'pending' WHERE id = ?",
        [payload.reference ? String(payload.reference) : null, payload.order_id ? String(payload.order_id) : null, issuance.id],
      );
      await db.execute(
        "UPDATE orders SET fulfilment_status = 'processing', order_status = 'fulfilment_pending' WHERE id = ? AND order_status <> 'manual_review'", [order.id],
      );
      return { status: "pending" };
    }
    await db.execute("UPDATE issued_cards SET issuance_status = 'manual_review' WHERE id = ?", [issuance.id]);
    await db.execute("UPDATE orders SET fulfilment_status = 'manual_review', order_status = 'manual_review' WHERE id = ? AND order_status <> 'manual_review'", [order.id]);
    logger?.error({ orderId, statusCode, providerCode: payload.code }, "Kripicard issuance requires manual review");
    return { status: "manual_review" };
  } catch (error) {
    // A network timeout has an ambiguous provider outcome. Never create a second card blindly.
    await db.execute("UPDATE issued_cards SET issuance_status = 'manual_review' WHERE id = ?", [issuance.id]);
    await db.execute("UPDATE orders SET fulfilment_status = 'manual_review', order_status = 'manual_review' WHERE id = ?", [order.id]);
    logger?.error({ orderId, error }, "Kripicard issuance outcome is unknown; manual review required");
    return { status: "manual_review" };
  }
}

export async function pollPendingIssuances(limit = 50) {
  const [rows] = await db.query<Array<IssuanceRow & { bin: string }>>(
    "SELECT id, order_id, provider_card_id, provider_order_id, provider_reference, issuance_status, bin FROM issued_cards WHERE provider = 'kripicard' AND issuance_status = 'pending' ORDER BY updated_at ASC LIMIT ?",
    [Math.min(Math.max(limit, 1), 100)],
  );
  const results: Array<{ orderId: string; status: string }> = [];
  for (const issuance of rows) {
    const identifier = issuance.provider_reference ? { reference: issuance.provider_reference }
      : issuance.provider_order_id ? { order_id: issuance.provider_order_id } : null;
    if (!identifier) {
      await db.execute("UPDATE issued_cards SET issuance_status = 'manual_review' WHERE id = ?", [issuance.id]);
      results.push({ orderId: issuance.order_id, status: "manual_review" });
      continue;
    }
    try {
      const { statusCode, payload } = await providerRequest("/api/external/cards/request-status", identifier);
      if (statusCode === 200 && payload.success === true && payload.status === "completed" && payload.card_id) {
        await db.execute("UPDATE issued_cards SET provider_card_id = ?, issuance_status = 'active' WHERE id = ?", [String(payload.card_id), issuance.id]);
        await db.execute("UPDATE orders SET fulfilment_status = 'completed', order_status = 'fulfilment_pending' WHERE id = ?", [issuance.order_id]);
        results.push({ orderId: issuance.order_id, status: "active" });
      } else if (statusCode === 200 && payload.status === "refunded") {
        await db.execute("UPDATE issued_cards SET issuance_status = 'refunded' WHERE id = ?", [issuance.id]);
        await db.execute("UPDATE orders SET fulfilment_status = 'failed', order_status = 'manual_review' WHERE id = ? AND order_status <> 'manual_review'", [issuance.order_id]);
        results.push({ orderId: issuance.order_id, status: "refunded" });
      } else if (statusCode === 404) {
        await db.execute("UPDATE issued_cards SET issuance_status = 'manual_review' WHERE id = ?", [issuance.id]);
        await db.execute("UPDATE orders SET fulfilment_status = 'manual_review', order_status = 'manual_review' WHERE id = ?", [issuance.order_id]);
        results.push({ orderId: issuance.order_id, status: "manual_review" });
      } else results.push({ orderId: issuance.order_id, status: "pending" });
    } catch {
      results.push({ orderId: issuance.order_id, status: "pending" });
    }
  }
  return results;
}

const pollSchema = z.object({ limit: z.number().int().min(1).max(100).optional() });
export async function registerKripicardRoutes(app: FastifyInstance) {
  app.post("/api/internal/kripicard/poll", async (request, reply) => {
    const secret = process.env.INTERNAL_JOB_SECRET;
    const supplied = request.headers["x-job-secret"];
    if (!secret || typeof supplied !== "string" || supplied !== secret) return reply.code(401).send({ error: "Unauthorized." });
    const parsed = pollSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid poll request." });
    const results = await pollPendingIssuances(parsed.data.limit);
    return { processed: results.length, results };
  });
}