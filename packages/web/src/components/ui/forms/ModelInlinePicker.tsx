import { useDeferredValue, useMemo, useState } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import Input from '@/components/ui/forms/Input'
import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'

/** Cap rendered rows so live filtering stays jank-free. */
const MAX_RESULTS = 60

function ModelRow({
  label,
  sub,
  picked,
  custom,
  onPick,
}: {
  label: string
  sub?: string
  picked: boolean
  custom?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={custom ? `Use custom model ${label}` : `Select model ${label}`}
      className="w-full text-left px-3.5 py-2.5 flex items-center justify-between space-x-3 hover:bg-surface-container-highest/60 active:bg-surface-container-highest transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
    >
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
          {label}
        </span>
        {sub && (
          <span className="text-[11px] font-mono text-on-surface-variant mt-0.5 truncate">
            {sub}
          </span>
        )}
      </span>
      {picked && !custom ? (
        <Check className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2.5} />
      ) : custom ? (
        <Plus className="w-4 h-4 text-on-surface-variant flex-shrink-0" strokeWidth={2} />
      ) : null}
    </button>
  )
}

/**
 * ModelInlinePicker — search-based AI model selection rendered inline
 * (no floating popover). Same interaction model as TimezoneInlinePicker:
 * a search field on top, results as tappable rows in a hairline list box
 * below. Because model ids are open-ended (custom endpoints, new releases),
 * a non-matching query also offers a "use custom value" row.
 */
export default function ModelInlinePicker({
  value,
  onChange,
  models,
  providerLabel,
  loading,
  onLoad,
}: {
  /** Currently selected model id (may be a custom value outside the catalog). */
  value: string
  onChange: (model: string) => void
  /** Live catalog for the provider, or null when not loaded yet. */
  models: string[] | null
  providerLabel: string
  loading: boolean
  onLoad: () => void
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const q = deferredQuery.trim().toLowerCase()

  const results = useMemo(() => {
    if (!models || !q) return []
    return models.filter((m) => m.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [models, q])

  const handlePick = (model: string) => {
    onChange(model)
    setQuery('')
  }

  return (
    <div className="space-y-3 pt-1">
      {models === null ? (
        <div className="border border-hairline rounded-lg bg-surface-container-high px-3.5 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-on-surface-variant">
            No live models loaded for <span className="font-mono">{providerLabel}</span>.
          </p>
          <Button
            variant="text"
            color="neutral"
            size="sm"
            onClick={onLoad}
            isLoading={loading}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load'}
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search models"
            leftIcon={<Search className="h-4 w-4" />}
            className="h-11 text-sm font-mono"
          />
          <div className="border border-hairline rounded-lg bg-surface-container-high overflow-hidden">
            {q === '' ? (
              <div className="px-3.5 py-3">
                {value ? (
                  <div className="flex items-center justify-between space-x-3">
                    <span className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                        {value}
                      </span>
                      <span className="text-[11px] font-mono text-on-surface-variant mt-0.5">
                        {providerLabel}
                        {models.includes(value) ? '' : ' · custom value'}
                      </span>
                    </span>
                    <Check className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={2.5} />
                  </div>
                ) : (
                  <p className="text-xs text-on-surface-variant">
                    Type above to search {models.length} models.
                  </p>
                )}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto divide-y divide-outline-variant">
                {results.map((m) => (
                  <ModelRow
                    key={m}
                    label={m}
                    sub={providerLabel}
                    picked={m === value}
                    onPick={() => handlePick(m)}
                  />
                ))}
                <ModelRow
                  label={deferredQuery.trim()}
                  sub="Use as a custom model id"
                  picked={false}
                  custom
                  onPick={() => handlePick(deferredQuery.trim())}
                />
                {results.length === 0 && (
                  <p className="px-3.5 py-2 text-[11px] text-on-surface-variant">
                    No catalog matches — the custom row above still works.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[11px] text-surface-variant leading-normal">
              {models.length} live models · {providerLabel}
            </p>
            <button
              type="button"
              onClick={onLoad}
              disabled={loading}
              className={cn(
                'text-[11px] font-semibold text-primary hover:brightness-110 active:opacity-[0.82] transition-opacity disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded',
              )}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
