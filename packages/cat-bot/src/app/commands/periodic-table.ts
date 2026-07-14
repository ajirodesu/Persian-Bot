/**
 * Popcat Periodic Table — multi-command family (single file, config-driven)
 *
 * Same architecture as popcat-media.ts / popcat-text.ts: one EFFECT_CONFIGS
 * table declares each endpoint's shape (does it need a positional
 * element-name argument? does it get a re-roll button?), and one shared
 * runEffect() dispatches on that config. Adding a new endpoint later means
 * appending one config object — no new onCommand function required.
 *
 * Both endpoints respond with a JSON envelope: `{ error, message: {...} }`.
 * The element image is served from a separate URL rather than as raw bytes,
 * so it's forwarded via `attachment_url` instead of downloading it ourselves.
 *
 * Commands:
 *   /periodic-table         — look up a specific element by name or symbol
 *   /periodic-table-random  — get a random element (with a 🔁 re-roll button)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';
import type { CommandMeta, CommandOption } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── API response shape ───────────────────────────────────────────────────────

interface ElementInfo {
  name: string;
  symbol: string;
  atomic_number: number;
  atomic_mass: number;
  period: number;
  phase: string;
  discovered_by: string;
  image: string;
  summary: string;
}

interface PeriodicTableResponse {
  error: boolean;
  message: ElementInfo | string;
}

/** Best-effort decode of a non-2xx response body for diagnostics. */
function describeErrorBody(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 300);
  try {
    const parsed = data as Record<string, unknown>;
    const reason = parsed?.['message'] ?? parsed?.['error'];
    if (typeof reason === 'string') return reason;
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return '(unreadable body)';
  }
}

/**
 * Fetches element info from a periodic-table endpoint. Handles both the
 * "not found" case (HTTP 200 with `error: true` or a string `message`) and
 * hard failures (non-2xx status, network errors) so callers get one clear
 * thrown Error either way.
 */
async function fetchElement(path: string, query: Record<string, string> = {}): Promise<ElementInfo> {
  const requestUrl = createUrl('popcat', path, query);

  const response = await axios.get<PeriodicTableResponse>(requestUrl, {
    timeout: 15_000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`API responded with status ${response.status}: ${describeErrorBody(response.data)}`);
  }

  const { error, message } = response.data ?? { error: true, message: 'Empty response' };

  if (error || typeof message === 'string' || !message) {
    throw new Error(typeof message === 'string' ? message : 'Element not found');
  }

  return message;
}

/** Formats an ElementInfo into a markdown embed-style message body. */
function formatElement(el: ElementInfo): string {
  return (
    `🧪 **${el.name} (${el.symbol})**\n` +
    `🔢 **Atomic Number:** ${el.atomic_number}\n` +
    `⚖️ **Atomic Mass:** ${el.atomic_mass}\n` +
    `📊 **Period:** ${el.period}\n` +
    `🧊 **Phase:** ${el.phase}\n` +
    `🔬 **Discovered By:** ${el.discovered_by}\n\n` +
    `${el.summary}`
  );
}

// ── Endpoint configs ──────────────────────────────────────────────────────────

interface EndpointConfig {
  name: string;
  path: string;
  label: string;
  description: string;
  aliases?: string[];
  /** True when the command takes a required `<element>` positional argument. */
  needsQuery?: boolean;
  /** True when successful replies get a 🔁 re-roll button (random only). */
  hasRerollButton?: boolean;
}

const EFFECT_CONFIGS: EndpointConfig[] = [
  {
    name: 'periodictable',
    path: '/v2/periodic-table',
    label: 'Periodic Table',
    description: 'Look up a chemical element by name or symbol.',
    aliases: ['pt', 'element'],
    needsQuery: true,
  },
  {
    name: 'randomperiodictable',
    path: '/v2/periodic-table/random',
    label: 'Random Element',
    description: 'Get a random chemical element from the periodic table.',
    aliases: ['ptrandom', 'randomelement'],
    hasRerollButton: true,
  },
];

// ── Button id (shared across the one config that uses it) ───────────────────

const REROLL_BUTTON_ID = 'periodic-table-reroll';

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(ctx: AppCtx, config: EndpointConfig): Promise<void> {
  const { args, usage, native, button, session } = ctx;

  let query: Record<string, string> = {};

  if (config.needsQuery) {
    const element = args.join(' ').trim();
    if (!element) {
      await usage();
      return;
    }
    query = { element };
  }

  const loading = await withLoadingMedia(ctx, `🔬 **Looking up ${config.label}...**`);

  try {
    const info = await fetchElement(config.path, query);
    const message = formatElement(info);

    // Reuse the active button instance ID on reroll so the button slot stays
    // live in place instead of minting (and leaking) a fresh session per click.
    const buttonRow =
      config.hasRerollButton && hasNativeButtons(native.platform)
        ? [
            loading.isButtonAction
              ? session.id
              : button.generateID({ id: REROLL_BUTTON_ID, public: true }),
          ]
        : [];

    await loading.finish({
      style: MessageStyle.MARKDOWN,
      message,
      attachment_url: [{ name: `${info.symbol.toLowerCase()}.png`, url: info.image }],
      ...(buttonRow.length > 0 ? { button: buttonRow } : {}),
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    await loading.fail(`⚠️ Failed to fetch element info: \`${messageText}\``);
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
  button?: Record<
    string,
    { label: string; style: (typeof ButtonStyle)[keyof typeof ButtonStyle]; onClick: (ctx: AppCtx) => Promise<void> }
  >;
}

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => {
  const options: CommandOption[] = config.needsQuery
    ? [
        {
          type: OptionType.string,
          name: 'element',
          description: 'Element name or symbol (e.g. "bohrium" or "Bh")',
          required: true,
        },
      ]
    : [];

  const entry: CommandEntry = {
    meta: {
      name: config.name,
      aliases: config.aliases ?? [],
      version: '1.0.0',
      role: Role.ANYONE,
      author: 'AjiroDesu',
      description: config.description,
      category: 'image',
      usage: config.needsQuery ? '<element>' : '',
      cooldown: 5,
      hasPrefix: true,
      options,
    },
    onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
  };

  if (config.hasRerollButton) {
    entry.button = {
      [REROLL_BUTTON_ID]: {
        label: '🔁 Another Element',
        style: ButtonStyle.PRIMARY,
        onClick: async (ctx: AppCtx) => runEffect(ctx, config),
      },
    };
  }

  return entry;
});