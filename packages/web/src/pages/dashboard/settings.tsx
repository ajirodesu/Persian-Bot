import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import Badge from '@/components/ui/data-display/Badge'
import Dialog from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Select from '@/components/ui/forms/Select'
import SearchableSelect from '@/components/ui/forms/SearchableSelect'
import Alert from '@/components/ui/feedback/Alert'
import DataList from '@/components/ui/data-display/DataList'
import Divider from '@/components/ui/layout/Divider'
import ThemeToggle from '@/components/ui/ThemeToggle'
import TimezoneSelect from '@/components/ui/forms/TimezoneSelect'
import { useTimezone } from '@/contexts/TimezoneContext'
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { ROUTES } from '@/constants/routes.constants'

// ============================================================================
// AI Integration — provider + model types
// ============================================================================

type AiProviderId =
  | 'openrouter'
  | 'groq'
  | 'nvidia'
  | 'openai'
  | 'gemini'
  | 'zen'
  | 'orcarouter'
  | 'fastrouter'

interface AiProviderKeyStatus {
  hasKey: boolean
  keyHint: string | null
}

interface AgentSettings {
  agentName: string
  maxToolIterations: number
  maxHistory: number
  threadTtl: number
}

interface AiSettingsStatus {
  provider: AiProviderId
  model: string
  groqModel: string
  openrouterModel: string
  nvidiaModel: string
  openaiModel: string
  geminiModel: string
  zenModel: string
  orcarouterModel: string
  fastrouterModel: string
  providers: Record<AiProviderId, AiProviderKeyStatus>
  models: Record<
    AiProviderId,
    { id: string; label: string; free?: boolean }[]
  >
  agent: AgentSettings
}

const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openrouter: 'OpenRouter',
  groq: 'Groq',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  gemini: 'AI Studio',
  zen: 'OpenCode Zen',
  orcarouter: 'OrcaRouter',
  fastrouter: 'FastRouter',
}

const AI_KEY_PLACEHOLDERS: Record<AiProviderId, string> = {
  openrouter: 'sk-or-v1-…',
  groq: 'gsk_…',
  nvidia: 'nvapi-…',
  openai: 'sk-…',
  gemini: 'AIza… / AQ…',
  zen: 'sk-…',
  orcarouter: 'sk-orca-…',
  fastrouter: '…',
}

const AI_PROVIDER_OPTIONS: { value: AiProviderId; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'groq', label: 'Groq' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'AI Studio' },
  { value: 'zen', label: 'OpenCode Zen' },
  { value: 'orcarouter', label: 'OrcaRouter' },
  { value: 'fastrouter', label: 'FastRouter' },
]

// Infers the provider from a key's prefix as it's typed/pasted —
// `sk-or-v1-` is an OpenRouter key (checked first — the primary provider),
// `nvapi-` an NVIDIA key, `gsk_` a Groq key, `sk-proj-`/`sk-` OpenAI,
// `AIza`/`AQ` Google AI Studio. Returns null while the key is too short or
// doesn't match any format.
const detectProviderFromKey = (key: string): AiProviderId | null => {
  const trimmed = key.trim()
  if (trimmed.startsWith('sk-or-v1')) return 'openrouter'
  if (trimmed.startsWith('nvapi-')) return 'nvidia'
  if (trimmed.startsWith('gsk_')) return 'groq'
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-')) {
    return 'openai'
  }
  if (trimmed.startsWith('AIza') || trimmed.startsWith('AQ')) return 'gemini'
  if (trimmed.startsWith('sk-orca-')) return 'orcarouter'
  return null
}

// Fallback shown if the status fetch fails — models are re-fetched on save.
const EMPTY_AI_STATUS: AiSettingsStatus = {
  provider: 'openrouter',
  model: '',
  groqModel: '',
  openrouterModel: '',
  nvidiaModel: '',
  openaiModel: '',
  geminiModel: '',
  zenModel: '',
  orcarouterModel: '',
  fastrouterModel: '',
  providers: {
    openrouter: { hasKey: false, keyHint: null },
    groq: { hasKey: false, keyHint: null },
    nvidia: { hasKey: false, keyHint: null },
    openai: { hasKey: false, keyHint: null },
    gemini: { hasKey: false, keyHint: null },
    zen: { hasKey: false, keyHint: null },
    orcarouter: { hasKey: false, keyHint: null },
    fastrouter: { hasKey: false, keyHint: null },
  },
  models: {
    openrouter: [],
    groq: [],
    nvidia: [],
    openai: [],
    gemini: [],
    zen: [],
    orcarouter: [],
    fastrouter: [],
  },
  agent: {
    agentName: '',
    maxToolIterations: 5,
    maxHistory: 20,
    threadTtl: 3600,
  },
}

// ============================================================================
// Page
// ============================================================================

function SettingsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 max-w-2xl pb-12" aria-busy="true">
      {/* Page header */}
      <div className="flex flex-col gap-1.5">
        <Skeleton variant="text" textSize="headline-sm" width="140px" />
        <Skeleton variant="text" textSize="body-sm" width="280px" />
      </div>

      {/* ── Appearance ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="120px" />
            <Skeleton variant="text" textSize="body-sm" width="320px" />
          </div>
        </Card.Header>
        <Skeleton variant="pill" height={48} className="w-full" />
      </Card.Root>

      {/* ── Timezone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="96px" />
            <Skeleton variant="text" textSize="body-sm" width="280px" />
          </div>
        </Card.Header>
        <Skeleton variant="input" height={44} className="w-full max-w-sm" />
      </Card.Root>

      {/* ── AI Integration ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="120px" />
            <Skeleton variant="text" textSize="body-sm" width="300px" />
          </div>
        </Card.Header>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton variant="input" height={44} className="w-full" />
            <Skeleton variant="input" height={44} className="w-full" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[var(--radius-card)] border border-outline-variant/50">
            <div className="flex flex-col gap-1.5">
              <Skeleton variant="text" textSize="label-lg" width="160px" />
              <Skeleton variant="text" textSize="body-sm" width="120px" />
            </div>
            <div className="flex gap-2 shrink-0">
              <Skeleton variant="rounded" width={88} height={32} />
              <Skeleton variant="rounded" width={88} height={32} />
            </div>
          </div>
          <Skeleton variant="rounded" height={44} className="w-full" />
        </div>
      </Card.Root>

      {/* ── Profile ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="80px" />
            <Skeleton variant="text" textSize="body-sm" width="260px" />
          </div>
        </Card.Header>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between py-2 border-b border-outline-variant/50">
            <Skeleton variant="text" textSize="label-md" width="48px" />
            <Skeleton variant="text" textSize="body-sm" width="55%" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="label-md" width="88px" />
            <Skeleton variant="input" height={44} className="w-full" />
          </div>
        </div>
      </Card.Root>

      {/* ── Unified save bar ── */}
      <Skeleton variant="pill" height={40} width="140px" className="self-end" />

      {/* ── Security ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="96px" />
            <Skeleton variant="text" textSize="body-sm" width="280px" />
          </div>
        </Card.Header>
        <div className="flex flex-col gap-4">
          <Skeleton variant="input" height={44} className="w-full" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton variant="input" height={44} className="w-full" />
            <Skeleton variant="input" height={44} className="w-full" />
          </div>
          <div className="flex justify-end pt-1">
            <Skeleton variant="pill" height={36} width="160px" />
          </div>
        </div>
      </Card.Root>

      {/* ── Danger Zone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-error/50"
      >
        <Card.Header>
          <div className="flex flex-col gap-1.5">
            <Skeleton variant="text" textSize="title-md" width="112px" />
            <Skeleton variant="text" textSize="body-sm" width="280px" />
          </div>
        </Card.Header>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <Skeleton variant="text" textSize="body-sm" width="70%" />
          <Skeleton variant="pill" height={40} width="132px" />
        </div>
      </Card.Root>
    </div>
  )
}

export default function SettingsPage() {
  const { isEmailEnabled } = useEmailServiceEnabled()

  const { data: session, isPending: sessionLoading } =
    authUserClient.useSession()

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

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)

  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }

  const profileDirty =
    nameInitialized &&
    profileName.trim() !== '' &&
    profileName.trim() !== (session?.user?.name ?? '')

  // ── Password state ─────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)

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

  // ── Delete account state ───────────────────────────────────────────────────
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

    // Password is required here because the /delete-user route only accepts
    // the request without it when the session is younger than 1 day
    // (sensitiveSessionMiddleware). The full data wipe runs server-side via
    // the deleteUser beforeDelete hook.
    const { error } = await authUserClient.deleteUser({
      password: deletePassword,
    })

    if (error) {
      setDeleteError(error.message ?? 'Failed to delete account')
      setIsDeleting(false)
      return
    }

    // better-auth clears the session cookie on success — hard-redirect so the
    // auth state provider re-mounts cleanly on the public route.
    window.location.assign(ROUTES.LOGIN)
  }

  // ── AI Integration state (provider + model + key) ────────────────────────
  const [aiStatus, setAiStatus] = useState<AiSettingsStatus | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [providerDraft, setProviderDraft] = useState<AiProviderId>('openrouter')
  const [modelDraft, setModelDraft] = useState('')
  const [aiKeyInput, setAiKeyInput] = useState('')
  const [aiEditing, setAiEditing] = useState(false)
  const [aiRemoving, setAiRemoving] = useState(false)
  const [aiRemoveError, setAiRemoveError] = useState<string | null>(null)

  // ── Agent behavior drafts (web-based AI configuration) ────────────────────
  const [agentNameDraft, setAgentNameDraft] = useState('')
  const [maxIterationsDraft, setMaxIterationsDraft] = useState('5')
  const [maxHistoryDraft, setMaxHistoryDraft] = useState('20')
  const [threadTtlDraft, setThreadTtlDraft] = useState('3600')

  // Fetch the current provider config once on mount — the API never returns the
  // keys themselves, only whether one exists and a 4-char hint per provider.
  // The agent-setting drafts are seeded from the same response (empty agentName
  // means the server's env default is in effect).
  useEffect(() => {
    let cancelled = false
    apiClient
      .get<AiSettingsStatus>('/api/v1/settings/ai')
      .then((res) => {
        if (cancelled) return
        setAiStatus(res.data)
        setProviderDraft(res.data.provider)
        setModelDraft(res.data.model)
        const a = res.data.agent
        setAgentNameDraft(a.agentName ?? '')
        setMaxIterationsDraft(String(a.maxToolIterations))
        setMaxHistoryDraft(String(a.maxHistory))
        setThreadTtlDraft(String(a.threadTtl))
      })
      .catch(() => {
        if (!cancelled) setAiStatus(EMPTY_AI_STATUS)
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The saved model for a given provider — used when switching providers so the
  // model select reflects what was last saved for each one.
  const savedModelFor = (provider: AiProviderId): string => {
    if (provider === 'openrouter') return aiStatus?.openrouterModel ?? ''
    if (provider === 'groq') return aiStatus?.groqModel ?? ''
    if (provider === 'nvidia') return aiStatus?.nvidiaModel ?? ''
    if (provider === 'openai') return aiStatus?.openaiModel ?? ''
    if (provider === 'zen') return aiStatus?.zenModel ?? ''
    if (provider === 'orcarouter') return aiStatus?.orcarouterModel ?? ''
    if (provider === 'fastrouter') return aiStatus?.fastrouterModel ?? ''
    return aiStatus?.geminiModel ?? ''
  }

  // Agent-setting drafts differ from the saved status → dirty (unsaved).
  const agentDirty =
    aiStatus !== null &&      (agentNameDraft.trim().toLowerCase() !==
        (aiStatus.agent.agentName ?? '').trim().toLowerCase() ||
      Number(maxIterationsDraft) !== aiStatus.agent.maxToolIterations ||
      Number(maxHistoryDraft) !== aiStatus.agent.maxHistory ||
      Number(threadTtlDraft) !== aiStatus.agent.threadTtl)

  const providerStatus =
    aiStatus?.providers[providerDraft] ?? { hasKey: false, keyHint: null }
  // The first OTHER provider that already has a key connected — used for the
  // "switch to X" hint when the current provider has none (any of the other
  // providers may be configured, not just a hardcoded second one).
  const otherConfiguredProvider = aiStatus
    ? (Object.keys(aiStatus.providers) as AiProviderId[]).find(
        (p) => p !== providerDraft && aiStatus.providers[p].hasKey,
      ) ?? null
    : null
  const otherProviderStatus = otherConfiguredProvider
    ? aiStatus?.providers[otherConfiguredProvider]
    : undefined

  const modelOptions = (aiStatus?.models[providerDraft] ?? []).map((m) => ({
    value: m.id,
    label: m.label,
    hint: m.free ? 'Free' : undefined,
  }))

  const providerDirty = providerDraft !== (aiStatus?.provider ?? 'openrouter')
  const modelDirty = modelDraft !== savedModelFor(providerDraft)
  const aiKeyDirty = aiKeyInput.trim() !== ''
  const aiDirty = providerDirty || modelDirty || aiKeyDirty

  const handleSwitchProvider = (provider: AiProviderId): void => {
    setProviderDraft(provider)
    setModelDraft(savedModelFor(provider))
    setAiRemoveError(null)
  }

  const handleRemoveAiKey = async (): Promise<void> => {
    setAiRemoveError(null)
    setAiRemoving(true)
    try {
      const res = await apiClient.delete<AiSettingsStatus>(
        '/api/v1/settings/ai',
        { body: { provider: providerDraft } },
      )
      setAiStatus(res.data)
      setAiEditing(false)
      setAiKeyInput('')
      // If the removed provider was the active one but another provider still
      // has a key, switch the drafts to it so AI stays usable.
      if (!res.data.providers[providerDraft].hasKey) {
        const fallback = (Object.keys(res.data.providers) as AiProviderId[]).find(
          (p) => p !== providerDraft && res.data.providers[p].hasKey,
        )
        if (fallback) {
          setProviderDraft(fallback)
          setModelDraft(savedModelFor(fallback))
        }
      }
    } catch {
      setAiRemoveError(`Failed to remove ${AI_PROVIDER_LABELS[providerDraft]} API key`)
    } finally {
      setAiRemoving(false)
    }
  }

  // ── Unified save — Timezone + AI Integration + Agent behavior + Profile ────
  const hasUnsavedChanges = timezoneDirty || profileDirty || aiDirty || agentDirty
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
        const { error } = await authUserClient.updateUser({
          name: profileName.trim(),
        })
        if (error) throw new Error(error.message ?? 'Failed to update profile')
      }
      if (aiDirty || agentDirty) {
        const settings: Record<string, unknown> = {}
        if (agentNameDraft.trim()) settings.agentName = agentNameDraft.trim()
        settings.maxToolIterations = Number(maxIterationsDraft)
        settings.maxHistory = Number(maxHistoryDraft)
        settings.threadTtl = Number(threadTtlDraft)
        const res = await apiClient.put<AiSettingsStatus>(
          '/api/v1/settings/ai',
          {
            provider: providerDraft,
            model: modelDraft,
            ...(aiKeyInput.trim() ? { apiKey: aiKeyInput.trim() } : {}),
            settings,
          },
        )
        setAiStatus(res.data)
        setAiKeyInput('')
        setAiEditing(false)
        // Keep the drafts in sync with the saved state.
        setProviderDraft(res.data.provider)
        setModelDraft(res.data.model)
        setAgentNameDraft(res.data.agent.agentName ?? '')
        setMaxIterationsDraft(String(res.data.agent.maxToolIterations))
        setMaxHistoryDraft(String(res.data.agent.maxHistory))
        setThreadTtlDraft(String(res.data.agent.threadTtl))
      }
      setTimezoneDraft(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setSaveError(
        e.response?.data?.error ??
          (err instanceof Error ? err.message : 'Failed to save changes'),
      )
    } finally {
      setIsSavingAll(false)
    }
  }

  const handleCancelChanges = (): void => {
    setTimezoneDraft(null)
    setProfileName(session?.user?.name ?? '')
    setProviderDraft(aiStatus?.provider ?? 'openrouter')
    setModelDraft(savedModelFor(aiStatus?.provider ?? 'openrouter'))
    setAiKeyInput('')
    setAiEditing(false)
    const a = aiStatus?.agent
    setAgentNameDraft(a?.agentName ?? '')
    setMaxIterationsDraft(String(a?.maxToolIterations ?? 5))
    setMaxHistoryDraft(String(a?.maxHistory ?? 20))
    setThreadTtlDraft(String(a?.threadTtl ?? 3600))
    setSaveError(null)
    setSaveSuccess(false)
  }

  const isPageLoading =
    sessionLoading || timezoneLoading || aiLoading

  if (isPageLoading) {
    return <SettingsPageSkeleton />
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl pb-12">
      <Helmet>
        <title>Settings · Cat-Bot</title>
      </Helmet>

      {/* Page header */}
      <div>
        <h1 className="text-headline-sm font-bold text-on-surface tracking-tight md:hidden">
          Settings
        </h1>
        <p className="mt-1 text-body-sm text-on-surface-variant md:mt-0 md:text-headline-sm md:font-bold md:text-on-surface md:tracking-tight">
          Manage your profile and account security.
        </p>
      </div>

      {/* ── Appearance ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Appearance</Card.Title>
            <Card.Description>
              Select the interface theme. Choose only one option: Aqua, Burnt, or Indigo.
            </Card.Description>
          </div>
        </Card.Header>
        <ThemeToggle />
      </Card.Root>

      {/* ── Timezone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">Timezone</Card.Title>
              <Card.Description>
                Used across the dashboard for timestamps, logs, and bot
                notices — like ban messages sent on your behalf.
              </Card.Description>
            </div>
            {timezoneDirty && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
          </div>
        </Card.Header>

        {timezoneLoading ? (
          <Skeleton variant="input" height={44} className="w-full max-w-sm" />
        ) : (
          <div className="flex flex-col gap-4">
            <Field.Root className="max-w-sm">
              <TimezoneSelect
                value={timezoneValue}
                onChange={(tz) => {
                  setTimezoneDraft(tz)
                }}
              />
            </Field.Root>

            {!savedTimezone && !timezoneDirty && (
              <p className="text-body-sm text-on-surface-variant">
                No timezone saved yet — currently showing your browser's
                timezone ({browserTimezone}). Pick one and click Save
                Changes below.
              </p>
            )}
          </div>
        )}
      </Card.Root>

      {/* ── AI Integration ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">AI Integration</Card.Title>
              <Card.Description>
                Your bots' AI runs on your own provider key (OpenRouter, Groq,
                NVIDIA, OpenAI, or Google AI Studio). Pick a provider, choose a
                model, store your key — it's kept encrypted and used only by
                your bots. Configure the agent's name and behavior below.
              </Card.Description>
            </div>
            {(aiDirty || agentDirty) && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
          </div>
        </Card.Header>

        <div className="flex flex-col gap-4">
          {aiLoading ? (
            <Skeleton textSize="body-sm" width="60%" />
          ) : (
            <>
              {/* Provider + model selection — models follow the chosen provider. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field.Root>
                  <Field.Label>Provider</Field.Label>
                  <Select
                    options={AI_PROVIDER_OPTIONS}
                    value={providerDraft}
                    onChange={(value) => {
                      handleSwitchProvider(value as AiProviderId)
                    }}
                    placeholder="Select a provider"
                  />
                </Field.Root>

                <Field.Root>
                  <Field.Label>Model</Field.Label>
                  <SearchableSelect
                    options={modelOptions}
                    value={modelDraft}
                    onChange={setModelDraft}
                    placeholder="Select a model"
                    searchPlaceholder="Search models…"
                    emptyMessage="No models match “{query}”"
                    disabled={modelOptions.length === 0}
                  />
                </Field.Root>
              </div>

              {/* Connection status for the selected provider */}
              {providerStatus.hasKey ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-highest/40 rounded-[var(--radius-card)] border border-outline-variant/50">
                  <div>
                    <p className="text-label-lg font-semibold text-on-surface">
                      {AI_PROVIDER_LABELS[providerDraft]} API key connected
                    </p>
                    <p className="text-body-sm text-on-surface-variant">
                      Ending in{' '}
                      <span className="font-mono font-semibold text-on-surface">
                        {providerStatus.keyHint ? `…${providerStatus.keyHint}` : '—'}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="tonal"
                      color="primary"
                      size="sm"
                      onClick={() => setAiEditing(true)}
                      disabled={aiRemoving}
                    >
                      Replace
                    </Button>
                    <Button
                      variant="tonal"
                      color="error"
                      size="sm"
                      onClick={() => {
                        void handleRemoveAiKey()
                      }}
                      disabled={aiRemoving}
                      isLoading={aiRemoving}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : otherProviderStatus?.hasKey && otherConfiguredProvider ? (
                <Alert
                  variant="tonal"
                  color="info"
                  title={`No ${AI_PROVIDER_LABELS[providerDraft]} key configured`}
                  message={`Add a ${AI_PROVIDER_LABELS[providerDraft]} key below to use it, or switch to ${AI_PROVIDER_LABELS[otherConfiguredProvider]} — it already has a key connected.`}
                />
              ) : (
                <Alert
                  variant="tonal"
                  color="warning"
                  title="AI features are disabled"
                  message="No AI provider key is configured for your account. Add your own provider key below to enable AI features."
                />
              )}

              {(aiEditing || !providerStatus.hasKey) && (
                <Field.Root>
                  <Field.Label>{AI_PROVIDER_LABELS[providerDraft]} API key</Field.Label>
                  <PasswordInput
                    value={aiKeyInput}
                    onChange={(e) => {
                      const value = e.target.value
                      setAiKeyInput(value)
                      setAiRemoveError(null)
                      // Auto-detect the provider from the key format — paste a
                      // Groq (gsk_…), OpenRouter (sk-or-v1-…), NVIDIA (nvapi-…),
                      // OpenAI (sk-…) or Google AI Studio (AIza…/AQ…) key and the
                      // provider selector + model list follow automatically.
                      const detected = detectProviderFromKey(value)
                      if (detected) handleSwitchProvider(detected)
                    }}
                    placeholder={AI_KEY_PLACEHOLDERS[providerDraft]}
                  />
                  <p className="mt-1.5 text-body-sm text-on-surface-variant">
                    Paste your{' '}
                    {AI_PROVIDER_LABELS[providerDraft]} key — it's
                    auto-detected from its format — then click Save Changes
                    below.
                  </p>
                </Field.Root>
              )}

              {aiRemoveError && (
                <Alert
                  variant="tonal"
                  color="error"
                  title={aiRemoveError}
                  size="sm"
                />
              )}

              {/* ── Agent behavior — web-based AI configuration ── */}
              <div className="mt-2 pt-4 border-t border-outline-variant/50">
                <div className="flex items-start justify-between w-full mb-4">
                  <div>
                    <p className="text-title-md font-semibold text-on-surface">
                      Agent behavior
                    </p>
                    <p className="text-body-sm text-on-surface-variant">
                      The word that wakes your bot, and how the agent runs.
                      Leave a field empty to keep the server's default.
                    </p>
                  </div>
                  {agentDirty && (
                    <Badge color="primary" size="sm" variant="tonal" pill>
                      Unsaved
                    </Badge>
                  )}
                </div>

                <Field.Root className="max-w-sm">
                  <Field.Label>Agent name (trigger word)</Field.Label>
                  <Input
                    value={agentNameDraft}
                    onChange={(e) => setAgentNameDraft(e.target.value)}
                    placeholder="e.g. miko"
                  />
                  <Field.HelperText>
                    Say this word in chat to activate the agent (defaults to
                    “Cat-Bot”).
                  </Field.HelperText>
                </Field.Root>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                  <Field.Root>
                    <Field.Label>Tool iterations</Field.Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={maxIterationsDraft}
                      onChange={(e) => setMaxIterationsDraft(e.target.value)}
                    />
                    <Field.HelperText>Max tool calls per turn</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Thread history</Field.Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={maxHistoryDraft}
                      onChange={(e) => setMaxHistoryDraft(e.target.value)}
                    />
                    <Field.HelperText>Messages remembered</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Thread TTL (sec)</Field.Label>
                    <Input
                      type="number"
                      min={60}
                      max={86400}
                      value={threadTtlDraft}
                      onChange={(e) => setThreadTtlDraft(e.target.value)}
                    />
                    <Field.HelperText>Conversation timeout</Field.HelperText>
                  </Field.Root>
                </div>
              </div>
            </>
          )}
        </div>
      </Card.Root>

      {/* ── Profile ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">Profile</Card.Title>
              <Card.Description>
                Update your display name and account information.
              </Card.Description>
            </div>
            {profileDirty && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
          </div>
        </Card.Header>

        <div className="flex flex-col gap-5">
          {/* Email — display only */}
          <DataList.Root size="sm">
            <DataList.Item>
              <DataList.ItemLabel>Email</DataList.ItemLabel>
              <DataList.ItemValue>
                {sessionLoading ? (
                  <Skeleton textSize="body-sm" width="55%" />
                ) : (
                  <span className="text-body-sm font-medium text-on-surface">
                    {session?.user?.email ?? '—'}
                  </span>
                )}
              </DataList.ItemValue>
            </DataList.Item>
          </DataList.Root>

          {/* Editable display name */}
          <Field.Root>
            <Field.Label>Display name</Field.Label>
            <Input
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value)
              }}
              placeholder={sessionLoading ? 'Loading…' : 'Your name'}
              disabled={sessionLoading}
            />
          </Field.Root>
        </div>
      </Card.Root>

      {/* ── Unified save bar — Timezone + AI Integration + Profile ── */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {saveError && <p className="text-body-sm text-error">{saveError}</p>}
          {saveSuccess && (
            <p className="text-body-sm text-success">
              Changes saved successfully.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          color="neutral"
          onClick={handleCancelChanges}
          disabled={!hasUnsavedChanges || isSavingAll}
        >
          Cancel
        </Button>
        <Button
          variant="filled"
          color="primary"
          onClick={() => void handleSaveChanges()}
          disabled={!hasUnsavedChanges || isSavingAll}
          isLoading={isSavingAll}
        >
          Save Changes
        </Button>
      </div>

      <Divider spacing="sm" />

      {/* ── Security ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Security</Card.Title>
            <Card.Description>
              Change your password. All other sessions will be signed out on
              success.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="flex flex-col gap-4">
          {isEmailEnabled && (
            <>
              {/* Quick reset code shortcut */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-highest/40 rounded-[var(--radius-card)] border border-outline-variant/50">
                <div>
                  <p className="text-label-lg font-semibold text-on-surface">
                    Password Reset
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    Send a 6-digit reset code to your email address.
                  </p>
                </div>
                <Button
                  variant="tonal"
                  color="primary"
                  size="sm"
                  onClick={async () => {
                    setResetSent(true)
                    await apiClient.post(
                      '/api/v1/validate/reset-password/request',
                      {
                        email: session?.user?.email || '',
                        adminOnly: false,
                      },
                    )
                  }}
                  disabled={resetSent}
                >
                  {resetSent ? 'Code Sent' : 'Send Reset Code'}
                </Button>
              </div>
              {resetSent && (
                <div className="flex flex-col gap-3">
                  <Alert
                    variant="tonal"
                    color="success"
                    title="Check your email"
                    message="We've sent you a 6-digit code to reset your password."
                    size="sm"
                  />
                  <Button
                    as={Link}
                    to={`${ROUTES.RESET_PASSWORD}?email=${encodeURIComponent(session?.user?.email || '')}`}
                    variant="tonal"
                    color="primary"
                    size="sm"
                    className="self-start"
                  >
                    Enter the code
                  </Button>
                </div>
              )}
              <Divider spacing="sm" />
            </>
          )}

          <Field.Root>
            <Field.Label>Current password</Field.Label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                setPasswordError(null)
              }}
              placeholder="Enter current password"
              disabled={passwordSaving}
            />
          </Field.Root>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field.Root>
              <Field.Label>New password</Field.Label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="At least 8 characters"
                disabled={passwordSaving}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Confirm new password</Field.Label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="Repeat new password"
                disabled={passwordSaving}
              />
            </Field.Root>
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

          <div className="flex justify-end pt-1">
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={() => {
                void handleChangePassword()
              }}
              disabled={
                passwordSaving ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              isLoading={passwordSaving}
            >
              Change password
            </Button>
          </div>
        </div>
      </Card.Root>

      {/* ── Danger Zone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-error/50"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Danger Zone</Card.Title>
            <Card.Description>
              Permanently delete your account and all associated data.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-body-sm text-on-surface-variant">
            Deleting your account permanently removes your profile, chats,
            sessions, and connected bot credentials. This action cannot be
            undone.
          </p>
          <Button
            variant="tonal"
            color="error"
            size="md"
            className="flex-shrink-0"
            onClick={() => {
              setDeletePassword('')
              setDeleteError(null)
              setDeleteDialogOpen(true)
            }}
          >
            Delete Account
          </Button>
        </div>
      </Card.Root>

      {/* Delete account confirmation dialog — requires the current password
          (the /delete-user route only skips it for sessions younger than 1 day). */}
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
              <p className="text-body-sm text-on-surface-variant">
                This permanently deletes your account, chat history, sessions,
                and connected bot credentials. This action cannot be undone.
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
              {deleteError && (
                <Alert
                  variant="tonal"
                  color="error"
                  title={deleteError}
                  size="sm"
                />
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="error"
                size="sm"
                onClick={() => {
                  void handleDeleteAccount()
                }}
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
