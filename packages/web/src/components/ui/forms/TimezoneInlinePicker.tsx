import { useDeferredValue, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import Input from '@/components/ui/forms/Input'
import {
  listTimezoneOptions,
  type TimezoneOption,
} from '@/utils/datetime.util'
import { cn } from '@/utils/cn.util'

/** Cap rendered rows so live filtering stays jank-free. */
const MAX_RESULTS = 60

function matchesQuery(opt: TimezoneOption, q: string): boolean {
  return (
    opt.city.toLowerCase().includes(q) ||
    opt.region.toLowerCase().includes(q) ||
    opt.value.toLowerCase().includes(q) ||
    opt.label.toLowerCase().includes(q)
  )
}

function ResultRow({
  option,
  selected,
  onPick,
}: {
  option: TimezoneOption
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Select ${option.label}`}
      className="w-full text-left px-3.5 py-2.5 flex items-center justify-between space-x-3 hover:bg-surface-container-highest/60 active:bg-surface-container-highest transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
    >
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-semibold text-on-surface truncate leading-snug">
          {option.city}
        </span>
        <span className="text-[11px] font-mono text-on-surface-variant mt-0.5">
          {option.value} · {option.offsetLabel}
        </span>
      </span>
      {selected && (
        <Check
          className="w-4 h-4 text-primary flex-shrink-0"
          strokeWidth={2.5}
        />
      )}
    </button>
  )
}

/**
 * TimezoneInlinePicker — search-based timezone selection rendered inline
 * (no floating popover). Matches the grouped settings design: a search
 * field on top, results as tappable rows in a hairline list box below.
 */
export default function TimezoneInlinePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (timezone: string) => void
}) {
  const options = useMemo(() => listTimezoneOptions(), [])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const q = deferredQuery.trim().toLowerCase()

  const selected = options.find((opt) => opt.value === value)

  const results = useMemo(() => {
    if (!q) return []
    return options.filter((opt) => matchesQuery(opt, q)).slice(0, MAX_RESULTS)
  }, [options, q])

  const handlePick = (timezone: string) => {
    onChange(timezone)
    setQuery('')
  }

  return (
    <div className="space-y-2.5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search timezones…"
        autoComplete="off"
        aria-label="Search timezones"
        leftIcon={<Search className="h-4 w-4" />}
        className="h-11 text-sm"
      />
      <div
        className={cn(
          'border border-hairline rounded-lg bg-surface-container-high overflow-hidden',
        )}
      >
        {q === '' ? (
          <div className="px-3.5 py-3">
            {selected ? (
              <div className="flex items-center justify-between space-x-3">
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                    {selected.city}
                  </span>
                  <span className="text-[11px] font-mono text-on-surface-variant mt-0.5">
                    {selected.value} · {selected.offsetLabel}
                  </span>
                </span>
                <Check
                  className="w-4 h-4 text-primary flex-shrink-0"
                  strokeWidth={2.5}
                />
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">
                Type above to search {options.length} timezones.
              </p>
            )}
          </div>
        ) : results.length > 0 ? (
          <div className="max-h-60 overflow-y-auto divide-y divide-outline-variant">
            {results.map((opt) => (
              <ResultRow
                key={opt.value}
                option={opt}
                selected={opt.value === value}
                onPick={() => handlePick(opt.value)}
              />
            ))}
          </div>
        ) : (
          <p className="px-3.5 py-3 text-xs text-on-surface-variant">
            No timezones match “{deferredQuery.trim()}”.
          </p>
        )}
      </div>
      <p className="text-[11px] text-surface-variant leading-normal px-0.5">
        {options.length} timezones · offsets recomputed live for daylight
        saving.
      </p>
    </div>
  )
}
