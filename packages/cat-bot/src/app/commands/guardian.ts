/**
 * Guardian command — native Persian-Bot port of Reze-Bot's guardian hook.
 *
 * Passive group moderation (link, promo and scam handling) that runs on every
 * group message via onChat, before command dispatch — so a spam message is
 * judged before it can also be treated as a command. AI-initiated synthetic
 * messages are never moderated.
 *
 * The hook deliberately returns nothing and never replies except for a
 * rate-limited warning on enforcement: moderation failing must never stop
 * the rest of the pipeline.
 *
 * Enforcement is per-thread opt-in via the stored chat policy (default
 * disabled + dry-run). Bot/thread admins' messages are exempt and feed the
 * topical context for "related?" judgments.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot (app/commands/guardian.ts,
 *   core/system/guardian.ts)
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (CommandMeta contract, Role levels, AppCtx, Fluxer/Discord/Telegram/WebChat).
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { guard } from '@/engine/ai/guardian.js';

export const meta: CommandMeta = {
  name: 'guardian',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'Persian-Bot',
  description: 'Passive group moderation — link, promo and scam handling.',
  category: 'Moderation',
  usage: '',
  cooldown: 0,
  hasPrefix: true,
};

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const text = String(ctx.event['message'] ?? ctx.event['body'] ?? '');
  if (!text.trim()) return;

  try {
    await guard(ctx);
  } catch (err) {
    // Moderation failing must never stop the rest of the pipeline.
    ctx.logger.error('[guardian] unexpected failure', {
      error: (err as Error)?.message ?? String(err),
    });
  }
};
