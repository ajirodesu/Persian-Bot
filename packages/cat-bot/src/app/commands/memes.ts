/**
 * Random Meme Fetcher — multi-command family (single file)
 *
 * Replaces the standalone meme.ts and animeme.ts files. Both commands hit
 * the same meme-api.com endpoint (just a different subreddit pool) and share
 * identical send/refresh-button logic, so they're expressed here as one
 * `runMeme()` handler + a small config table, registered via the `commands`
 * array export that engine/app.ts's loadCommands() natively supports.
 *
 * Each entry keeps its own independent button definition (bound to its own
 * config via closure), so /meme's "Next Meme" button always re-rolls from
 * r/memes and /animeme's "Refresh" button always re-rolls from r/animemes.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Shared fetch ──────────────────────────────────────────────────────────────

interface MemeResult {
  url: string;
  title: string;
}

/** Fetches a random meme (URL + title) from the given meme-api.com subreddit pool. */
async function fetchRandomMeme(endpoint: string): Promise<MemeResult> {
  const { data } = await axios.get<{ url?: string; title?: string }>(
    `https://meme-api.com/gimme/${endpoint}`,
    { timeout: 10_000 },
  );
  if (!data?.url || !data?.title) throw new Error('Invalid meme data returned');
  return { url: data.url, title: data.title };
}

// ── Config table ──────────────────────────────────────────────────────────────

interface MemeConfig {
  name: string;
  aliases: string[];
  version: string;
  category: string;
  description: string;
  endpoint: string;
  attachmentPrefix: string;
  titlePrefix: string;
  buttonLabel: string;
  cooldown: number;
}

const MEME_CONFIGS: MemeConfig[] = [
  {
    name: 'meme',
    aliases: ['memes', 'randommeme'],
    version: '1.1.0',
    category: 'random',
    description: 'Sends a random meme.',
    endpoint: 'memes',
    attachmentPrefix: 'meme',
    titlePrefix: '😂 ',
    buttonLabel: '🔄 Next Meme',
    cooldown: 5,
  },
  {
    name: 'animeme',
    aliases: ['anime-meme'],
    version: '1.2.0',
    category: 'Anime',
    description: 'Fetch a random anime meme from Reddit.',
    endpoint: 'animemes',
    attachmentPrefix: 'animeme',
    titlePrefix: '',
    buttonLabel: '🔁 Refresh',
    cooldown: 5,
  },
];

const BUTTON_ID = { refresh: 'refresh' } as const;

// ── Shared handler ────────────────────────────────────────────────────────────

/**
 * Shared send/edit logic used by both onCommand (fresh send) and the
 * button onClick (in-place refresh). Determines the code path by checking
 * `event.type`.
 */
async function runMeme(ctx: AppCtx, config: MemeConfig): Promise<void> {
  const { native, button, session } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const meme = await fetchRandomMeme(config.endpoint);

    // Reuse the active button instance ID on refresh so the button stays live;
    // otherwise mint a fresh one for the initial send.
    const buttonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.refresh, public: true });

    const extMatch = meme.url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
    const ext = extMatch?.[1] ?? 'jpg';

    await finish({
      style: MessageStyle.MARKDOWN,
      message: `${config.titlePrefix}**${meme.title}**`,
      attachment_url: [
        { name: `${config.attachmentPrefix}.${ext}`, url: meme.url },
      ],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await fail(`⚠️ Failed to fetch a meme: ${message}`);
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface ButtonDefinition {
  label: string;
  style: string;
  onClick: (ctx: AppCtx) => Promise<void>;
}

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
  button: Record<string, ButtonDefinition>;
}

export const commands: CommandEntry[] = MEME_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: Role.ANYONE,
    author: 'ShawnDesu',
    description: config.description,
    category: config.category,
    usage: '',
    cooldown: config.cooldown,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => runMeme(ctx, config),
  button: {
    [BUTTON_ID.refresh]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx) => runMeme(ctx, config),
    },
  },
}));
