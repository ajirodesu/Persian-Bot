/**
 * AI Agent — Prompt & Catalog Builder
 *
 * Centralizes every piece of text the agent consumes so prompts stay compact
 * and token-cheap:
 *
 *   • buildAgentSystemPrompt   — renders the compact agentic system prompt.
 *                                Deliberately does NOT inline the command list
 *                                (previously a large <available_commands> dump
 *                                sent on every request); the model discovers
 *                                commands via list_commands/help instead, which
 *                                costs one tool call and is then reused from
 *                                the conversation history.
 *   • buildCommandCatalog      — compact one-line-per-command catalogue (the
 *                                list_commands output) that the LLM can scan.
 *   • buildThreadEntry         — concise assistant-side history entry: a short
 *                                tool summary + the reply text (or the message
 *                                that send_result delivered), so stored history
 *                                stays small instead of accumulating raw dumps.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CommandModule } from '@/engine/types/controller.types.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { Role, type RoleLevel } from '@/engine/constants/role.constants.js';
import type { ToolLogEntry } from './agent-runner.lib.js';

// System-prompt template (agent/system_prompt.md), loaded once at module eval —
// works symmetrically from src/ (tsx watch) and dist/ (compiled build).
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_PROMPT_TEMPLATE = fs.readFileSync(
  path.join(MODULE_DIR, '../../../../agent/system_prompt.md'),
  'utf-8',
);

// ── Roles ──────────────────────────────────────────────────────────────────────

/** Compact role label exposed to the LLM. */
export function roleLabel(level: RoleLevel | undefined): string {
  switch (level) {
    case Role.PREMIUM:
      return 'premium';
    case Role.THREAD_ADMIN:
    case Role.BOT_ADMIN:
      return 'admin';
    case Role.SYSTEM_ADMIN:
      return 'super-admin';
    default:
      return 'user';
  }
}

function roleMatchesFilter(
  level: RoleLevel | undefined,
  filter: string,
): boolean {
  const label = roleLabel(level);
  if (filter === 'all') return true;
  if (filter === 'admin') return label === 'admin' || label === 'super-admin';
  if (filter === 'super-admin') return label === 'super-admin';
  if (filter === 'premium') return label === 'premium';
  return label === 'user'; // 'user' filter → ANYONE commands only
}

// ── System prompt ──────────────────────────────────────────────────────────────

export interface SystemPromptParams {
  botName: string;
  userName: string;
  userRole: string;
  prefix: string;
  modelName: string;
  providerName: string;
  currentDatetime: string;
  /** Appended hint when the message mentions people (reply can @mention them). */
  mentioned?: boolean;
}

/** Renders the compact agentic system prompt for a turn. */
export function buildAgentSystemPrompt(params: SystemPromptParams): string {
  let prompt = SYSTEM_PROMPT_TEMPLATE
    .replaceAll('{{BOT_NAME}}', params.botName)
    .replaceAll('{{USER_NAME}}', params.userName)
    .replaceAll('{{USER_ROLE}}', params.userRole)
    .replaceAll('{{COMMAND_PREFIX}}', params.prefix)
    .replaceAll('{{CURRENT_DATETIME}}', params.currentDatetime)
    .replaceAll('{{AI_MODEL_NAME}}', params.modelName || 'unknown')
    .replaceAll('{{AI_PROVIDER_NAME}}', params.providerName || 'unknown');
  if (params.mentioned) {
    prompt +=
      '\n\nThe user has mentioned people in this message — you can @mention them in your reply.';
  }
  return prompt;
}

// ── Command catalogue (list_commands output) ───────────────────────────────────

const CATALOG_MAX_CHARS = 4000;

/**
 * Builds a compact, role-filtered command catalogue for the list_commands tool.
 * One line per command — name, short description, usage — grouped by category.
 * Role tags only appear for non-ANYONE commands (premium/admin/super-admin) so
 * ordinary users don't pay tokens for privilege metadata they can't use.
 */
export function buildCommandCatalog(
  commands: Map<string, CommandModule>,
  platform: string,
  role = 'all',
): string {
  const byCategory = new Map<string, string[]>();
  const seen = new Set<CommandModule>();

  for (const [name, mod] of commands) {
    if (seen.has(mod)) continue;
    seen.add(mod);
    if (!isPlatformAllowed(mod, platform)) continue;

    const cfg = (mod['meta'] ?? {}) as {
      name?: string;
      description?: string;
      usage?: string | string[];
      role?: RoleLevel;
      category?: string;
    };
    if (role !== 'all' && !roleMatchesFilter(cfg.role, role)) continue;

    const label = roleLabel(cfg.role);
    const cmdName = (cfg.name ?? name).toLowerCase();
    const description = (cfg.description ?? '').trim();
    const usage = Array.isArray(cfg.usage)
      ? cfg.usage[0] ?? ''
      : (cfg.usage ?? '');
    const category = cfg.category?.trim() || 'Uncategorized';

    // Compact single line: `name — description (usage: /name args) [role]`.
    const roleTag = label === 'user' ? '' : ` [${label}]`;
    let line = `- ${cmdName} — ${description || 'no description'}`;
    if (usage) line += ` (usage: ${usage})`;
    line += roleTag;

    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(line);
  }

  const sections = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([cat, lines]) =>
        `## ${cat}\n${[...lines].sort().join('\n')}`,
    );
  const catalog = sections.join('\n\n') || '(no commands available)';
  return catalog.length > CATALOG_MAX_CHARS
    ? `${catalog.slice(0, CATALOG_MAX_CHARS)}\n…(catalogue truncated — use \`help <command>\` for details)`
    : catalog;
}

// ── Thread history entries ─────────────────────────────────────────────────────

const TOOL_SUMMARY_MAX_CHARS = 400;

/**
 * Condenses a list_commands catalogue into just its command names so the
 * discovery result survives into thread history without the full descriptions:
 * the model reuses the name list to pick commands, and calls `help <command>`
 * only when it needs the details. Capped small enough to not bloat later turns.
 */
function condenseCommandCatalog(result: string): string {
  const names = result
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => {
      const name = l.slice(2).split(' — ')[0] ?? '';
      return name.trim();
    })
    .filter(Boolean);
  if (names.length === 0) return '';
  return `[Commands: ${names.join(', ')}]`;
}

/** Short tool summary: tool names + one-line outcomes, capped. */
function summarizeToolLog(toolLog: ToolLogEntry[]): string {
  if (toolLog.length === 0) return '';
  const catalogs: string[] = [];
  const names: string[] = [];
  for (const t of toolLog) {
    // list_commands results carry the full catalogue the model discovered —
    // keep the condensed name list so later turns reuse it without re-calling.
    if (t.name === 'list_commands') {
      const condensed = condenseCommandCatalog(t.result);
      if (condensed) {
        catalogs.push(condensed);
        continue;
      }
    }
    const args = Object.values(t.args)
      .map((v) => String(v))
      .join(' ')
      .slice(0, 60);
    names.push(`${t.name}${args ? `(${args})` : ''}`);
  }
  const parts = catalogs;
  if (names.length > 0) parts.push(`[Tools: ${names.join(', ')}]`);
  return parts.join('\n');
}

/** Extracts the message text a successful send_result delivered this turn. */
export function extractDeliveredMessage(toolLog: ToolLogEntry[]): string | null {
  for (let i = toolLog.length - 1; i >= 0; i--) {
    const t = toolLog[i]!;
    if (t.name !== 'send_result') continue;
    if (t.result.startsWith('Delivery failed')) continue;
    const m = t.args['message'];
    if (typeof m === 'string' && m.trim()) return m.trim();
  }
  return null;
}

/**
 * Builds the concise assistant-side entry stored in the conversation thread.
 * Includes a one-line tool summary and the reply text (preferring the message
 * send_result actually delivered over the model's trailing text).
 */
export function buildThreadEntry(
  toolLog: ToolLogEntry[],
  replyText: string | null,
): string {
  const summary = summarizeToolLog(toolLog);
  const delivered = extractDeliveredMessage(toolLog) ?? replyText ?? '';
  const summaryText = summary.length > TOOL_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, TOOL_SUMMARY_MAX_CHARS)}…`
    : summary;
  return [summaryText, delivered.trim()].filter(Boolean).join('\n');
}