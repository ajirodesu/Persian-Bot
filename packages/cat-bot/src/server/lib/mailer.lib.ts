/**
 * Brevo Transactional-Email Mailer — SDK Singleton Wrapper
 *
 * Sends transactional email (primarily account-verification links) via the
 * Brevo REST API using `@getbrevo/brevo`. The client is lazily initialised on
 * first use:
 *
 *   - BREVO_SENDER_EMAIL and BREVO_API_KEY both present  → real API delivery
 *   - Either absent                                      → warn + no-op (bot still boots)
 *
 * Brevo setup:
 *   1. Create an account at app.brevo.com and confirm the sender address.
 *   2. Go to API Keys (app.brevo.com/settings/keys/api) → create a key.
 *   3. Paste the key into BREVO_API_KEY and the verified sender address
 *      into BREVO_SENDER_EMAIL in .env.
 */

import { BrevoClient } from '@getbrevo/brevo';
import type { Brevo } from '@getbrevo/brevo';
import { env } from '@/engine/config/env.config.js';

// ── Singleton client ─────────────────────────────────────────────────────────

let _client: BrevoClient | null = null;

/**
 * Returns a lazily-created Brevo API client authenticated with the API key.
 * Returns null when a required env var is absent so callers can skip the send
 * without crashing.
 */
function getClient(): BrevoClient | null {
  if (!env.BREVO_SENDER_EMAIL || !env.BREVO_API_KEY) return null;
  if (_client) return _client;

  // The Brevo SDK (v6) auths via an api-key header supplier.
  _client = new BrevoClient({ apiKey: env.BREVO_API_KEY });
  return _client;
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Attachment item compatible with both the previous Nodemailer payloads and
 * Brevo's `attachment` entries. Brevo requires either `content` (base64) or an
 * absolute `url` (local file paths are not supported).
 */
export interface MailAttachment {
  /** Attachment filename. Required when `content` is provided. */
  filename?: string;
  /** Base64-encoded content (or a Buffer that will be base64-encoded) */
  content?: string | Buffer;
  /** Absolute URL to the attachment (used instead of `content`). */
  path?: string;
  cid?: string;
}

export interface MailOptions {
  /** Recipient email address */
  to: string;
  subject: string;
  /** HTML body — rendered by modern email clients */
  html: string;
  /** Plain-text fallback for email clients that strip HTML */
  text?: string | undefined;
  /** Attachments. Kept optional for caller compatibility. */
  attachments?: MailAttachment[];
}

// ── Duplicate-send guard ──────────────────────────────────────────────────────

// Collapses true duplicates fired within the window (e.g. a callback invoked twice
// for one action), while letting deliberate re-sends through — those mint a fresh
// token, producing a different link/HTML that no longer matches the prior hash.
const recentSends = new Map<number, number>();
const DEDUP_WINDOW_MS = 10_000;

/** Builds a fuzzy (non-cryptographic FNV-1a) hash so identical messages collapse. */
function isRecentlySent(to: string, subject: string, html: string): boolean {
  const input = `${to}\u0000${subject}\u0000${html}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash >>>= 0;
  const now = Date.now();
  if (recentSends.has(hash) && now - (recentSends.get(hash) ?? 0) < DEDUP_WINDOW_MS) {
    return true;
  }
  recentSends.set(hash, now);
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends an email via the Brevo API. Silently skips listeners (with a
 * console.warn) when BREVO_SENDER_EMAIL or BREVO_API_KEY is unset, so the bot
 * continues to operate in environments where email is not yet configured.
 * Identical messages sent twice within {@link DEDUP_WINDOW_MS} are collapsed to
 * a single delivery to prevent accidental double-sends.
 */
export async function sendMail(options: MailOptions): Promise<void> {
  const client = getClient();

  if (!client) {
    // Warn rather than throw — a missing API key should never crash the bot
    console.warn(
      `[mailer] BREVO_SENDER_EMAIL or BREVO_API_KEY is not set. ` +
        `Skipping verification email to ${options.to}. ` +
        `Configure both env vars to enable email delivery.`,
    );
    return;
  }

  // BREVO_SENDER_EMAIL is guaranteed non-null here — getClient() returns null otherwise
  const senderEmail = env.BREVO_SENDER_EMAIL ?? 'noreply';

  const attachments = toBrevoAttachments(options.attachments);

  const request: Brevo.SendTransacEmailRequest = {
    sender: {
      email: senderEmail,
      name: 'Cat-Bot',
    },
    to: [
      {
        email: options.to,
      },
    ],
    subject: options.subject,
    htmlContent: options.html,
    ...(options.text !== undefined ? { textContent: options.text } : {}),
    ...(attachments ? { attachment: attachments } : {}),
  };

  if (isRecentlySent(options.to, options.subject, options.html)) {
    return;
  }

  await client.transactionalEmails.sendTransacEmail(request);
}

/**
 * Maps the generic {@link MailAttachment}s into Brevo's
 * `SendTransacEmailRequest.Attachment.Item[]` shape, base64-encoding Buffers.
 */
function toBrevoAttachments(
  attachments: MailAttachment[] | undefined,
): Brevo.SendTransacEmailRequest.Attachment.Item[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;

  return attachments.map((att) => {
    const { content } = att;
    if (typeof content === 'string') {
      return { name: att.filename, content };
    }
    if (Buffer.isBuffer(content)) {
      return { name: att.filename, content: content.toString('base64') };
    }
    if (att.path) {
      return { name: att.filename, url: att.path };
    }
    return { name: att.filename };
  });
}