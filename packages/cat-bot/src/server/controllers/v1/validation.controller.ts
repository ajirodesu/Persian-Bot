/**
 * Credential Validation Controller
 *
 * POST /api/v1/validate/discord          — verify Discord bot token via /users/@me
 * POST /api/v1/validate/telegram         — verify Telegram token via getMe
 * POST /api/v1/validate/discord          — verify Discord bot token via /users/@me
 * POST /api/v1/validate/telegram         — verify Telegram token via getMe
 * POST /api/v1/validate/email-reset      — check email existence (+ adminOnly role)
 * GET  /api/v1/validate/email-service-status — is transactional email configured?
 * POST /api/v1/validate/email-status     — email existence + verification flag
 * POST /api/v1/validate/email-verification/confirm — verify an email via OTP code
 * POST /api/v1/validate/reset-password/request      — send a 6-digit OTP reset code
 * POST /api/v1/validate/reset-password/verify-code  — validate OTP without consuming it
 * POST /api/v1/validate/reset-password/confirm      — consume OTP and apply new password
 *
 * All validation endpoints return HTTP 200 with { valid: false, error } for rejected
 * credentials so the React hook can distinguish network failures (throws) from
 * validation failures without try/catch branching at the call site.
 */

import type { Request, Response } from 'express';
import { hashPassword } from 'better-auth/crypto';
import { sendMail } from '@/server/lib/mailer.lib.js';
import { env } from '@/engine/config/env.config.js';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { auth } from '@/server/lib/better-auth.lib.js';
import axios from 'axios';
import { isAuthError, withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';
import { generateOtp, checkOtp, consumeOtp } from '@/server/lib/otp.lib.js';
import { buildEmailLayout, buildCodeBlock, COLORS } from '@/server/email-template/index.js';

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
 * Returns whether transactional email is deliverable: BREVO_SENDER_EMAIL + BREVO_API_KEY
 * (Brevo sender + API key) must both be present. VITE_EMAIL_SERVICES_ENABLE='false'
 * acts as an explicit kill switch.
 * Checked at request time so credential changes take effect on process restart — no
 * frontend rebuild required.
 */
export function getEmailServiceStatus(_req: Request, res: Response): void {
  const hasCredentials = Boolean(env.BREVO_SENDER_EMAIL && env.BREVO_API_KEY);
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

// ── OTP-code Password Reset Flow ────────────────────────────────────────────
//
// Codes are generated, stored, and validated by the shared in-memory OTP store
// (server/lib/otp.lib.ts). The request endpoint emails a 6-digit code, the
// verify endpoint gates the reset UI without consuming it, and the confirm
// endpoint consumes the code while applying the new password.

/** POST /api/v1/validate/reset-password/request — body: { email, adminOnly } — emails a 6-digit OTP code. */
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

    const resetCode = generateOtp(email, 'reset-password');
    const targetEmail = String(user['email'] ?? email);
    const targetName = String(user['name'] ?? email);

    await sendMail({
      to: targetEmail,
      subject: adminOnly ? 'Reset your Cat-Bot Admin password' : 'Reset your Cat-Bot password',
      html: buildEmailLayout(
        `<p style="margin: 0 0 16px 0; color: ${COLORS.onSurface}; font-weight: 500;">Hello ${targetName},</p>
        <p style="margin: 0 0 24px 0;">Use the code below to securely reset your ${adminOnly ? 'admin ' : ''}password:</p>
        ${buildCodeBlock(resetCode)}
        <p style="margin: 24px 0 0 0; color: ${COLORS.outlineVariant}; font-size: 14px;">This code expires in 10 minutes. If you did not request this, you can safely ignore this email.</p>`,
        'Securely reset your password',
      ),
      text: `Your Cat-Bot password reset code is ${resetCode}. It expires in 10 minutes.`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Custom request reset failed', { error });
    res.status(500).json({ error: 'Failed to request reset' });
  }
}

/** POST /api/v1/validate/reset-password/verify-code — body: { email, code, adminOnly } */
export async function verifyResetCodeCustom(req: Request, res: Response): Promise<void> {
  const body = req.body as { email?: string; code?: string; adminOnly?: boolean };
  const email = body.email?.trim();
  const code = body.code?.trim();
  if (!email || !code) { res.status(400).json({ error: 'Missing email or code' }); return; }

  const result = checkOtp(email, 'reset-password', code);
  res.status(200).json({ valid: result.valid });
}

/** POST /api/v1/validate/reset-password/confirm — body: { email, code, password, adminOnly } */
export async function confirmPasswordResetCustom(req: Request, res: Response): Promise<void> {
  const body = req.body as { email?: string; code?: string; password?: string; adminOnly?: boolean };
  const email = body.email?.trim();
  const code = body.code?.trim();
  const { password, adminOnly } = body;
  if (!email || !code || !password) { res.status(400).json({ error: 'Missing email, code, or password' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });
    if (!user) { res.status(400).json({ error: 'User no longer exists' }); return; }
    if (adminOnly && user['role'] !== 'admin') { res.status(400).json({ error: 'Invalid or expired code' }); return; }

    if (!consumeOtp(email, 'reset-password', code)) {
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

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
          accountId: email.toLowerCase().trim(),
          providerId: 'credential',
          password: hashed,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

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

// ── OTP-code Email Verification Flow ─────────────────────────────────────────
//
// The 6-digit code is generated inside better-auth's sendVerificationEmail
// handler (server/lib/better-auth.lib.ts) when the user signs up or requests a
// resend. This endpoint consumes that code and marks the user's email as
// verified so requireEmailVerification stops blocking sign-in.

/** POST /api/v1/validate/email-verification/confirm — body: { email, code } */
export async function confirmEmailVerificationCustom(req: Request, res: Response): Promise<void> {
  const body = req.body as { email?: string; code?: string };
  const email = body.email?.trim();
  const code = body.code?.trim();
  if (!email || !code) { res.status(400).json({ error: 'Missing email or code' }); return; }

  try {
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: email.toLowerCase().trim() }],
    });
    if (!user) { res.status(400).json({ error: 'User no longer exists' }); return; }
    if (user['emailVerified'] === true) { res.status(200).json({ success: true }); return; }

    if (!consumeOtp(email, 'email-verification', code)) {
      res.status(400).json({ error: 'Invalid or expired code' });
      return;
    }

    await ctx.adapter.update({
      model: 'user',
      where: [{ field: 'id', value: user['id'] as string }],
      update: { emailVerified: true },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('[validate] Email verification confirm failed', { error });
    res.status(500).json({ error: 'Failed to verify email' });
  }
}
