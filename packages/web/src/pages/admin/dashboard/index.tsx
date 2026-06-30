import { Helmet } from '@dr.pogodin/react-helmet'
import React from 'react'
import { Users, Bot, ShieldBan, AlertCircle } from 'lucide-react'
import { PLATFORM_LABELS } from '@/constants/platform.constants'
import Badge from '@/components/ui/data-display/Badge'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useAdminUsers } from '@/features/admin/hooks/useAdminUsers'

// ── Shared subcomponents ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  colorClass,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  colorClass: string
}) {
  return (
    <div className="rounded-2xl bg-surface border border-outline-variant p-5 flex flex-col gap-3 shadow-elevation-1">
      <div
        className={`h-10 w-10 rounded-xl flex items-center justify-center ${colorClass}`}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-headline-sm font-bold text-on-surface">{value}</p>
        <p className="text-body-sm text-on-surface-variant">{label}</p>
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
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Overview
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Platform health and activity at a glance.
        </p>
      </div>

      {/* ── Stat grid ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Registered Users"
          value={isUsersLoading ? '…' : String(totalUsers)}
          icon={Users}
          colorClass="bg-primary-container text-on-primary-container"
        />
        <StatCard
          label="Active Bots"
          value={isBotsLoading ? '…' : `${activeBots} / ${totalBots}`}
          icon={Bot}
          colorClass="bg-tertiary-container text-on-tertiary-container"
        />
        <StatCard
          label="Admin Accounts"
          value={isUsersLoading ? '…' : String(adminCount)}
          icon={ShieldBan}
          colorClass="bg-secondary-container text-on-secondary-container"
        />
        <StatCard
          label="Banned Accounts"
          value={isUsersLoading ? '…' : String(bannedCount)}
          icon={AlertCircle}
          colorClass="bg-error-container text-on-error-container"
        />
      </div>

      {/* ── Detail cards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform distribution — real data from useAdminBots */}
        <div className="rounded-2xl bg-surface border border-outline-variant p-5 shadow-elevation-1">
          <h2 className="text-title-md font-semibold text-on-surface mb-4">
            Bot Platform Distribution
          </h2>
          {isBotsLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {Object.entries(platformDist).map(([platform, count]) => {
                // Extract active running count to show alongside the total
                const running = botStats?.platformActiveDist?.[platform] ?? 0
                return (
                  <div
                    key={platform}
                    className="flex items-center justify-between py-3 border-b border-outline-variant/50 last:border-0"
                  >
                    <span className="text-body-sm font-medium text-on-surface">
                      {PLATFORM_LABELS[platform] ?? platform}
                    </span>
                    <div className="text-right">
                      <p className="text-body-sm font-semibold text-on-surface">
                        {count} session{count !== 1 ? 's' : ''}
                      </p>
                      <p className="text-label-sm text-on-surface-variant">
                        {running} running
                      </p>
                    </div>
                  </div>
                )
              })}
              {Object.keys(platformDist).length === 0 && (
                <p className="text-body-sm text-on-surface-variant text-center py-6">
                  No bot sessions registered yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Recent registrations */}
        <div className="rounded-2xl bg-surface border border-outline-variant p-5 shadow-elevation-1">
          <h2 className="text-title-md font-semibold text-on-surface mb-4">
            Recent Registrations
          </h2>
          {isUsersLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {users.slice(0, 6).map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between py-2.5 border-b border-outline-variant/50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-on-surface truncate">
                      {u.name}
                    </p>
                    <p className="text-label-sm text-on-surface-variant truncate">
                      {u.email}
                    </p>
                  </div>
                  <Badge
                    variant="tonal"
                    color={u.role === 'admin' ? 'primary' : 'default'}
                    size="sm"
                    pill
                    className="ml-3 shrink-0"
                  >
                    {u.role ?? 'user'}
                  </Badge>
                </div>
              ))}
              {users.length === 0 && (
                <p className="text-body-sm text-on-surface-variant text-center py-6">
                  No users registered yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
