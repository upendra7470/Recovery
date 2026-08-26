import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

type ScryptOptions = { N: number; r: number; p: number; maxmem?: number };
const scrypt = promisify(scryptCallback) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/**
 * Password hashing with Node's built-in scrypt (no external dependency).
 * Stored format: `scrypt:N:r:p:<saltB64>:<hashB64>` — parameters travel with
 * the hash so verification is self-describing and future-proof.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false; // malformed storage never verifies
  }
  const nRaw = parts[1];
  const rRaw = parts[2];
  const pRaw = parts[3];
  const saltB64 = parts[4];
  const hashB64 = parts[5];
  if (nRaw === undefined || rRaw === undefined || pRaw === undefined || saltB64 === undefined || hashB64 === undefined) {
    return false;
  }
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Opaque session token: 256 bits of CSPRNG entropy, URL-safe. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Sessions are stored by SHA-256 token hash — a database leak cannot be
 * replayed as valid sessions. The raw token lives only in the HttpOnly cookie.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
