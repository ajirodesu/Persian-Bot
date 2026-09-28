import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { Bot, KeyRound, Link2, PlugZap, Sparkles, Wrench } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Button from '@/components/ui/buttons/Button'
import Card from '@/components/ui/data-display/Card'
import Status from '@/components/ui/data-display/Status'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Switch from '@/components/ui/forms/Switch'
import { useAiAgent } from '@/features/admin/hooks/useAiAgent'
import type { AiAgentConnectionStatus } from '@/features/admin/services/ai-agent.service'
import type { AiAgentSettingsDto } from '@/features/admin/services/ai-agent.service'
import { cn } from '@/utils/cn.util'

/**
 * Admin → AI Agent page.
 *
 * Controls the external Cactus Needle 3 integration: connection settings
 * (URL / token / enabled), a real authenticated Test Connection, and live
 * capability detection. MCP and Skills render their truthful state —
 * "Not supported by this Needle 3 build" — with no management controls when
 * the connected build does not provide them.
 */

function statusColor(status: AiAgentConnectionStatus | null) {
  switch (status) {
    case 'Connected':
      return 'success' as const
    case 'Unauthorized':
    case 'Configuration incomplete':
    case 'Disabled':
      return 'warning' as const
    default:
      return 'error' as const
  }
}

function SectionHeader({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-9 h-9 rounded-lg border bg-surface-container-high border-hairline text-primary flex-shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-body-lg font-semibold text-on-surface leading-tight">
          {title}
        </h2>
        {hint && (
          <p className="text-label-md text-on-surface-variant truncate">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}

export default function AiAgentPage() {
  const {
    settings,
    status,
    capabilities,
    loading,
    saving,
    testing,
    error,
    notice,
    save,
    test,
    dismissNotice,
  } = useAiAgent()

  const [needleUrl, setNeedleUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [timeoutMs, setTimeoutMs] = useState('30000')
  const [confidence, setConfidence] = useState('0.7')
  const [dirty, setDirty] = useState(false)

  // Render-time form sync: when freshly loaded settings arrive, mirror them
  // into the local form state once (React "adjust state during render"
  // pattern — no effect involved).
  const [lastSynced, setLastSynced] =
    useState<AiAgentSettingsDto | null>(null)
  if (settings && settings !== lastSynced) {
    setLastSynced(settings)
    setNeedleUrl(settings.needleUrl)
    setEnabled(settings.enabled)
    setTimeoutMs(String(settings.timeoutMs))
    setConfidence(String(settings.confidenceThreshold))
    setToken('')
    setDirty(false)
  }

  const markDirty = () => setDirty(true)

  const handleSave = async () => {
    const timeout = parseInt(timeoutMs, 10)
    const conf = parseFloat(confidence)
    const ok = await save({
      enabled,
      needleUrl: needleUrl.trim(),
      // Omit the token to keep the stored secret; empty string clears it.
      ...(token !== '' ? { token } : {}),
      timeoutMs: Number.isFinite(timeout) ? timeout : 30000,
      confidenceThreshold: Number.isFinite(conf) ? conf : 0.7,
    })
    if (ok) setDirty(false)
  }

  return (
    <>
      <Helmet>
        <title>AI Agent — Admin</title>
      </Helmet>

      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 px-1">
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 text-primary flex-shrink-0">
            <Sparkles className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-headline-md font-semibold text-on-surface leading-tight">
              AI Agent
            </h1>
            <p className="text-label-md text-on-surface-variant">
              Cactus Needle 3 connection, status, and capabilities
            </p>
          </div>
        </div>

        {error && (
          <Alert color="error" variant="tonal" title="Something went wrong">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert
            color="success"
            variant="tonal"
            title="Done"
            actions={[{ label: 'Dismiss', onClick: dismissNotice }]}
          >
            {notice}
          </Alert>
        )}

        {loading || !settings ? (
          <div className="flex flex-col gap-4">
            <Skeleton height={160} />
            <Skeleton height={112} />
          </div>
        ) : (
          <>
            {/* ── Needle 3 connection ─────────────────────────────── */}
            <Card.Root variant="elevated" surfaceLevel="low">
              <Card.Body className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <SectionHeader
                    icon={<Bot className="w-4 h-4" />}
                    title="Needle 3"
                    hint="Separately hosted Cactus Needle 3 service"
                  />
                  <Status.Root colorPalette={statusColor(status)} size="md">
                    <Status.Indicator
                      colorPalette={statusColor(status)}
                      size="sm"
                    />
                    <span className="font-medium">
                      {status === 'Connected' ? 'Connected' : (status ?? '…')}
                    </span>
                  </Status.Root>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field.Root>
                    <Field.Label>Needle URL</Field.Label>
                    <Input
                      value={needleUrl}
                      onChange={(e) => {
                        setNeedleUrl(e.target.value)
                        markDirty()
                      }}
                      placeholder="https://persian-bot-needle3.onrender.com"
                      inputMode="url"
                      aria-label="Needle 3 service URL"
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Authentication Token</Field.Label>
                    <PasswordInput
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value)
                        markDirty()
                      }}
                      placeholder={
                        settings.tokenConfigured
                          ? '•••••••• (stored — leave blank to keep)'
                          : 'Paste the Needle service Bearer token'
                      }
                      aria-label="Needle 3 authentication token"
                    />
                    <Field.HelperText>
                      {settings.tokenConfigured
                        ? 'A token is stored server-side. The value is never shown.'
                        : 'No token stored yet.'}
                    </Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Request timeout (ms)</Field.Label>
                    <Input
                      value={timeoutMs}
                      onChange={(e) => {
                        setTimeoutMs(e.target.value)
                        markDirty()
                      }}
                      inputMode="numeric"
                      aria-label="Request timeout in milliseconds"
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Confidence threshold (0–1)</Field.Label>
                    <Input
                      value={confidence}
                      onChange={(e) => {
                        setConfidence(e.target.value)
                        markDirty()
                      }}
                      inputMode="decimal"
                      aria-label="Minimum Needle confidence for tool execution"
                    />
                  </Field.Root>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Switch
                    checked={enabled}
                    onChange={(v) => {
                      setEnabled(v)
                      markDirty()
                    }}
                    label="Enabled"
                    aria-label="Enable AI Agent"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      color="primary"
                      size="sm"
                      leftIcon={<PlugZap className="w-4 h-4" />}
                      isLoading={testing}
                      onClick={() => void test()}
                    >
                      Test Connection
                    </Button>
                    <Button
                      variant="filled"
                      color="primary"
                      size="sm"
                      isLoading={saving}
                      disabled={!dirty}
                      onClick={() => void handleSave()}
                    >
                      Save Changes
                    </Button>
                  </div>
                </div>
              </Card.Body>
            </Card.Root>

            {/* ── Capabilities ────────────────────────────────────── */}
            <Card.Root variant="elevated" surfaceLevel="low">
              <Card.Body className="flex flex-col gap-4 p-5">
                <SectionHeader
                  icon={<Wrench className="w-4 h-4" />}
                  title="Capabilities"
                  hint="Detected live from the connected Needle 3 service"
                />
                <dl className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-hairline bg-surface-container-high p-3">
                    <dt className="text-label-md text-on-surface-variant">
                      Tool Calling
                    </dt>
                    <dd className="text-body-md font-medium text-on-surface">
                      {capabilities
                        ? capabilities.toolCalling
                          ? 'Supported'
                          : 'Unsupported'
                        : '…'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-hairline bg-surface-container-high p-3">
                    <dt className="text-label-md text-on-surface-variant">
                      MCP
                    </dt>
                    <dd className="text-body-md font-medium text-on-surface">
                      {capabilities
                        ? capabilities.mcp
                          ? 'Supported'
                          : 'Not supported by this Needle 3 build'
                        : '…'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-hairline bg-surface-container-high p-3">
                    <dt className="text-label-md text-on-surface-variant">
                      Skills
                    </dt>
                    <dd className="text-body-md font-medium text-on-surface">
                      {capabilities
                        ? capabilities.skills
                          ? 'Supported'
                          : 'Not supported by this Needle 3 build'
                        : '…'}
                    </dd>
                  </div>
                </dl>
              </Card.Body>
            </Card.Root>

            {/* ── MCP / Skills (unsupported truth) ────────────────── */}
            <Card.Root variant="outlined">
              <Card.Body className="flex flex-col gap-2 p-5">
                <SectionHeader
                  icon={<Link2 className="w-4 h-4" />}
                  title="MCP"
                  hint="Model Context Protocol servers"
                />
                <p
                  className={cn(
                    'text-body-md text-on-surface-variant',
                    capabilities?.mcp && 'text-on-surface',
                  )}
                >
                  {capabilities?.mcp
                    ? 'MCP is reported as supported by the connected build.'
                    : 'Not supported by this Needle 3 build. No MCP servers can be added — ordinary Needle tools are not MCP.'}
                </p>
              </Card.Body>
            </Card.Root>

            <Card.Root variant="outlined">
              <Card.Body className="flex flex-col gap-2 p-5">
                <SectionHeader
                  icon={<KeyRound className="w-4 h-4" />}
                  title="Skills"
                  hint="Reusable skill packages"
                />
                <p className="text-body-md text-on-surface-variant">
                  {capabilities?.skills
                    ? 'Skills are reported as supported by the connected build.'
                    : 'Not supported by this Needle 3 build. Tools, prompts, and environments are not Skills.'}
                </p>
              </Card.Body>
            </Card.Root>

            {/* ── Runtime ─────────────────────────────────────────── */}
            <Card.Root variant="outlined">
              <Card.Body className="flex flex-col gap-3 p-5">
                <SectionHeader
                  icon={<Bot className="w-4 h-4" />}
                  title="Runtime"
                />
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-label-md text-on-surface-variant">
                      Needle version
                    </dt>
                    <dd className="text-body-md font-mono text-on-surface">
                      {capabilities?.needleVersion ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-md text-on-surface-variant">
                      Generation
                    </dt>
                    <dd className="text-body-md font-mono text-on-surface">
                      {capabilities?.generation ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-md text-on-surface-variant">
                      Last health state
                    </dt>
                    <dd className="text-body-md text-on-surface">
                      {status ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-md text-on-surface-variant">
                      Last successful request
                    </dt>
                    <dd className="text-body-md font-mono text-on-surface">
                      {settings.lastSuccessAt || '—'}
                    </dd>
                  </div>
                </dl>
              </Card.Body>
            </Card.Root>
          </>
        )}
      </div>
    </>
  )
}
