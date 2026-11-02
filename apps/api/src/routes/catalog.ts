import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2";
import { db } from "../db.js";
import { getProviderConfig } from "../provider-config.js";

type ProductRow = RowDataPacket & { id: number; code: string; name: string; network: string };
type DenominationRow = RowDataPacket & { amount: number };
type SettingsRow = RowDataPacket & { currency: string; exchange_rate_ngn_per_usd: number; issuance_fee_usd: number; gross_profit_ngn: number; custom_enabled: number; custom_min: number | null; custom_max: number | null; custom_step: number | null };

export async function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/api/catalog", async (_request, reply) => {
    const [products] = await db.query<ProductRow[]>("SELECT id, code, name, network FROM card_products WHERE is_active = 1 ORDER BY id");
    const [denominations] = await db.query<DenominationRow[]>("SELECT amount FROM fixed_denominations WHERE is_enabled = 1 ORDER BY sort_order");
    const [settings] = await db.query<SettingsRow[]>("SELECT currency, exchange_rate_ngn_per_usd, issuance_fee_usd, gross_profit_ngn, custom_enabled, custom_min, custom_max, custom_step FROM pricing_settings WHERE id = 1");
    if (!settings[0]) return reply.code(503).send({ error: "Pricing is not configured." });
    const p = settings[0];
    const btcpay = await getProviderConfig("btcpay");
    const [btcpayRows] = await db.query<Array<RowDataPacket & { verification_status: string }>>("SELECT verification_status FROM provider_settings WHERE provider = 'btcpay' LIMIT 1");
    const btcpayVerified = btcpayRows[0]?.verification_status === "verified";
    const quote = (usd: number) => Number((((usd + p.issuance_fee_usd) * p.exchange_rate_ngn_per_usd) + p.gross_profit_ngn).toFixed(2));
    return {
      products,
      cardCurrency: "USD",
      paymentCurrency: p.currency,
      pricing: { exchangeRateNgnPerUsd: p.exchange_rate_ngn_per_usd, issuanceFeeUsd: p.issuance_fee_usd, grossProfitNgn: p.gross_profit_ngn },
      denominations: denominations.map((item) => ({ amountUsd: item.amount, priceNgn: quote(item.amount) })),
      customAmount: { enabled: Boolean(p.custom_enabled), min: p.custom_enabled ? p.custom_min : null, max: p.custom_enabled ? p.custom_max : null, step: p.custom_enabled ? p.custom_step : null },
      paymentMethods: { flutterwave: true, btcpay: btcpay.enabled === "true" && btcpayVerified },
    };
  });
}