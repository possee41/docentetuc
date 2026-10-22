// Opt-in pilot runner. Keep workflows on their isolated receivers until the
// D1 REST path and source cutover are explicitly approved.
import { pathToFileURL } from "node:url";
import { createD1Rest } from "./d1-rest.mjs";
import { createDirectD1ReceiverFetch } from "./direct-d1-receiver.mjs";
import { runFdciImport } from "./import-fdci.mjs";
import { runSimeImport } from "./import-sime.mjs";
import { runPublicSourceImport } from "./import-public-sources.mjs";

/** @param {{source: string, db: any, sourceFetch?: typeof fetch, driveKey?: string, selection?: {token: string, slug: string, commissionId: string}}} options */
export async function runDirectD1Import({ source, db, sourceFetch = fetch, driveKey, selection }) {
  const receiver = createDirectD1ReceiverFetch(db);
  const path = source === "fdci" ? "/api/internal/fdci-import" : source === "sime" ? "/api/internal/sime-import" :
    `/api/internal/public-source-import/${source}`;
  const endpoint = receiver.endpoint(path);
  let result;
  if (source === "fdci") {
    if (!selection) throw new Error("FDCI_SELECTION_REQUIRED");
    const fetcher = (input, init) => String(input).startsWith("https://direct-d1.invalid/") ?
      receiver.receiverFetch(input, init) : sourceFetch(input, init);
    result = await runFdciImport({ endpoint, token: receiver.token, fetcher, scope: "single", selection });
  } else if (source === "sime") {
    result = await runSimeImport({ endpoint, token: receiver.token, sourceFetch, receiverFetch: receiver.receiverFetch });
  } else if (["juntas", "cenet", "infd"].includes(source)) {
    result = await runPublicSourceImport({ source, endpoint, token: receiver.token, sourceFetch,
      receiverFetch: receiver.receiverFetch, driveKey });
  } else throw new Error("SOURCE_INVALID");
  return { source, ...result, d1: db.metrics?.() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.DIRECT_D1_WRITE_ENABLED !== "true") throw new Error("DIRECT_D1_WRITE_DISABLED");
    const db = createD1Rest({ accountId: process.env.CF_ACCOUNT_ID, databaseId: process.env.D1_DATABASE_ID,
      token: process.env.D1_IMPORT_TOKEN });
    const source = process.env.SYNC_SOURCE || "";
    const selection = source === "fdci" ? { token: process.env.FDCI_COURSE_TOKEN || "",
      slug: process.env.FDCI_COURSE_SLUG || "", commissionId: process.env.FDCI_COMMISSION_ID || "" } : undefined;
    const result = await runDirectD1Import({ source, db, driveKey: process.env.GOOGLE_DRIVE_API_KEY, selection });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Never include remote response bodies, URLs with tokens, or credentials.
    console.error("DIRECT_D1_IMPORT_FAILED", error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown");
    process.exitCode = 1;
  }
}
