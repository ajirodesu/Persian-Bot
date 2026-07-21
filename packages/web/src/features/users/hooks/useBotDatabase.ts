/**
 * useBotDatabase — data fetching + mutation state for the Database panel.
 *
 * Manages paginated user/group lists, search, status filtering, column
 * sorting, optimistic UI updates on ban/delete, and a pending-operation map
 * so individual rows can show loading indicators.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { botService } from '@/features/users/services/bot.service'
import type {
  BotDatabaseUser,
  BotDatabaseGroup,
  BotDatabaseStatusFilter,
  BotDatabaseSortBy,
  BotDatabaseSortDir,
} from '@/features/users/services/bot.service'

// ── Users hook ────────────────────────────────────────────────────────────────

export interface UseBotDatabaseUsersReturn {
  users: BotDatabaseUser[]
  total: number
  page: number
  totalPages: number
  isLoading: boolean
  error: string | null
  search: string
  setSearch: (s: string) => void
  status: BotDatabaseStatusFilter
  setStatus: (s: BotDatabaseStatusFilter) => void
  sortBy: BotDatabaseSortBy
  sortDir: BotDatabaseSortDir
  toggleSort: (column: BotDatabaseSortBy) => void
  setPage: (p: number) => void
  pending: Set<string>   // set of userId strings currently processing
  refetch: () => void
  deleteUser: (userId: string) => Promise<void>
  banUser: (userId: string, reason?: string) => Promise<void>
  unbanUser: (userId: string) => Promise<void>
}

export function useBotDatabaseUsers(sessionId: string): UseBotDatabaseUsersReturn {
  const [users, setUsers] = useState<BotDatabaseUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearchRaw] = useState('')
  const [status, setStatusRaw] = useState<BotDatabaseStatusFilter>('all')
  const [sortBy, setSortBy] = useState<BotDatabaseSortBy>('last_seen')
  const [sortDir, setSortDir] = useState<BotDatabaseSortDir>('desc')
  const [pending, setPending] = useState<Set<string>>(new Set())

  // Reset to page 1 whenever search or filter changes
  const setSearch = useCallback((s: string) => {
    setSearchRaw(s)
    setPage(1)
  }, [])

  const setStatus = useCallback((s: BotDatabaseStatusFilter) => {
    setStatusRaw(s)
    setPage(1)
  }, [])

  const toggleSort = useCallback((column: BotDatabaseSortBy) => {
    setSortBy((prevColumn) => {
      setSortDir((prevDir) =>
        prevColumn === column ? (prevDir === 'asc' ? 'desc' : 'asc') : 'desc',
      )
      return column
    })
    setPage(1)
  }, [])

  const fetchRef = useRef(0)

  const fetch = useCallback(() => {
    if (!sessionId) return
    const id = ++fetchRef.current
    setIsLoading(true)
    setError(null)
    botService
      .getDatabaseUsers(sessionId, page, 20, search, { status, sortBy, sortDir })
      .then((data) => {
        if (id !== fetchRef.current) return
        setUsers(data.users)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err: unknown) => {
        if (id !== fetchRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load users')
      })
      .finally(() => {
        if (id === fetchRef.current) setIsLoading(false)
      })
  }, [sessionId, page, search, status, sortBy, sortDir])

  useEffect(() => {
    fetch()
  }, [fetch])

  const addPending = (id: string) => setPending((s) => new Set([...s, id]))
  const removePending = (id: string) =>
    setPending((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })

  const deleteUser = useCallback(
    async (userId: string) => {
      addPending(userId)
      try {
        await botService.deleteDatabaseUser(sessionId, userId)
        setUsers((prev) => prev.filter((u) => u.id !== userId))
        setTotal((t) => Math.max(0, t - 1))
      } finally {
        removePending(userId)
      }
    },
    [sessionId],
  )

  const banUser = useCallback(
    async (userId: string, reason?: string) => {
      addPending(userId)
      try {
        await botService.banDatabaseUser(sessionId, userId, reason)
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, is_banned: true, ban_reason: reason ?? null } : u,
          ),
        )
      } finally {
        removePending(userId)
      }
    },
    [sessionId],
  )

  const unbanUser = useCallback(
    async (userId: string) => {
      addPending(userId)
      try {
        await botService.unbanDatabaseUser(sessionId, userId)
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, is_banned: false, ban_reason: null } : u,
          ),
        )
      } finally {
        removePending(userId)
      }
    },
    [sessionId],
  )

  return {
    users,
    total,
    page,
    totalPages,
    isLoading,
    error,
    search,
    setSearch,
    status,
    setStatus,
    sortBy,
    sortDir,
    toggleSort,
    setPage,
    pending,
    refetch: fetch,
    deleteUser,
    banUser,
    unbanUser,
  }
}

// ── Groups hook ───────────────────────────────────────────────────────────────

export interface UseBotDatabaseGroupsReturn {
  groups: BotDatabaseGroup[]
  total: number
  page: number
  totalPages: number
  isLoading: boolean
  error: string | null
  search: string
  setSearch: (s: string) => void
  status: BotDatabaseStatusFilter
  setStatus: (s: BotDatabaseStatusFilter) => void
  sortBy: BotDatabaseSortBy
  sortDir: BotDatabaseSortDir
  toggleSort: (column: BotDatabaseSortBy) => void
  setPage: (p: number) => void
  pending: Set<string>
  refetch: () => void
  deleteGroup: (groupId: string) => Promise<void>
  banGroup: (groupId: string, reason?: string) => Promise<void>
  unbanGroup: (groupId: string) => Promise<void>
}

export function useBotDatabaseGroups(sessionId: string): UseBotDatabaseGroupsReturn {
  const [groups, setGroups] = useState<BotDatabaseGroup[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearchRaw] = useState('')
  const [status, setStatusRaw] = useState<BotDatabaseStatusFilter>('all')
  const [sortBy, setSortBy] = useState<BotDatabaseSortBy>('last_seen')
  const [sortDir, setSortDir] = useState<BotDatabaseSortDir>('desc')
  const [pending, setPending] = useState<Set<string>>(new Set())

  const setSearch = useCallback((s: string) => {
    setSearchRaw(s)
    setPage(1)
  }, [])

  const setStatus = useCallback((s: BotDatabaseStatusFilter) => {
    setStatusRaw(s)
    setPage(1)
  }, [])

  const toggleSort = useCallback((column: BotDatabaseSortBy) => {
    setSortBy((prevColumn) => {
      setSortDir((prevDir) =>
        prevColumn === column ? (prevDir === 'asc' ? 'desc' : 'asc') : 'desc',
      )
      return column
    })
    setPage(1)
  }, [])

  const fetchRef = useRef(0)

  const fetch = useCallback(() => {
    if (!sessionId) return
    const id = ++fetchRef.current
    setIsLoading(true)
    setError(null)
    botService
      .getDatabaseGroups(sessionId, page, 20, search, { status, sortBy, sortDir })
      .then((data) => {
        if (id !== fetchRef.current) return
        setGroups(data.groups)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      })
      .catch((err: unknown) => {
        if (id !== fetchRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load groups')
      })
      .finally(() => {
        if (id === fetchRef.current) setIsLoading(false)
      })
  }, [sessionId, page, search, status, sortBy, sortDir])

  useEffect(() => {
    fetch()
  }, [fetch])

  const addPending = (id: string) => setPending((s) => new Set([...s, id]))
  const removePending = (id: string) =>
    setPending((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })

  const deleteGroup = useCallback(
    async (groupId: string) => {
      addPending(groupId)
      try {
        await botService.deleteDatabaseGroup(sessionId, groupId)
        setGroups((prev) => prev.filter((g) => g.id !== groupId))
        setTotal((t) => Math.max(0, t - 1))
      } finally {
        removePending(groupId)
      }
    },
    [sessionId],
  )

  const banGroup = useCallback(
    async (groupId: string, reason?: string) => {
      addPending(groupId)
      try {
        await botService.banDatabaseGroup(sessionId, groupId, reason)
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, is_banned: true, ban_reason: reason ?? null } : g,
          ),
        )
      } finally {
        removePending(groupId)
      }
    },
    [sessionId],
  )

  const unbanGroup = useCallback(
    async (groupId: string) => {
      addPending(groupId)
      try {
        await botService.unbanDatabaseGroup(sessionId, groupId)
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, is_banned: false, ban_reason: null } : g,
          ),
        )
      } finally {
        removePending(groupId)
      }
    },
    [sessionId],
  )

  return {
    groups,
    total,
    page,
    totalPages,
    isLoading,
    error,
    search,
    setSearch,
    status,
    setStatus,
    sortBy,
    sortDir,
    toggleSort,
    setPage,
    pending,
    refetch: fetch,
    deleteGroup,
    banGroup,
    unbanGroup,
  }
}
