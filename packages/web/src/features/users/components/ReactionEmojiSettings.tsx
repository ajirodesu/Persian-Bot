import { Smile } from 'lucide-react'
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
import { cn } from '@/utils/cn.util'

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
        {children}
      </h2>
    </div>
  )
}

function IconWell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 bg-surface-container-high border-hairline text-on-surface-variant">
      {children}
    </div>
  )
}

/**
 * Reaction Emoji Settings — lets the bot owner pick the emoji the bot reacts
 * with on the user's message after a successful command. Platform-aware:
 * Telegram restricts to its documented supported set, Discord accepts unicode
 * or custom-emoji references, Fluxer accepts unicode or `name:id` custom
 * emoji references.
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
  const isFluxer = platform === 'fluxer'
  const effective = pending ?? emoji
  const draftInvalid =
    isDiscord && effective !== '' && !isDiscordReactionEmoji(effective)
  const dirty = pending !== null && pending !== emoji

  return (
    <section aria-label="Command Reaction Emoji" className="space-y-2">
      <SectionTitle>Command Reaction Emoji</SectionTitle>

      <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
        {/* ── Live preview ── */}
        <div className="p-3.5 flex items-center space-x-3.5 min-w-0">
          <div className="w-11 h-11 rounded-full bg-surface-container-high border border-hairline flex items-center justify-center text-2xl flex-shrink-0">
            {effective || '🔥'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-on-surface truncate leading-snug">
              {effective || 'Not configured'}
            </span>
            <span className="text-xs text-on-surface-variant mt-0.5">
              Applies to the {getPlatformLabel(platform)} session — takes
              effect immediately, no restart required.
              {dirty && <span className="text-primary"> · Unsaved</span>}
            </span>
          </div>
        </div>

        {/* ── Picker ── */}
        <div className="p-3.5">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton variant="rounded" height="36px" />
              <Skeleton variant="rounded" height="120px" />
            </div>
          ) : isTelegram ? (
            <div className="space-y-2.5">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Smile className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Pick from Telegram&apos;s supported reactions
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Tap a reaction to select it
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
                {TELEGRAM_REACTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onPick(e)}
                    aria-label={`Select ${e}`}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-lg text-2xl transition-colors duration-100',
                      'hover:bg-surface-container-highest focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      effective === e
                        ? 'bg-primary/10 ring-1 ring-primary'
                        : 'bg-surface-container-high/40',
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Smile className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    {isDiscord ? 'Custom emoji reference' : 'Reaction emoji'}
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Type or pick below
                  </span>
                </div>
              </div>
              <Field.Root>
                <Input
                  value={effective}
                  onChange={(e) => onPick(e.target.value)}
                  aria-label={
                    isDiscord ? 'Custom emoji reference' : 'Reaction emoji'
                  }
                  placeholder={
                    isDiscord
                      ? 'e.g. <:cat:123456789012345678> or <a:party:123456789012345678>'
                      : isFluxer
                        ? 'e.g. cat:123456789012345678 or a unicode emoji'
                        : 'Type a unicode emoji…'
                  }
                  leftIcon={<Smile className="h-4 w-4" />}
                  className="h-11 text-sm"
                />
                <p className="text-[11px] text-surface-variant leading-normal mt-1.5 px-0.5">
                  {isDiscord ? (
                    <>
                      Paste a custom Discord emoji reference (e.g.{' '}
                      <code className="font-mono text-[10px] text-on-surface-variant bg-surface-container-high border border-hairline px-1 py-0.5 rounded">
                        &lt;:cat:123456789012345678&gt;
                      </code>
                      ) or type any unicode emoji.
                    </>
                  ) : isFluxer ? (
                    <>
                      Type any unicode emoji or a custom emoji reference (e.g.{' '}
                      <code className="font-mono text-[10px] text-on-surface-variant bg-surface-container-high border border-hairline px-1 py-0.5 rounded">
                        cat:123456789012345678
                      </code>
                      ).
                    </>
                  ) : (
                    <>Type any unicode emoji.</>
                  )}
                </p>
                {draftInvalid && (
                  <p className="text-xs text-error mt-1.5 px-0.5">
                    That doesn&apos;t look like a valid Discord emoji. Use a
                    standard unicode emoji or a custom reference like{' '}
                    <code className="font-mono text-[10px] bg-error/10 border border-error/30 px-1 py-0.5 rounded">
                      &lt;:name:123456789012345678&gt;
                    </code>
                    .
                  </p>
                )}
              </Field.Root>

              <div className="space-y-2.5">
                <p className="text-sm font-semibold text-on-surface">
                  Or pick a common one
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
                  {DISCORD_COMMON_REACTION_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onPick(e)}
                      aria-label={`Select ${e}`}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-lg text-2xl transition-colors duration-100',
                        'hover:bg-surface-container-highest focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        effective === e
                          ? 'bg-primary/10 ring-1 ring-primary'
                          : 'bg-surface-container-high/40',
                      )}
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
          <div className="p-3.5">
            <Alert
              variant="tonal"
              color="error"
              title="Error"
              message={error}
              size="sm"
            />
          </div>
        )}
      </div>
    </section>
  )
}
