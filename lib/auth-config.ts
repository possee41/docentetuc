export type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type AuthConfiguration = {
  baseURL: string;
  origin: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  secureCookies: boolean;
};

export type AuthConfigurationResult =
  | { configured: true; value: AuthConfiguration }
  | { configured: false; missing: string[]; reason?: string };

/** Validates runtime OAuth settings without returning any secret to callers. */
export function readAuthConfiguration(
  environment: AuthEnvironment,
  runtime: "development" | "production" | "test" = "production",
): AuthConfigurationResult {
  const required: [string, string | undefined][] = [
    ["BETTER_AUTH_SECRET", environment.BETTER_AUTH_SECRET],
    ["BETTER_AUTH_URL", environment.BETTER_AUTH_URL],
    ["GOOGLE_CLIENT_ID", environment.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", environment.GOOGLE_CLIENT_SECRET],
  ];
  const missing = required.flatMap(([name, value]) => value?.trim() ? [] : [name]);

  if (missing.length) return { configured: false, missing };

  const secret = environment.BETTER_AUTH_SECRET!.trim();
  if (new TextEncoder().encode(secret).length < 32) {
    return { configured: false, missing: [], reason: "BETTER_AUTH_SECRET debe tener al menos 32 bytes." };
  }

  let url: URL;
  try {
    url = new URL(environment.BETTER_AUTH_URL!.trim());
  } catch {
    return { configured: false, missing: [], reason: "BETTER_AUTH_URL debe ser una URL absoluta." };
  }

  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return { configured: false, missing: [], reason: "BETTER_AUTH_URL debe contener solo el origen, sin credenciales, ruta ni parámetros." };
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(runtime !== "production" && isLocal && url.protocol === "http:")) {
    return { configured: false, missing: [], reason: "BETTER_AUTH_URL debe usar HTTPS; HTTP solo se permite en localhost fuera de producción." };
  }

  if (runtime === "production" && /\.(workers\.dev|pages\.dev)$/i.test(url.hostname)) {
    return { configured: false, missing: [], reason: "En producción se requiere un dominio propio verificado; workers.dev/pages.dev no sirven como dominio de marca OAuth." };
  }

  return {
    configured: true,
    value: {
      baseURL: url.origin,
      origin: url.origin,
      secret,
      googleClientId: environment.GOOGLE_CLIENT_ID!.trim(),
      googleClientSecret: environment.GOOGLE_CLIENT_SECRET!.trim(),
      secureCookies: url.protocol === "https:",
    },
  };
}
