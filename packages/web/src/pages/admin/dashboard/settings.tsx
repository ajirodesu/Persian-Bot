import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Switch from '@/components/ui/forms/Switch'
import TimezoneInlinePicker from '@/components/ui/forms/TimezoneInlinePicker'
import { useTheme, type AppTheme } from '@/contexts/ThemeContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import {
  Plus,
  Trash2,
  Terminal,
  Check,
  ChevronRight,
  ShieldCheck,
  User,
  UserPen,
  Mail,
  Palette,
  Globe,
  GitBranch,
  KeyRound,
  LockKeyhole,
  TriangleAlert,
} from 'lucide-react'
import Dialog from '@/components/ui/overlay/Dialog'
import { adminService } from '@/features/admin/services/admin.service'
import type { SystemAdminDto } from '@/features/admin/services/admin.service'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type { GitHubIdentityDto } from '@/features/admin/services/admin-file-manager.service'
import { RESET_ALL_DATABASE_CONFIRMATION_PHRASE } from '@/features/admin/services/admin.service'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import { cn } from '@/utils/cn.util'

/**
 * AdminSettingsPage
 *
 * System Admins section now persists to and loads from /api/v1/admin/system-admins
 * so registered IDs survive server restarts and are visible to all admin accounts.
 *
 * Timezone, Profile, and System Administrators share a single "Save Changes"
 * button — Security (password) and Danger Zone remain separate since they're
 * distinct, higher-stakes actions.
 */

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

function AdminSettingsPageSkeleton() {
  return (
    <div
      className="flex flex-col gap-0 max-w-[420px] md:max-w-2xl w-full mx-auto pb-8"
      aria-busy="true"
    >
      <div className="px-5 pt-4 space-y-6">
        {[0, 1, 2, 3, 4].map((s) => (
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

const THEME_OPTIONS: { id: AppTheme; label: string; dot: string }[] = [
  { id: 'aqua', label: 'Aqua', dot: 'bg-primary' },
  { id: 'burnt', label: 'Burnt', dot: 'bg-amber-500/80' },
  { id: 'indigo', label: 'Indigo', dot: 'bg-indigo-500/80' },
]

export default function AdminSettingsPage() {
  const { isEmailEnabled } = useEmailServiceEnabled()
  const { success } = useSnackbar()
  const { theme, setTheme } = useTheme()

  const { data: session, isPending: sessionLoading } =
    authAdminClient.useSession()

  // ── Timezone state ──────────────────────────────────────────────────────────
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

  // ── Profile edit state ─────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [nameEditorOpen, setNameEditorOpen] = useState(false)

  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }

  const profileDirty =
    nameInitialized &&
    profileName.trim() !== '' &&
    profileName.trim() !== (session?.user?.name ?? '')
  const displayName = nameInitialized
    ? profileName || session?.user?.name || ''
    : (session?.user?.name ?? '')
  const email = session?.user?.email ?? ''
  const initials = (displayName || email || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // ── Password change state ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetCodeError, setResetCodeError] = useState<string | null>(null)
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
    const { error } = await authAdminClient.changePassword({
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
    setResetCodeError(null)
    try {
      // Target the custom OTP flow that powers the Admin Forgot Password page
      // instead of better-auth's native implementation.
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email: email || '',
        adminOnly: true,
      })
      setResetSent(true)
      success('Verification code sent to email')
    } catch (err) {
      setResetCodeError(
        err instanceof Error ? err.message : 'Failed to send reset code',
      )
    }
  }

  // ── System Admins — real API ───────────────────────────────────────────────
  const [systemAdmins, setSystemAdmins] = useState<SystemAdminDto[]>([])
  const [adminIds, setAdminIds] = useState<string[]>([''])
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminLoadError, setAdminLoadError] = useState<string | null>(null)
  const [openAdminIndex, setOpenAdminIndex] = useState<number | null>(null)

  // Load persisted system admins on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await adminService.getSystemAdmins()
        setSystemAdmins(result.admins)
        setAdminIds(
          result.admins.length > 0 ? result.admins.map((a) => a.adminId) : [''],
        )
      } catch (err) {
        setAdminLoadError(
          err instanceof Error ? err.message : 'Failed to load system admins',
        )
      } finally {
        setAdminLoading(false)
      }
    }
    void load()
  }, [])

  const handleAdminChange = (index: number, value: string) => {
    setAdminIds((prev) => {
      const ids = [...prev]
      ids[index] = value
      return ids
    })
  }

  const handleAddAdminRow = () => {
    setOpenAdminIndex(adminIds.length)
    setAdminIds((prev) => [...prev, ''])
  }

  const handleRemoveAdminRow = (index: number) => {
    setAdminIds((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    )
  }

  // Compute diff to determine if a save is needed and what to dispatch
  const targetIds = Array.from(
    new Set(adminIds.map((id) => id.trim()).filter((id) => id !== '')),
  )
  const currentIds = systemAdmins.map((a) => a.adminId)
  const isAdminsModified =
    targetIds.length !== currentIds.length ||
    targetIds.some((id) => !currentIds.includes(id)) ||
    currentIds.some((id) => !targetIds.includes(id))

  // ── Maintenance Mode — global "restrict bots to System Admins" ──────────────
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(true)
  const [maintenanceSaving, setMaintenanceSaving] = useState(false)
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const { enabled } = await adminService.getMaintenanceMode()
        setMaintenanceEnabled(enabled)
      } catch (err) {
        setMaintenanceError(
          err instanceof Error
            ? err.message
            : 'Failed to load Maintenance Mode state',
        )
      } finally {
        setMaintenanceLoading(false)
      }
    }
    void load()
  }, [])

  // Optimistic toggle that reverts on failure — mirrors the Bot Admin Only switch.
  const handleToggleMaintenance = async (enabled: boolean): Promise<void> => {
    setMaintenanceSaving(true)
    setMaintenanceError(null)
    const previous = maintenanceEnabled
    setMaintenanceEnabled(enabled)
    try {
      const { enabled: confirmed } =
        await adminService.updateMaintenanceMode(enabled)
      setMaintenanceEnabled(confirmed)
    } catch (err) {
      setMaintenanceEnabled(previous)
      setMaintenanceError(
        err instanceof Error
          ? err.message
          : 'Failed to update Maintenance Mode state',
      )
    } finally {
      setMaintenanceSaving(false)
    }
  }

  // ── GitHub API key (Git functionality) — takes effect immediately,
  // like Maintenance Mode and Security, so it stays outside Save Changes ──
  const [gitToken, setGitToken] = useState('')
  const [gitIdentity, setGitIdentity] = useState<GitHubIdentityDto | null>(null)
  const [gitLoading, setGitLoading] = useState(true)
  const [gitSaving, setGitSaving] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitEditorOpen, setGitEditorOpen] = useState(false)

  // Restore the connected identity on mount — the token itself stays on the
  // server (encrypted) and never reaches the browser.
  useEffect(() => {
    let cancelled = false
    adminFileManagerService
      .getGitConfig()
      .then((data) => {
        if (!cancelled && data.identity) setGitIdentity(data.identity)
      })
      .catch(() => {
        // Best-effort — settings works without a connected account.
      })
      .finally(() => {
        if (!cancelled) setGitLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Verify the PAT against GitHub and store it as the single global
  // deployment token. Connects Files → Git, /push, /installer and /update.
  const handleConnectGit = async (): Promise<void> => {
    const token = gitToken.trim()
    if (!token) {
      setGitError('Enter your GitHub personal access token to connect.')
      return
    }
    setGitSaving(true)
    setGitError(null)
    try {
      const identity = await adminFileManagerService.gitIdentity(token)
      setGitIdentity(identity)
      setGitToken('')
      success(`GitHub connected as ${identity.login}`)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setGitError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to verify GitHub API key'),
      )
    } finally {
      setGitSaving(false)
    }
  }

  // Disconnect the global token on the server and clear local state.
  const handleDisconnectGit = async (): Promise<void> => {
    setGitSaving(true)
    setGitError(null)
    try {
      await adminFileManagerService.clearGitConfig()
    } catch {
      // Best-effort — local state clears even if the server call failed.
    } finally {
      setGitSaving(false)
    }
    setGitIdentity(null)
    setGitToken('')
  }

  // ── Reset All Database — destructive, admin-only ─────────────────────────────
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetConfirmInput, setResetConfirmInput] = useState('')
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const openResetDialog = () => {
    setResetDialogOpen(true)
    setResetConfirmInput('')
    setResetError(null)
  }

  const closeResetDialog = () => {
    if (isResetting) return
    setResetDialogOpen(false)
    setResetConfirmInput('')
    setResetError(null)
  }

  const isResetConfirmed =
    resetConfirmInput === RESET_ALL_DATABASE_CONFIRMATION_PHRASE

  const handleResetAllDatabase = async (): Promise<void> => {
    if (!isResetConfirmed) return
    setIsResetting(true)
    setResetError(null)
    try {
      await adminService.resetAllDatabase(resetConfirmInput)
      setResetDialogOpen(false)
      setResetConfirmInput('')
      success('Database reset complete. Reload the page to see the updated state.')
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResetError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to reset database'),
      )
    } finally {
      setIsResetting(false)
    }
  }

  // ── Unified save — Timezone + Profile + System Administrators ──────────────
  const hasUnsavedChanges = timezoneDirty || profileDirty || isAdminsModified
  const [isSavingAll, setIsSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSaveChanges = async (): Promise<void> => {
    setSaveError(null)
    setSaveSuccess(false)
    setIsSavingAll(true)
    try {
      if (timezoneDirty && timezoneDraft) {
        await persistTimezone(timezoneDraft)
      }
      if (profileDirty) {
        const { error } = await authAdminClient.updateUser({
          name: profileName.trim(),
        })
        if (error) throw new Error(error.message ?? 'Failed to update profile')
      }
      if (isAdminsModified) {
        const toAdd = targetIds.filter((id) => !currentIds.includes(id))
        const toRemove = currentIds.filter((id) => !targetIds.includes(id))
        // Execute operations iteratively to avoid DB lock issues with
        // concurrent operations on the same table
        for (const id of toRemove) await adminService.removeSystemAdmin(id)
        for (const id of toAdd) await adminService.addSystemAdmin(id)
        const result = await adminService.getSystemAdmins()
        setSystemAdmins(result.admins)
        setAdminIds(
          result.admins.length > 0 ? result.admins.map((a) => a.adminId) : [''],
        )
      }
      setTimezoneDraft(null)
      setNameEditorOpen(false)
      setSaveSuccess(true)
      success('Changes saved successfully.')
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save changes',
      )
    } finally {
      setIsSavingAll(false)
    }
  }

  const handleCancelChanges = (): void => {
    setTimezoneDraft(null)
    setProfileName(session?.user?.name ?? '')
    setNameEditorOpen(false)
    setAdminIds(
      systemAdmins.length > 0 ? systemAdmins.map((a) => a.adminId) : [''],
    )
    setSaveError(null)
    setSaveSuccess(false)
  }

  // Collect every mount-time data fetch the page depends on — session, timezone,
  // system admins, and maintenance mode — and keep the page-level skeleton up
  // until they've all settled (better-auth caches the session, so sessionLoading
  // alone flashes too fast to be useful here).
  const isPageLoading =
    sessionLoading ||
    timezoneLoading ||
    adminLoading ||
    maintenanceLoading ||
    gitLoading

  if (isPageLoading) {
    return <AdminSettingsPageSkeleton />
  }

  return (
    <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
      <Helmet>
        <title>Admin Settings · Cat-Bot</title>
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
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {email || '—'}
                  </span>
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
                    {profileDirty && (
                      <span className="text-primary"> · Unsaved</span>
                    )}
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
                    disabled={sessionLoading}
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
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {email || '—'}
                  </span>
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
              <div
                className="grid grid-cols-3 gap-2 pt-1"
                role="radiogroup"
                aria-label="Interface theme"
              >
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
                      <span
                        className={cn(
                          'w-3 h-3 rounded-full flex-shrink-0',
                          opt.dot,
                        )}
                      />
                      <span
                        className={cn(active && 'font-semibold text-primary')}
                      >
                        {opt.label}
                      </span>
                      {active && (
                        <Check
                          className="w-3 h-3 text-primary ml-auto"
                          strokeWidth={2.5}
                        />
                      )}
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
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Timezone
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Used across the admin portal for timestamps and logs
                    {timezoneDirty && (
                      <span className="text-primary"> · Unsaved</span>
                    )}
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
                    Currently showing your browser&apos;s detected timezone (
                    {browserTimezone}).
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── SYSTEM ADMINISTRATORS ── */}
        <section aria-label="System Administrators" className="space-y-2">
          <SectionTitle>System Administrators</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <IconWell>
                    <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Admin User IDs
                    </span>
                    <span className="text-xs text-on-surface-variant mt-0.5">
                      Bypass all command role restrictions and ban checks
                      {isAdminsModified && (
                        <span className="text-primary"> · Unsaved</span>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddAdminRow}
                  disabled={adminLoading}
                  aria-label="Add another system admin user ID"
                  className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex items-center space-x-1 flex-shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>Add</span>
                </button>
              </div>
              {adminLoading ? (
                <div className="flex flex-col gap-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Skeleton variant="input" height={44} />
                      </div>
                      <Skeleton variant="input" width={40} height={40} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {adminIds.map((adminId, index) => {
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
                          onClick={() =>
                            setOpenAdminIndex(open ? null : index)
                          }
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
                            <div className="mx-auto w-full max-w-[300px] flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <Input
                                  placeholder={`System admin user ID ${index + 1}`}
                                  value={adminId}
                                  onChange={(e) =>
                                    handleAdminChange(index, e.target.value)
                                  }
                                  aria-label={`System admin user ID ${index + 1}`}
                                  className="h-11 text-sm"
                                />
                              </div>
                              {adminIds.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveAdminRow(index)
                                  }
                                  aria-label={`Remove system admin ${index + 1}`}
                                  className="p-2 text-error hover:opacity-75 active:opacity-[0.82] transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 rounded-lg flex-shrink-0"
                                >
                                  <Trash2
                                    className="h-4 w-4"
                                    strokeWidth={2}
                                  />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {adminLoadError !== null && (
              <div className="p-3.5">
                <Alert
                  variant="tonal"
                  color="error"
                  title={adminLoadError}
                  size="sm"
                />
              </div>
            )}
          </div>
        </section>

        {/* ── MAINTENANCE MODE ── */}
        <section aria-label="Maintenance Mode" className="space-y-2">
          <SectionTitle>Maintenance Mode</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-3 min-w-0">
                <IconWell tone={maintenanceEnabled ? 'accent' : 'default'}>
                  <Terminal className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Maintenance Mode
                    </span>
                    {!maintenanceLoading && (
                      <StatusBadge active={maintenanceEnabled} />
                    )}
                  </div>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    {maintenanceEnabled
                      ? 'All bots are currently under maintenance — only System Admins can use commands.'
                      : 'All users can use the bots as normal.'}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {maintenanceLoading || maintenanceSaving ? (
                  <Skeleton variant="pill" width="44px" height="24px" />
                ) : (
                  <Switch
                    checked={maintenanceEnabled}
                    onChange={() => void handleToggleMaintenance(!maintenanceEnabled)}
                  />
                )}
              </div>
            </div>

            <div className="p-3.5">
              <p className="text-[11px] text-surface-variant leading-normal">
                System-level switch that takes effect immediately across every
                bot and platform. Only registered System Administrators bypass
                this restriction.
              </p>
            </div>

            {maintenanceError !== null && (
              <div className="p-3.5">
                <Alert
                  variant="tonal"
                  color="error"
                  title="Error"
                  message={maintenanceError}
                  size="sm"
                />
              </div>
            )}
          </div>
        </section>

        {/* ── GIT ── */}
        <section aria-label="Git Settings" className="space-y-2">
          <SectionTitle>Git</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article
              role="button"
              tabIndex={0}
              aria-expanded={gitEditorOpen}
              onClick={() => setGitEditorOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setGitEditorOpen((v) => !v)
                }
              }}
              className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
            >
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone={gitIdentity ? 'accent' : 'default'}>
                  <GitBranch className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      GitHub API Key
                    </span>
                    <StatusBadge active={gitIdentity !== null} />
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {gitIdentity
                      ? `Connected as ${gitIdentity.login} — enables Files → Git, push, installer and updates`
                      : 'Connect a token to enable commits, pushes and updates'}
                  </span>
                </div>
              </div>
              <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
                <ChevronRight
                  className={cn(
                    'w-4 h-4 transition-transform duration-200',
                    gitEditorOpen && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
              </div>
            </article>
            {gitEditorOpen && (
              <div className="p-3.5 pt-3 space-y-2.5">
                {gitIdentity ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-container-high p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {gitIdentity.avatarUrl ? (
                        <img
                          src={gitIdentity.avatarUrl}
                          alt={`${gitIdentity.login} avatar`}
                          className="h-9 w-9 rounded-full flex-shrink-0"
                        />
                      ) : (
                        <IconWell>
                          <GitBranch className="w-4 h-4" strokeWidth={2} />
                        </IconWell>
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                          {gitIdentity.login}
                        </span>
                        <span className="text-xs text-on-surface-variant truncate mt-0.5">
                          {gitIdentity.name || gitIdentity.email || 'GitHub account verified'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDisconnectGit()}
                      disabled={gitSaving}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-error/30 text-error transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 flex-shrink-0"
                    >
                      {gitSaving ? 'Working…' : 'Disconnect'}
                    </button>
                  </div>
                ) : (
                  <>
                    <PasswordInput
                      id="admin-settings-github-token"
                      placeholder="ghp_…"
                      value={gitToken}
                      onChange={(e) => {
                        setGitToken(e.target.value)
                        setGitError(null)
                      }}
                      disabled={gitSaving}
                      autoComplete="off"
                      aria-label="GitHub personal access token"
                      className="py-2.5 text-sm leading-6"
                    />
                    <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                      Classic personal access token with the{' '}
                      <code className="font-mono text-on-surface bg-surface-container-high rounded px-1 py-px text-[10px]">
                        repo
                      </code>{' '}
                      scope. Verified against GitHub, then stored encrypted
                      server-side — it is never shown again.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleConnectGit()}
                      disabled={gitSaving || !gitToken.trim()}
                      className="w-full h-9 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {gitSaving ? 'Verifying…' : 'Verify & Connect'}
                    </button>
                  </>
                )}
                {gitError && (
                  <Alert
                    variant="tonal"
                    color="error"
                    title={gitError}
                    size="sm"
                  />
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── SECURITY ── */}
        <section aria-label="Security Settings" className="space-y-2">
          <SectionTitle>Security</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
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
            {resetCodeError && (
              <div className="p-3.5">
                <Alert
                  variant="tonal"
                  color="error"
                  title={resetCodeError}
                  size="sm"
                />
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
                  to={`${ROUTES.ADMIN.RESET_PASSWORD}?email=${encodeURIComponent(session?.user?.email || '')}`}
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
                    htmlFor="admin-settings-current-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    Current Password
                  </label>
                  <PasswordInput
                    id="admin-settings-current-password"
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
                    htmlFor="admin-settings-new-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    New Password
                  </label>
                  <PasswordInput
                    id="admin-settings-new-password"
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
                    htmlFor="admin-settings-confirm-password"
                    className="block text-[11px] font-medium text-on-surface-variant mb-1"
                  >
                    Confirm New Password
                  </label>
                  <PasswordInput
                    id="admin-settings-confirm-password"
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
                  <Alert
                    variant="tonal"
                    color="error"
                    title={passwordError}
                    size="sm"
                  />
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
                      passwordSaving ||
                      !currentPassword ||
                      !newPassword ||
                      !confirmPassword
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
              onClick={openResetDialog}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openResetDialog()
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
                    Reset All Database
                  </span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Permanently wipe every record except your own admin account
                  </span>
                </div>
              </div>
              <RowChevron className="text-error" />
            </article>
          </div>

          {/* Reset All Database Dialog */}
          <Dialog.Root
            open={resetDialogOpen}
            onOpenChange={(open) => {
              if (!open) closeResetDialog()
            }}
            closeOnEsc={!isResetting}
            closeOnOverlayClick={!isResetting}
          >
            <Dialog.Positioner position="center">
              <Dialog.Backdrop />
              <Dialog.Content size="sm">
                <Dialog.Header>
                  <Dialog.Title>Reset All Database</Dialog.Title>
                  <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                  <p className="text-sm text-on-surface-variant mb-3">
                    This will{' '}
                    <span className="font-semibold text-on-surface">
                      permanently delete every database record and system
                      setting
                    </span>
                    — every other admin/user account, bot session, credential,
                    thread, and configuration. Only your own admin account (
                    {session?.user?.email ?? 'this account'}) and its
                    associated data will remain intact. This action cannot be
                    undone.
                  </p>
                  <Field.Root>
                    <Field.Label>
                      Type{' '}
                      <span className="font-mono font-semibold text-on-surface">
                        {RESET_ALL_DATABASE_CONFIRMATION_PHRASE}
                      </span>{' '}
                      to confirm
                    </Field.Label>
                    <Input
                      value={resetConfirmInput}
                      onChange={(e) => {
                        setResetConfirmInput(e.target.value)
                        setResetError(null)
                      }}
                      placeholder={RESET_ALL_DATABASE_CONFIRMATION_PHRASE}
                      disabled={isResetting}
                      autoComplete="off"
                      spellCheck={false}
                      className="h-11 text-sm"
                    />
                  </Field.Root>
                  {resetError !== null && (
                    <div className="mt-3">
                      <Alert
                        variant="tonal"
                        color="error"
                        title={resetError}
                        size="sm"
                      />
                    </div>
                  )}
                </Dialog.Body>
                <Dialog.Footer>
                  <Dialog.CloseTrigger asChild>
                    <Button
                      variant="text"
                      color="neutral"
                      size="sm"
                      disabled={isResetting}
                    >
                      Cancel
                    </Button>
                  </Dialog.CloseTrigger>
                  <Button
                    color="error"
                    size="sm"
                    onClick={() => void handleResetAllDatabase()}
                    isLoading={isResetting}
                    disabled={isResetting || !isResetConfirmed}
                  >
                    Reset All Database
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Dialog.Root>
        </section>

        {/* ── Cancel / Save ── */}
        {(saveError || saveSuccess) && (
          <div className="px-1">
            {saveError && <p className="text-xs text-error">{saveError}</p>}
            {saveSuccess && (
              <p className="text-xs text-primary">
                Changes saved successfully.
              </p>
            )}
          </div>
        )}
        <div className="pt-2 flex items-center space-x-3">
          <button
            type="button"
            onClick={handleCancelChanges}
            disabled={!hasUnsavedChanges || isSavingAll || adminLoading}
            className="flex-1 h-11 px-4 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface-variant hover:text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSaveChanges()}
            disabled={!hasUnsavedChanges || isSavingAll || adminLoading}
            className="flex-1 h-11 px-4 rounded-lg bg-primary hover:brightness-110 active:brightness-90 active:opacity-[0.82] text-on-primary font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:ring-offset-surface"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>{isSavingAll ? 'Saving…' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
