/**
 * /apilist — Free API Registry Viewer
 *
 * Lists every free third-party API provider registered in
 * `@/engine/lib/apis.lib.js`, along with its base URL and whether it
 * requires an API key. Demonstrates `listUrl()` / `createUrl()` usage for
 * anyone building new commands on top of that registry.
 *
 * Flow:
 *   User: /apilist
 *   Bot:  Numbered list of every registered provider + base URL + key status
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { listUrl, type ApiDefinition } from '@/engine/lib/apis.lib.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'apilist',
  aliases: ['apis'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Lists all registered free API providers and their base URLs.',
  category: 'Utility',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatProviderList(
  providers: Record<string, ApiDefinition>,
): string {
  const entries = Object.entries(providers);

  const list = entries
    .map(([name, def], index) => {
      const keyBadge = def.APIKey ? '🔑 requires key' : '🔓 no key needed';
      return ` • ${index + 1}. **${name}** — \`${def.baseURL}\` (${keyBadge})`;
    })
    .join('\n');

  return (
    `🌐 **Registered Free API Providers** (${entries.length})\n\n` +
    `${list}\n\n` +
    `_Use \`createUrl(name, endpoint, params)\` from ` +
    `\`@/engine/lib/apis.lib.js\` to build request URLs for any of these._`
  );
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat }: AppCtx): Promise<void> => {
  const providers = listUrl();

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: formatProviderList(providers),
  });
};
