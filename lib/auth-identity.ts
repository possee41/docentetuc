export type ValidatedSession = {
  user?: { id?: unknown; name?: unknown; image?: unknown } | null;
  session?: { expiresAt?: unknown } | null;
} | null;

export type AuthenticatedAccount = { accountId: string };

/** Accepts only a server-validated Better Auth session, never a client userId or device UUID. */
export function accountFromValidatedSession(
  value: ValidatedSession,
  now = Date.now(),
): AuthenticatedAccount | null {
  const id = value?.user?.id;
  const expiry = value?.session?.expiresAt;
  const expiresAt = expiry instanceof Date ? expiry.getTime() : typeof expiry === "string" || typeof expiry === "number" ? new Date(expiry).getTime() : Number.NaN;

  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { accountId: id };
}

export function accountOwnsResource(account: AuthenticatedAccount | null, ownerAccountId: string) {
  return Boolean(account && ownerAccountId && account.accountId === ownerAccountId);
}

export function safeGoogleProfileImage(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const image = new URL(value);
    if (image.protocol !== "https:" || image.username || image.password || !/(^|\.)googleusercontent\.com$/iu.test(image.hostname)) return null;
    return image.href;
  } catch {
    return null;
  }
}

export function safeGoogleAccountName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return name ? name.slice(0, 80) : null;
}

/** Deliberately excludes email, private profile, and account identifiers. */
export function publicAuthStatus(configured: boolean, account: AuthenticatedAccount | null, image: unknown = null, name: unknown = null) {
  return {
    configured,
    authenticated: Boolean(account),
    image: account ? safeGoogleProfileImage(image) : null,
    name: account ? safeGoogleAccountName(name) : null,
  };
}

export type SessionReader = (request: Request) => Promise<ValidatedSession>;
export type AccountAuthorization =
  | { authorized: true; account: AuthenticatedAccount }
  | { authorized: false; status: 401 | 403 };

/** The reader must validate the opaque HttpOnly session token against Better Auth/D1. */
export async function authenticatedAccountFromRequest(
  request: Request,
  readSession: SessionReader,
  now = Date.now(),
) {
  try {
    return accountFromValidatedSession(await readSession(request), now);
  } catch {
    return null;
  }
}

export async function authorizeAccountResource(
  request: Request,
  readSession: SessionReader,
  ownerAccountId: string,
  now = Date.now(),
): Promise<AccountAuthorization> {
  const account = await authenticatedAccountFromRequest(request, readSession, now);
  if (!account) return { authorized: false, status: 401 };
  if (!accountOwnsResource(account, ownerAccountId)) return { authorized: false, status: 403 };
  return { authorized: true, account };
}

/** Custom account mutations accept only same-origin browser requests (CSRF defense). */
export function isSameOriginMutation(request: Request) {
  try {
    const origin = request.headers.get("origin");
    return Boolean(origin && new URL(origin).origin === new URL(request.url).origin);
  } catch {
    return false;
  }
}
