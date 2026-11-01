import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerOrderRoutes } from "./routes/orders.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});
const env = envSchema.parse(process.env);
const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: 1_048_576,
  trustProxy: env.NODE_ENV === "production",
});

await app.register(helmet);
await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map((value) => value.trim()),
  credentials: true,
});
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

app.get("/health", async () => {
  try {
    await db.query("SELECT 1");
    return { status: "ok", service: "cards-api", database: "connected", environment: env.NODE_ENV };
  } catch {
    return app.httpErrors ? { status: "degraded", service: "cards-api", database: "unavailable" } : { status: "degraded", service: "cards-api", database: "unavailable" };
  }
});
await registerCatalogRoutes(app);
await registerOrderRoutes(app);

// Provider webhooks stay disabled until signature verification and idempotency are implemented.
app.post("/webhooks/flutterwave", async (_request, reply) =>
  reply.code(501).send({ error: "Flutterwave webhook integration is not enabled yet." }));
app.post("/webhooks/kripicard", async (_request, reply) =>
  reply.code(501).send({ error: "Kripicard webhook integration is not enabled yet." }));

const close = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
} catch (error) {
  app.log.error(error);
  await db.end();
  process.exit(1);
}
