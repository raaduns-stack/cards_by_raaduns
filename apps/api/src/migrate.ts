import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "./db.js";

try {
  const sql = await readFile(new URL("./migrations/001_initial.sql", import.meta.url), "utf8");
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  const connection = await db.getConnection();
  try {
    for (const statement of statements) await connection.query(statement);
  } finally {
    connection.release();
  }
  console.log(`Applied ${statements.length} migration statements.`);
} finally {
  await db.end();
}
