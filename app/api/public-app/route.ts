import { getD1 } from "@/db/d1";
import { getPublicApp, type PublicAppSettings } from "@/lib/public-app";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return getPublicApp(request, getD1, env as PublicAppSettings);
}
