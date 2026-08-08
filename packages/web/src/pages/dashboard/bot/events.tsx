import { useState } from 'react'
import { Search, Zap } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import Alert from '@/components/ui/feedback/Alert'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotEvents } from '@/features/users/hooks/useBotEvents'
import Skeleton from '@/components/ui/feedback/Skeleton'

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
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="tonal" color="error" title="Error" message={error} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-title-md font-semibold text-on-surface">
            Events
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Enable or disable event handler modules. Disabled modules are
            skipped during dispatch.
          </p>
        </div>
        <Badge color="secondary" size="sm" variant="tonal">
          {isLoading
            ? 'Loading...'
            : query.trim()
              ? `${filtered.length} of ${events.length}`
              : `${events.length} total`}
        </Badge>
      </div>

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      {/* Keep contextual search bar visible; swap only the grid for skeletons while fetching */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card.Root
              key={i}
              padding="sm"
              bordered
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Skeleton variant="input" width="16px" height="16px" />
                  <Skeleton variant="text" width="60%" height="22px" />
                </div>
                <Skeleton
                  variant="pill"
                  width="36px"
                  height="20px"
                />
              </div>
              <Skeleton variant="text" count={2} />
              <div className="flex gap-1.5 pt-0.5">
                <Skeleton variant="rounded" width="44px" height="20px" />
              </div>
            </Card.Root>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card.Root padding="lg">
          <p className="text-body-md text-on-surface-variant italic text-center">
            {query.trim()
              ? `No events match "${query}"`
              : 'No events synced yet — start the bot to populate this list.'}
          </p>
        </Card.Root>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((evt) => (
            <Card.Root
              key={evt.eventName}
              padding="sm"
              bordered
              className={[
                // Same grid-tile treatment as the Commands cards (padding,
                // gap, bordered surface) — but intentionally no
                // `interactive`/`onClick` here, since events stay
                // switch-only and never open a detail popup.
                'flex flex-col gap-2 transition-all duration-fast',
                !evt.isEnable ? 'opacity-60' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Zap className="h-4 w-4 text-on-surface-variant shrink-0" />
                  <span className="font-mono text-label-lg font-semibold text-on-surface truncate">
                    {evt.eventName}
                  </span>
                </div>
                <Switch
                  checked={evt.isEnable}
                  onChange={() =>
                    void toggleEvent(evt.eventName, !evt.isEnable)
                  }
                />
              </div>

              {evt.description && (
                <p className="text-body-sm text-on-surface-variant leading-relaxed line-clamp-2">
                  {evt.description}
                </p>
              )}

              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <Badge
                  color={evt.isEnable ? 'success' : 'secondary'}
                  size="sm"
                  variant="tonal"
                  pill
                >
                  {evt.isEnable ? 'ON' : 'OFF'}
                </Badge>
                {evt.version && (
                  <Badge color="primary" size="sm" variant="outlined" pill>
                    v{evt.version}
                  </Badge>
                )}
              </div>

              {evt.author && (
                <div className="flex gap-1 pt-2 border-t border-outline-variant text-label-sm text-on-surface-variant">
                  <span className="font-medium text-on-surface">Author:</span>
                  <span>{evt.author}</span>
                </div>
              )}
            </Card.Root>
          ))}
        </div>
      )}
    </div>
  )
}
