import { getD1 } from "@/db";
import { hasCommunitySchema } from "@/lib/auth-schema";
import { CommunityError, type CommunityDatabase } from "@/lib/community";

export async function communityDatabase() {
  try {
    const database = getD1();
    if (!await hasCommunitySchema(database)) throw new CommunityError("SCHEMA_UNAVAILABLE", 503);
    return database as unknown as CommunityDatabase;
  } catch (error) {
    if (error instanceof CommunityError) throw error;
    throw new CommunityError("SCHEMA_UNAVAILABLE", 503);
  }
}

export async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const maxBytes = 12_288;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new CommunityError("REQUEST_TOO_LARGE", 413);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CommunityError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = null; }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
