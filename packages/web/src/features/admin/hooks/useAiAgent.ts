import { useCallback, useEffect, useState } from 'react'
import { aiAgentService } from '@/features/admin/services/ai-agent.service'
import type {
  AiAgentCapabilitiesDto,
  AiAgentConnectionStatus,
  AiAgentSettingsDto,
  AiAgentTestDto,
} from '@/features/admin/services/ai-agent.service'

export interface UseAiAgentState {
  settings: AiAgentSettingsDto | null
  status: AiAgentConnectionStatus | null
  detail: string | null
  capabilities: AiAgentCapabilitiesDto | null
  model: string | null
  endpoint: string | null
  latencyMs: number | null
  lastCheckedAt: string | null
  loading: boolean
  saving: boolean
  testing: boolean
  error: string | null
  refresh: () => Promise<void>
  save: (data: {
    enabled: boolean
    needleUrl: string
    token?: string
    timeoutMs: number
    maxNewTokens: number
    confidenceThreshold: number
  }) => Promise<boolean>
  test: () => Promise<AiAgentTestDto | null>
}

/** Loads AI Agent settings + live probe; save/test mutate + refresh. */
export function useAiAgent(): UseAiAgentState {
  const [settings, setSettings] = useState<AiAgentSettingsDto | null>(null)
  const [status, setStatus] = useState<AiAgentConnectionStatus | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [capabilities, setCapabilities] =
    useState<AiAgentCapabilitiesDto | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyProbe = useCallback((c: AiAgentTestDto) => {
    setStatus(c.status)
    setDetail(c.detail)
    setCapabilities(c.capabilities)
    setModel(c.model)
    setEndpoint(c.endpoint)
    setLatencyMs(c.latencyMs)
    setLastCheckedAt(c.lastCheckedAt)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([
        aiAgentService.getSettings(),
        aiAgentService.getCapabilities(),
      ])
      setSettings(s)
      applyProbe(c)
    } catch {
      setError('Failed to load AI Agent settings.')
    } finally {
      setLoading(false)
    }
  }, [applyProbe])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-fetching: setState is deferred to await continuations
    void refresh()
  }, [refresh])

  const save: UseAiAgentState['save'] = useCallback(async (data) => {
    setSaving(true)
    setError(null)
    try {
      const s = await aiAgentService.updateSettings(data)
      setSettings(s)
      return true
    } catch {
      setError('Failed to save AI Agent settings.')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const test: UseAiAgentState['test'] = useCallback(async () => {
    setTesting(true)
    setError(null)
    try {
      const result = await aiAgentService.testConnection()
      applyProbe(result)
      return result
    } catch {
      setError('Connection test failed.')
      return null
    } finally {
      setTesting(false)
    }
  }, [applyProbe])

  return {
    settings,
    status,
    detail,
    capabilities,
    model,
    endpoint,
    latencyMs,
    lastCheckedAt,
    loading,
    saving,
    testing,
    error,
    refresh,
    save,
    test,
  }
}
