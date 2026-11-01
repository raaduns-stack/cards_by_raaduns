import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "./db.js";

export type ProviderName = "flutterwave" | "kripicard" | "smtp";
export type ProviderConfig = Record<string, string>;
type ConfigRow = RowDataPacket & { encrypted_config: string };
function encryptionKey() {
  const value = process.env.APP_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}
export function encryptConfig(value: ProviderConfig) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export function decryptConfig(value: string): ProviderConfig {
  const raw = Buffer.from(value, "base64");
  if (raw.length < 29) throw new Error("Stored provider configuration is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as ProviderConfig;
}
export async function getProviderConfig(provider: ProviderName): Promise<ProviderConfig> {
  const [rows] = await db.query<ConfigRow[]>("SELECT encrypted_config FROM provider_settings WHERE provider = ? LIMIT 1", [provider]);
  if (rows[0]) return decryptConfig(rows[0].encrypted_config);
  if (provider === "flutterwave") return { secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? "", webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET ?? "", environment: process.env.FLUTTERWAVE_ENVIRONMENT ?? "test" };
  if (provider === "kripicard") return { apiKey: process.env.KRIPICARD_API_KEY ?? "", bin: process.env.KRIPICARD_BIN ?? "539502" };
  return { host: process.env.SMTP_HOST ?? "", port: process.env.SMTP_PORT ?? "587", user: process.env.SMTP_USER ?? "", password: process.env.SMTP_PASSWORD ?? "", from: process.env.SMTP_FROM ?? "" };
}