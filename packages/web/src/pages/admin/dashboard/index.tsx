import { Helmet } from '@dr.pogodin/react-helmet'
import React from 'react'
import { Users, Bot, ShieldBan, AlertCircle } from 'lucide-react'
import { PLATFORM_LABELS } from '@/constants/platform.constants'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useAdminUsers } from '@/features/admin/hooks/useAdminUsers'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching dashboard settings
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
        'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
        tone === 'accent' && 'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' && 'bg-error/10 border-error/30 text-error',
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

// ── Shared subcomponents ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'accent' | 'danger'
}) {
  return (
    <div className="bg-surface-container-low border border-hairline rounded-xl p-3.5 flex items-center space-x-3">
      <IconWell tone={tone}>
        <Icon className="w-4 h-4" />
      </IconWell>
      <div className="flex flex-col min-w-0">
        <span className="text-lg font-bold text-on-surface leading-snug">
          {value}
        </span>
        <span className="text-xs text-on-surface-variant mt-0.5">{label}</span>
      </div>
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <div
      className="bg-surface-container-low border border-hairline rounded-xl p-3.5 flex items-center space-x-3"
      aria-hidden="true"
    >
      <Skeleton variant="input" width={36} height={36} />
      <div className="flex flex-col gap-2">
        <Skeleton textSize="body-sm" width="56px" />
        <Skeleton textSize="body-sm" width="96px" />
      </div>
    </div>
  )
}

// ── Main page component ───────────────────────────────────────────────────────

/**
 * AdminDashboardPage (Overview)
 *
 * Bot stats now sourced from the real /api/v1/admin/bots endpoint rather than
 * inline mock data so the platform health numbers reflect live state.
 */
export default function AdminDashboardPage() {
  // Fetch minimum recent data, but the stats properties represent the full server-side aggregates
  const {
    users,
    stats: userStats,
    isLoading: isUsersLoading,
  } = useAdminUsers(1, 6)
  // Extracted only the stats and loading state; 'bots' array is unused in this aggregate view
  const { stats: botStats, isLoading: isBotsLoading } = useAdminBots(1, 1)

  // Fallbacks mapping exactly to the server-calculated aggregate response
  const totalUsers = userStats?.totalUsers ?? 0
  const adminCount = userStats?.adminCount ?? 0
  const bannedCount = userStats?.bannedCount ?? 0
  const activeBots = botStats?.activeBots ?? 0
  const totalBots = botStats?.totalBots ?? 0
  const platformDist = botStats?.platformDist ?? {}

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>Admin Overview · Cat-Bot</title>
      </Helmet>

      {/* ── Stat grid ── */}
      <section aria-label="Platform totals" className="space-y-2">
        <SectionTitle>Totals</SectionTitle>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
          {isUsersLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Registered Users"
              value={String(totalUsers)}
              icon={Users}
              tone="accent"
            />
          )}
          {isBotsLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Active Bots"
              value={`${activeBots} / ${totalBots}`}
              icon={Bot}
              tone="accent"
            />
          )}
          {isUsersLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard label="Admin Accounts" value={String(adminCount)} icon={ShieldBan} />
          )}
          {isUsersLoading ? (
            <StatCardSkeleton />
          ) : (
            <StatCard
              label="Banned Accounts"
              value={String(bannedCount)}
              icon={AlertCircle}
              tone="danger"
            />
          )}
        </div>
      </section>

      {/* ── Detail sections ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform distribution — real data from useAdminBots */}
        <section aria-label="Bot platform distribution" className="space-y-2">
          <SectionTitle>Bot Platform Distribution</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {isBotsLoading ? (
              [1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-3.5 flex items-center justify-between"
                  aria-hidden="true"
                >
                  <Skeleton textSize="body-sm" width="45%" />
                  <div className="flex flex-col items-end gap-1">
                    <Skeleton textSize="body-sm" width="72px" />
                    <Skeleton textSize="body-sm" width="52px" />
                  </div>
                </div>
              ))
            ) : Object.keys(platformDist).length === 0 ? (
              <p className="p-6 text-sm text-on-surface-variant italic text-center">
                No bot sessions registered yet.
              </p>
            ) : (
              Object.entries(platformDist).map(([platform, count]) => {
                // Extract active running count to show alongside the total
                const running = botStats?.platformActiveDist?.[platform] ?? 0
                return (
                  <div
                    key={platform}
                    className="p-3.5 flex items-center justify-between space-x-3"
                  >
                    <span className="text-sm font-semibold text-on-surface truncate">
                      {PLATFORM_LABELS[platform] ?? platform}
                    </span>
                    <span className="text-[11px] font-mono text-on-surface-variant flex-shrink-0">
                      {count} total · {running} running
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Recent registrations */}
        <section aria-label="Recent registrations" className="space-y-2">
          <SectionTitle>Recent Registrations</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {isUsersLoading ? (
              [1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-3.5 flex items-center space-x-3 min-w-0"
                  aria-hidden="true"
                >
                  <Skeleton variant="input" width={36} height={36} />
                  <div className="flex flex-col gap-2 min-w-0 flex-1">
                    <Skeleton textSize="body-sm" width="55%" />
                    <Skeleton textSize="body-sm" width="80%" />
                  </div>
                </div>
              ))
            ) : users.length === 0 ? (
              <p className="p-6 text-sm text-on-surface-variant italic text-center">
                No users registered yet.
              </p>
            ) : (
              users.slice(0, 6).map((u) => (
                <div
                  key={u.id}
                  className="p-3.5 flex items-center justify-between space-x-3"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      {u.name}
                    </span>
                    <span className="text-xs text-on-surface-variant truncate mt-0.5">
                      {u.email}
                    </span>
                  </div>
                  <MonoChip tone={u.role === 'admin' ? 'accent' : 'default'}>
                    {u.role ?? 'user'}
                  </MonoChip>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
