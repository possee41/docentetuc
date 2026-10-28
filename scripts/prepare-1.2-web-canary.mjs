// Creates only a local, synthetic D1. There is intentionally no remote option.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(root, "wrangler.1.2-web-canary.jsonc"), "utf8"));
const db = config.d1_databases?.[0];
if (config.name !== "docentetuc-web-canary-1-2" || config.triggers?.crons?.length ||
    config.routes || config.route || config.vars?.PUSH_DISPATCH_MODE !== "disabled" ||
    config.vars?.AI_WEB_SEARCH_ENABLED !== "0" || config.vars?.LEGACY_SYNC_PAUSED !== "true" ||
    config.d1_databases?.length !== 1 || db.binding !== "DB" ||
    db.database_name !== "docentetuc-web-canary-1-2-local" ||
    db.database_id !== "00000000-0000-4000-8000-000000000012") throw new Error("WEB_CANARY_CONFIG_UNSAFE");

const paths = ["0000_docentetuc.sql", "0001_training_metadata.sql", "0002_reminders_ai.sql", "0003_web_push.sql"]
  .map((name) => join(root, "drizzle", name));
paths.push(...readdirSync(join(root, "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort().map((name) => join(root, "migrations", name)));
const seed = `
INSERT INTO import_gateway_identity(id,database_name,database_id)
VALUES(1,'docentetuc-web-canary-1-2-local','00000000-0000-4000-8000-000000000012');
INSERT INTO publications(id,source,external_id,kind,category,title,summary,status,official_url,content_hash,metadata,normalized_status,source_status)
VALUES
('preview:sime','Vista previa local','preview-sime','vacante','Inscripciones SIME','PRUEBA LOCAL — pedido SIME','Dato sintético; vigencia no verificada.','sin verificar','','preview-sime','{"preview":true}','UNKNOWN','sin verificar'),
('preview:training','Vista previa local','preview-training','capacitacion','Capacitaciones','PRUEBA LOCAL — capacitación','Dato sintético; inscripción no confirmada.','sin verificar','','preview-training','{"preview":true}','UNKNOWN','sin verificar'),
('preview:padron','Vista previa local','preview-padron','junta','Padrones','PRUEBA LOCAL — padrón','Documento sintético de referencia.','sin verificar','','preview-padron','{"preview":true}','UNKNOWN','sin verificar'),
('preview:comunicado','Vista previa local','preview-comunicado','junta','Comunicados','PRUEBA LOCAL — comunicado','Documento sintético de referencia.','sin verificar','','preview-comunicado','{"preview":true}','UNKNOWN','sin verificar'),
('preview:llamado','Vista previa local','preview-llamado','junta','Llamados abiertos','PRUEBA LOCAL — llamado histórico','Documento sintético sin fecha de inscripción verificada.','sin verificar','','preview-llamado','{"preview":true}','UNKNOWN','sin verificar');
`;
const directory = join(root, ".wrangler");
mkdirSync(directory, { recursive: true });
const file = join(directory, "web-canary-schema.sql");
writeFileSync(file, paths.map((path) => readFileSync(path, "utf8")).join("\n") + seed);
try {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
    "--config", "wrangler.1.2-web-canary.jsonc", "--local", "--persist-to", ".wrangler/web-canary",
    "--file", file], { cwd: root, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, WRANGLER_LOG_PATH: join(directory, "web-canary.log"), WRANGLER_SEND_METRICS: "false" } });
  if (result.status !== 0) throw new Error(`WEB_CANARY_SCHEMA_FAILED: ${result.stderr || result.stdout}`);
  console.log("WEB_CANARY_READY: local D1 migrated; five synthetic publications; no remote resources");
} finally { unlinkSync(file); }
