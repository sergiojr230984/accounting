import crypto from "crypto";
import { prisma } from "./prisma";
import { isApiScope, type ApiScope } from "./api-scopes";

export { API_KEY_SCOPES, isApiScope, type ApiScope } from "./api-scopes";

// Recognizable prefix (grep-able in logs, matches the convention of
// Stripe/GitHub-style tokens) -- not a secret itself, just an identifier.
const KEY_PREFIX = "lc_live_";
const PREFIX_DISPLAY_LENGTH = KEY_PREFIX.length + 8;

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Generates a new API key. The full key is returned exactly once here --
 * only its SHA-256 hash is meant to be persisted, so there is no way to
 * recover or re-display the full key after this call returns.
 */
export function generateApiKey(): { fullKey: string; keyHash: string; keyPrefix: string } {
  const secret = crypto.randomBytes(32).toString("hex");
  const fullKey = `${KEY_PREFIX}${secret}`;
  return {
    fullKey,
    keyHash: hashApiKey(fullKey),
    keyPrefix: fullKey.slice(0, PREFIX_DISPLAY_LENGTH),
  };
}

function extractPresentedKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.startsWith(KEY_PREFIX)) return token;
  }
  const headerKey = request.headers.get("x-api-key");
  if (headerKey?.startsWith(KEY_PREFIX)) return headerKey;
  return null;
}

/**
 * Looks for an API key on the request (Authorization: Bearer <key>, or
 * X-API-Key) and validates it against stored, active keys. Returns null if
 * no key was presented or it doesn't match an active key -- callers should
 * fall back to session auth rather than treat that as a hard failure.
 */
export async function verifyApiKey(
  request: Request
): Promise<{ id: string; label: string; scopes: ApiScope[] } | null> {
  const presented = extractPresentedKey(request);
  if (!presented) return null;

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(presented) },
  });
  if (!record || !record.active) return null;

  // Best-effort usage tracking -- never block or fail the request over it.
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  const scopes = Array.isArray(record.scopes) ? record.scopes.filter(isApiScope) : [];
  return { id: record.id, label: record.label, scopes };
}
