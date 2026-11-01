import type { FastifyInstance } from "fastify";
import { db } from "../db.js";

type ProductRow = { id: number; code: string; name: string; network: string };
type DenominationRow = { amount: number };
type SettingsRow = { currency: string; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null };

export async function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/api/catalog", async (_request, reply) => {
    const [products] = await db.query<ProductRow[]>(
      "SELECT id, code, name, network FROM card_products WHERE is_active = 1 ORDER BY id",
    );
    const [denominations] = await db.query<DenominationRow[]>(
      "SELECT amount FROM fixed_denominations WHERE is_enabled = 1 ORDER BY sort_order",
    );
    const [settings] = await db.query<SettingsRow[]>(
      "SELECT currency, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1",
    );
    if (!settings[0]) return reply.code(503).send({ error: "Pricing is not configured." });
    const pricing = settings[0];
    return {
      products,
      currency: pricing.currency,
      denominations: denominations.map((item) => item.amount),
      customAmount: {
        enabled: Boolean(pricing.custom_enabled),
        min: pricing.custom_enabled ? pricing.custom_min : null,
        max: pricing.custom_enabled ? pricing.custom_max : null,
        step: pricing.custom_enabled ? pricing.custom_step : null,
      },
    };
  });
}
