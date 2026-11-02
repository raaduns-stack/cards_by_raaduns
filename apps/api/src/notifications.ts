import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "./db.js";
import { sendEmail } from "./mailer.js";

type OutboxRow = RowDataPacket & {
  id: number; recipient: string; subject: string; text_body: string; html_body: string | null;
};

export async function enqueuePaymentReceipt(connection: PoolConnection, order: { id: string; order_number: string; customer_email: string; currency: string; amount: number }) {
  const amount = Number(order.amount).toFixed(2);
  const subject = `Payment received — order ${order.order_number}`;
  const text = [
    "We have verified your payment.",
    "",
    `Order: ${order.order_number}`,
    `Amount: ${order.currency} ${amount}`,
    "",
    "Your virtual card is now being processed. We will send a separate notification when fulfilment is complete.",
    "If you did not place this order, contact our support team.",
    "",
    "Cards by Raaduns",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>Payment received</h2><p>We have verified your payment.</p><p><strong>Order:</strong> ${order.order_number}<br><strong>Amount:</strong> ${order.currency} ${amount}</p><p>Your virtual card is now being processed. We will send a separate notification when fulfilment is complete.</p><p>Cards by Raaduns</p></div>`;
  await connection.execute(
    "INSERT IGNORE INTO email_outbox (order_id, notification_type, recipient, subject, text_body, html_body) VALUES (?, 'payment_receipt', ?, ?, ?, ?)",
    [order.id, order.customer_email, subject, text, html],
  );
}

export async function processEmailOutbox(limit = 20) {
  await db.execute("UPDATE email_outbox SET status = 'pending' WHERE status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)");
  const [rows] = await db.query<OutboxRow[]>(
    "SELECT id, recipient, subject, text_body, html_body FROM email_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
    [Math.min(Math.max(limit, 1), 100)],
  );
  const results: Array<{ id: number; status: string }> = [];
  for (const row of rows) {
    const [claim] = await db.execute(
      "UPDATE email_outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'pending'",
      [row.id],
    );
    if ((claim as { affectedRows: number }).affectedRows !== 1) continue;
    try {
      await sendEmail({ to: row.recipient, subject: row.subject, text: row.text_body, ...(row.html_body ? { html: row.html_body } : {}) });
      await db.execute("UPDATE email_outbox SET status = 'sent', sent_at = NOW(), last_error = NULL WHERE id = ? AND status = 'sending'", [row.id]);
      results.push({ id: row.id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown SMTP error";
      await db.execute("UPDATE email_outbox SET status = 'pending', last_error = ? WHERE id = ? AND status = 'sending'", [message, row.id]);
      results.push({ id: row.id, status: "pending" });
    }
  }
  return results;
}