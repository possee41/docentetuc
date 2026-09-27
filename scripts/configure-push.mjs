import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" }), privateJwk = privateKey.export({ format: "jwk" });
if (!publicJwk.x || !publicJwk.y || !privateJwk.d) throw new Error("No se pudo generar el par VAPID.");
const publicVapid = Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x, "base64url"), Buffer.from(publicJwk.y, "base64url")]).toString("base64url");
const secrets = {
  VAPID_PUBLIC_KEY: publicVapid,
  VAPID_PRIVATE_KEY: privateJwk.d,
  VAPID_SUBJECT: "https://docentetuc.possee41.workers.dev",
  CRON_SECRET: randomBytes(32).toString("base64url"),
};

for (const [name, value] of Object.entries(secrets)) {
  const result = spawnSync(process.execPath, [wrangler, "secret", "put", name, "--config", "wrangler.cloudflare.jsonc"], { cwd: root, input: `${value}\n`, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`No se pudo configurar ${name}.`);
}
console.log("Claves Web Push configuradas en Cloudflare. La clave privada no se guardó en el proyecto.");
