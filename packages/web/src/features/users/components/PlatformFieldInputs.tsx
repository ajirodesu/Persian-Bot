import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import type { Platform } from '@/features/users/dtos/bot.dto'
import { Platforms } from '@/constants/platform.constants'

// Unified schema covering all platform credentials required during both creation and edits
export interface PlatformFields {
  discordToken: string
  discordClientId: string
  telegramToken: string
}

export interface PlatformFieldInputsProps {
  platform: Platform | string
  fields: PlatformFields
  onChange: (key: keyof PlatformFields, value: string) => void
}

/**
 * Shared component rendering the correct credential inputs based on the selected platform.
 * Prevents UI divergence between the 'Create New Bot' wizard and the 'Bot Settings' tab.
 */
export function PlatformFieldInputs({
  platform,
  fields,
  onChange,
}: PlatformFieldInputsProps) {
  switch (platform) {
    case Platforms.Discord:
      return (
        <>
          <Field.Root>
            <Field.Label>Discord Token</Field.Label>
            <Input
              placeholder="Bot token from Discord Developer Portal"
              value={fields.discordToken}
              onChange={(e) => onChange('discordToken', e.target.value)}
            />
          </Field.Root>
        </>
      )

    case Platforms.Telegram:
      return (
        <Field.Root>
          <Field.Label>Telegram Token</Field.Label>
          <Input
            placeholder="Token from @BotFather"
            value={fields.telegramToken}
            onChange={(e) => onChange('telegramToken', e.target.value)}
          />
        </Field.Root>
      )

    default:
      return null
  }
}
