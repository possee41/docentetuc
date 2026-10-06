import { betterAuth } from "better-auth";
import { env } from "cloudflare:workers";
import { readAuthConfiguration, type AuthConfiguration, type AuthEnvironment } from "@/lib/auth-config";
import { hasAuthSchema } from "@/lib/auth-schema";

type AuthBindings = AuthEnvironment & { DB?: D1Database };

function createAuth(bindings: AuthBindings, config: AuthConfiguration) {
  return betterAuth({
    appName: "DocenteTuc",
    database: bindings.DB!,
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.origin],
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        scope: ["openid", "email", "profile"],
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({ name: profile.name || "Cuenta DocenteTuc", image: profile.picture }),
      },
    },
    account: {
      accountLinking: { disableImplicitLinking: true },
      storeAccountCookie: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.secureCookies,
      cookiePrefix: "docentetuc-auth",
      crossSubDomainCookies: { enabled: false },
      cookies: { state: { attributes: { maxAge: 600 } } },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: "lax",
        path: "/",
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              scope: null,
            },
          }),
        },
        update: {
          before: async (account) => ({
            data: {
              ...account,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              scope: null,
            },
          }),
        },
      },
    },
  });
}

const authByDatabase = new WeakMap<object, Promise<ReturnType<typeof createAuth> | null>>();

export async function getDocenteTucAuth() {
  const bindings = env as unknown as AuthBindings;
  const config = readAuthConfiguration(bindings, import.meta.env?.PROD ? "production" : "development");
  if (!config.configured || !bindings.DB) return null;

  const database = bindings.DB as object;
  const cached = authByDatabase.get(database);
  if (cached) return await cached;

  const authPromise = hasAuthSchema(bindings.DB).then((ready) => ready ? createAuth(bindings, config.value) : null);
  authByDatabase.set(database, authPromise);
  const auth = await authPromise;
  if (!auth) authByDatabase.delete(database);
  return auth;
}
