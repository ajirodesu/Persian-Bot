/**
 * /start — Onboarding & Welcome Command
 *
 * The bot's front door. Distinct from /help (full command reference) and
 * /menu (category browser) — this is the first thing a new user should run,
 * and what Telegram auto-suggests the moment a user opens a DM with the bot
 * (Telegram clients special-case a bot's `/start` command). It answers three
 * questions on one screen: "what is this bot", "what can it do right now for
 * ME", and "how do I actually use it" — then hands off to /help and /menu for
 * the deep dive instead of duplicating their listings.
 *
 * ── Special features ──────────────────────────────────────────────────────
 * 1. Personalized greeting — resolves the caller's platform display name via
 *    ctx.user.getName() and falls back to their raw ID if the platform
 *    lookup fails, so the message never renders a blank name.
 *
 * 2. First-time vs. returning detection — writes a small `onboarding`
 *    collection to db.users (same CollectionManager pattern as daily.ts's
 *    `money` collection): `firstSeenAt` is set once, `visits` increments on
 *    every call. First-time callers get a longer "getting started" framing;
 *    returning callers get a shorter welcome-back plus their visit count.
 *    This persists per-user across restarts (it's the DB, not in-memory
 *    session state).
 *
 * 3. Permission-scoped command counts — mirrors /help's and /menu's exact
 *    filtering pipeline (platform support → dashboard-disabled → role
 *    access) before counting commands, so the number shown is always "what
 *    YOU can actually run", not a hand-maintained or global total. A group
 *    admin sees more than an anonymous user; a bot admin sees more still.
 *
 * 4. Live bot nickname — the bot's configured display name is read via
 *    getBotNickname() (same cached repo used by ai.ts and lans.ts) and used
 *    everywhere this command would otherwise say "Cat-Bot", so a renamed
 *    bot instance never shows a stale hardcoded name. Falls back to
 *    "Cat-Bot" only when no nickname has been configured for this session.
 *
 * 5. Quick-action buttons — on platforms with native buttons (Discord,
 *    Telegram, WebChat — see hasNativeButtons()), 📖 Help and 📜 Menu
 *    buttons are attached. Rather than re-implementing list rendering, their
 *    onClick handlers delegate into help.ts's and menu.ts's exported
 *    onCommand() — those functions already branch on
 *    event['type'] === 'button_action' to edit the message in place, so
 *    delegation here gets that behavior for free. On platforms without
 *    native buttons, the message body just tells the user which text
 *    command to type instead.
 *
 *    IMPORTANT (fixed in 1.2.0): delegation rebinds ctx.chat/ctx.button to
 *    the real owning command ("help"/"menu") before calling its onCommand —
 *    see delegateTo() below. Passing the raw ctx straight through used to
 *    leave chat/button scoped to "start", which silently broke help.ts's
 *    Prev/Next and menu.ts's category/Back buttons after navigating there
 *    from /start (every button they generated was mis-tagged "start:<id>",
 *    a key that doesn't exist in start.ts's own button map).
 *
 * ── The bot's AI features, both surfaced here ────────────────────────────
 * Cat-Bot ships two distinct AI conversation surfaces, and /start calls out
 * both by name so new users don't miss either one:
 *   • The AI agent (`/ai`, or just saying the bot's nickname in chat) — a
 *     tool-using assistant (see engine/agent/agent.ts) that can chat AND
 *     execute other bot commands on the user's behalf. It refers to itself
 *     by the session's configured nickname.
 *   • Lans (`/lans`, or just saying "Lans" in chat) — a separate, named AI
 *     companion (see lans.ts) with her own persistent per-user conversation
 *     memory. Reply to any of her messages to keep the thread going, or run
 *     `/lans reset` to start over.
 *
 * ── How it fits the command system ───────────────────────────────────────
 * Standard CommandMeta + onCommand/button module shape, same as every other
 * command here. IMPORTANT: `start` used to be registered as an alias of
 * `help` (see help.ts's changelog note in its meta.aliases comment) — that
 * alias was removed when this file was added, since app.ts's command loader
 * has no collision detection (`commands.set()` on a duplicate key just
 * overwrites silently, and file load order across the directory isn't
 * guaranteed). /start now owns that command name outright and links back to
 * /help itself for anyone who typed it out of habit.
 *
 * Aliases: /begin, /welcome
 * Access:  ANYONE
 * Cooldown: 5s
 */

import type { CommandMap, AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { findSessionCommands } from '@/engine/modules/session/bot-session-commands.repo.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { isThreadAdmin } from '@/engine/repos/threads.repo.js';
import { isBotAdmin, isBotPremium } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { getBotNickname } from '@/engine/repos/session.repo.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import {
  createChatContext,
  createButtonContext,
} from '@/engine/adapters/models/context.model.js';
import { onCommand as helpOnCommand, button as helpButtonDef } from './help.js';
import { onCommand as menuOnCommand, button as menuButtonDef } from './menu.js';

// ── Config ───────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'start',
  aliases: ['begin', 'welcome'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Welcomes you to the bot and shows what it can do and how to use it.',
  category: 'Info',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const HR = '─────────────────';

/** Fallback display name used only when no nickname has been configured
 *  for this session — mirrors the same fallback agent.ts uses internally. */
const DEFAULT_NICKNAME = 'Cat-Bot';

/**
 * Feature groups shown in the welcome summary — kept high-level and
 * category-shaped rather than a full command dump, since /help and /menu
 * already own the exhaustive listing. The AI Chat entry is built separately
 * at render time since it needs the bot's live nickname.
 */
const STATIC_FEATURE_GROUPS = [
  {
    emoji: '💰',
    label: 'Economy & Games',
    blurb: 'daily rewards, balance, slots, quizzes, and more',
  },
  {
    emoji: '📥',
    label: 'Media & Downloads',
    blurb: 'save from TikTok, YouTube, Instagram, and other platforms',
  },
  {
    emoji: '🎨',
    label: 'Image Tools',
    blurb: 'AI image generation, filters, and random photo commands',
  },
  {
    emoji: '🛡️',
    label: 'Moderation',
    blurb: 'warnings, anti-spam, bad-word filtering for group admins',
  },
  {
    emoji: '🧩',
    label: 'Utilities',
    blurb: 'translation, QR codes, reminders, link shortening, and more',
  },
] as const;

/**
 * Resolves the set of role levels the invoking user can access, and the set
 * of command names that should be treated as hidden/disabled for them.
 *
 * This is the exact same three-stage pipeline /help and /menu use — platform
 * support, dashboard-disabled overrides, then role privilege — kept in one
 * place here so /start's counts never drift from what /help <command> would
 * actually allow the user to run.
 */
async function resolveDisabledNames(ctx: AppCtx): Promise<Set<string>> {
  const { commands, native, event } = ctx;
  const sessionUserId = native.userId ?? '';
  const sessionId = native.sessionId ?? '';

  let disabledNames = new Set<string>();
  if (sessionUserId && sessionId) {
    try {
      const rows = await findSessionCommands(
        sessionUserId,
        native.platform,
        sessionId,
      );
      disabledNames = new Set(
        rows
          .filter((r: { isEnable: boolean; commandName: string }) => !r.isEnable)
          .map((r: { commandName: string }) => r.commandName),
      );
    } catch {
      // DB unreachable — fail-open, same contract as /help
    }
  }

  // Hide commands unsupported on this platform, same as /help
  for (const mod of commands.values()) {
    const cfg = mod['meta'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (name && !isPlatformAllowed(mod, native.platform)) {
      disabledNames.add(name);
    }
  }

  // Resolve accessible role levels — non-monotone set, mirrors /help exactly
  const senderID = (event['senderID'] ?? event['userID'] ?? '') as string;
  const threadID = (event['threadID'] ?? '') as string;
  const accessibleRoles = new Set<number>([Role.ANYONE]);

  if (sessionUserId && sessionId && senderID) {
    try {
      const isSysAdmin = await isSystemAdmin(senderID);
      if (isSysAdmin) {
        accessibleRoles.add(Role.THREAD_ADMIN);
        accessibleRoles.add(Role.BOT_ADMIN);
        accessibleRoles.add(Role.PREMIUM);
        accessibleRoles.add(Role.SYSTEM_ADMIN);
      } else {
        const isAdmin = await isBotAdmin(
          sessionUserId,
          native.platform,
          sessionId,
          senderID,
        );
        if (isAdmin) {
          accessibleRoles.add(Role.THREAD_ADMIN);
          accessibleRoles.add(Role.BOT_ADMIN);
          accessibleRoles.add(Role.PREMIUM);
        } else {
          const isPremium = await isBotPremium(
            sessionUserId,
            native.platform,
            sessionId,
            senderID,
          );
          if (isPremium) {
            accessibleRoles.add(Role.THREAD_ADMIN);
            accessibleRoles.add(Role.PREMIUM);
          } else if (threadID) {
            const isThreadAdm = await isThreadAdmin(threadID, senderID);
            if (isThreadAdm) accessibleRoles.add(Role.THREAD_ADMIN);
          }
        }
      }
    } catch {
      // Fail-open: DB outage defaults to ANYONE, same as /help
    }
  }

  // Commands whose role level is absent from accessibleRoles are hidden
  for (const mod of commands.values()) {
    const cfg = mod['meta'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    const cmdRole = Number((cfg?.['role'] as number | undefined) ?? Role.ANYONE);
    if (name && !accessibleRoles.has(cmdRole)) {
      disabledNames.add(name);
    }
  }

  return disabledNames;
}

/**
 * Counts unique commands (by canonical meta.name) that are actually reachable
 * by this user — i.e. loaded, platform-supported, not dashboard-disabled, and
 * within their accessible role set. Mirrors help.ts's getCanonicalMods dedup
 * logic so the number shown here always agrees with what /help would list.
 */
function countAccessibleCommands(
  commands: CommandMap,
  disabledNames: Set<string>,
): number {
  const seen = new Set<string>();
  for (const mod of commands.values()) {
    const cfg = mod['meta'] as Record<string, unknown> | undefined;
    const name = (cfg?.['name'] as string | undefined)?.toLowerCase();
    if (!name || seen.has(name) || disabledNames.has(name)) continue;
    seen.add(name);
  }
  return seen.size;
}

// ── Buttons ──────────────────────────────────────────────────────────────────

const BUTTON_ID = { help: 'help', menu: 'menu' } as const;

/**
 * Rebinds ctx.chat and ctx.button to the real owning command before
 * delegating into that command's onCommand.
 *
 * Bug this fixes: ctx.chat/ctx.button are scoped to whichever command the
 * dispatcher actually invoked — here, "start" (the /start message's own Help
 * button). Every button ID a command generates gets stamped with that scope
 * (see context.model.ts's resolveButtons: `${commandName}:${id}`). Without
 * rebinding, when the delegated help.ts renders its Prev/Next buttons, they
 * would be emitted as "start:prev#..." / "start:next#...". A later click on
 * either button routes through button.dispatcher.ts's handleButtonAction,
 * which looks up `commands.get('start')['button']['prev'|'next']` — a key
 * that only exists on help.ts's button map, not start.ts's — so the handler
 * lookup fails and the click silently does nothing (same failure mode would
 * hit menu.ts's category/Back buttons via the Menu button).
 *
 * The fix mirrors exactly what the dispatcher itself does for a native
 * button click (see button.dispatcher.ts's handleButtonAction): rebuild
 * ctx.chat via createChatContext(..., commandName, ownerButtonDef, ...) and
 * ctx.button via createButtonContext(commandName, ...), both scoped to the
 * command that actually owns the rendering logic ("help" or "menu"). Every
 * button.generateID / button.createContext / chat.editMessage call made
 * inside the delegated onCommand is then consistently scoped to that real
 * owner, so subsequent clicks route back to its own button map correctly.
 */
function delegateTo(
  ctx: AppCtx,
  commandName: string,
  ownerButtonDef: Record<string, unknown>,
): AppCtx {
  return {
    ...ctx,
    chat: createChatContext(
      ctx.api,
      ctx.event,
      commandName,
      ownerButtonDef as Parameters<typeof createChatContext>[3],
      ctx.native.platform,
    ),
    button: createButtonContext(commandName, ctx.event).button,
  };
}

export const button = {
  [BUTTON_ID.help]: {
    label: '📖 Help',
    style: ButtonStyle.PRIMARY,
    // Delegating straight into help.ts's onCommand reuses its own
    // edit-in-place-on-button-click branch — no duplicated rendering here.
    // ctx is rebound to "help" first so its Prev/Next buttons route back
    // to help.ts, not to start.ts's much smaller button map.
    onClick: async (ctx: AppCtx) => {
      const helpCtx = delegateTo(
        ctx,
        'help',
        helpButtonDef as unknown as Record<string, unknown>,
      );
      helpCtx.args = [];
      await helpOnCommand(helpCtx);
    },
  },
  [BUTTON_ID.menu]: {
    label: '📜 Menu',
    style: ButtonStyle.SECONDARY,
    // Same rebinding, scoped to "menu" — fixes menu.ts's category and
    // Back buttons the same way.
    onClick: async (ctx: AppCtx) => {
      const menuCtx = delegateTo(
        ctx,
        'menu',
        menuButtonDef as unknown as Record<string, unknown>,
      );
      await menuOnCommand(menuCtx);
    },
  },
};

// ── Command handler ──────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, event, db, native, user, prefix = '', button } = ctx;
  const senderID = event['senderID'] as string | undefined;

  // ── Resolve the bot's live nickname, with a static fallback ──────────────
  let botNickname = DEFAULT_NICKNAME;
  if (native.userId && native.sessionId) {
    try {
      const resolved = await getBotNickname(
        native.userId,
        native.platform,
        native.sessionId,
      );
      if (resolved) botNickname = resolved;
    } catch {
      // Fall back to DEFAULT_NICKNAME already assigned above
    }
  }

  // ── Resolve a display name for the caller, with graceful fallbacks ───────
  let displayName = senderID ?? 'there';
  if (senderID) {
    try {
      const resolved = await user.getName(senderID);
      if (resolved) displayName = resolved;
    } catch {
      // Fall back to the raw ID already assigned above — never block the
      // welcome message on a platform identity lookup failing.
    }
  }

  // ── First-time vs. returning detection ────────────────────────────────────
  let isFirstTime = true;
  let visits = 1;
  if (senderID) {
    try {
      const userColl = db.users.collection(senderID);
      if (!(await userColl.isCollectionExist('onboarding'))) {
        await userColl.createCollection('onboarding');
      }
      const onboarding = await userColl.getCollection('onboarding');
      const firstSeenAt = (await onboarding.get('firstSeenAt')) as
        | number
        | undefined;
      isFirstTime = !firstSeenAt;
      if (isFirstTime) {
        await onboarding.set('firstSeenAt', Date.now());
      }
      await onboarding.increment('visits');
      visits = ((await onboarding.get('visits')) as number | undefined) ?? 1;
    } catch {
      // DB unreachable — fail open as a first-time greeting rather than
      // blocking the command entirely.
    }
  }

  // ── Permission-scoped command count — same filtering pipeline as /help ───
  const disabledNames = await resolveDisabledNames(ctx);
  const commandCount = countAccessibleCommands(ctx.commands, disabledNames);

  // ── Compose the message ────────────────────────────────────────────────────
  const headerLine = isFirstTime
    ? `🐾 **Welcome to ${botNickname}, ${displayName}!**`
    : `🐾 **Welcome back, ${displayName}!**`;

  const introLines = isFirstTime
    ? [
        `${botNickname} is a multi-platform assistant — it runs on Discord, Telegram, and WebChat, and packs AI chat, an economy system, media downloaders, games, and moderation tools into one bot.`,
        `Here's what you get:`,
      ]
    : [
        `Good to see you again — this is visit #${visits}.`,
        `Quick refresher on what's on offer:`,
      ];

  // Built dynamically since it references the bot's own live nickname (the
  // AI agent is addressed by that nickname) alongside Lans, the bot's
  // separately-named AI companion.
  const aiFeatureLine = `🤖 **AI Chat** — talk to the AI agent via \`${prefix}ai\` or by saying "${botNickname}" in chat, or talk to Lans, a separate AI companion, via \`${prefix}lans\` or by saying "Lans"`;

  const featureLines = [
    aiFeatureLine,
    ...STATIC_FEATURE_GROUPS.map((f) => `${f.emoji} **${f.label}** — ${f.blurb}`),
  ];

  const howItWorksLines = [
    `**How it works:**`,
    `• Every command starts with the prefix \`${prefix}\` — e.g. \`${prefix}help\`.`,
    `• Based on your current access level, you can run ${commandCount} command(s) right now. Run \`${prefix}help\` to list them, or \`${prefix}help <command>\` for details on one.`,
    `• Run \`${prefix}menu\` to browse commands grouped by category instead.`,
    `• Some commands need group-admin, bot-admin, or premium access — you'll be told if one is out of reach.`,
    `• Talk to the AI agent any time with \`${prefix}ai <message>\` or by saying "${botNickname}" — it can chat and even run other commands for you.`,
    `• Talk to Lans with \`${prefix}lans <message>\` or by saying "Lans" — she remembers your conversation and keeps it going if you reply to her messages. Use \`${prefix}lans reset\` to start fresh.`,
  ];

  const message = [
    headerLine,
    '',
    ...introLines,
    '',
    ...featureLines,
    '',
    HR,
    ...howItWorksLines,
  ].join('\n');

  const buttons = hasNativeButtons(native.platform)
    ? [[button.generateID({ id: BUTTON_ID.help }), button.generateID({ id: BUTTON_ID.menu })]]
    : [];

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: hasNativeButtons(native.platform)
      ? message
      : `${message}\n\nType \`${prefix}help\` or \`${prefix}menu\` to continue.`,
    ...(buttons.length > 0 ? { button: buttons } : {}),
  };

  await chat.replyMessage(payload);
};
