import fdci from "../workers/fdci-receiver.mjs";
import sime from "../workers/sime-receiver.mjs";
import publicSources from "../workers/public-source-receiver.mjs";
import { randomBytes } from "node:crypto";

// Reuse the existing strict receiver validation inside Node, without deploying
// a write Worker. Only the D1 REST transport leaves the GitHub runner.
export function createDirectD1ReceiverFetch(db) {
  const secret = randomBytes(32).toString("hex");
  const env = { DB: db, FDCI_IMPORT_SECRET: secret, FDCI_EXTERNAL_ENABLED: "true",
    SIME_IMPORT_SECRET: secret, JUNTAS_IMPORT_SECRET: secret,
    CENET_IMPORT_SECRET: secret, INFD_IMPORT_SECRET: secret };
  const endpoint = (path) => `https://direct-d1.invalid${path}`;
  const receiverFetch = (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== "https://direct-d1.invalid") throw new Error("DIRECT_D1_ENDPOINT_INVALID");
    const worker = url.pathname === "/api/internal/fdci-import" ? fdci :
      url.pathname === "/api/internal/sime-import" ? sime : publicSources;
    return worker.fetch(request, env);
  };
  return { endpoint, token: secret, receiverFetch };
}

export async function sourceHashCache(db, source) {
  const rows = new Map();
  let cursor = "";
  while (true) {
    const page = await db.prepare("SELECT id,source,content_hash,removed_at FROM publications WHERE source=? AND id>? ORDER BY id LIMIT 200")
      .bind(source, cursor).all();
    if (!Array.isArray(page.results) || page.results.length > 200) throw new Error("D1_HASH_PAGE_INVALID");
    for (const row of page.results) {
      if (typeof row.id !== "string" || row.id <= cursor || row.source !== source) throw new Error("D1_HASH_PAGE_INVALID");
      rows.set(row.id, row);
    }
    if (page.results.length < 200) break;
    cursor = page.results.at(-1).id;
  }
  return rows;
}

export function withSourceHashCache(db, rows) {
  const lookup = /^\s*SELECT\s+id\s*,\s*source\s*,\s*content_hash\s*,\s*removed_at\s+FROM\s+publications\s+WHERE\s+id\s+IN\s*\(/i;
  return { ...db, prepare: (sql) => lookup.test(sql) ? { bind: (...ids) => ({
    all: async () => ({ results: ids.flatMap((id) => rows.has(id) ? [rows.get(id)] : []), meta: { rows_read: 0 } }),
  }) } : db.prepare(sql) };
}
