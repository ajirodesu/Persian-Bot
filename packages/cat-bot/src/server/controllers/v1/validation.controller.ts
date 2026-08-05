/**
 * Credential Validation Controller
 *
 * POST /api/v1/validate/discord          — verify Discord bot token via /users/@me
 * POST /api/v1/validate/telegram         — verify Telegram token via getMe
 * POST /api/v1/validate/email-reset      — check email existence (+ adminOnly role)
 * GET  /api/v1/validate/email-service-status — is transactional email configured?
 * POST /api/v1/validate/email-status     — email existence + verification flag
 * POST /api/v1/validate/reset-password/request      — issue HMAC-signed reset token
 * POST /api/v1/validate/reset-password/verify-token — validate token without consuming it
 * POST /api/v1/validate/reset-password/confirm      — apply new password and consume token
 *
 * All validation endpoints return HTTP 200 with { valid: false, error } for rejected
 * credentials so the React hook can distinguish network failures (throws) from
 * validation failures without try/catch branching at the call site.
 */

import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { sendMail } from '@/server/lib/mailer.lib.js';
import { env } from '@/engine/config/env.config.js';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { auth } from '@/server/lib/better-auth.lib.js';
import axios from 'axios';
import { isAuthError, withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';
import { buildEmailLayout, buildButton, COLORS } from '@/server/email-template/index.js';

// ── Discord ───────────────────────────────────────────────────────────────────

/** POST /api/v1/validate/discord — body: { discordToken } */
export async function validateDiscord(req: Request, res: Response): Promise<void> {
  const userId = await requireSession(req, res);
  if (!userId) return;

  const { discordToken } = req.body as { discordToken?: string };
  if (!discordToken) { res.status(400).json({ error: 'Missing discordToken' }); return; }

  try {
    const response = await withRetry(
      () => axios.get<{ username: string; id: string }>(
        'https://discord.com/api/v10/users/@me',
        { headers: { Authorization: `Bot ${discordToken}` } },
      ),
      { maxAttempts: 3, initialDelayMs: 1000, shouldRetry: (err) => !isAuthError(err) && isNetworkError(err) },
    );
    res.status(200).json({ valid: true, botName: response.data.username, botId: response.data.id });
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) { res.status(200).json({ valid: false, error: 'Invalid Discord bot token' }); return; }
    logger.error('[validate] Discord validation request failed', { error: err });
    res.status(500).json({ error: 'Failed to validate Discord token' });
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────────

/** POST /api/v1/validate/telegram — body: { telegramToken } */
export async function validateTelegram(req: Request, res: Response): Promise<void> {
  const userId = await requireSession(req, res);
  if (!userId) return;

  const { telegramToken } = req.body as { telegramToken?: string };
  if (!telegramToken) { res.status(400).json({ error: 'Missing telegramToken' }); return; }

  try {
    const response = await withRetry(
      () => axios.get<{ ok: boolean; result?: { first_name?: string; username?: string } }>(
        `https://api.telegram.org/bot${telegramToken}/getMe`,
      ),
      { maxAttempts: 3, initialDelayMs: 1000, shouldRetry: (err) => !isAuthError(err) && isNetworkError(err) },
    );
    if (response.data.ok) {
      const r = response.data.result;
      res.status(200).json({ valid: true, botName: r?.first_name ?? r?.username });
    } else {
      res.status(200).json({ valid: false, error: 'Invalid Telegram bot token' });
    }
  } catch (err) {
    const e = err as { response?: { status: number } };
    if (e.response?.status === 401) { res.status(200).json({ valid: false, error: 'Invalid Telegram bot token' }); return; }
    logger.error('[validate] Telegram validation request failed', { error: err });
    res.status(500).json({ error: 'Failed to validate Telegram token' });
  }
}

// ── Email Reset Validation ─────────────────────────────────────────────────────

/**
 * POST /api/v1/validate/email-reset — body: { email, adminOnly? }
 * Checks email existence and, when adminOnly=true, verifies the admin role.
 * Called before requestPasswordReset so the UI can surface clear errors.
 * Protected by VALIDATE_LIMIT (20 req/60 s per IP) at the routing layer.
 */
export async function validateEmailForPasswordReset(req: Request, res: Response): Promise<void> {
  const { email, adminOnly } = req.body as { email?: string; adminOnly?: boolean };
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'Missing email' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });
    if (!user) { res.status(200).json({ valid: false, error: 'No account found with this email address.' }); return; }
    if (adminOnly === true && user['role'] !== 'admin') {
      res.status(200).json({ valid: false, error: 'No admin account found with this email address.' }); return;
    }
    res.status(200).json({ valid: true });
  } catch (error) {
    logger.error('[validate] Email reset validation failed', { error });
    res.status(500).json({ error: 'Failed to validate email' });
  }
}

// ── Email Service Availability ─────────────────────────────────────────────────

/**
 * GET /api/v1/validate/email-service-status
 * Returns whether transactional email is deliverable: GMAIL_USER + GOOGLE_APP_PASSWORD
 * must both be present. VITE_EMAIL_SERVICES_ENABLE='false' acts as an explicit kill switch.
 * Checked at request time so credential changes take effect on process restart — no
 * frontend rebuild required.
 */
export function getEmailServiceStatus(_req: Request, res: Response): void {
  const hasCredentials = Boolean(env.GMAIL_USER && env.GOOGLE_APP_PASSWORD);
  const explicitlyEnabled = env.VITE_EMAIL_SERVICES_ENABLE === 'true';
  res.status(200).json({ enabled: hasCredentials && explicitlyEnabled });
}

// ── Email Status Check ────────────────────────────────────────────────────────

/** POST /api/v1/validate/email-status — body: { email } — returns { exists, verified }. */
export async function checkEmailStatus(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'Missing email' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });
    if (!user) { res.status(200).json({ exists: false, verified: false }); return; }
    res.status(200).json({ exists: true, verified: user['emailVerified'] === true });
  } catch (error) {
    logger.error('[validate] Email status check failed', { error });
    res.status(500).json({ error: 'Failed to check email status' });
  }
}

// ── HMAC-signed Password Reset Token Flow ─────────────────────────────────────
//
// Stateless tokens: email/expiry/adminOnly encoded in base64url JSON, signed with HMAC-SHA256.
// Token format: <base64url(JSON)>.<hex HMAC-SHA256 signature>
// Single-use: consumed signatures tracked in usedTokenSigs (Set<string>).

interface TokenPayload { email: string; expiresAt: number; adminOnly: boolean; }

function getSigningKey(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) {
    logger.warn('[validate] BETTER_AUTH_SECRET is not set — reset tokens are using an insecure fallback key.');
    return 'cat-bot-reset-fallback-insecure';
  }
  return secret;
}

function createSignedToken(email: string, adminOnly: boolean): string {
  const payload = Buffer.from(
    JSON.stringify({ email: email.toLowerCase().trim(), expiresAt: Date.now() + 3_600_000, adminOnly } satisfies TokenPayload),
  ).toString('base64url');
  const sig = createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySignedToken(
  token: string,
  adminOnly: boolean,
): { valid: true; email: string; sig: string } | { valid: false } {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return { valid: false };
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const expectedSig = createHmac('sha256', getSigningKey()).update(payload).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return { valid: false };
    if (!timingSafeEqual(sigBuf, expectedBuf)) return { valid: false };
  } catch { return { valid: false }; }

  if (usedTokenSigs.has(sig)) return { valid: false };

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as TokenPayload;
    if (Date.now() > data.expiresAt) return { valid: false };
    if (data.adminOnly !== adminOnly) return { valid: false };
    return { valid: true, email: data.email, sig };
  } catch { return { valid: false }; }
}

const usedTokenSigs = new Set<string>();
// Hourly sweep: clear if > 10k entries (10k completed resets/hour is unrealistic).
setInterval(() => { if (usedTokenSigs.size > 10_000) usedTokenSigs.clear(); }, 3_600_000).unref();

/** POST /api/v1/validate/reset-password/request — issues HMAC-signed token and sends email. */
export async function requestPasswordResetCustom(req: Request, res: Response): Promise<void> {
  const { email, adminOnly } = req.body as { email?: string; adminOnly?: boolean };
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'Missing email' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });
    // Prevent user enumeration — always return success even if user not found.
    if (!user) { res.status(200).json({ success: true }); return; }
    if (adminOnly && user['role'] !== 'admin') { res.status(200).json({ success: true }); return; }

    const token = createSignedToken(email, !!adminOnly);
    const baseUrl = (env.VITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const targetEmail = String(user['email'] ?? email);
    const url = `${baseUrl}${adminOnly ? '/admin' : ''}/reset-password?token=${token}&email=${encodeURIComponent(targetEmail)}`;
    const targetName = String(user['name'] ?? email);

    await sendMail({
      to: targetEmail,
      subject: adminOnly ? 'Reset your Cat-Bot Admin password' : 'Reset your Cat-Bot password',
      html: buildEmailLayout(
        `<p style="margin: 0 0 16px 0; color: ${COLORS.onSurface}; font-weight: 500;">Hello ${targetName},</p>
        <p style="margin: 0 0 24px 0;">Click the button below to securely reset your ${adminOnly ? 'admin ' : ''}password:</p>
        ${buildButton(url, 'Reset Password')}
        <p style="margin: 24px 0 0 0; color: ${COLORS.outlineVariant}; font-size: 14px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`,
        'Securely reset your password',
      ),
      text: `Reset your password by visiting: ${url}`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Custom request reset failed', { error });
    res.status(500).json({ error: 'Failed to request reset' });
  }
}

/** POST /api/v1/validate/reset-password/verify-token — body: { token, adminOnly } */
export async function verifyResetTokenCustom(req: Request, res: Response): Promise<void> {
  const body = req.body as { token?: string; adminOnly?: boolean };
  const token = body.token?.trim();
  if (!token) { res.status(400).json({ error: 'Missing token' }); return; }
  const result = verifySignedToken(token, !!body.adminOnly);
  res.status(200).json({ valid: result.valid });
}

/** POST /api/v1/validate/reset-password/confirm — body: { token, password, adminOnly } */
export async function confirmPasswordResetCustom(req: Request, res: Response): Promise<void> {
  const body = req.body as { token?: string; password?: string; adminOnly?: boolean };
  const token = body.token?.trim();
  const { password, adminOnly } = body;
  if (!token || !password) { res.status(400).json({ error: 'Missing token or password' }); return; }

  const tokenResult = verifySignedToken(token, !!adminOnly);
  if (!tokenResult.valid) { res.status(400).json({ error: 'Invalid or expired token' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: tokenResult.email }],
    });
    if (!user) { res.status(400).json({ error: 'User no longer exists' }); return; }

    const hashed = await hashPassword(password);
    const accounts = await ctx.adapter.findMany<Record<string, unknown>>({
      model: 'account',
      where: [
        { field: 'userId', value: user['id'] as string },
        { field: 'providerId', value: 'credential' },
      ],
    });

    if (accounts && accounts.length > 0) {
      await ctx.adapter.update({
        model: 'account',
        where: [{ field: 'id', value: accounts[0]!['id'] as string }],
        update: { password: hashed },
      });
    } else {
      await ctx.adapter.create({
        model: 'account',
        data: {
          userId: user['id'] as string,
          accountId: tokenResult.email,
          providerId: 'credential',
          password: hashed,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    usedTokenSigs.add(tokenResult.sig);
    await ctx.adapter.deleteMany({
      model: 'session',
      where: [{ field: 'userId', value: user['id'] as string }],
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Custom confirm reset failed', { error });
    res.status(500).json({ error: 'Failed to reset password' });
  }
}
