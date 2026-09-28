import type { AppCtx } from '@/engine/types/controller.types.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { isBlockedCommand } from './blocked-commands.lib.js';

/**
 * Dynamic Command Catalog — generates the AI-visible command catalogue from
 * Persian-Bot's REAL command registry on every turn.
 *
 * No second static list is maintained. The catalogue:
 *   - respects platform restrictions (meta.platform)
 *   - respects enabled/disabled commands (dashboard toggles)
 *   - deduplicates aliases (one entry per canonical meta.name)
 *   - groups commands by category with deterministic (alphabetical) ordering
 *   - only exposes commands the invoking user is permitted to see
 *     (role ceiling: system admin > bot admin > premium > thread admin > anyone)
 *
 * The grouped list is rendered into the system prompt (domain signal for the
 * model, mirroring Cat-Bot), and the sorted allowed-name list is embedded as
 * the `command` enum of the test_command tool schema so Needle 3 can only
 * nominate commands that actually exist and are permitted.
 */

export interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  usage: string;
  role: number;
}

function readMeta(mod: Record<string, unknown>): CommandMeta | null {
  const meta = mod['meta'] as Partial<CommandMeta> | undefined;
  if (!meta || typeof meta.name !== 'string' || meta.name === '') return null;
  return meta as CommandMeta;
}

/** Resolves the invoking user's effective privilege ceiling. Fail-open to ANYONE. */
async function resolveUserMaxRole(
  senderID: string,
  threadID: string,
  sessionUserId: string,
  platform: string,
  sessionId: string,
): Promise<number> {
  if (!senderID) return Role.ANYONE;
  try {
    if (await isSystemAdmin(senderID)) return Role.SYSTEM_ADMIN;
  } catch {
    /* fail-open */
  }
  if (sessionUserId && sessionId) {
    try {
      if (await isBotAdmin(sessionUserId, platform, sessionId, senderID)) {
        return Role.BOT_ADMIN;
      }
    } catch {
      /* fail-open */
    }
    try {
      if (await isBotPremium(sessionUserId, platform, sessionId, senderID)) {
        return Role.PREMIUM;
      }
    } catch {
      /* fail-open */
    }
  }
  if (threadID) {
    try {
      if (await isThreadAdmin(threadID, senderID)) return Role.THREAD_ADMIN;
    } catch {
      /* fail-open */
    }
  }
  return Role.ANYONE;
}

/**
 * Builds the permitted catalogue for this turn's identity.
 * Returns the category-grouped prompt block plus the sorted allowed names.
 */
export async function buildCommandCatalog(ctx: AppCtx): Promise<{
  groupedList: string;
  allowedNames: string[];
  entries: CatalogEntry[];
}> {
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  // 1. Commands toggled off by the bot admin via the dashboard.
  let disabledNames = new Set<string>();
  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(sessionUserId, platform, sessionId);
      disabledNames = new Set(
        rows
          .filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable)
          .map((r: { isEnable: boolean; commandName: string }) =>
            r.commandName.toLowerCase(),
          ),
      );
    } catch {
      // Fail-open — show all commands when DB is unreachable
    }
  }

  // 2. Platform-unsupported commands are hidden the same way.
  for (const mod of ctx.commands.values()) {
    const meta = readMeta(mod);
    if (meta && !isPlatformAllowed(mod, platform)) {
      disabledNames.add(meta.name.toLowerCase());
    }
  }

  // 3. Role ceiling — hide commands above the user's privilege level.
  const userMaxRole = await resolveUserMaxRole(
    senderID,
    threadID,
    sessionUserId,
    platform,
    sessionId,
  );

  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const mod of ctx.commands.values()) {
    const meta = readMeta(mod);
    if (!meta) continue;
    const name = meta.name.toLowerCase();
    if (seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);
    // AI deny-list — shell/eval-class commands are never AI-visible.
    if (isBlockedCommand(name)) continue;
    const cmdRole = typeof meta.role === 'number' ? meta.role : Role.ANYONE;
    if (cmdRole > userMaxRole) continue;
    const usageRaw = meta.usage;
    entries.push({
      name,
      description: meta.description ?? 'No description.',
      category: meta.category ?? 'Uncategorized',
      usage: Array.isArray(usageRaw) ? usageRaw.join(' | ') : (usageRaw ?? ''),
      role: cmdRole,
    });
  }

  // Deterministic ordering — prevents shuffled tool selection across turns.
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const byCategory = new Map<string, string[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e.name);
    byCategory.set(e.category, list);
  }
  const groupedList = Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, cmds]) => `${cat}: ${[...cmds].sort().join(', ')}`)
    .join('\n');

  return {
    groupedList,
    allowedNames: entries.map((e) => e.name),
    entries,
  };
}
