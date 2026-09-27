import { useState } from 'react'
import { Search, Zap } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotEvents } from '@/features/users/hooks/useBotEvents'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching dashboard settings
// ============================================================================

function IconWell({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent'
}) {
  return (
    <div
      className={cn(
        'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
        tone === 'accent' && 'bg-primary/10 border-primary/30 text-primary',
        tone === 'default' && 'bg-surface-container-high border-hairline text-on-surface-variant',
      )}
    >
      {children}
    </div>
  )
}

function MonoChip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {children}
    </span>
  )
}

function EventRowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <Skeleton variant="pill" width={44} height={24} />
    </div>
  )
}

/**
 * Events Page — /dashboard/bot/events?id=xxx
 * Decoupled route to isolate fetching scope for events.
 */
export default function BotEventsPage() {
  const { id } = useBotContext()
  const { events, isLoading, error, toggleEvent } = useBotEvents(id)

  const [query, setQuery] = useState('')

  const filtered =
    query.trim() === ''
      ? events
      : events.filter(
          (evt) =>
            evt.eventName.toLowerCase().includes(query.toLowerCase()) ||
            evt.description?.toLowerCase().includes(query.toLowerCase()),
        )

  return (
    <div className="flex flex-col max-w-[400px] md:max-w-2xl w-full mx-auto">
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Events
          </h2>
          <span className="text-[11px] font-mono font-medium text-surface-variant">
            {isLoading
              ? 'Loading…'
              : query.trim()
                ? `${filtered.length} of ${events.length}`
                : `${events.length} total`}
          </span>
        </div>

        {error && (
          <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
        )}

        <Input
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          aria-label="Search events"
          className="h-11 text-sm"
        />

        {/* Keep the search bar visible; swap only the list for skeletons while fetching */}
        {isLoading ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <EventRowSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <p className="p-6 text-sm text-on-surface-variant italic text-center">
              {query.trim()
                ? `No events match "${query}"`
                : 'No events synced yet — start the bot to populate this list.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {filtered.map((evt) => (
              <div
                key={evt.eventName}
                className="p-3.5 flex items-center justify-between space-x-3"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <IconWell tone={evt.isEnable ? 'accent' : 'default'}>
                    <Zap className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                      {evt.eventName}
                    </span>
                    {evt.description && (
                      <span className="text-xs text-on-surface-variant truncate mt-0.5">
                        {evt.description}
                      </span>
                    )}
                    <span className="flex items-center space-x-1.5 mt-1 flex-wrap gap-y-1">
                      <MonoChip tone={evt.isEnable ? 'accent' : 'default'}>
                        {evt.isEnable ? 'ON' : 'OFF'}
                      </MonoChip>
                      {evt.version && (
                        <MonoChip tone="default">v{evt.version}</MonoChip>
                      )}
                    </span>
                    {evt.author && (
                      <span className="text-[11px] text-surface-variant font-mono mt-1 truncate">
                        by {evt.author}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <Switch
                    checked={evt.isEnable}
                    onChange={() =>
                      void toggleEvent(evt.eventName, !evt.isEnable)
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
