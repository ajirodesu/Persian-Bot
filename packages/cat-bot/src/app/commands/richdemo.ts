/**
 * /richdemo — Example command demonstrating Telegram's Rich Messages
 * (InputRichMessage, Bot API 10.1+) end-to-end: sending via
 * style: MessageStyle.RICH_MARKDOWN / RICH_HTML, and editing via the same
 * styles (see telegram/lib/replyMessage.ts + editMessage.ts's rich dispatch
 * branches, and telegram/lib/sendRichMessage.ts for the underlying call).
 *
 * Usage:
 *   /richdemo         → Rich Markdown demo (tables, task lists, footnotes, code)
 *   /richdemo html    → Rich HTML demo (spoiler, collapsible <details>, <pre>)
 *
 * The 🔁 toggle button below then exercises the *edit* path — clicking it
 * calls chat.editMessage with the opposite style, proving both the send and
 * edit dispatch branches work.
 *
 * Telegram-only feature: on every other platform (Discord, WebChat) the
 * RICH_MARKDOWN/RICH_HTML styles fall back to each platform's normal markdown
 * renderer (see message-style.constants.ts), so GFM-only syntax like tables
 * and task lists would show up as literal pipes/brackets there. Rather than
 * ship a degraded-looking demo, this command sends a short explanatory
 * message on non-Telegram platforms instead.
 */
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

export const meta: CommandMeta = {
  name: 'richdemo',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'System',
  description:
    'Demo of Telegram Rich Messages (InputRichMessage) — tables, task lists, footnotes, code blocks, spoilers, and collapsible sections.',
  category: 'Info',
  usage: '[html]',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'mode',
      description: '"html" for the Rich HTML variant; omit for Rich Markdown (default)',
      required: false,
    },
  ],
};

// ── Demo content builders ───────────────────────────────────────────────────

/** Rich Markdown — GFM-compatible plus Telegram's extensions (tables, task lists, footnotes). */
function buildMarkdownDemo(): string {
  return [
    '# 📊 Rich Message Demo',
    '',
    'This is rendered via **InputRichMessage** (Bot API 10.1+), not the old MarkdownV2 pipeline — so it supports things MarkdownV2 never could.',
    '',
    '## Feature table',
    '',
    '| Feature      | In Rich Markdown |',
    '| ------------ | ----------------- |',
    '| Headings     | ✅ |',
    '| Tables       | ✅ |',
    '| Task lists   | ✅ |',
    '| Footnotes    | ✅ |',
    '',
    '## Task list',
    '- [x] Ship `sendRichMessage`',
    '- [x] Ship `sendRichMessageDraft` (used by the AI thinking indicator)',
    '- [ ] Convert every command to rich output',
    '',
    '## Code block',
    '```ts',
    'const hello = "world";',
    '```',
    '',
    '> Block quotes still work exactly as you\'d expect.',
    '',
    'Rich Markdown even supports footnotes[^1].',
    '',
    '[^1]: Right here, no separate message needed.',
    '',
    '_Tap 🔁 below to see the same content re-edited as Rich HTML._',
  ].join('\n');
}

/** Rich HTML — same capability set as Rich Markdown, authored in the HTML tag dialect. */
function buildHtmlDemo(): string {
  return [
    '<b>📊 Rich Message Demo</b> (HTML mode)',
    '',
    'This is rendered via <b>InputRichMessage</b> (Bot API 10.1+), authored with Rich HTML tags instead of Markdown syntax.',
    '',
    '<tg-spoiler>This line is hidden until tapped — a native spoiler block.</tg-spoiler>',
    '',
    '<details><summary>Tap to expand</summary>',
    'Rich HTML supports collapsible sections via &lt;details&gt;, handy for long explanations you don\'t want to show by default.',
    '</details>',
    '',
    '<pre><code class="language-ts">const hello = "world";</code></pre>',
    '',
    '<i>Tap 🔁 below to see the same content re-edited as Rich Markdown.</i>',
  ].join('\n');
}

/** Plain-markdown fallback shown on platforms without a Rich Messages concept. */
function buildFallbackMessage(): string {
  return (
    '📊 **Rich Message Demo**\n\n' +
    'Telegram Rich Messages (`InputRichMessage`) are Telegram-only — tables, task lists, ' +
    'footnotes, spoilers, and collapsible sections rendered natively via `sendRichMessage`. ' +
    'This platform doesn\'t have an equivalent, so there\'s nothing richer to show here. ' +
    'Try `/richdemo` on Telegram to see it in action.'
  );
}

const BUTTON_ID = { toggle: 'toggle' } as const;

// ── Toggle button: exercises the rich-message *edit* dispatch path ─────────
export const button = {
  [BUTTON_ID.toggle]: {
    label: '🔁 Switch format',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session, button }: AppCtx) => {
      // Session context tracks which variant is currently displayed so the
      // click alternates markdown ↔ html instead of always going one way.
      const currentMode = (session.context.mode as 'markdown' | 'html') || 'markdown';
      const nextMode = currentMode === 'markdown' ? 'html' : 'markdown';

      button.createContext({ id: session.id, context: { mode: nextMode } });

      const scopedToggle = session.id;
      await chat.editMessage({
        message_id_to_edit: event.messageID as string,
        style:
          nextMode === 'html'
            ? MessageStyle.RICH_HTML
            : MessageStyle.RICH_MARKDOWN,
        message: nextMode === 'html' ? buildHtmlDemo() : buildMarkdownDemo(),
        ...(native.platform === Platforms.Telegram
          ? { button: [scopedToggle] }
          : {}),
      });
    },
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, native, button: buttonCtx } = ctx;

  // Non-Telegram platforms: explain the feature instead of shipping a
  // degraded-looking table/task-list wall of literal pipe characters.
  if (native.platform !== Platforms.Telegram) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildFallbackMessage(),
    });
    return;
  }

  const mode = args[0]?.toLowerCase() === 'html' ? 'html' : 'markdown';

  // scopedToggle becomes `session.id` inside the button's onClick handler
  // above (the dispatcher looks up stored context by this exact ID), so it's
  // the only key that needs seeding here.
  const scopedToggle = buttonCtx.generateID({ id: BUTTON_ID.toggle });
  buttonCtx.createContext({ id: scopedToggle, context: { mode } });

  await chat.replyMessage({
    style: mode === 'html' ? MessageStyle.RICH_HTML : MessageStyle.RICH_MARKDOWN,
    message: mode === 'html' ? buildHtmlDemo() : buildMarkdownDemo(),
    button: [scopedToggle],
  });
};
