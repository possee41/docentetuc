import { env } from "cloudflare:workers";

// Native D1 readers do not need to initialize Drizzle or its full schema.
export function getD1() {
  if (!env.DB) throw new Error("La base de datos no está disponible.");
  return env.DB;
}
