import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import {
  Bot,
  KeyRound,
  Link2,
  PlugZap,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Switch from '@/components/ui/forms/Switch'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { useAiAgent } from '@/features/admin/hooks/useAiAgent'
import type {
  AiAgentConnectionStatus,
  AiAgentSettingsDto,
} from '@/features/admin/services/ai-agent.service'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching admin settings
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

function StatusChip({
  text,
  tone = 'default',
}: {
  text: string
  tone?: 'default' | 'accent' | 'success' | 'error' | 'info' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex-shrink-0',
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'success' && 'bg-surface-container-high text-success border-success/30',
        tone === 'error' && 'bg-surface-container-high text-error border-error/30',
        tone === 'info' && 'bg-surface-container-high text-info border-info/30',
        tone === 'warning' && 'bg-surface-container-high text-warning border-warning/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {text}
    </span>
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
        tone === 'accent' && 'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' && 'bg-error/10 border-error/30 text-error',
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

function AiAgentPageSkeleton() {
  return (
    <div
      className="flex flex-col gap-0 max-w-[420px] md:max-w-2xl w-full mx-auto pb-8"
      aria-busy="true"
    >
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

function statusTone(
  status: AiAgentConnectionStatus | null,
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'Connected':
      return 'success'
    case 'Unauthorized':
    case 'Configuration incomplete':
    case 'Disabled':
      return 'warning'
    case 'Service unavailable':
    case 'Endpoint not found':
    case 'Disconnected':
    case 'Unsupported':
      return 'error'
    default:
      return 'default'
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function capabilityChip(supported: boolean | undefined, unsupportedLabel: string) {
  if (supported === undefined) return <StatusChip text="…" />
  return supported ? (
    <StatusChip text="Supported" tone="success" />
  ) : (
    <StatusChip text={unsupportedLabel} />
  )
}

/**
 * AdminAiAgentPage — /admin/dashboard/ai-agent
 *
 * Controls the external Cactus Needle 3 integration: connection settings
 * (URL / token / enabled / limits), a real authenticated Test Connection,
 * and live capability detection. MCP and Skills render their truthful
 * state — unsupported by this Needle 3 build — with no management controls.
 */
export default function AdminAiAgentPage() {
  const { success, error: notifyError } = useSnackbar()
  const {
    settings,
    status,
    detail,
    capabilities,
    model,
    endpoint,
    latencyMs,
    lastCheckedAt,
    remote,
    loading,
    saving,
    testing,
    error,
    save,
    test,
    refresh,
  } = useAiAgent()

  const [needleUrl, setNeedleUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState('30000')
  const [maxNewTokens, setMaxNewTokens] = useState('256')
  const [confidence, setConfidence] = useState('0.7')
  const [dirty, setDirty] = useState(false)

  // Render-time form sync: when freshly loaded settings arrive, mirror them
  // into the local form state once (React "adjust state during render"
  // pattern — no effect involved).
  const [lastSynced, setLastSynced] = useState<AiAgentSettingsDto | null>(null)
  if (settings && settings !== lastSynced) {
    setLastSynced(settings)
    setNeedleUrl(settings.needleUrl)
    setEnabled(settings.enabled)
    setTimeoutMs(String(settings.timeoutMs))
    setMaxNewTokens(String(settings.maxNewTokens ?? 256))
    setConfidence(String(settings.confidenceThreshold))
    setToken('')
    setDirty(false)
  }

  const markDirty = () => setDirty(true)
  const connected = status === 'Connected'

  const handleSave = async () => {
    const timeout = parseInt(timeoutMs, 10)
    const tokens = parseInt(maxNewTokens, 10)
    const conf = parseFloat(confidence)
    const ok = await save({
      enabled,
      needleUrl: needleUrl.trim(),
      // Omit the token to keep the stored secret; it is never shown.
      ...(token !== '' ? { token } : {}),
      timeoutMs: Number.isFinite(timeout) ? timeout : 30000,
      maxNewTokens: Number.isFinite(tokens) ? tokens : 256,
      confidenceThreshold: Number.isFinite(conf) ? conf : 0.7,
    })
    if (ok) {
      setDirty(false)
      success('AI Agent settings saved.')
    } else {
      notifyError('Failed to save AI Agent settings.')
    }
  }

  const handleTest = async () => {
    const result = await test()
    if (!result) return // error state is already shown inline
    if (result.status === 'Connected') success('Needle 3 connection verified.')
    else notifyError(`Connection state: ${result.status}.`)
  }

  if (loading || !settings) {
    return (
      <>
        <Helmet>
          <title>AI Agent · Admin</title>
        </Helmet>
        <AiAgentPageSkeleton />
      </>
    )
  }

  return (
    <div className="flex flex-col max-w-[420px] md:max-w-2xl w-full mx-auto pb-8">
      <Helmet>
        <title>AI Agent · Admin</title>
      </Helmet>

      <div className="pt-4 space-y-6">
        {error && (
          <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
        )}

        {/* ── CONNECTION ── */}
        <section aria-label="Needle 3 connection" className="space-y-2">
          <SectionTitle>Connection</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone={connected ? 'accent' : 'default'}>
                  <Bot className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      Needle 3
                    </span>
                    <StatusChip text={status ?? '…'} tone={statusTone(status)} />
                    <StatusChip
                      text={settings.authMode === 'token' ? 'API key' : 'No key'}
                      tone={settings.authMode === 'token' ? 'accent' : 'default'}
                    />
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                    {settings.needleUrl || 'No service URL configured'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void refresh()
                }}
                disabled={testing}
                aria-label="Reload AI Agent status"
                className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="p-3.5 pt-0">
              <Button
                variant="tonal"
                color="primary"
                size="md"
                leftIcon={<PlugZap className="h-4 w-4" />}
                disabled={testing}
                onClick={() => void handleTest()}
                fullWidth
                className="max-sm:py-1.5"
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
              <p className="text-[11px] text-surface-variant leading-normal px-0.5 pt-2">
                Performs a real request (health check plus a minimal
                inference call) against the standalone Needle 3 API — the
                state above is never assumed.
              </p>
              {detail && (
                <p className="text-[11px] text-surface-variant leading-normal px-0.5 pt-1 font-mono">
                  {detail}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── SETTINGS ── */}
        <section aria-label="AI Agent settings" className="space-y-2">
          <SectionTitle>Settings</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-3 min-w-0">
                <IconWell tone={enabled ? 'accent' : 'default'}>
                  <Sparkles className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-on-surface leading-snug">
                      Enabled
                    </span>
                    <StatusBadge active={enabled} />
                  </div>
                  <span className="text-xs text-on-surface-variant mt-0.5">
                    {enabled
                      ? 'The /ai command and passive mentions answer via Needle 3.'
                      : 'AI answers are turned off; all other bot features keep working.'}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {saving ? (
                  <Skeleton variant="pill" width="44px" height="24px" />
                ) : (
                  <Switch
                    checked={enabled}
                    onChange={(v) => {
                      setEnabled(v)
                      markDirty()
                    }}
                    aria-label="Enable AI Agent"
                  />
                )}
              </div>
            </div>

            <div className="p-3.5 space-y-2.5">
              <Input
                placeholder="https://wataru-needle-3-api.onrender.com"
                value={needleUrl}
                onChange={(e) => {
                  setNeedleUrl(e.target.value)
                  markDirty()
                }}
                disabled={saving}
                inputMode="url"
                aria-label="Needle 3 service URL"
                className="py-2.5 text-sm leading-6 font-mono"
              />
              <PasswordInput
                placeholder={
                  settings.tokenConfigured
                    ? '•••••••• (stored — leave blank to keep)'
                    : 'NEEDLE_API_KEY for the Needle service'
                }
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  markDirty()
                }}
                disabled={saving}
                autoComplete="off"
                aria-label="Needle 3 API key"
                className="py-2.5 text-sm leading-6"
              />
              <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                {settings.tokenConfigured
                  ? 'An API key is stored encrypted server-side. The value is never shown — leave blank to keep it.'
                  : 'The standalone Needle 3 API requires NEEDLE_API_KEY (sent as Authorization: Bearer). Never a Cactus Platform key.'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Timeout (ms)"
                  value={timeoutMs}
                  onChange={(e) => {
                    setTimeoutMs(e.target.value)
                    markDirty()
                  }}
                  disabled={saving}
                  inputMode="numeric"
                  aria-label="Request timeout in milliseconds"
                  className="py-2.5 text-sm leading-6 font-mono"
                />
                <Input
                  placeholder="Max tokens"
                  value={maxNewTokens}
                  onChange={(e) => {
                    setMaxNewTokens(e.target.value)
                    markDirty()
                  }}
                  disabled={saving}
                  inputMode="numeric"
                  aria-label="Maximum inference tokens per request"
                  className="py-2.5 text-sm leading-6 font-mono"
                />
                <Input
                  placeholder="Confidence (0–1)"
                  value={confidence}
                  onChange={(e) => {
                    setConfidence(e.target.value)
                    markDirty()
                  }}
                  disabled={saving}
                  inputMode="decimal"
                  aria-label="Minimum Needle confidence for tool execution"
                  className="py-2.5 text-sm leading-6 font-mono"
                />
              </div>
              <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                Render Free instances sleep when idle — 30000 ms tolerates a
                cold start (range 1000–120000 ms). Inference budget 1–512
                tokens (default 256).
              </p>
              <Button
                variant="filled"
                color="primary"
                size="md"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
                fullWidth
                className="max-sm:py-1.5"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES ── */}
        <section aria-label="Needle 3 capabilities" className="space-y-2">
          <SectionTitle>Capabilities</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell tone={capabilities?.toolCalling ? 'accent' : 'default'}>
                  <Wrench className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Tool Calling
                  </span>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    JSON Schema tools, multi-turn execution, confidence
                  </span>
                </div>
              </div>
              {capabilityChip(capabilities?.toolCalling, 'Unsupported')}
            </div>
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <Link2 className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    MCP
                  </span>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {capabilities?.mcp
                      ? 'Supported by the connected build'
                      : 'Not supported by this Needle 3 build'}
                  </span>
                </div>
              </div>
              {capabilityChip(capabilities?.mcp, 'Not supported')}
            </div>
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <IconWell>
                  <KeyRound className="w-4 h-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface leading-snug">
                    Skills
                  </span>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5">
                    {capabilities?.skills
                      ? 'Supported by the connected build'
                      : 'Not supported by this Needle 3 build'}
                  </span>
                </div>
              </div>
              {capabilityChip(capabilities?.skills, 'Not supported')}
            </div>
          </div>
        </section>

        {/* ── RUNTIME ── */}
        <section aria-label="Needle 3 runtime" className="space-y-2">
          <SectionTitle>Runtime</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {(
              [
                ['Endpoint', endpoint ?? '—'],
                ['Model', model ?? capabilities?.model ?? '—'],
                ['Remote version', remote?.packageVersion ?? '—'],
                ['Streaming', remote ? (remote.streaming ? 'Supported' : 'Unsupported') : '—'],
                ['Remote queue', remote?.queueDepth !== null && remote?.queueDepth !== undefined ? String(remote.queueDepth) : '—'],
                ['Last latency', formatLatency(latencyMs)],
                ['Connection state', status ?? '—'],
                ['Status detail', detail ?? '—'],
                ['Last checked', lastCheckedAt ?? '—'],
                ['Last successful request', settings.lastSuccessAt || '—'],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="p-3.5 flex items-center justify-between gap-3">
                <span className="text-sm text-on-surface-variant">{label}</span>
                <span className="text-sm font-mono text-on-surface truncate text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
