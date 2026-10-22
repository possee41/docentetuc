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
