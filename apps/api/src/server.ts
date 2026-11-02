import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerKripicardRoutes } from "./providers/kripicard.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerCustomerAuthRoutes } from "./routes/customer-auth.js";
import { registerBtcpayRoutes } from "./providers/btcpay.js";
import { processEmailOutbox } from "./notifications.js";
import { pollPendingIssuances } from "./providers/kripicard.js";

const env = z.object({
 NODE_ENV: z.enum(["development","test","production"]).default("development"),
 PORT: z.coerce.number().int().positive().default(4000),
 CORS_ORIGIN: z.string().default("http://localhost:5173"),
}).parse(process.env);
const app = Fastify({logger:{level:env.NODE_ENV==="production"?"info":"debug"},bodyLimit:1048576,trustProxy:env.NODE_ENV==="production"});
await app.register(helmet);
await app.register(cors,{origin:env.CORS_ORIGIN.split(",").map(v=>v.trim()),credentials:true});
await app.register(rateLimit,{max:100,timeWindow:"1 minute"});
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  (request as typeof request & { rawBody?: Buffer }).rawBody = body as Buffer;
  try { done(null, JSON.parse((body as Buffer).toString("utf8"))); } catch { done(new Error("Invalid JSON body")); }
});
app.get("/health",async(_request,reply)=>{try{await db.query("SELECT 1");return{status:"ok",service:"cards-api",database:"connected",environment:env.NODE_ENV};}catch{reply.code(503);return{status:"degraded",service:"cards-api",database:"unavailable"};}});
await registerCustomerAuthRoutes(app);
await registerCatalogRoutes(app);
await registerOrderRoutes(app);
await registerPaymentRoutes(app);
await registerBtcpayRoutes(app);
await registerKripicardRoutes(app);
await registerAdminRoutes(app);
const outboxTimer = setInterval(() => { void processEmailOutbox(20).catch((error) => app.log.error(error, "Email outbox processing failed")); }, 60_000);
let issuancePollRunning = false;
const runIssuancePoll = async () => {
  if (issuancePollRunning) return;
  issuancePollRunning = true;
  try { const results = await pollPendingIssuances(10); if (results.length) app.log.info({ processed: results.length }, "Pending card issuance statuses checked"); }
  catch (error) { app.log.error(error, "Pending card issuance poll failed"); }
  finally { issuancePollRunning = false; }
};
const issuancePollTimer = setInterval(() => { void runIssuancePoll(); }, 60_000);
void runIssuancePoll();
const close=async()=>{clearInterval(outboxTimer);clearInterval(issuancePollTimer);await app.close();await db.end();process.exit(0);};
process.on("SIGINT",close);process.on("SIGTERM",close);
try{await app.listen({host:"0.0.0.0",port:env.PORT});}catch(error){app.log.error(error);await db.end();process.exit(1);}