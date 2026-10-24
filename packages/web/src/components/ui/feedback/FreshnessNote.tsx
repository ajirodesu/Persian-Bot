/**
 * Author: AjiroDesu
 *
 * Per-view freshness marker.
 *
 * A dashboard view backed by persisted data must say so. This reads the query
 * cache for the given key (without triggering a fetch) and renders either the
 * last sync time or a warning-toned "stale" label when the newest fetch
 * failed but older data is still on screen.
 */
import { useQuery, skipToken } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { cn } from '@/utils/cn.util'

function formatTimestamp(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return '—'
  }
}

export default function FreshnessNote({
  queryKey,
  className,
  staleOnly = false,
}: {
  queryKey: QueryKey
  className?: string
  staleOnly?: boolean
}) {
  const { data, dataUpdatedAt, isError } = useQuery({
    queryKey,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  if (!dataUpdatedAt) return null

  const isStale = isError && data !== undefined
  if (staleOnly && !isStale) return null

  const label = formatTimestamp(dataUpdatedAt)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]',
        isStale ? 'text-warning' : 'text-on-surface-variant/80',
        className,
      )}
      title={`Data last updated ${label}`}
    >
      <span
        aria-hidden="true"
        className={cn('h-1 w-1', isStale ? 'bg-warning' : 'bg-success/70')}
      />
      {isStale ? `Stale · last updated ${label}` : `Synced ${label}`}
    </span>
  )
}
