import { Helmet } from '@dr.pogodin/react-helmet'
import { useMemo, useState } from 'react'
import {
  Sparkles,
  Cpu,
  Bot,
  MessageSquare,
  Database,
  Wrench,
  Gauge,
  ShieldCheck,
  GitBranch,
  ChevronRight,
  Check,
  Plus,
  Pencil,
  Trash2,
  FlaskConical,
  Plug,
  Puzzle,
} from 'lucide-react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Alert from '@/components/ui/feedback/Alert'
import Button from '@/components/ui/buttons/Button'
import Dialog from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Select from '@/components/ui/forms/Select'
import Switch from '@/components/ui/forms/Switch'
import Textarea from '@/components/ui/forms/Textarea'
import ModelInlinePicker from '@/components/ui/forms/ModelInlinePicker'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { useAiConfig, useAiIntegrations, useAiRouting, useAiStatus, useAiTools } from '@/features/users/hooks/useAiAgent'
import { aiService, type AiConfigDto, type AiIntegrationDto, type AiSavePayload } from '@/features/users/services/ai.service'
import { queryClient, queryKeys } from '@/lib/query-client.lib'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Presentational pieces — same vocabulary as the Settings page
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

function IconWell({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'danger'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border flex items-center justify-center flex-shrink-0 w-9 h-9',
        tone === 'accent' && 'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' && 'bg-error/10 border-error/30 text-error',
        tone === 'default' && 'bg-surface-container-high border-hairline text-on-surface-variant',
      )}
    >
      {children}
    </div>
  )
}

function StatusDot({ tone }: { tone: 'success' | 'warning' | 'error' | 'neutral' }) {
  return (
    <span
      className={cn(
        'w-1.5 h-1.5 rounded-full inline-block flex-shrink-0',
        tone === 'success' && 'bg-primary',
        tone === 'warning' && 'bg-amber-500/80',
        tone === 'error' && 'bg-error',
        tone === 'neutral' && 'bg-surface-variant',
      )}
      aria-hidden="true"
    />
  )
}

function RiskBadge({ risk }: { risk: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex-shrink-0',
        risk >= 2
          ? 'bg-error/10 text-error border-error/30'
          : risk === 1
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
            : 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {risk >= 2 ? 'Destructive' : risk === 1 ? 'Action' : 'Read'}
    </span>
  )
}

function IntegrationRow({
  item,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  item: AiIntegrationDto
  testing: boolean
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const cfg = item.config as { url?: string; mode?: string }
  return (
    <article className="p-3.5 flex items-center justify-between gap-3">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-semibold text-on-surface font-mono truncate">{item.name}</span>
        <span className="text-[11px] text-on-surface-variant truncate mt-0.5 font-mono">
          {item.kind === 'skill' && cfg.mode === 'prompt' ? 'prompt skill' : (cfg.url ?? '—')}
        </span>
        <span className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <IntegrationStatusBadge status={item.status} />
          <RiskBadge risk={item.risk} />
        </span>
        {item.dangerReasons.length > 0 && (
          <span className="text-[11px] text-error/90 mt-1 line-clamp-2">{item.dangerReasons[0]}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          aria-label={`Test ${item.name}`}
          title="Test connection"
          className="px-2 py-1 text-xs font-semibold rounded-md bg-surface-container-high hover:bg-surface-container-highest border border-hairline text-on-surface-variant hover:text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {testing ? '…' : 'Test'}
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${item.name}`}
          title="Edit"
          className="p-1.5 rounded-md bg-surface-container-high hover:bg-surface-container-highest border border-hairline text-on-surface-variant hover:text-on-surface transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${item.name}`}
          title="Delete"
          className="p-1.5 rounded-md bg-surface-container-high hover:bg-error/10 border border-hairline hover:border-error/30 text-on-surface-variant hover:text-error transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </article>
  )
}

function IntegrationStatusBadge({ status }: { status: AiIntegrationDto['status'] }) {
  const tone =
    status === 'active'
      ? 'bg-primary/10 text-primary border-primary/30'
      : status === 'pending_review'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
        : status === 'restricted'
          ? 'bg-error/10 text-error border-error/30'
          : 'bg-surface-container-high text-on-surface-variant border-hairline'
  const label =
    status === 'active'
      ? 'Active'
      : status === 'pending_review'
        ? 'Needs admin review'
        : status === 'restricted'
          ? 'Admin only'
          : 'Disabled'
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex-shrink-0',
        tone,
      )}
    >
      {label}
    </span>
  )
}

function AIAgentSkeleton() {
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
// Draft helpers — explicit save pattern like Settings (dirty → Save/Cancel)
// ============================================================================

interface Draft {
  enabled: boolean
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxTokens: number
  agents: Record<string, { provider: string; model: string; temperature: string }>
  memoryEnabled: boolean
  maxRecentTurns: number
  retentionDays: number
  maxSteps: number
  timeoutMs: number
  maxToolErrors: number
  maxCallsPerStep: number
  moderationEnabled: boolean
  minConfidence: number
  secondOpinion: boolean
  dryRun: boolean
  mentionReply: boolean
  dmReply: boolean
}

const AGENT_IDS = ['default', 'moderator', 'moderator2', 'policy', 'editor'] as const
const AGENT_LABELS: Record<string, string> = {
  default: 'Default',
  moderator: 'Moderator',
  moderator2: 'Moderator 2',
  policy: 'Policy',
  editor: 'Editor',
}

function draftFromConfig(cfg: AiConfigDto): Draft {
  const agents: Draft['agents'] = {}
  for (const id of AGENT_IDS) {
    const a = cfg.agents[id]
    agents[id] = {
      provider: a?.provider ?? '',
      model: a?.model ?? (a?.models?.[0] ?? ''),
      temperature: a?.temperature !== undefined ? String(a.temperature) : '',
    }
  }
  return {
    enabled: cfg.enabled,
    provider: cfg.provider ?? '',
    model: cfg.model ?? '',
    baseUrl: cfg.baseUrl ?? '',
    apiKey: '',
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    agents,
    memoryEnabled: cfg.memory.enabled,
    maxRecentTurns: cfg.memory.maxRecentTurns,
    retentionDays: cfg.memory.retentionDays,
    maxSteps: cfg.execution.maxSteps,
    timeoutMs: cfg.execution.timeoutMs,
    maxToolErrors: cfg.execution.maxToolErrors,
    maxCallsPerStep: cfg.execution.maxCallsPerStep,
    moderationEnabled: cfg.moderation.enabled,
    minConfidence: cfg.moderation.minConfidence,
    secondOpinion: cfg.moderation.secondOpinion,
    dryRun: cfg.moderation.dryRun,
    mentionReply: cfg.autoReply.mention,
    dmReply: cfg.autoReply.dm,
  }
}

function draftToPayload(d: Draft): AiSavePayload {
  const agents: AiSavePayload['agents'] = {}
  for (const id of AGENT_IDS) {
    const a = d.agents[id]
    if (!a) continue
    const entry: { provider?: string; model?: string; temperature?: number } = {}
    if (a.provider.trim()) entry.provider = a.provider.trim().toLowerCase()
    if (a.model.trim()) entry.model = a.model.trim()
    if (a.temperature.trim() !== '' && Number.isFinite(Number(a.temperature))) {
      entry.temperature = Math.min(2, Math.max(0, Number(a.temperature)))
    }
    if (Object.keys(entry).length > 0) agents[id] = entry
  }
  return {
    enabled: d.enabled,
    ...(d.provider ? { provider: d.provider } : {}),
    ...(d.model.trim() ? { model: d.model.trim() } : {}),
    ...(d.baseUrl.trim() ? { baseUrl: d.baseUrl.trim() } : {}),
    ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
    temperature: d.temperature,
    maxTokens: d.maxTokens,
    agents,
    memory: {
      enabled: d.memoryEnabled,
      maxRecentTurns: Math.min(50, Math.max(2, Math.trunc(d.maxRecentTurns) || 10)),
      retentionDays: Math.min(365, Math.max(1, Math.trunc(d.retentionDays) || 30)),
    },
    execution: {
      maxSteps: Math.min(12, Math.max(1, Math.trunc(d.maxSteps) || 6)),
      timeoutMs: Math.min(180000, Math.max(10000, Math.trunc(d.timeoutMs) || 90000)),
      maxToolErrors: Math.min(10, Math.max(1, Math.trunc(d.maxToolErrors) || 3)),
      maxCallsPerStep: Math.min(8, Math.max(1, Math.trunc(d.maxCallsPerStep) || 3)),
    },
    moderation: {
      enabled: d.moderationEnabled,
      minConfidence: Math.min(1, Math.max(0, d.minConfidence)),
      secondOpinion: d.secondOpinion,
      dryRun: d.dryRun,
    },
    autoReply: {
      mention: d.mentionReply,
      dm: d.dmReply,
    },
  }
}

// ============================================================================
// Page
// ============================================================================

export default function AIAgentPage() {
  const { success, error: notifyError } = useSnackbar()
  const { status, isLoading: statusLoading, error: statusError } = useAiStatus()
  const { config, isLoading: configLoading, error: configError } = useAiConfig()
  const { tools, isLoading: toolsLoading } = useAiTools()
  const { routing } = useAiRouting()
  const { integrations, isLoading: integrationsLoading, refetch: refetchIntegrations } = useAiIntegrations()

  const mcpItems = useMemo(
    () => (integrations ?? []).filter((i) => i.kind === 'mcp'),
    [integrations],
  )
  const skillItems = useMemo(
    () => (integrations ?? []).filter((i) => i.kind === 'skill'),
    [integrations],
  )

  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftInitialized, setDraftInitialized] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Connection test
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Live model catalog (per provider)
  const [modelCatalog, setModelCatalog] = useState<Record<string, string[]>>({})
  const [catalogLoading, setCatalogLoading] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  // Integration dialogs
  const [integrationDialog, setIntegrationDialog] = useState<
    | { mode: 'create-mcp' }
    | { mode: 'create-skill' }
    | { mode: 'edit'; item: AiIntegrationDto }
    | null
  >(null)
  const [integrationForm, setIntegrationForm] = useState({ name: '', url: '', authHeader: '', instructions: '', parameters: '' })
  const [integrationSaving, setIntegrationSaving] = useState(false)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AiIntegrationDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  // Render-time derived-state init (same pattern as the Settings page):
  // seed the editable draft once the persisted config lands.
  if (config && !draftInitialized) {
    setDraft(draftFromConfig(config))
    setDraftInitialized(true)
  }

  const dirty = useMemo(() => {
    if (!config || !draft) return false
    const payload = draftToPayload(draft)
    // Compare against last persisted state structurally. A typed API key
    // always counts as a change (the persisted key itself is never readable).
    if (draft.apiKey.trim()) return true
    const baseline = JSON.stringify(draftToPayload(draftFromConfig(config)))
    return JSON.stringify(payload) !== baseline
  }, [config, draft])

  const handleCancel = (): void => {
    if (config) setDraft(draftFromConfig(config))
    setSaveError(null)
  }

  const handleTestConnection = async (): Promise<void> => {
    setTestResult(null)
    setIsTesting(true)
    try {
      const result = await aiService.testConnection('default')
      if (result.ok) {
        setTestResult({
          ok: true,
          message: `Connected via ${result.provider}/${result.model} in ${result.latencyMs}ms (${result.attempts ?? 1} attempt${(result.attempts ?? 1) === 1 ? '' : 's'}).`,
        })
        success('AI connection test passed')
      } else {
        setTestResult({ ok: false, message: result.error ?? 'Connection test failed.' })
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection test failed.' })
    } finally {
      setIsTesting(false)
    }
  }

  const ensureLiveModels = async (provider: string): Promise<void> => {
    const key = provider.trim().toLowerCase() || 'groq'
    if (modelCatalog[key]) return
    setCatalogError(null)
    setCatalogLoading(key)
    try {
      const result = await aiService.getProviderModels(key)
      setModelCatalog((prev) => ({ ...prev, [key]: result.models }))
      if (result.models.length === 0) {
        setCatalogError('The provider returned an empty model list.')
      }
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to load models.')
    } finally {
      setCatalogLoading(null)
    }
  }

  const effectiveModelProvider = (agentProvider?: string): string =>
    (agentProvider || draft?.provider || status?.provider || 'groq').trim().toLowerCase() || 'groq'

  const openCreateIntegration = (kind: 'mcp' | 'skill'): void => {
    setIntegrationForm({ name: '', url: '', authHeader: '', instructions: '', parameters: '' })
    setIntegrationError(null)
    setIntegrationDialog(kind === 'mcp' ? { mode: 'create-mcp' } : { mode: 'create-skill' })
  }

  const openEditIntegration = (item: AiIntegrationDto): void => {
    const cfg = item.config
    const headers = (cfg.headers as Record<string, string> | undefined) ?? {}
    const authHeader = headers.Authorization ?? headers.authorization ?? ''
    setIntegrationForm({
      name: item.name,
      url: typeof cfg.url === 'string' ? cfg.url : '',
      authHeader,
      instructions: typeof cfg.instructions === 'string' ? cfg.instructions : '',
      parameters: cfg.parameters ? JSON.stringify(cfg.parameters, null, 2) : '',
    })
    setIntegrationError(null)
    setIntegrationDialog({ mode: 'edit', item })
  }

  const buildIntegrationPayload = (): { kind: 'mcp' | 'skill'; name: string; config: Record<string, unknown> } | null => {
    const name = integrationForm.name.trim()
    if (!name) {
      setIntegrationError('Name is required.')
      return null
    }
    if (!integrationDialog || integrationDialog.mode === 'edit') {
      const item = integrationDialog?.mode === 'edit' ? integrationDialog.item : null
      const kind = item?.kind ?? 'mcp'
      if (kind === 'skill' && (item?.config as { mode?: string } | undefined)?.mode === 'prompt') {
        if (!integrationForm.instructions.trim()) {
          setIntegrationError('Instructions are required.')
          return null
        }
        return { kind, name, config: { mode: 'prompt', instructions: integrationForm.instructions.trim() } }
      }
      const config: Record<string, unknown> = { url: integrationForm.url.trim() }
      if (integrationForm.authHeader.trim()) {
        config.headers = { Authorization: integrationForm.authHeader.trim() }
      }
      if (kind === 'skill') {
        config.mode = 'tool'
        if (integrationForm.parameters.trim()) {
          try {
            config.parameters = JSON.parse(integrationForm.parameters) as unknown
          } catch {
            setIntegrationError('Parameters must be valid JSON.')
            return null
          }
        }
      }
      return { kind, name, config }
    }
    if (integrationDialog.mode === 'create-mcp') {
      if (!integrationForm.url.trim()) {
        setIntegrationError('Server URL is required.')
        return null
      }
      const config: Record<string, unknown> = { url: integrationForm.url.trim() }
      if (integrationForm.authHeader.trim()) {
        config.headers = { Authorization: integrationForm.authHeader.trim() }
      }
      return { kind: 'mcp', name, config }
    }
    if (!integrationForm.instructions.trim() && !integrationForm.url.trim()) {
      setIntegrationError('Provide webhook URL or prompt instructions.')
      return null
    }
    if (integrationForm.url.trim()) {
      const config: Record<string, unknown> = { mode: 'tool', url: integrationForm.url.trim() }
      if (integrationForm.authHeader.trim()) {
        config.headers = { Authorization: integrationForm.authHeader.trim() }
      }
      if (integrationForm.parameters.trim()) {
        try {
          config.parameters = JSON.parse(integrationForm.parameters) as unknown
        } catch {
          setIntegrationError('Parameters must be valid JSON.')
          return null
        }
      }
      return { kind: 'skill', name, config }
    }
    return { kind: 'skill', name, config: { mode: 'prompt', instructions: integrationForm.instructions.trim() } }
  }

  const handleSaveIntegration = async (): Promise<void> => {
    const payload = buildIntegrationPayload()
    if (!payload || !integrationDialog) return
    setIntegrationError(null)
    setIntegrationSaving(true)
    try {
      const result =
        integrationDialog.mode === 'edit'
          ? await aiService.updateIntegration(integrationDialog.item.id, payload)
          : await aiService.createIntegration(payload)
      await refetchIntegrations()
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiTools })
      setIntegrationDialog(null)
      if (result.autoRestricted) {
        notifyError(
          `Saved, but auto-restricted to system admins: ${(result.reasons ?? []).slice(0, 2).join(' · ') || 'dangerous capability detected'}. An admin must approve it.`,
        )
      } else {
        success(integrationDialog.mode === 'edit' ? 'Integration updated' : 'Integration added')
      }
    } catch (err) {
      setIntegrationError(err instanceof Error ? err.message : 'Failed to save integration')
    } finally {
      setIntegrationSaving(false)
    }
  }

  const handleDeleteIntegration = async (): Promise<void> => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await aiService.deleteIntegration(deleteTarget.id)
      await refetchIntegrations()
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiTools })
      setDeleteTarget(null)
      success('Integration deleted')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to delete integration')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleTestIntegration = async (item: AiIntegrationDto): Promise<void> => {
    setTestingId(item.id)
    setTestResult(null)
    try {
      const result = await aiService.testIntegration(item.id)
      await refetchIntegrations()
      setTestResult({
        ok: result.ok,
        message: `${item.name}: ${result.detail} (${result.latencyMs}ms)${result.autoRestricted ? ' — auto-restricted to system admins.' : ''}`,
      })
      if (result.ok && !result.autoRestricted) success(`"${item.name}" test passed`)
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Integration test failed.' })
    } finally {
      setTestingId(null)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    setSaveError(null)
    setIsSaving(true)
    try {
      const saved = await aiService.saveConfig(draftToPayload(draft))
      queryClient.setQueryData(queryKeys.aiConfig, saved)
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiStatus })
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiRouting })
      setDraft(draftFromConfig(saved))
      success('AI Agent settings saved successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save AI Agent settings'
      setSaveError(message)
      notifyError(message)
    } finally {
      setIsSaving(false)
    }
  }

  if (statusLoading || configLoading) return <AIAgentSkeleton />

  const loadError = statusError ?? configError
  if (loadError || !status || !config) {
    return (
      <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
        <Helmet>
          <title>AI Agent · Cat-Bot</title>
        </Helmet>
        <div className="pt-4 px-1">
          <Alert
            variant="tonal"
            color="error"
            title="Could not load AI Agent settings"
            message={loadError ?? 'The AI service did not respond. Try again in a moment.'}
            size="sm"
          />
        </div>
      </div>
    )
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const connectionState = !status.enabled
    ? { label: 'Disabled', tone: 'neutral' as const }
    : status.configured
      ? { label: 'Operational', tone: 'success' as const }
      : { label: 'Not configured', tone: 'warning' as const }

  const providerOptions = status.providers.map((p) => ({ value: p, label: p }))
  const builtInTools = tools?.builtIn ?? []
  const defaultRoute = routing?.default
  const dialogTitle =
    !integrationDialog || integrationDialog.mode === 'create-mcp'
      ? 'Add MCP server'
      : integrationDialog.mode === 'create-skill'
        ? 'Add Skill'
        : `Edit ${integrationDialog.item.kind === 'mcp' ? 'MCP server' : 'Skill'}`
  const dialogIsPromptSkill =
    integrationDialog?.mode === 'edit' &&
    integrationDialog.item.kind === 'skill' &&
    (integrationDialog.item.config as { mode?: string }).mode === 'prompt'
  const dialogIsSkillTool =
    integrationDialog?.mode === 'create-skill' ||
    (integrationDialog?.mode === 'edit' &&
      integrationDialog.item.kind === 'skill' &&
      !dialogIsPromptSkill)

  return (
    <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
      <Helmet>
        <title>AI Agent · Cat-Bot</title>
      </Helmet>

      <div className="pt-4 space-y-6">
        {/* ── OVERVIEW ── */}
        <section aria-label="AI Agent overview" className="space-y-2">
          <SectionTitle>Overview</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <article className="p-3.5 flex items-center gap-3.5">
              <IconWell tone="accent">
                <Sparkles className="w-4 h-4 text-primary" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-on-surface leading-snug">AI Agent</span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  Conversational AI, tools, memory, and specialized agents for your bots.
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border bg-surface-container-high border-hairline text-on-surface-variant flex-shrink-0">
                <StatusDot tone={connectionState.tone} />
                {connectionState.label}
              </span>
            </article>
            <div className="grid grid-cols-3 divide-x divide-outline-variant border-t border-hairline">
              {[
                { label: 'Provider', value: status.provider ?? '—' },
                { label: 'Model', value: status.model ?? (status.candidates[0]?.split('/').slice(1).join('/') ?? '—') },
                { label: 'Agents', value: `${status.agents} configured` },
              ].map((stat) => (
                <div key={stat.label} className="px-3 py-2.5 min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-on-surface-variant/70">
                    {stat.label}
                  </p>
                  <p className="text-xs font-mono text-on-surface truncate mt-0.5">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="px-3.5 py-3 border-t border-hairline flex items-center justify-between gap-3">
              <span className="text-xs text-on-surface-variant">Verify the provider, model, and keys actually work.</span>
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={isTesting || !status.configured}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <FlaskConical className="w-3.5 h-3.5" strokeWidth={2} />
                {isTesting ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </div>
          {testResult && (
            <Alert
              variant="tonal"
              color={testResult.ok ? 'success' : 'error'}
              title={testResult.ok ? 'Connection test passed' : 'Connection test failed'}
              message={testResult.message}
              size="sm"
              onClose={() => setTestResult(null)}
            />
          )}
          {!status.configured && (
            <Alert
              variant="tonal"
              color="warning"
              title="AI Agent isn't configured yet"
              message="Connect an AI provider below to enable conversational AI, tool execution, memory, and specialized agents."
              size="sm"
            />
          )}
        </section>

        {/* ── GENERAL ── */}
        <section aria-label="General AI settings" className="space-y-2">
          <SectionTitle>General</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <IconWell tone="accent">
                  <Cpu className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">AI Agent enabled</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Master switch for conversational AI across bots
                  </span>
                </div>
              </div>
              <Switch
                size="sm"
                checked={draft?.enabled ?? false}
                onChange={(v) => set('enabled', v)}
                aria-label="AI Agent enabled"
              />
            </article>

            <div className="p-3.5 space-y-3">
              <Field.Root>
                <Field.Label>Default provider</Field.Label>
                <Select
                  options={[{ value: '', label: 'Automatic (first configured)' }, ...providerOptions]}
                  value={draft?.provider ?? ''}
                  onChange={(v) => set('provider', v)}
                  fullWidth
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Default model</Field.Label>
                <ModelInlinePicker
                  value={draft?.model ?? ''}
                  onChange={(v) => set('model', v)}
                  models={modelCatalog[effectiveModelProvider()] ?? null}
                  providerLabel={effectiveModelProvider()}
                  loading={catalogLoading === effectiveModelProvider()}
                  onLoad={() => void ensureLiveModels(effectiveModelProvider())}
                />
              </Field.Root>
              {catalogError && (
                <Alert variant="tonal" color="error" title={catalogError} size="sm" />
              )}
              <Field.Root>
                <Field.Label>API key</Field.Label>
                <PasswordInput
                  value={draft?.apiKey ?? ''}
                  onChange={(e) => {
                    set('apiKey', e.target.value)
                    setSaveError(null)
                  }}
                  placeholder={config.apiKeyConfigured ? `Saved (${config.apiKeyMasked ?? '••••'}) — leave blank to keep` : 'Enter provider API key'}
                  autoComplete="off"
                  aria-label="Provider API key"
                  className="h-11 text-xs"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Base URL (custom endpoints only)</Field.Label>
                <Input
                  value={draft?.baseUrl ?? ''}
                  onChange={(e) => set('baseUrl', e.target.value)}
                  placeholder="https://… (blank for provider default)"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  aria-label="Custom base URL"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <div className="grid grid-cols-2 gap-3">
                <Field.Root>
                  <Field.Label>Temperature</Field.Label>
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={draft?.temperature ?? 0.3}
                    onChange={(e) => set('temperature', Number(e.target.value))}
                    aria-label="Temperature"
                    className="h-11 text-sm font-mono"
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Max tokens</Field.Label>
                  <Input
                    type="number"
                    min={64}
                    max={8000}
                    step={64}
                    value={draft?.maxTokens ?? 1024}
                    onChange={(e) => set('maxTokens', Number(e.target.value))}
                    aria-label="Max tokens"
                    className="h-11 text-sm font-mono"
                  />
                </Field.Root>
              </div>
            </div>
          </div>
        </section>

        {/* ── AGENTS ── */}
        <section aria-label="Specialized agents" className="space-y-2">
          <SectionTitle>Agents</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {AGENT_IDS.map((id) => {
              const open = expandedAgent === id
              const a = draft?.agents[id]
              const route = routing?.[id]
              return (
                <div key={id}>
                  <article
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => setExpandedAgent(open ? null : id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedAgent(open ? null : id)
                      }
                    }}
                    className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <IconWell>
                        <Bot className="w-4 h-4" strokeWidth={2} />
                      </IconWell>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-on-surface leading-snug">
                          {AGENT_LABELS[id]}
                        </span>
                        <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                          {route?.candidates[0] ?? a?.model ?? a?.provider ?? 'inherits default'}
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn('w-4 h-4 transition-transform duration-200 text-surface-variant', open && 'rotate-90')}
                      strokeWidth={2}
                    />
                  </article>
                  {open && (
                    <div className="p-3.5 pt-0 space-y-3">
                      <Field.Root>
                        <Field.Label>Provider (blank inherits default)</Field.Label>
                        <Select
                          options={[{ value: '', label: 'Inherit default' }, ...providerOptions]}
                          value={a?.provider ?? ''}
                          onChange={(v) =>
                            setDraft((prev) =>
                              prev ? { ...prev, agents: { ...prev.agents, [id]: { provider: v, model: a?.model ?? '', temperature: a?.temperature ?? '' } } } : prev,
                            )
                          }
                          fullWidth
                        />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>Model (blank inherits default)</Field.Label>
                        <ModelInlinePicker
                          value={a?.model ?? ''}
                          onChange={(v) =>
                            setDraft((prev) =>
                              prev ? { ...prev, agents: { ...prev.agents, [id]: { provider: a?.provider ?? '', model: v, temperature: a?.temperature ?? '' } } } : prev,
                            )
                          }
                          models={modelCatalog[effectiveModelProvider(a?.provider)] ?? null}
                          providerLabel={effectiveModelProvider(a?.provider)}
                          loading={catalogLoading === effectiveModelProvider(a?.provider)}
                          onLoad={() => void ensureLiveModels(effectiveModelProvider(a?.provider))}
                        />
                      </Field.Root>
                      {a?.model && (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) =>
                              prev ? { ...prev, agents: { ...prev.agents, [id]: { provider: a?.provider ?? '', model: '', temperature: a?.temperature ?? '' } } } : prev,
                            )
                          }
                          className="text-[11px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded self-start"
                        >
                          Clear — inherit default
                        </button>
                      )}
                      {catalogError && (
                        <Alert variant="tonal" color="error" title={catalogError} size="sm" />
                      )}
                      <Field.Root>
                        <Field.Label>Temperature (blank inherits default)</Field.Label>
                        <Input
                          value={a?.temperature ?? ''}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev ? { ...prev, agents: { ...prev.agents, [id]: { provider: a?.provider ?? '', model: a?.model ?? '', temperature: e.target.value } } } : prev,
                            )
                          }
                          placeholder="Inherit default"
                          inputMode="decimal"
                          aria-label={`${AGENT_LABELS[id]} temperature`}
                          className="h-11 text-sm font-mono"
                        />
                      </Field.Root>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── MEMORY ── */}
        <section aria-label="Memory settings" className="space-y-2">
          <SectionTitle>Memory</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <IconWell>
                  <Database className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">Conversation memory</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Recent turns, summaries, and durable user facts
                  </span>
                </div>
              </div>
              <Switch
                size="sm"
                checked={draft?.memoryEnabled ?? true}
                onChange={(v) => set('memoryEnabled', v)}
                aria-label="Conversation memory enabled"
              />
            </article>
            <div className="p-3.5 grid grid-cols-2 gap-3">
              <Field.Root>
                <Field.Label>Recent turns kept</Field.Label>
                <Input
                  type="number"
                  min={2}
                  max={50}
                  value={draft?.maxRecentTurns ?? 10}
                  onChange={(e) => set('maxRecentTurns', Number(e.target.value))}
                  aria-label="Recent turns kept"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Retention (days)</Field.Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={draft?.retentionDays ?? 30}
                  onChange={(e) => set('retentionDays', Number(e.target.value))}
                  aria-label="Memory retention days"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
            </div>
          </div>
        </section>

        {/* ── TOOLS ── */}
        <section aria-label="Tool availability" className="space-y-2">
          <SectionTitle>Tools</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article className="p-3.5 flex items-center gap-3.5">
              <IconWell>
                <Wrench className="w-4 h-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-on-surface leading-snug">
                  Built-in tools{toolsLoading ? '' : ` · ${builtInTools.length}`}
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  What the AI can access on your behalf
                </span>
              </div>
            </article>
            {toolsLoading ? (
              <div className="p-3.5 space-y-2">
                <Skeleton textSize="body-sm" width="80%" />
                <Skeleton textSize="body-sm" width="60%" />
              </div>
            ) : (
              builtInTools.map((t) => (
                <article key={t.name} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface font-mono truncate">{t.name}</span>
                    <span className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{t.description}</span>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex-shrink-0',
                      t.risk >= 2
                        ? 'bg-error/10 text-error border-error/30'
                        : t.risk === 1
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                          : 'bg-surface-container-high text-on-surface-variant border-hairline',
                    )}
                  >
                    {t.risk >= 2 ? 'Destructive' : t.risk === 1 ? 'Action' : 'Read'}
                  </span>
                </article>
              ))
            )}
            <article className="p-3.5 flex items-center gap-3.5">
              <IconWell>
                <Plug className="w-4 h-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-on-surface leading-snug">
                  MCP servers{integrationsLoading ? '' : ` · ${mcpItems.length}`}
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  Your Model Context Protocol endpoints
                </span>
              </div>
              <button
                type="button"
                onClick={() => openCreateIntegration('mcp')}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 flex items-center gap-1 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Add
              </button>
            </article>
            {integrationsLoading ? (
              <div className="p-3.5 space-y-2">
                <Skeleton textSize="body-sm" width="70%" />
                <Skeleton textSize="body-sm" width="50%" />
              </div>
            ) : mcpItems.length === 0 ? (
              <p className="px-3.5 py-3 text-xs text-on-surface-variant">
                No MCP servers connected. Add one to give the agent new tools.
              </p>
            ) : (
              mcpItems.map((item) => (
                <IntegrationRow
                  key={item.id}
                  item={item}
                  testing={testingId === item.id}
                  onTest={() => void handleTestIntegration(item)}
                  onEdit={() => openEditIntegration(item)}
                  onDelete={() => setDeleteTarget(item)}
                />
              ))
            )}
            <article className="p-3.5 flex items-center gap-3.5 border-t border-hairline">
              <IconWell>
                <Puzzle className="w-4 h-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold text-on-surface leading-snug">
                  Skills{integrationsLoading ? '' : ` · ${skillItems.length}`}
                </span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  Custom webhook tools and prompt packs
                </span>
              </div>
              <button
                type="button"
                onClick={() => openCreateIntegration('skill')}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 flex items-center gap-1 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                Add
              </button>
            </article>
            {!integrationsLoading &&
              (skillItems.length === 0 ? (
                <p className="px-3.5 py-3 text-xs text-on-surface-variant">
                  No Skills added. Webhook skills become agent tools; prompt skills shape answers.
                </p>
              ) : (
                skillItems.map((item) => (
                  <IntegrationRow
                    key={item.id}
                    item={item}
                    testing={testingId === item.id}
                    onTest={() => void handleTestIntegration(item)}
                    onEdit={() => openEditIntegration(item)}
                    onDelete={() => setDeleteTarget(item)}
                  />
                ))
              ))}
          </div>
        </section>

        {/* ── EXECUTION ── */}
        <section aria-label="Execution limits" className="space-y-2">
          <SectionTitle>Execution</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <article className="p-3.5 flex items-center gap-3.5">
              <IconWell>
                <Gauge className="w-4 h-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-on-surface leading-snug">Bounded execution</span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  The agent loop can never run away — every run has a budget
                </span>
              </div>
            </article>
            <div className="p-3.5 grid grid-cols-2 gap-3">
              <Field.Root>
                <Field.Label>Maximum steps</Field.Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={draft?.maxSteps ?? 6}
                  onChange={(e) => set('maxSteps', Number(e.target.value))}
                  aria-label="Maximum steps"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Timeout (ms)</Field.Label>
                <Input
                  type="number"
                  min={10000}
                  max={180000}
                  step={5000}
                  value={draft?.timeoutMs ?? 90000}
                  onChange={(e) => set('timeoutMs', Number(e.target.value))}
                  aria-label="Execution timeout milliseconds"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Tool error budget</Field.Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={draft?.maxToolErrors ?? 3}
                  onChange={(e) => set('maxToolErrors', Number(e.target.value))}
                  aria-label="Tool error budget"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Max calls / step</Field.Label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={draft?.maxCallsPerStep ?? 3}
                  onChange={(e) => set('maxCallsPerStep', Number(e.target.value))}
                  aria-label="Maximum tool calls per step"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
            </div>
          </div>
        </section>

        {/* ── MODERATION ── */}
        <section aria-label="Moderation agent" className="space-y-2">
          <SectionTitle>Moderation</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <IconWell>
                  <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">AI moderation</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    Classify borderline content the rule engine can&apos;t settle
                  </span>
                </div>
              </div>
              <Switch
                size="sm"
                checked={draft?.moderationEnabled ?? false}
                onChange={(v) => set('moderationEnabled', v)}
                aria-label="AI moderation enabled"
              />
            </article>
            <div className="p-3.5 space-y-3">
              <Field.Root>
                <Field.Label>Confidence threshold</Field.Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft?.minConfidence ?? 0.75}
                  onChange={(e) => set('minConfidence', Number(e.target.value))}
                  aria-label="Moderation confidence threshold"
                  className="h-11 text-sm font-mono"
                />
              </Field.Root>
              <article className="flex items-center justify-between gap-3">
                <span className="text-xs text-on-surface-variant">Second opinion on borderline calls</span>
                <Switch
                  size="sm"
                  checked={draft?.secondOpinion ?? false}
                  onChange={(v) => set('secondOpinion', v)}
                  aria-label="Second opinion enabled"
                />
              </article>
              <article className="flex items-center justify-between gap-3">
                <span className="text-xs text-on-surface-variant">Dry run (log only, never enforce)</span>
                <Switch
                  size="sm"
                  checked={draft?.dryRun ?? true}
                  onChange={(v) => set('dryRun', v)}
                  aria-label="Moderation dry run"
                />
              </article>
            </div>
          </div>
        </section>

        {/* ── AUTO-REPLY ── */}
        <section aria-label="Automatic replies" className="space-y-2">
          <SectionTitle>Auto-reply</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <article className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <IconWell>
                  <Bot className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">Reply when mentioned</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    The AI answers in groups when the bot&apos;s nickname is mentioned
                  </span>
                </div>
              </div>
              <Switch
                size="sm"
                checked={draft?.mentionReply ?? true}
                onChange={(v) => set('mentionReply', v)}
                aria-label="Reply when mentioned enabled"
              />
            </article>
            <article className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <IconWell>
                  <MessageSquare className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">Reply in direct messages</span>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    The AI answers every private message (max one per minute per chat)
                  </span>
                </div>
              </div>
              <Switch
                size="sm"
                checked={draft?.dmReply ?? true}
                onChange={(v) => set('dmReply', v)}
                aria-label="Reply in direct messages enabled"
              />
            </article>
          </div>
        </section>

        {/* ── FALLBACK ── */}
        <section aria-label="Provider fallback" className="space-y-2">
          <SectionTitle>Provider fallback</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <article className="p-3.5 flex items-center gap-3.5">
              <IconWell>
                <GitBranch className="w-4 h-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-on-surface leading-snug">Attempt order</span>
                <span className="text-xs text-on-surface-variant mt-0.5">
                  Resolved live from provider keys and agent config
                </span>
              </div>
            </article>
            <div className="p-3.5">
              {defaultRoute?.candidates.length ? (
                <ol className="space-y-1.5">
                  {defaultRoute.candidates.map((c, i) => (
                    <li key={c} className="flex items-center gap-2.5 text-xs">
                      <span className="flex items-center justify-center w-5 h-5 rounded-md bg-surface-container-high border border-hairline font-mono text-[10px] font-semibold text-on-surface-variant flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="font-mono text-on-surface truncate">{c}</span>
                      {i === 0 && (
                        <span className="text-[10px] font-mono text-primary flex-shrink-0">primary</span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-on-surface-variant">
                  No provider with a valid key — add an API key above to build a fallback chain.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Cancel / Save ── */}
        {saveError && (
          <div className="px-1">
            <Alert variant="tonal" color="error" title={saveError} size="sm" />
          </div>
        )}
        <div className="pt-2 flex items-center space-x-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!dirty || isSaving}
            className="flex-1 h-11 px-4 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface-variant hover:text-on-surface font-semibold text-xs flex items-center justify-center transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || isSaving}
            className="flex-1 h-11 px-4 rounded-lg bg-primary hover:brightness-110 active:brightness-90 active:opacity-[0.82] text-on-primary font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:ring-offset-surface"
          >
            <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>{isSaving ? 'Saving…' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {/* Add/Edit integration dialog */}
      <Dialog.Root
        open={integrationDialog !== null}
        onOpenChange={(open) => {
          if (!open && !integrationSaving) setIntegrationDialog(null)
        }}
        closeOnEsc={!integrationSaving}
        closeOnOverlayClick={!integrationSaving}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>{dialogTitle}</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <div className="space-y-3">
                <Field.Root>
                  <Field.Label>Name</Field.Label>
                  <Input
                    value={integrationForm.name}
                    onChange={(e) => setIntegrationForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. docs-search"
                    autoComplete="off"
                    aria-label="Integration name"
                    className="h-11 text-sm"
                  />
                </Field.Root>
                {!dialogIsPromptSkill && (
                  <Field.Root>
                    <Field.Label>Server URL</Field.Label>
                    <Input
                      value={integrationForm.url}
                      onChange={(e) => setIntegrationForm((f) => ({ ...f, url: e.target.value }))}
                      placeholder="https://…"
                      autoComplete="off"
                      spellCheck={false}
                      inputMode="url"
                      aria-label="Server URL"
                      className="h-11 text-sm font-mono"
                    />
                  </Field.Root>
                )}
                {!dialogIsPromptSkill && (
                  <Field.Root>
                    <Field.Label>Authorization header (optional)</Field.Label>
                    <PasswordInput
                      value={integrationForm.authHeader}
                      onChange={(e) => setIntegrationForm((f) => ({ ...f, authHeader: e.target.value }))}
                      placeholder="Bearer … (stored encrypted)"
                      autoComplete="off"
                      aria-label="Authorization header"
                      className="h-11 text-xs"
                    />
                  </Field.Root>
                )}
                {(integrationDialog?.mode === 'create-skill' || dialogIsPromptSkill) && (
                  <Field.Root>
                    <Field.Label>Prompt instructions</Field.Label>
                    <Textarea
                      value={integrationForm.instructions}
                      onChange={(e) => setIntegrationForm((f) => ({ ...f, instructions: e.target.value }))}
                      placeholder="Extra instructions for the agent… (leave blank for webhook-only skills)"
                      aria-label="Skill instructions"
                      rows={4}
                    />
                  </Field.Root>
                )}
                {dialogIsSkillTool && (
                  <Field.Root>
                    <Field.Label>Parameters JSON schema (optional)</Field.Label>
                    <Textarea
                      value={integrationForm.parameters}
                      onChange={(e) => setIntegrationForm((f) => ({ ...f, parameters: e.target.value }))}
                      placeholder='{"type":"object","properties":{}}'
                      aria-label="Parameters JSON schema"
                      spellCheck={false}
                      rows={3}
                      className="font-mono text-xs"
                    />
                  </Field.Root>
                )}
                <p className="text-[11px] text-on-surface-variant leading-normal">
                  Dangerous integrations are automatically restricted to system admins and need admin
                  approval before they can run.
                </p>
                {integrationError && <Alert variant="tonal" color="error" title={integrationError} size="sm" />}
              </div>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={integrationSaving}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="primary"
                size="sm"
                onClick={() => void handleSaveIntegration()}
                isLoading={integrationSaving}
                disabled={integrationSaving}
              >
                Save integration
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete confirmation dialog */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null)
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete integration?</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-sm text-on-surface-variant">
                This removes <span className="font-mono text-on-surface">{deleteTarget?.name}</span> and
                its tools from the agent. This action cannot be undone.
              </p>
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
                onClick={() => void handleDeleteIntegration()}
                isLoading={isDeleting}
                disabled={isDeleting}
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
