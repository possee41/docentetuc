import { env } from "cloudflare:workers";
export { POST } from "./chat/route";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = env as unknown as Record<string, string | undefined>;
  return Response.json({ configured: Boolean(settings.AI_PROVIDER && settings.AI_API_KEY && settings.AI_MODEL) });
}
