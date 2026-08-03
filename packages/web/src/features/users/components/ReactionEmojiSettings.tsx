import { Smile } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import {
  TELEGRAM_REACTION_EMOJIS,
  DISCORD_COMMON_REACTION_EMOJIS,
  isDiscordReactionEmoji,
} from '@/constants/reaction-emoji.constants'
import { getPlatformLabel } from '@/utils/bot.util'

interface ReactionEmojiSettingsProps {
  platform: string
  /** Persisted value loaded from the server. */
  emoji: string
  /** Unsaved local selection, or null when showing the persisted value. */
  pending: string | null
  onPick: (next: string) => void
  isLoading: boolean
  error?: string | null
}

/**
 * Reaction Emoji Settings — lets the bot owner pick the emoji the bot reacts
 * with on the user's message after a successful command. Platform-aware:
 * Telegram restricts to its documented supported set, Discord accepts unicode
 * or custom-emoji references.
 *
 * Controlled component: selection lives in the parent's form state and is
 * persisted together with the rest of the page via the single page-level
 * "Save Changes" button, instead of its own save action.
 */
export default function ReactionEmojiSettings({
  platform,
  emoji,
  pending,
  onPick,
  isLoading,
  error,
}: ReactionEmojiSettingsProps) {
  const isDiscord = platform === 'discord'
  const isTelegram = platform === 'telegram'
  const effective = pending ?? emoji
  const draftInvalid =
    isDiscord && effective !== '' && !isDiscordReactionEmoji(effective)
  const dirty = pending !== null && pending !== emoji

  return (
    <Card.Root
      variant="elevated"
      shadowElevation={1}
      padding="md"
      className="border border-outline-variant/60"
    >
      <Card.Header>
        <div className="flex items-start justify-between w-full">
          <div>
            <Card.Title as="h3">Command Reaction Emoji</Card.Title>
            <Card.Description>
              Emoji the bot reacts with on your message once a command finishes
              successfully.
            </Card.Description>
          </div>
          {!isLoading && dirty && (
            <Badge color="primary" size="sm" variant="tonal" pill>
              Unsaved
            </Badge>
          )}
        </div>
      </Card.Header>

      {/* ── Live preview ── */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-container text-3xl">
          {effective || '🔥'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-label-lg font-semibold text-on-surface">
            {effective || 'Not configured'}
          </p>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Applies to the{' '}
            <Badge color="secondary" size="sm" variant="outlined">
              {getPlatformLabel(platform)}
            </Badge>{' '}
            session — takes effect immediately, no restart required.
          </p>
        </div>
      </div>

      <div className="mt-5">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton variant="rounded" height="36px" />
            <Skeleton variant="rounded" height="120px" />
          </div>
        ) : isTelegram ? (
          <>
            <p className="text-label-md font-medium text-on-surface mb-2">
              Pick from Telegram&apos;s supported reactions
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
              {TELEGRAM_REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onPick(e)}
                  aria-label={`Select ${e}`}
                  className={[
                    'flex h-11 items-center justify-center rounded-lg text-2xl transition-colors duration-normal',
                    'hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    effective === e
                      ? 'bg-primary/15 ring-1 ring-primary'
                      : 'bg-surface-container/40',
                  ].join(' ')}
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <Field.Root>
              <Field.Label>Custom emoji reference</Field.Label>
              <Input
                value={effective}
                onChange={(e) => onPick(e.target.value)}
                placeholder="e.g. <:cat:123456789012345678> or <a:party:123456789012345678>"
                leftIcon={<Smile className="h-4 w-4" />}
              />
              <p className="mt-1.5 text-body-sm text-on-surface-variant">
                Paste a custom Discord emoji reference (e.g.{' '}
                <code className="font-mono text-label-sm bg-surface-container px-1 py-0.5 rounded">
                  &lt;:cat:123456789012345678&gt;
                </code>
                ) or type any unicode emoji.
              </p>
              {draftInvalid && (
                <p className="mt-1.5 text-body-sm text-error">
                  That doesn&apos;t look like a valid Discord emoji. Use a
                  standard unicode emoji or a custom reference like{' '}
                  <code className="font-mono text-label-sm bg-error/10 px-1 py-0.5 rounded">
                    &lt;:name:123456789012345678&gt;
                  </code>
                  .
                </p>
              )}
            </Field.Root>

            <div>
              <p className="text-label-md font-medium text-on-surface mb-2">
                Or pick a common one
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
                {DISCORD_COMMON_REACTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onPick(e)}
                    aria-label={`Select ${e}`}
                    className={[
                      'flex h-11 items-center justify-center rounded-lg text-2xl transition-colors duration-normal',
                      'hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      effective === e
                        ? 'bg-primary/15 ring-1 ring-primary'
                        : 'bg-surface-container/40',
                    ].join(' ')}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert
            variant="tonal"
            color="error"
            title="Error"
            message={error}
          />
        </div>
      )}
    </Card.Root>
  )
}
