import { useState, useCallback } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryClient, queryKeys } from '@/lib/query-client.lib'
import { botService } from '@/features/users/services/bot.service'
import type { BotCommandItemDto } from '@/features/users/dtos/bot.dto'
import type { GetBotCommandsResponseDto } from '@/features/users/dtos/bot.dto'

interface UseBotCommandsReturn {
  commands: BotCommandItemDto[]
  total: number
  totalPages: number
  isLoading: boolean
  error: string | null
  // Optimistic update: toggles the local state immediately, calls API in background
  toggleCommand: (name: string, isEnable: boolean) => Promise<void>
  // Optimistic update for the per-command "Ignore Admin-Only" switch
  toggleIgnoreAdminOnly: (name: string, ignored: boolean) => Promise<void>
}

export function useBotCommands(
  sessionId: string,
  page = 1,
  limit = 12,
  search = '',
): UseBotCommandsReturn {
  const key = queryKeys.botCommands(sessionId, page, limit, search)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const { data, isPending, error } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      botService.getCommands(sessionId, page, limit, search, signal),
    enabled: !!sessionId,
    // Page/search changes keep showing the previous page while the next
    // one loads — no full-list spinner flicker while paginating.
    placeholderData: keepPreviousData,
  })

  /** Applies a command-list patch to every cached page of this session so
   *  optimistic toggles stay visible even if the user paginates mid-flight. */
  const patchAllPages = useCallback(
    (
      patch: (
        prev: GetBotCommandsResponseDto,
      ) => GetBotCommandsResponseDto,
    ): void => {
      for (const [cachedKey, cached] of queryClient.getQueriesData<GetBotCommandsResponseDto>({
        queryKey: ['bots', sessionId, 'commands'],
      })) {
        if (cached) queryClient.setQueryData(cachedKey, patch(cached))
      }
    },
    [sessionId],
  )

  const toggleCommand = useCallback(
    async (name: string, isEnable: boolean): Promise<void> => {
      // Optimistic update so the toggle feels instant — revert on API error
      setToggleError(null)
      patchAllPages((prev) => ({
        ...prev,
        commands: prev.commands.map((cmd) =>
          cmd.commandName === name ? { ...cmd, isEnable } : cmd,
        ),
      }))

      try {
        await botService.toggleCommand(sessionId, name, isEnable)
      } catch (err) {
        // Revert the optimistic change if the API call failed
        patchAllPages((prev) => ({
          ...prev,
          commands: prev.commands.map((cmd) =>
            cmd.commandName === name ? { ...cmd, isEnable: !isEnable } : cmd,
          ),
        }))
        setToggleError(
          err instanceof Error ? err.message : 'Failed to toggle command',
        )
      }
    },
    [sessionId, patchAllPages],
  )

  const toggleIgnoreAdminOnly = useCallback(
    async (name: string, ignored: boolean): Promise<void> => {
      // Optimistic update so the toggle feels instant — revert on API error
      setToggleError(null)
      patchAllPages((prev) => ({
        ...prev,
        commands: prev.commands.map((cmd) =>
          cmd.commandName === name
            ? { ...cmd, ignoresAdminOnly: ignored }
            : cmd,
        ),
      }))

      try {
        await botService.toggleCommandIgnoreAdminOnly(sessionId, name, ignored)
      } catch (err) {
        // Revert the optimistic change if the API call failed
        patchAllPages((prev) => ({
          ...prev,
          commands: prev.commands.map((cmd) =>
            cmd.commandName === name
              ? { ...cmd, ignoresAdminOnly: !ignored }
              : cmd,
          ),
        }))
        setToggleError(
          err instanceof Error
            ? err.message
            : 'Failed to update admin-only ignore list',
        )
      }
    },
    [sessionId, patchAllPages],
  )

  return {
    commands: data?.commands ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading: isPending,
    error:
      toggleError ?? (error ? (error.message ?? 'Failed to load commands') : null),
    toggleCommand,
    toggleIgnoreAdminOnly,
  }
}
