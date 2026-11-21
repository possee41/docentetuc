import vinext from "vinext";
import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";
export default defineConfig(async ({ command }) => {
  const previewAuthFile = command === "serve" && !managedLinux && process.env.DOCENTETUC_PREVIEW_STATE_DIR
    ? resolve(process.env.DOCENTETUC_PREVIEW_STATE_DIR, "auth.json") : "";
  const previewAuth: { secret: string; token: string } | null = previewAuthFile && existsSync(previewAuthFile)
    ? JSON.parse(readFileSync(previewAuthFile, "utf8")) : null;
  const localBindingConfig = {
    main: "vinext/server/fetch-handler",
    compatibility_flags: ["nodejs_compat"],
    ...(previewAuth ? { vars: {
      BETTER_AUTH_SECRET: previewAuth.secret,
      BETTER_AUTH_URL: "http://localhost:8793",
      GOOGLE_CLIENT_ID: "local-preview-only",
      GOOGLE_CLIENT_SECRET: "local-preview-only",
      AI_PROVIDER: "preview",
      AI_API_KEY: "local-preview-only",
      AI_MODEL: "preview",
    } } : {}),
    d1_databases: d1
      ? [{ binding: d1, database_name: "site-creator-d1", database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID }]
      : [],
    r2_buckets: r2 ? [{ binding: r2, bucket_name: "site-creator-r2" }] : [],
  };
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      watch: {
        ignored: ["**/.android-toolchain/**"],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux, previewAuth }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        persistState: process.env.DOCENTETUC_PREVIEW_STATE_DIR
          ? { path: process.env.DOCENTETUC_PREVIEW_STATE_DIR }
          : true,
        config: localBindingConfig,
      }),
    ],
  };
});
