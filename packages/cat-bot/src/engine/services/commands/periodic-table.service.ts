/**
 * Periodic Table Service — shared implementation for /periodictable and
 * /randomperiodictable.
 *
 * Both endpoints respond with a JSON envelope `{ error, message: {...} }` and
 * serve the element image from a separate URL, forwarded via `attachment_url`.
 * Only the random endpoint renders a re-roll button.
 */

import axios from 'axios';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createMessageDelivery } from './message-delivery.service.js';

export const PERIODIC_TABLE_REROLL_BUTTON_ID = 'periodic-table-reroll';

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

async function fetchElement(
  path: string,
  query: Record<string, string> = {},
): Promise<ElementInfo> {
  const requestUrl = createUrl('popcat', path, query);

  const response = await axios.get<PeriodicTableResponse>(requestUrl, {
    timeout: 15_000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `API responded with status ${response.status}: ${describeErrorBody(response.data)}`,
    );
  }

  const { error, message } = response.data ?? {
    error: true,
    message: 'Empty response',
  };

  if (error || typeof message === 'string' || !message) {
    throw new Error(
      typeof message === 'string' ? message : 'Element not found',
    );
  }

  return message;
}

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

export interface PeriodicTableConfig {
  name: string;
  path: string;
  /** True when the command takes a required `<element>` positional argument. */
  needsQuery?: boolean;
  /** True when successful replies get a re-roll button (random only). */
  hasRerollButton?: boolean;
}

/** Runs the shared periodic-table flow for a family config. */
export async function runPeriodicTable(
  ctx: AppCtx,
  config: PeriodicTableConfig,
): Promise<void> {
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

  const isButtonAction = ctx.event['type'] === 'button_action';
  const delivery = createMessageDelivery(ctx);

  try {
    const info = await fetchElement(config.path, query);
    const message = formatElement(info);

    const buttonRow =
      config.hasRerollButton && hasNativeButtons(native.platform)
        ? [
            isButtonAction
              ? session.id
              : button.generateID({
                  id: PERIODIC_TABLE_REROLL_BUTTON_ID,
                  public: true,
                }),
          ]
        : [];

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message,
      attachment_url: [
        { name: `${info.symbol.toLowerCase()}.png`, url: info.image },
      ],
      ...(buttonRow.length > 0 ? { button: buttonRow } : {}),
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    await delivery.fail(`⚠️ Failed to fetch element info: \`${messageText}\``);
  }
}

export interface PeriodicTableButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the re-roll button for the random-element command. */
export function createPeriodicTableButton(
  config: PeriodicTableConfig,
  label: string,
): Record<string, PeriodicTableButtonDefinition> {
  return {
    [PERIODIC_TABLE_REROLL_BUTTON_ID]: {
      label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        runPeriodicTable(ctx, config),
    },
  };
}
