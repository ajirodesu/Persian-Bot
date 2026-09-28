/**
 * Validation Routes — v1
 *
 * Mounted at /api/v1/validate by routes/v1/index.ts.
 */

import { Router } from 'express';
import { asyncHandler } from '@/server/middleware/async-handler.middleware.js';
import {
  validateDiscord,
  validateTelegram,
  validateFluxer,
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
validationRouter.post('/discord', asyncHandler(validateDiscord));

// POST /api/v1/validate/telegram — verify Telegram bot token via getMe
validationRouter.post('/telegram', asyncHandler(validateTelegram));

// POST /api/v1/validate/fluxer — verify Fluxer bot token via /users/@me
validationRouter.post('/fluxer', asyncHandler(validateFluxer));

// POST /api/v1/validate/email-reset — check email existence + optional admin-role filter
validationRouter.post('/email-reset', asyncHandler(validateEmailForPasswordReset));

// POST /api/v1/validate/email-status — check email existence and verification status
validationRouter.post('/email-status', asyncHandler(checkEmailStatus));

// POST /api/v1/validate/email-verification/confirm — consume OTP code and verify email
validationRouter.post(
  '/email-verification/confirm',
  asyncHandler(confirmEmailVerificationCustom),
);

// GET /api/v1/validate/email-service-status — is email actually deliverable right now?
// Public/unauthenticated: only exposes a boolean, no PII, needed pre-login on the
// forgot-password screens as well as post-login on account settings pages.
validationRouter.get('/email-service-status', (req, res) => {
  getEmailServiceStatus(req, res);
});

// POST /api/v1/validate/reset-password/request — generate OTP code and email it
validationRouter.post(
  '/reset-password/request',
  asyncHandler(requestPasswordResetCustom),
);

// POST /api/v1/validate/reset-password/verify-code — check OTP code without consuming it
validationRouter.post(
  '/reset-password/verify-code',
  asyncHandler(verifyResetCodeCustom),
);

// POST /api/v1/validate/reset-password/confirm — consume OTP code and reset password
validationRouter.post(
  '/reset-password/confirm',
  asyncHandler(confirmPasswordResetCustom),
);

export default validationRouter;
