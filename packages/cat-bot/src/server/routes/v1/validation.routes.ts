/**
 * Validation Routes — v1
 *
 * Mounted at /api/v1/validate by routes/v1/index.ts.
 */

import { Router } from 'express';
import {
  validateDiscord,
  validateTelegram,
  validateEmailForPasswordReset,
  requestPasswordResetCustom,
  verifyResetCodeCustom,
  confirmPasswordResetCustom,
  confirmEmailVerificationCustom,
  checkEmailStatus,
  getEmailServiceStatus,
} from '@/server/controllers/v1/validation.controller.js';

const validationRouter = Router();

// POST /api/v1/validate/discord — verify Discord bot token
validationRouter.post('/discord', (req, res) => {
  void validateDiscord(req, res);
});

// POST /api/v1/validate/telegram — verify Telegram bot token via getMe
validationRouter.post('/telegram', (req, res) => {
  void validateTelegram(req, res);
});

// POST /api/v1/validate/email-reset — check email existence + optional admin-role filter
validationRouter.post('/email-reset', (req, res) => {
  void validateEmailForPasswordReset(req, res);
});

// POST /api/v1/validate/email-status — check email existence and verification status
validationRouter.post('/email-status', (req, res) => {
  void checkEmailStatus(req, res);
});

// POST /api/v1/validate/email-verification/confirm — consume OTP code and verify email
validationRouter.post('/email-verification/confirm', (req, res) => {
  void confirmEmailVerificationCustom(req, res);
});

// GET /api/v1/validate/email-service-status — is email actually deliverable right now?
// Public/unauthenticated: only exposes a boolean, no PII, needed pre-login on the
// forgot-password screens as well as post-login on account settings pages.
validationRouter.get('/email-service-status', (req, res) => {
  getEmailServiceStatus(req, res);
});

// POST /api/v1/validate/reset-password/request — generate OTP code and email it
validationRouter.post('/reset-password/request', (req, res) => {
  void requestPasswordResetCustom(req, res);
});

// POST /api/v1/validate/reset-password/verify-code — check OTP code without consuming it
validationRouter.post('/reset-password/verify-code', (req, res) => {
  void verifyResetCodeCustom(req, res);
});

// POST /api/v1/validate/reset-password/confirm — consume OTP code and reset password
validationRouter.post('/reset-password/confirm', (req, res) => {
  void confirmPasswordResetCustom(req, res);
});

export default validationRouter;
