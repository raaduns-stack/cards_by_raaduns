import mysql from "mysql2/promise";
import { z } from "zod";

const schema = z.object({
  MYSQL_HOST: z.string().default("localhost"),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_DATABASE: z.string().min(1),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string(),
});
const config = schema.parse(process.env);

export const db = mysql.createPool({
  host: config.MYSQL_HOST,
  port: config.MYSQL_PORT,
  database: config.MYSQL_DATABASE,
  user: config.MYSQL_USER,
  password: config.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: "Z",
});
