import { useCallback, useEffect, useState } from 'react'
import { aiAgentService } from '@/features/admin/services/ai-agent.service'
import type {
  AiAgentCapabilitiesDto,
  AiAgentConnectionStatus,
  AiAgentSettingsDto,
} from '@/features/admin/services/ai-agent.service'

export interface UseAiAgentState {
  settings: AiAgentSettingsDto | null
  status: AiAgentConnectionStatus | null
  capabilities: AiAgentCapabilitiesDto | null
  loading: boolean
  saving: boolean
  testing: boolean
  error: string | null
  notice: string | null
  refresh: () => Promise<void>
  save: (data: {
    enabled: boolean
    needleUrl: string
    token?: string
    timeoutMs: number
    confidenceThreshold: number
  }) => Promise<boolean>
  test: () => Promise<void>
  dismissNotice: () => void
}

/** Loads AI Agent settings + live capabilities; save/test mutate + refresh. */
export function useAiAgent(): UseAiAgentState {
  const [settings, setSettings] = useState<AiAgentSettingsDto | null>(null)
  const [status, setStatus] = useState<AiAgentConnectionStatus | null>(null)
  const [capabilities, setCapabilities] =
    useState<AiAgentCapabilitiesDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([
        aiAgentService.getSettings(),
        aiAgentService.getCapabilities(),
      ])
      setSettings(s)
      setStatus(c.status)
      setCapabilities(c.capabilities)
    } catch {
      setError('Failed to load AI Agent settings.')
    } finally {
      setLoading(false)
    }
  }, [])

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
      setNotice('AI Agent settings saved.')
      return true
    } catch {
      setError('Failed to save AI Agent settings.')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  const test = useCallback(async () => {
    setTesting(true)
    setError(null)
    try {
      const result = await aiAgentService.testConnection()
      setStatus(result.status)
      setCapabilities(result.capabilities)
      setNotice(
        result.status === 'Connected'
          ? 'Needle 3 connection verified.'
          : `Connection state: ${result.status}.`,
      )
    } catch {
      setError('Connection test failed.')
    } finally {
      setTesting(false)
    }
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    settings,
    status,
    capabilities,
    loading,
    saving,
    testing,
    error,
    notice,
    refresh,
    save,
    test,
    dismissNotice,
  }
}
