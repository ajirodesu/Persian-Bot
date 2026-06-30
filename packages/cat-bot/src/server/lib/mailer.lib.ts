/**
 * Gmail SMTP Mailer — Nodemailer Singleton Wrapper
 *
 * Sends transactional email (primarily account-verification links) via Gmail
 * using a Google App Password. The transport is lazily initialised on first use:
 *
 *   - GMAIL_USER and GOOGLE_APP_PASSWORD both present  → real SMTP delivery
 *   - Either absent                                     → warn + no-op (bot still boots)
 *
 * This "optional SMTP" design lets developers run Cat-Bot locally without
 * configuring email, while production deployments get full verification flow.
 *
 * Google App Password setup:
 *   1. Enable 2-Step Verification on your Google account.
 *   2. Go to myaccount.google.com → Security → App Passwords.
 *   3. Create an App Password for "Mail".
 *   4. Copy the 16-character key into GOOGLE_APP_PASSWORD in .env.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '@/engine/config/env.config.js';

// ── Singleton transport ───────────────────────────────────────────────────────

let _transporter: Transporter | null = null;

/**
 * Returns a lazily-created nodemailer transporter authenticated with a Gmail
 * App Password. Returns null when either required env var is absent so callers
 * can skip the send without crashing.
 */
function getTransporter(): Transporter | null {
  if (!env.GMAIL_USER || !env.GOOGLE_APP_PASSWORD) return null;
  if (_transporter) return _transporter;

  // Gmail SMTP via App Password — port 465 (implicit TLS) is the recommended
  // choice for App Password auth; the 'gmail' service alias configures it correctly.
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env.GMAIL_USER,
      pass: env.GOOGLE_APP_PASSWORD,
    },
  });
  return _transporter;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface MailOptions {
  /** Recipient email address */
  to: string;
  subject: string;
  /** HTML body — rendered by modern email clients */
  html: string;
  /** Plain-text fallback for email clients that strip HTML */
  text?: string | undefined;
  /** Attachments array for Nodemailer (used for CID base64 image embedding) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachments?: any[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends an email via Gmail SMTP. Silently skips delivery (with a console.warn)
 * when GMAIL_USER or GOOGLE_APP_PASSWORD is unset, so the bot continues to
 * operate in environments where email is not yet configured.
 */
export async function sendMail(options: MailOptions): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    // Warn rather than throw — a missing SMTP config should never crash the bot
    console.warn(
      `[mailer] GMAIL_USER or GOOGLE_APP_PASSWORD is not set. ` +
        `Skipping verification email to ${options.to}. ` +
        `Configure both env vars to enable email delivery.`,
    );
    return;
  }

  // GMAIL_USER is guaranteed non-null here — getTransporter() returns null otherwise
  const fromAddress = env.GMAIL_USER ?? 'noreply';

  await transporter.sendMail({
    from: `"Cat-Bot" <${fromAddress}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
  });
}
