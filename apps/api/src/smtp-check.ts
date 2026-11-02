import "dotenv/config";
import { verifySmtpConnection } from "./mailer.js";

try {
  await verifySmtpConnection();
  console.log("SMTP connection verified.");
} catch (error) {
  console.error("SMTP verification failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}