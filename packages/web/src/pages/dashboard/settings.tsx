import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  User,
  UserPen,
  Mail,
  Palette,
  Globe,
  ShieldCheck,
  KeyRound,
  LockKeyhole,
  Trash2,
  TriangleAlert,
  Check,
  ChevronRight,
} from 'lucide-react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Button from '@/components/ui/buttons/Button'
import Dialog from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import TimezoneInlinePicker from '@/components/ui/forms/TimezoneInlinePicker'
import { useTheme, type AppTheme } from '@/contexts/ThemeContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching bot_manager_settings.html
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
    <div className={cn('flex items-center pl-3 flex-shrink-0', className ?? 'text-surface-variant')}>
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

function SettingsPageSkeleton() {
  return (
    <div className="flex flex-col gap-0 max-w-[420px] md:max-w-2xl w-full mx-auto pb-8" aria-busy="true">
      <div className="px-5 pt-4 space-y-6">
        {[0, 1, 2].map((s) => (
          <section key={s} className="space-y-2">
            <Skeleton textSize="body-sm" width="96px" />
            <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
              <div className="p-3.5 flex items-center gap-3.5">
                <Skeleton variant="input" width={36} height={36} />
                <div className="flex flex-col gap-2">
                  <Skeleton textSize="body-sm" width="140px" />
                  <Skeleton textSize="body-sm" width="100px" />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Page — bot_manager_settings.html structure, real application logic
// ============================================================================

const THEME_OPTIONS: { id: AppTheme; label: string; dot: string }[] = [
  { id: 'aqua', label: 'Aqua', dot: 'bg-primary' },
  { id: 'burnt', label: 'Burnt', dot: 'bg-amber-500/80' },
  { id: 'indigo', label: 'Indigo', dot: 'bg-indigo-500/80' },
]

export default function SettingsPage() {
  const { isEmailEnabled } = useEmailServiceEnabled()
  const { success, error: notifyError } = useSnackbar()
  const { theme, setTheme } = useTheme()

  const { data: session, isPending: sessionLoading } = authUserClient.useSession()

  // ── Timezone ──
  const {
    timezone: activeTimezone,
    savedTimezone,
    browserTimezone,
    isLoading: timezoneLoading,
    setTimezone: persistTimezone,
  } = useTimezone()
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null)
  const timezoneValue = timezoneDraft ?? activeTimezone
  const timezoneDirty = timezoneDraft !== null && timezoneDraft !== savedTimezone
  const [timezoneEditorOpen, setTimezoneEditorOpen] = useState(false)

  // ── Profile ──
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [nameEditorOpen, setNameEditorOpen] = useState(false)
  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }
  const profileDirty =
    nameInitialized && profileName.trim() !== '' && profileName.trim() !== (session?.user?.name ?? '')
  const displayName = nameInitialized ? profileName || session?.user?.name || '' : (session?.user?.name ?? '')
  const email = session?.user?.email ?? ''
  const verified = Boolean(session?.user?.emailVerified)
  const initials = (displayName || email || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // ── Password ──
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false)

  const handleChangePassword = async (): Promise<void> => {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }
    setPasswordSaving(true)
    const { error } = await authUserClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    if (error) {
      setPasswordError(error.message ?? 'Failed to change password')
    } else {
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 3000)
    }
    setPasswordSaving(false)
  }

  const handleSendResetCode = async (): Promise<void> => {
    setResetError(null)
    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email: email || '',
        adminOnly: false,
      })
      setResetSent(true)
      success('Verification code sent to email')
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send reset code')
    }
  }

  const handleRevokeSessions = async (): Promise<void> => {
    try {
      const { error } = await authUserClient.revokeOtherSessions()
      if (error) throw new Error(error.message ?? 'Failed to sign out other sessions')
      success('All other sessions signed out')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to sign out other sessions')
    }
  }

  // ── Delete account ──
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteAccount = async (): Promise<void> => {
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm deletion')
      return
    }
    setDeleteError(null)
    setIsDeleting(true)
    const { error } = await authUserClient.deleteUser({ password: deletePassword })
    if (error) {
      setDeleteError(error.message ?? 'Failed to delete account')
      setIsDeleting(false)
      return
    }
    window.location.assign(ROUTES.LOGIN)
  }

  // ── Unified save — Timezone + Profile ──
  const hasUnsavedChanges = timezoneDirty || profileDirty
  const [isSavingAll, setIsSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSaveChanges = async (): Promise<void> => {
    setSaveError(null)
    setSaveSuccess(false)
    setIsSavingAll(true)
    try {
      if (timezoneDirty && timezoneDraft) await persistTimezone(timezoneDraft)
      if (profileDirty) {
        const { error } = await authUserClient.updateUser({ name: profileName.trim() })
        if (error) throw new Error(error.message ?? 'Failed to update profile')
      }
      setTimezoneDraft(null)
      setNameEditorOpen(false)
      setSaveSuccess(true)
      success('Settings saved successfully')
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setIsSavingAll(false)
    }
  }

  const handleCancelChanges = (): void => {
    setTimezoneDraft(null)
    setProfileName(session?.user?.name ?? '')
    setNameEditorOpen(false)
    setSaveError(null)
    setSaveSuccess(false)
  }

  if (sessionLoading || timezoneLoading) return <SettingsPageSkeleton />

  return (
    <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
      <Helmet>
        <title>Settings · Cat-Bot</title>
      </Helmet>

      <div className="pt-4 space-y-6">
        {/* ── PROFILE ── */}
        <section aria-label="Account Settings" className="space-y-2">
          <SectionTitle>Profile</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {/* Identity */}
            <article className="p-3.5 flex items-center justify-between">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone="accent">
                  <User className="w-4 h-4 text-primary" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      {displayName || '—'}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
                        verified
                          ? 'bg-surface-container-high text-primary border-primary/30'
                          : 'bg-surface-container-high text-on-surface-variant border-hairline',
                      )}
                    >
                      {verified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">{email || '—'}</span>
                </div>
              </div>
              <span
                className="flex items-center justify-center w-7 h-7 rounded-md bg-surface-container-high border border-hairline font-mono text-[11px] font-semibold text-on-surface flex-shrink-0 ml-3"
                aria-hidden="true"
              >
                {initials}
              </span>
            </article>

            {/* Display name — expands inline editor */}
            <article
              role="button"
              tabIndex={0}
              aria-expanded={nameEditorOpen}
              onClick={() => setNameEditorOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setNameEditorOpen((v) => !v)
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <UserPen className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                    Display Name
                  </span>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {displayName || '—'}
                    {profileDirty && <span className="text-primary"> · Unsaved</span>}
                  </span>
                </div>
              </div>
              <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                <ChevronRight
                  className={cn(
                    'w-4 h-4 transition-transform duration-200',
                    nameEditorOpen && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
              </div>
            </article>
            {nameEditorOpen && (
              <div className="p-3.5">
                <Field.Root>
                  <Input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    aria-label="Display name"
                    className="h-11 text-sm"
                  />
                </Field.Root>
              </div>
            )}

            {/* Email — display only */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => success('Email address cannot be changed')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  success('Email address cannot be changed')
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Mail className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                    Primary Email
                  </span>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">{email || '—'}</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* ── APPEARANCE ── */}
        <section aria-label="Appearance Settings" className="space-y-2">
          <SectionTitle>Appearance</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <IconWell>
                    <Palette className="w-4 h-4 text-primary" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Interface Theme
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      Select active colorway: Aqua, Burnt, or Indigo
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1" role="radiogroup" aria-label="Interface theme">
                {THEME_OPTIONS.map((opt) => {
                  const active = theme === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setTheme(opt.id)
                      }}
                      className={cn(
                        'flex items-center justify-center space-x-2 py-2 px-2.5 rounded-lg text-xs font-medium transition-colors duration-100 active:opacity-[0.82] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        active
                          ? 'bg-primary/10 border-2 border-primary text-on-surface'
                          : 'bg-surface-container-high border border-hairline text-on-surface-variant hover:text-on-surface',
                      )}
                    >
                      <span className={cn('w-3 h-3 rounded-full flex-shrink-0', opt.dot)} />
                      <span className={cn(active && 'font-semibold text-primary')}>
                        {opt.label}
                      </span>
                      {active && <Check className="w-3 h-3 text-primary ml-auto" strokeWidth={2.5} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── REGIONAL ── */}
        <section aria-label="Regional Settings" className="space-y-2">
          <SectionTitle>Regional</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article
              role="button"
              tabIndex={0}
              aria-expanded={timezoneEditorOpen}
              onClick={() => setTimezoneEditorOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setTimezoneEditorOpen((v) => !v)
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Globe className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">Timezone</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Used across dashboard timestamps and logs
                    {timezoneDirty && <span className="text-primary"> · Unsaved</span>}
                  </span>
                </div>
              </div>
              <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                <ChevronRight
                  className={cn(
                    'w-4 h-4 transition-transform duration-200',
                    timezoneEditorOpen && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
              </div>
            </article>
            {timezoneEditorOpen && (
              <div className="p-3.5 pt-3 space-y-3">
                <TimezoneInlinePicker
                  value={timezoneValue}
                  onChange={(tz) => setTimezoneDraft(tz)}
                />
                {!savedTimezone && !timezoneDirty && (
                  <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                    Currently showing your browser's detected timezone ({browserTimezone}).
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── SECURITY ── */}
        <section aria-label="Security Settings" className="space-y-2">
          <SectionTitle>Security</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {/* Sessions */}
            <article
              role="button"
              tabIndex={0}
              onClick={() => void handleRevokeSessions()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void handleRevokeSessions()
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone="accent">
                  <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Sessions
                  </span>
                  <span className="text-xs text-primary mt-0.5 flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                    <span>Tap to sign out all other sessions</span>
                  </span>
                </div>
              </div>
              <RowChevron />
            </article>

            {/* Reset code */}
            {isEmailEnabled && (
              <article className="p-3.5 flex items-center justify-between">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <IconWell>
                    <KeyRound className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Password Reset Code
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      Send a 6-digit verification code to email
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={resetSent}
                  onClick={() => void handleSendResetCode()}
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 disabled:opacity-60 flex-shrink-0 ml-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {resetSent ? 'Code Sent' : 'Send Code'}
                </button>
              </article>
            )}
            {resetError && (
              <div className="p-3.5">
                <Alert variant="tonal" color="error" title={resetError} size="sm" />
              </div>
            )}
            {resetSent && (
              <div className="p-3.5 space-y-3">
                <Alert
                  variant="tonal"
                  color="success"
                  title="Check your email"
                  message="We've sent you a 6-digit code to reset your password."
                  size="sm"
                />
                <Button
                  as={Link}
                  to={`${ROUTES.RESET_PASSWORD}?email=${encodeURIComponent(email || '')}`}
                  variant="tonal"
                  color="primary"
                  size="sm"
                  className="self-start"
                >
                  Enter the code
                </Button>
              </div>
            )}

            {/* Change password inline form */}
            <article
              role="button"
              tabIndex={0}
              aria-expanded={passwordEditorOpen}
              onClick={() => setPasswordEditorOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setPasswordEditorOpen((v) => !v)
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <LockKeyhole className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Change Password
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Requires verification of existing credential
                  </span>
                </div>
              </div>
              <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                <ChevronRight
                  className={cn(
                    'w-4 h-4 transition-transform duration-200',
                    passwordEditorOpen && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
              </div>
            </article>
            {passwordEditorOpen && (
              <div className="p-3.5 pt-0">
                <div className="space-y-2 pt-1">
                <div>
                  <label
                    htmlFor="settings-current-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    Current Password
                  </label>
                  <PasswordInput
                    id="settings-current-password"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value)
                      setPasswordError(null)
                    }}
                    disabled={passwordSaving}
                    autoComplete="current-password"
                    className="h-11 text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="settings-new-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    New Password
                  </label>
                  <PasswordInput
                    id="settings-new-password"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      setPasswordError(null)
                    }}
                    disabled={passwordSaving}
                    autoComplete="new-password"
                    className="h-11 text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="settings-confirm-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    Confirm New Password
                  </label>
                  <PasswordInput
                    id="settings-confirm-password"
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      setPasswordError(null)
                    }}
                    disabled={passwordSaving}
                    autoComplete="new-password"
                    className="h-11 text-xs"
                  />
                </div>
                {passwordError && (
                  <Alert variant="tonal" color="error" title={passwordError} size="sm" />
                )}
                {passwordSuccess && (
                  <Alert
                    variant="tonal"
                    color="success"
                    title="Password changed successfully."
                    message="All other sessions have been signed out."
                    size="sm"
                  />
                )}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => void handleChangePassword()}
                    disabled={
                      passwordSaving || !currentPassword || !newPassword || !confirmPassword
                    }
                    className="w-full h-9 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {passwordSaving ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── DANGER ZONE ── */}
        <section aria-label="Destructive Actions" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-error/90 uppercase tracking-wider flex items-center space-x-1.5">
              <TriangleAlert className="w-3.5 h-3.5 text-error" strokeWidth={2} />
              <span>Danger Zone</span>
            </h2>
          </div>
          <div className="bg-surface-container-low border border-error/30 rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article
              role="button"
              tabIndex={0}
              onClick={() => {
                setDeletePassword('')
                setDeleteError(null)
                setDeleteDialogOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDeletePassword('')
                  setDeleteError(null)
                  setDeleteDialogOpen(true)
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-error/5 active:bg-error/10 tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone="danger">
                  <Trash2 className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Delete Account
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Permanently erase profile, bots, and chat logs
                  </span>
                </div>
              </div>
              <RowChevron className="text-error" />
            </article>
          </div>
        </section>

        {/* ── Cancel / Save ── */}
        {(saveError || saveSuccess) && (
          <div className="px-1">
            {saveError && <p className="text-xs text-error">{saveError}</p>}
            {saveSuccess && <p className="text-xs text-primary">Changes saved successfully.</p>}
          </div>
        )}
        <div className="pt-2 flex items-center space-x-3">
          <button
            type="button"
            onClick={handleCancelChanges}
            disabled={!hasUnsavedChanges || isSavingAll}
            className="flex-1 h-11 px-4 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface-variant hover:text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSaveChanges()}
            disabled={!hasUnsavedChanges || isSavingAll}
            className="flex-1 h-11 px-4 rounded-lg bg-primary hover:brightness-110 active:brightness-90 active:opacity-[0.82] text-on-primary font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:ring-offset-surface"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>{isSavingAll ? 'Saving…' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
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
              <Dialog.Title>Delete account?</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-sm text-on-surface-variant">
                This permanently deletes your account, chat history, sessions, and connected bot
                credentials. This action cannot be undone.
              </p>
              <Field.Root>
                <Field.Label>Confirm password</Field.Label>
                <PasswordInput
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value)
                    setDeleteError(null)
                  }}
                  placeholder="Enter your password"
                  disabled={isDeleting}
                />
              </Field.Root>
              {deleteError && <Alert variant="tonal" color="error" title={deleteError} size="sm" />}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="error"
                size="sm"
                onClick={() => void handleDeleteAccount()}
                isLoading={isDeleting}
                disabled={isDeleting || !deletePassword}
              >
                Delete account
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
