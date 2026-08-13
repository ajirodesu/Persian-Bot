/**
 * One-time Password (OTP) Store — in-memory, single-process
 *
 * Email verification and password-reset flows authenticate with a short
 * numeric code instead of a clickable link. Codes are generated on demand,
 * stored in an in-memory Map, and consumed on successful confirmation.
 *
 * Security properties:
 *   - Codes are 6 digits (~1M space), valid for 10 minutes.
 *   - Each code allows MAX_ATTEMPTS wrong guesses before it is revoked.
 *   - Every verification attempt (valid or not) counts against that budget.
 *   - Rate limiting is additionally enforced by VALIDATE_LIMIT (20 req/60 s)
 *     at the routing layer.
 *
 * In-memory storage matches the existing single-process deployment: codes
 * are lost on restart, which just forces users to request a fresh code.
 */

export type OtpPurpose = 'reset-password' | 'email-verification';

interface OtpRecord {
  code: string;
  expiresAt: number;
  attemptsRemaining: number;
}

const store = new Map<string, OtpRecord>();

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

function key(email: string, purpose: OtpPurpose): string {
  return `${email.toLowerCase().trim()}\0${purpose}`;
}

/** Generates a fresh 6-digit numeric code for `email` + `purpose`. */
export function generateOtp(email: string, purpose: OtpPurpose): string {
  const code = String(
    Math.floor(Math.random() * 9 * 10 ** (CODE_LENGTH - 1) + 10 ** (CODE_LENGTH - 1)),
  );
  store.set(key(email, purpose), {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attemptsRemaining: MAX_ATTEMPTS,
  });
  return code;
}

/**
 * Checks a submitted code WITHOUT consuming it on success, so the same code
 * can be carried into a subsequent confirm request. Failed attempts still
 * count toward the attempt budget.
 */
export function checkOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
): { valid: boolean; reason?: 'missing' | 'expired' | 'invalid' | 'exhausted' } {
  const record = store.get(key(email, purpose));
  if (!record) return { valid: false, reason: 'missing' };

  if (Date.now() > record.expiresAt) {
    store.delete(key(email, purpose));
    return { valid: false, reason: 'expired' };
  }

  if (record.code !== code) {
    record.attemptsRemaining -= 1;
    if (record.attemptsRemaining <= 0) {
      store.delete(key(email, purpose));
      return { valid: false, reason: 'exhausted' };
    }
    return { valid: false, reason: 'invalid' };
  }

  return { valid: true };
}

/**
 * Validates and consumes a code in a single step. Returns true only when the
 * code matches, is unexpired, and attempts remain.
 */
export function consumeOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
): boolean {
  const result = checkOtp(email, purpose, code);
  if (result.valid) {
    store.delete(key(email, purpose));
  }
  return result.valid;
}

// Housekeeping — drop expired records hourly to bound memory usage.
setInterval(() => {
  const now = Date.now();
  for (const [k, record] of store) {
    if (now > record.expiresAt) store.delete(k);
  }
}, 60 * 60 * 1000).unref();