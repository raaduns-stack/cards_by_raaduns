import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "./db.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || "Cards Administrator";
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Set a valid ADMIN_EMAIL.");
if (!password || password.length < 12 || password.length > 256) throw new Error("Set ADMIN_PASSWORD to 12–256 characters.");
if (displayName.length < 2 || displayName.length > 120) throw new Error("ADMIN_DISPLAY_NAME must be 2–120 characters.");
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
try {
  await db.execute(
    "INSERT INTO admin_users (email, display_name, password_hash, role, is_active) VALUES (?, ?, ?, 'admin', TRUE)",
    [email, displayName, passwordHash],
  );
  console.log(`Created administrator account for ${email}.`);
} finally {
  await db.end();
}
