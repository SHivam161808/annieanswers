import { createHash, timingSafeEqual } from 'node:crypto';

export const SECRET_HEADER = 'x-annie-secret';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Constant-time check of the shared secret against all active secrets (rotation-safe).
 * Accepts `x-annie-secret: <secret>`, `Authorization: Bearer <secret>` or `Authorization: <secret>`,
 * the forms GHL custom actions and workflow webhooks can send.
 */
export function isAuthorised(
  headers: { [key: string]: string | string[] | undefined },
  secrets: readonly string[],
): boolean {
  const presented = extractSecret(headers);
  if (!presented) return false;
  const presentedDigest = digest(presented);
  let ok = false;
  for (const secret of secrets) {
    // No early exit: comparison time does not depend on which secret matched.
    if (timingSafeEqual(presentedDigest, digest(secret))) ok = true;
  }
  return ok;
}

function extractSecret(headers: { [key: string]: string | string[] | undefined }): string | null {
  const direct = headers[SECRET_HEADER];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const auth = headers.authorization;
  if (typeof auth !== 'string') return null;
  // GHL custom actions send their "authentication value" in Authorization; accept it with or
  // without the Bearer scheme. Other schemes (Basic, ...) are rejected.
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : auth.trim();
  return token.length > 0 && !/\s/.test(token) ? token : null;
}
