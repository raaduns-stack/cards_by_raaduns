import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "./db.js";
const migrations = ["001_initial.sql", "002_kripicard_issuance.sql", "003_admin_console.sql", "004_provider_settings.sql", "004_customer_receipts.sql", "005_customer_auth.sql", "006_ngn_pricing.sql", "007_btcpay_provider.sql"];
try {
  const connection = await db.getConnection();
  try {
    await connection.query("CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
    for (const migration of migrations) {
      const [applied] = await connection.query("SELECT name FROM schema_migrations WHERE name = ?", [migration]);
      if ((applied as Array<{name:string}>).length) continue;
      const sql = await readFile(new URL("./migrations/" + migration, import.meta.url), "utf8");
      const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
      await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [migration]);
      console.log("Applied " + migration + " (" + statements.length + " statements).");
    }
  } finally { connection.release(); }
} finally { await db.end(); }