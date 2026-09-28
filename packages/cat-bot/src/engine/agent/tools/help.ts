import type { AppCtx } from '@/engine/types/controller.types.js';
import { buildCommandCatalog } from '../lib/command-catalog.lib.js';
import { renderCommandDetail } from '../lib/tool-schema.lib.js';

/**
 * help tool — paginated command list + per-command detail, filtered exactly
 * like the catalogue: platform, dashboard toggles, and the caller's role
 * ceiling. Mirrors the /help command's visibility rules so the model never
 * sees commands it cannot use.
 */

const COMMANDS_PER_PAGE = 10;
const HR = '─────────────────';

function crop(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export const config = {
  name: 'help',
  description:
    'Get the paginated command list or full command details. ' +
    'Accepts a command name or a page number. ' +
    "Use before 'test_command' to view command arguments and verify access.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "An exact command name (e.g. 'ping'), a page number (e.g. '2'), or omit/empty for page 1.",
      },
    },
    required: [],
  },
};

export const run = async (
  args: Record<string, unknown>,
  ctx: AppCtx,
): Promise<string> => {
  const query = args['query'];
  const arg = (typeof query === 'string' ? query : '').toLowerCase().trim();
  const { entries, groupedList } = await buildCommandCatalog(ctx);
  void groupedList;

  // ── Detail view — non-numeric, non-empty arg treated as command name ──
  if (arg && isNaN(Number(arg))) {
    const entry = entries.find((e) => e.name === arg);
    if (!entry) {
      return `No accessible commands found matching "${arg}".`;
    }
    return renderCommandDetail(entry, ctx.prefix || '/');
  }

  // ── Paginated list view ─────────────────────────────────────────────
  const totalCmds = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalCmds / COMMANDS_PER_PAGE));
  const page = arg ? Math.min(Math.max(1, parseInt(arg, 10)), totalPages) : 1;
  const startIdx = (page - 1) * COMMANDS_PER_PAGE;
  const pageEntries = entries.slice(startIdx, startIdx + COMMANDS_PER_PAGE);

  const cmdLines = pageEntries.map((e, i) => {
    const num = startIdx + i + 1;
    return `${String(num).padStart(2, ' ')}. \`${ctx.prefix || '/'}${e.name}\` — ${crop(e.description, 60)}`;
  });

  return [
    `Commands (Page ${page}/${totalPages}) — ${totalCmds} total`,
    HR,
    ...cmdLines,
    HR,
    `Pass a page number as query to navigate. Pass a command name for full details.`,
  ].join('\n');
};
