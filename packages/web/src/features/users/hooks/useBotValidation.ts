/**
 * useBotValidation — Platform credential validation state machine.
 *
 * Abstracts REST validation transports for Discord and Telegram.
 *
 * Responses follow { valid: boolean, error?: string, botName?: string } contract.
 */

import { useState, useCallback } from 'react'
import { validationService } from '@/features/users/services/validation.service'
import type { PlatformCredentials } from '@/features/users/dtos/bot.dto'
import { Platforms } from '@/constants/platform.constants'

// ── Status union — discriminated on `phase` ────────────────────────────────────

export type ValidationStatus =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'success'; info?: string }
  | { phase: 'error'; message: string }

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBotValidation(): {
  status: ValidationStatus
  validate: (credentials: PlatformCredentials) => void
  reset: () => void
} {
  const [status, setStatus] = useState<ValidationStatus>({ phase: 'idle' })

  const reset = useCallback(() => {
    setStatus({ phase: 'idle' })
  }, [])

  const validate = useCallback((credentials: PlatformCredentials) => {
    setStatus({ phase: 'validating' })

    switch (credentials.platform) {
      case Platforms.Discord: {
        void validationService
          .validateDiscord(credentials.discordToken)
          .then((result) => {
            setStatus(
              result.valid
                ? {
                    phase: 'success',
                    info: result.botName ? `Bot: ${result.botName}` : undefined,
                  }
                : {
                    phase: 'error',
                    message: result.error ?? 'Invalid Discord bot token',
                  },
            )
          })
          .catch((err: unknown) => {
            setStatus({
              phase: 'error',
              message: err instanceof Error ? err.message : 'Validation failed',
            })
          })
        break
      }

      case Platforms.Telegram: {
        void validationService
          .validateTelegram(credentials.telegramToken)
          .then((result) => {
            setStatus(
              result.valid
                ? {
                    phase: 'success',
                    info: result.botName ? `Bot: ${result.botName}` : undefined,
                  }
                : {
                    phase: 'error',
                    message: result.error ?? 'Invalid Telegram bot token',
                  },
            )
          })
          .catch((err: unknown) => {
            setStatus({
              phase: 'error',
              message: err instanceof Error ? err.message : 'Validation failed',
            })
          })
        break
      }
    }
  }, [])

  return { status, validate, reset }
}
