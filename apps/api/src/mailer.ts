import nodemailer, { type Transporter } from "nodemailer";
import { getProviderConfig } from "./provider-config.js";

let transporter: Transporter | undefined;
let transporterKey = "";

async function getTransporter() {
  const config = await getProviderConfig("smtp");
  const host = config.host?.trim();
  const port = Number(config.port ?? 587);
  const user = config.user?.trim();
  const pass = config.password;
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP is not configured. Configure SMTP in Admin > Providers.");
  }
  const key = JSON.stringify([host, port, user, pass]);
  if (!transporter || transporterKey !== key) {
    transporter?.close();
    transporter = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port === 587,
      auth: { user, pass },
      // Temporary CTO-approved workaround for the expired SMTP certificate.
      // Keep verification enabled by default; remove SMTP_ALLOW_INVALID_CERT after renewal.
      tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERT !== "true" },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    transporterKey = key;
  }
  return transporter;
}

export async function verifySmtpConnection() {
  await (await getTransporter()).verify();
}

export async function sendEmail(message: { to: string; subject: string; text: string; html?: string }) {
  const config = await getProviderConfig("smtp");
  const from = config.from?.trim() || config.user?.trim();
  if (!from) throw new Error("SMTP_FROM or SMTP_USER must be configured.");
  return (await getTransporter()).sendMail({ from, ...message });
}