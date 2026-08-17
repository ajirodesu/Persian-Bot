/**
 * Validation Service — REST credential checks for Discord, Telegram, and Fluxer.
 *
 * Responses follow { valid: boolean, error?: string, botName?: string } contract.
 */

import apiClient from '@/lib/api-client.lib'

export interface ValidateResult {
  valid: boolean
  error?: string
  botName?: string
  botId?: string
}

export const validationService = {
  async validateDiscord(discordToken: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/discord',
      { discordToken },
    )
    return response.data
  },

  async validateTelegram(telegramToken: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/telegram',
      { telegramToken },
    )
    return response.data
  },

  async validateFluxer(fluxerToken: string): Promise<ValidateResult> {
    const response = await apiClient.post<ValidateResult>(
      '/api/v1/validate/fluxer',
      { fluxerToken },
    )
    return response.data
  },
}
