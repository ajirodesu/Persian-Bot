import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Trash2,
  Lock,
  ShieldCheck,
  ShieldOff,
  Star,
  Bot,
  Check,
  ChevronRight,
  TriangleAlert,
} from 'lucide-react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Switch from '@/components/ui/forms/Switch'
import Dialog from '@/components/ui/overlay/Dialog'
import Alert from '@/components/ui/feedback/Alert'
import { useBotUpdate } from '@/features/users/hooks/useBotUpdate'
import { useBotValidation } from '@/features/users/hooks/useBotValidation'
import { useBotAdminOnly } from '@/features/users/hooks/useBotAdminOnly'
import { useBotReactionEmoji } from '@/features/users/hooks/useBotReactionEmoji'
import ReactionEmojiSettings from '@/features/users/components/ReactionEmojiSettings'
import type { PlatformCredentials } from '@/features/users/dtos/bot.dto'
import {
  PlatformFieldInputs,
  type PlatformFields,
} from '@/features/users/components/PlatformFieldInputs'
import { VerificationStatusDisplay } from '@/features/users/components/VerificationStatusDisplay'
import { getPlatformLabel } from '@/utils/bot.util'
import { botService } from '@/features/users/services/bot.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { Platforms } from '@/constants/platform.constants'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { cn } from '@/utils/cn.util'

interface FormState {
  botNickname: string
  botPrefix: string
  botAdmins: string[]
  botPremiums: string[]
  platform: string
  platformFields: PlatformFields
}

// ============================================================================
// Small presentational pieces matching dashboard settings
// ============================================================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
        {children}
      </h2>
    </div>
  )
}

function RowChevron({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center pl-3 flex-shrink-0',
        className ?? 'text-surface-variant',
      )}
    >
      <ChevronRight className="w-4 h-4" strokeWidth={2} />
    </div>
  )
}

function IconWell({
  children,
  tone = 'default',
  size = 'md',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'danger'
  size?: 'md' | 'lg'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border flex items-center justify-center flex-shrink-0',
        size === 'lg' ? 'w-11 h-11' : 'w-9 h-9',
        tone === 'accent' &&
          'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' &&
          'bg-error/10 border-error/30 text-error',
        tone === 'default' && 'bg-surface-container-high border-hairline text-on-surface-variant',
      )}
    >
      {children}
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
        active
          ? 'bg-surface-container-high text-primary border-primary/30'
          : 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function AddButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex items-center space-x-1 flex-shrink-0"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      <span>{label}</span>
    </button>
  )
}

function RemoveButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="p-2 text-error hover:opacity-75 active:opacity-[0.82] transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 rounded-lg flex-shrink-0"
    >
      <Trash2 className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}

// ============================================================================
// Page — /dashboard/bot/settings?id=xxx
// Handles bot property updates and dangerous actions.
// ============================================================================

export default function BotSettingsPage() {
  const { bot, setBot, isActive, id: sessionId } = useBotContext()
  const { updateBot, isLoading, error } = useBotUpdate()
  const {
    enabled: adminOnlyEnabled,
    isLoading: adminOnlyLoading,
    error: adminOnlyError,
    toggle: toggleAdminOnly,
  } = useBotAdminOnly(sessionId)
  const { success } = useSnackbar()

  const handleToggleAdminOnly = async (next: boolean): Promise<void> => {
    await toggleAdminOnly(next)
    success(
      next
        ? 'Bot Admin Only mode enabled — non-admins are now restricted.'
        : 'Bot Admin Only mode disabled — all users can use the bot again.',
    )
  }
  const [savePhase, setSavePhase] = useState<'idle' | 'clearing' | 'saving'>(
    'idle',
  )
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // ── Reaction emoji — folded into the single page-level Save Changes button
  const {
    emoji: reactionEmoji,
    isLoading: reactionLoading,
    isSaving: reactionSaving,
    error: reactionError,
    save: saveReactionEmoji,
  } = useBotReactionEmoji(sessionId)
  const [reactionPending, setReactionPending] = useState<string | null>(null)
  const reactionDirty =
    reactionPending !== null && reactionPending !== reactionEmoji
  const [openAdminIndex, setOpenAdminIndex] = useState<number | null>(null)
  const [openPremiumIndex, setOpenPremiumIndex] = useState<number | null>(null)

  const navigate = useNavigate()
  const {
    status: verificationStatus,
    validate,
    reset: resetVerification,
  } = useBotValidation()

  const buildInitialForm = (): FormState => ({
    botNickname: bot.nickname,
    botPrefix: bot.prefix,
    botAdmins: bot.admins?.length > 0 ? bot.admins : [''],
    botPremiums: bot.premiums?.length > 0 ? bot.premiums : [''],
    platform: bot.credentials.platform,
    platformFields: {
      discordToken:
        bot.credentials.platform === Platforms.Discord
          ? bot.credentials.discordToken
          : '',
      discordClientId:
        bot.credentials.platform === Platforms.Discord
          ? (bot.credentials.discordClientId ?? '')
          : '',
      telegramToken:
        bot.credentials.platform === Platforms.Telegram
          ? bot.credentials.telegramToken
          : '',
      fluxerToken:
        bot.credentials.platform === Platforms.Fluxer
          ? bot.credentials.fluxerToken
          : '',
    },
  })

  const [form, setForm] = useState<FormState>(buildInitialForm)

  // ── Field handlers ────────────────────────────────────────────────────────

  const handleTopField = (
    key: keyof Omit<
      FormState,
      'botAdmins' | 'botPremiums' | 'platform' | 'platformFields'
    >,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleAdminChange = (index: number, value: string) => {
    setForm((prev) => {
      const admins = [...prev.botAdmins]
      admins[index] = value
      return { ...prev, botAdmins: admins }
    })
  }

  const handleAddAdmin = () => {
    setOpenAdminIndex(form.botAdmins.length)
    setForm((prev) => ({ ...prev, botAdmins: [...prev.botAdmins, ''] }))
  }

  const handleRemoveAdmin = (index: number) => {
    setForm((prev) => ({
      ...prev,
      botAdmins:
        prev.botAdmins.length > 1
          ? prev.botAdmins.filter((_, i) => i !== index)
          : prev.botAdmins,
    }))
  }

  const handlePremiumChange = (index: number, value: string) => {
    setForm((prev) => {
      const premiums = [...prev.botPremiums]
      premiums[index] = value
      return { ...prev, botPremiums: premiums }
    })
  }

  const handleAddPremium = () => {
    setOpenPremiumIndex(form.botPremiums.length)
    setForm((prev) => ({ ...prev, botPremiums: [...prev.botPremiums, ''] }))
  }

  const handleRemovePremium = (index: number) => {
    setForm((prev) => ({
      ...prev,
      botPremiums:
        prev.botPremiums.length > 1
          ? prev.botPremiums.filter((_, i) => i !== index)
          : prev.botPremiums,
    }))
  }

  const handlePlatformField = (key: keyof PlatformFields, value: string) => {
    resetVerification()
    setForm((prev) => ({
      ...prev,
      platformFields: { ...prev.platformFields, [key]: value },
    }))
  }

  // ── Verification ──────────────────────────────────────────────────────────

  const canVerify = (() => {
    switch (form.platform) {
      case Platforms.Discord:
        return !!form.platformFields.discordToken
      case Platforms.Telegram:
        return !!form.platformFields.telegramToken
      case Platforms.Fluxer:
        return !!form.platformFields.fluxerToken
      default:
        return false
    }
  })()

  const handleVerify = () => {
    if (!form.platform || !canVerify) return
    let credentials: PlatformCredentials
    switch (form.platform) {
      case Platforms.Discord:
        credentials = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
        }
        break
      case Platforms.Telegram:
        credentials = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.Fluxer:
        credentials = {
          platform: Platforms.Fluxer,
          fluxerToken: form.platformFields.fluxerToken,
        }
        break
      default:
        return
    }
    validate(credentials)
  }

  // ── Save-guard ────────────────────────────────────────────────────────────

  const isCredentialsModified = (() => {
    if (form.platform === Platforms.Discord)
      return (
        form.platformFields.discordToken !==
        (bot.credentials.platform === Platforms.Discord
          ? bot.credentials.discordToken
          : '')
      )
    if (form.platform === Platforms.Telegram)
      return (
        form.platformFields.telegramToken !==
        (bot.credentials.platform === Platforms.Telegram
          ? bot.credentials.telegramToken
          : '')
      )
    if (form.platform === Platforms.Fluxer)
      return (
        form.platformFields.fluxerToken !==
        (bot.credentials.platform === Platforms.Fluxer
          ? bot.credentials.fluxerToken
          : '')
      )
    return false
  })()

  const hasValidAdmins = form.botAdmins.some((a) => a.trim() !== '')

  const disableSave =
    savePhase !== 'idle' ||
    isLoading ||
    reactionSaving ||
    (isCredentialsModified && verificationStatus.phase !== 'success') ||
    !hasValidAdmins

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    let credentials: PlatformCredentials
    switch (form.platform) {
      case Platforms.Discord:
        credentials = {
          platform: Platforms.Discord,
          discordToken: form.platformFields.discordToken,
          discordClientId: form.platformFields.discordClientId,
        }
        break
      case Platforms.Telegram:
        credentials = {
          platform: Platforms.Telegram,
          telegramToken: form.platformFields.telegramToken,
        }
        break
      case Platforms.Fluxer:
        credentials = {
          platform: Platforms.Fluxer,
          fluxerToken: form.platformFields.fluxerToken,
        }
        break
      default:
        return
    }

    try {
      const isSlashPlatform =
        bot.credentials.platform === Platforms.Discord ||
        bot.credentials.platform === Platforms.Telegram

      if (
        isCredentialsModified &&
        bot.prefix === '/' &&
        isActive &&
        isSlashPlatform
      ) {
        setSavePhase('clearing')
        await updateBot(bot.sessionId, {
          botNickname: bot.nickname,
          botPrefix: '-',
          botAdmins: bot.admins,
          botPremiums: bot.premiums,
          credentials: bot.credentials,
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      setSavePhase('saving')
      const updated = await updateBot(bot.sessionId, {
        botNickname: form.botNickname,
        botPrefix: form.botPrefix,
        botAdmins: form.botAdmins.filter((a) => a.trim() !== ''),
        botPremiums: form.botPremiums.filter((p) => p.trim() !== ''),
        credentials,
      })

      setBot(updated)

      if (reactionDirty && reactionPending !== null) {
        const reactionSaved = await saveReactionEmoji(reactionPending)
        if (reactionSaved) setReactionPending(null)
      }

      if (isCredentialsModified && isActive) {
        await botService.restartBot(bot.sessionId).catch(console.error)
        success('Bot settings saved and session reloaded successfully.')
      } else {
        success('Bot settings saved successfully.')
      }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      // Errors bubbled to UI via `error` state from useBotUpdate
    } finally {
      setSavePhase('idle')
    }
  }

  const handleCancel = (): void => {
    setForm(buildInitialForm())
    setReactionPending(null)
    resetVerification()
    setSaveSuccess(false)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await botService.deleteBot(bot.sessionId)
      success(`"${bot.nickname}" has been permanently deleted.`)
      navigate('/dashboard')
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete bot',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
      <div className="pt-4 space-y-6">
        {/* ── BOT IDENTITY ── */}
        <section aria-label="Bot Identity" className="space-y-2">
          <SectionTitle>Bot Identity</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 space-y-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone="accent">
                  <Bot className="w-4 h-4 text-primary" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      {form.botNickname || '—'}
                    </span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-container-high text-on-surface-variant border-hairline border">
                      {getPlatformLabel(form.platform)}
                    </span>
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    Display name, command prefix, and admin user IDs.
                  </span>
                </div>
              </div>
              <div className="space-y-2 pt-1">
                <div className="mx-auto w-full max-w-[300px] md:max-w-none">
                  <Field.Root required>
                    <Input
                      value={form.botNickname}
                      onChange={(e) =>
                        handleTopField('botNickname', e.target.value)
                      }
                      placeholder="Nickname — e.g. Cat Bot"
                      autoComplete="off"
                      aria-label="Bot nickname"
                      className="h-11 text-sm"
                    />
                  </Field.Root>
                </div>
                <div className="mx-auto w-full max-w-[300px] md:max-w-none">
                  <Field.Root required>
                    <Input
                      value={form.botPrefix}
                      onChange={(e) =>
                        handleTopField('botPrefix', e.target.value)
                      }
                      placeholder="Prefix — e.g. /"
                      autoComplete="off"
                      aria-label="Command prefix"
                      className="h-11 text-sm"
                    />
                  </Field.Root>
                </div>
              </div>
            </div>

            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <IconWell>
                    <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Bot Admins
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      User IDs that have admin privileges
                    </span>
                  </div>
                </div>
                <AddButton onClick={handleAddAdmin} label="Add" />
              </div>
              {form.botAdmins.map((adminId, index) => {
                const open = openAdminIndex === index
                return (
                  <div
                    key={index}
                    className="border border-hairline rounded-lg bg-surface-container-high overflow-hidden"
                  >
                    <article
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setOpenAdminIndex(open ? null : index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenAdminIndex(open ? null : index)
                        }
                      }}
                      className="p-3 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-on-surface leading-snug">
                            Admin {index + 1}
                          </span>
                          <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                            {adminId.trim() !== ''
                              ? adminId.trim()
                              : 'Tap to enter ID'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                        <ChevronRight
                          className={cn(
                            'w-4 h-4 transition-transform duration-200',
                            open && 'rotate-90',
                          )}
                          strokeWidth={2}
                        />
                      </div>
                    </article>
                    {open && (
                      <div className="p-3 pt-0">
                        <div className="mx-auto w-full max-w-[300px] md:max-w-none flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Input
                              placeholder={`Admin user ID ${index + 1}`}
                              value={adminId}
                              onChange={(e) =>
                                handleAdminChange(index, e.target.value)
                              }
                              aria-label={`Admin user ID ${index + 1}`}
                              className="h-11 text-sm"
                            />
                          </div>
                          {form.botAdmins.length > 1 && (
                            <RemoveButton
                              onClick={() => handleRemoveAdmin(index)}
                              label={`Remove admin ${index + 1}`}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <IconWell>
                    <Star className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Bot Premiums
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      User IDs with premium command privileges
                    </span>
                  </div>
                </div>
                <AddButton onClick={handleAddPremium} label="Add" />
              </div>
              {form.botPremiums.map((premiumId, index) => {
                const open = openPremiumIndex === index
                return (
                  <div
                    key={index}
                    className="border border-hairline rounded-lg bg-surface-container-high overflow-hidden"
                  >
                    <article
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setOpenPremiumIndex(open ? null : index)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenPremiumIndex(open ? null : index)
                        }
                      }}
                      className="p-3 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-on-surface leading-snug">
                            Premium {index + 1}
                          </span>
                          <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                            {premiumId.trim() !== ''
                              ? premiumId.trim()
                              : 'Tap to enter ID'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                        <ChevronRight
                          className={cn(
                            'w-4 h-4 transition-transform duration-200',
                            open && 'rotate-90',
                          )}
                          strokeWidth={2}
                        />
                      </div>
                    </article>
                    {open && (
                      <div className="p-3 pt-0">
                        <div className="mx-auto w-full max-w-[300px] md:max-w-none flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <Input
                              placeholder={`Premium user ID ${index + 1}`}
                              value={premiumId}
                              onChange={(e) =>
                                handlePremiumChange(index, e.target.value)
                              }
                              aria-label={`Premium user ID ${index + 1}`}
                              className="h-11 text-sm"
                            />
                          </div>
                          {form.botPremiums.length > 1 && (
                            <RemoveButton
                              onClick={() => handleRemovePremium(index)}
                              label={`Remove premium ${index + 1}`}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── PLATFORM CREDENTIALS ── */}
        <section aria-label="Platform Credentials" className="space-y-2">
          <SectionTitle>Platform Credentials</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 space-y-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Lock className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    {getPlatformLabel(form.platform)}
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Platform cannot be changed after creation.
                  </span>
                </div>
              </div>
              <div className="space-y-2 pt-1">
                <Field.Root>
                  <Input
                    value={getPlatformLabel(form.platform)}
                    readOnly
                    disabled
                    aria-label="Platform"
                    className="h-11 text-sm"
                  />
                </Field.Root>
                <PlatformFieldInputs
                  platform={form.platform}
                  fields={form.platformFields}
                  onChange={handlePlatformField}
                />
                <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                  Tokens used to connect this bot to its messaging platform.
                </p>
              </div>
            </div>

            {verificationStatus.phase !== 'idle' && (
              <div className="p-3.5">
                <VerificationStatusDisplay status={verificationStatus} />
              </div>
            )}

            <div className="p-3.5">
              {verificationStatus.phase === 'success' ? (
                <button
                  type="button"
                  disabled
                  className="w-full h-9 px-3 rounded-lg bg-surface-container-high border border-primary/30 text-primary font-semibold text-xs flex items-center justify-center space-x-1.5 disabled:opacity-80"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span>Verified</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={
                    !canVerify || verificationStatus.phase === 'validating'
                  }
                  className="w-full h-9 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {verificationStatus.phase === 'validating'
                    ? 'Verifying…'
                    : 'Verify Credentials'}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── BOT ADMIN ONLY ── */}
        <section aria-label="Bot Admin Only" className="space-y-2">
          <SectionTitle>Bot Admin Only</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-3 min-w-0">
                <IconWell tone={adminOnlyEnabled ? 'accent' : 'default'}>
                  {adminOnlyEnabled ? (
                    <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                  ) : (
                    <ShieldOff className="w-4 h-4" strokeWidth={2} />
                  )}
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Restrict to admins
                    </span>
                    {!adminOnlyLoading && (
                      <StatusBadge active={adminOnlyEnabled} />
                    )}
                  </div>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    {adminOnlyEnabled
                      ? 'Non-admins are currently blocked from using commands in every thread.'
                      : 'All users can currently use the bot as normal.'}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {adminOnlyLoading ? (
                  <Skeleton variant="pill" width="44px" height="24px" />
                ) : (
                  <Switch
                    checked={adminOnlyEnabled}
                    onChange={() => void handleToggleAdminOnly(!adminOnlyEnabled)}
                  />
                )}
              </div>
            </div>

            <div className="p-3.5">
              <p className="text-[11px] text-surface-variant leading-normal">
                Equivalent to{' '}
                <code className="font-mono text-[10px] text-on-surface-variant bg-surface-container-high border border-hairline px-1 py-0.5 rounded">
                  {bot.prefix}adminonly on
                </code>{' '}
                /{' '}
                <code className="font-mono text-[10px] text-on-surface-variant bg-surface-container-high border border-hairline px-1 py-0.5 rounded">
                  off
                </code>{' '}
                — takes effect immediately across all threads.
              </p>
            </div>

            {adminOnlyError && (
              <div className="p-3.5">
                <Alert
                  variant="tonal"
                  color="error"
                  title="Error"
                  message={adminOnlyError}
                  size="sm"
                />
              </div>
            )}
          </div>
        </section>

        {/* ── REACTION EMOJI ── */}
        <ReactionEmojiSettings
          platform={bot.credentials.platform}
          emoji={reactionEmoji}
          pending={reactionPending}
          onPick={setReactionPending}
          isLoading={reactionLoading}
          error={reactionError}
        />

        {/* ── DANGER ZONE ── */}
        <section aria-label="Destructive Actions" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-error/90 uppercase tracking-wider flex items-center space-x-1.5">
              <TriangleAlert
                className="w-3.5 h-3.5 text-error"
                strokeWidth={2}
              />
              <span>Danger Zone</span>
            </h2>
          </div>
          <div className="bg-surface-container-low border border-error/30 rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article
              role="button"
              tabIndex={0}
              onClick={() => {
                setDeleteError(null)
                setDeleteDialogOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDeleteError(null)
                  setDeleteDialogOpen(true)
                }
              }}
              className="w-full text-left p-3.5 flex items-center justify-between hover:bg-error/5 active:bg-error/10 tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone="danger">
                  <Trash2 className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Delete Bot
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Permanently delete this bot and all its data
                  </span>
                </div>
              </div>
              <RowChevron className="text-error" />
            </article>
          </div>

          <Dialog.Root
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              if (!open && !isDeleting) setDeleteDialogOpen(false)
            }}
            closeOnEsc={!isDeleting}
            closeOnOverlayClick={!isDeleting}
          >
            <Dialog.Positioner position="center">
              <Dialog.Backdrop />
              <Dialog.Content size="sm">
                <Dialog.Header>
                  <Dialog.Title>Delete Bot</Dialog.Title>
                  <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                  <p className="text-sm text-on-surface-variant">
                    Are you sure you want to permanently delete{' '}
                    <strong className="text-on-surface">
                      {bot.nickname}
                    </strong>
                    ? This action cannot be undone.
                  </p>
                  {deleteError && (
                    <div className="mt-3">
                      <Alert
                        variant="tonal"
                        color="error"
                        title={deleteError}
                        size="sm"
                      />
                    </div>
                  )}
                </Dialog.Body>
                <Dialog.Footer>
                  <Dialog.CloseTrigger asChild>
                    <Button variant="text" color="neutral" size="sm">
                      Cancel
                    </Button>
                  </Dialog.CloseTrigger>
                  <Button
                    color="error"
                    size="sm"
                    isLoading={isDeleting}
                    disabled={isDeleting}
                    onClick={() => void handleDelete()}
                  >
                    Yes, Delete Bot
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Dialog.Root>
        </section>

        {/* ── Cancel / Save ── */}
        {(error || saveSuccess) && (
          <div className="px-1">
            {error && <p className="text-xs text-error">{error}</p>}
            {saveSuccess && (
              <p className="text-xs text-primary">
                Bot settings saved successfully.
              </p>
            )}
          </div>
        )}
        <div className="pt-2 flex items-center space-x-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={savePhase !== 'idle' || isLoading || reactionSaving}
            className="flex-1 h-11 px-4 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface-variant hover:text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={disableSave}
            className="flex-1 h-11 px-4 rounded-lg bg-primary hover:brightness-110 active:brightness-90 active:opacity-[0.82] text-on-primary font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:ring-offset-surface"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>
              {savePhase === 'clearing'
                ? 'Clearing old commands...'
                : savePhase === 'saving' || isLoading || reactionSaving
                  ? 'Saving…'
                  : 'Save Changes'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
