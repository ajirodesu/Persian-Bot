<!--
  PERSIAN-BOT NATIVE DOC — Telegram adapter (grammy).
  Source structure extracted from upstream
  https://github.com/johnlester-0369/Cat-Bot/blob/main/docs/cat-bot/adapters/TELEGRAM_ARCHITECTURE.md
  and rewritten natively for this repo, which uses grammy (NOT Telegraf).
  Upstream Telegraf-based original is kept at
  docs/cat-bot/adapters/TELEGRAM_ARCHITECTURE.upstream-base.md for attribution.
-->

# Telegram Adapter — grammy Architecture (Native)

## Overview

The Telegram transport in this repo is built on **grammy `^1.45.1`** with
**`@grammyjs/runner ^2.0.3`** for concurrent update dispatch
(`packages/cat-bot/package.json:39,53,50`).
There is no Telegraf anywhere in the dependency tree — every `Telegraf`,
`telegraf`, `bot.launch()`, `answerCbQuery`, or `createWebhook` reference in
the upstream base doc maps to the grammy equivalent below.

Two run modes are supported by the same listener factory
(`src/engine/adapters/platform/telegram/listener.ts`):

- **Long-polling** (default): `run(bot, { runner: { fetch: { allowed_updates } } })`
  (`listener.ts:148`). Each session owns a `RunnerHandle`; teardown calls
  `activeRunner.stop()` + `activeBot.stop()` (`listener.ts:67-72,218-223`).
- **Webhook**: when `TELEGRAM_WEBHOOK_DOMAIN` is set, the listener registers
  `webhookCallback(bot, 'http', { secretToken })` + `setWebhook`
  (`listener.ts:128-138`) through `telegram-webhook.registry.ts`.

Retry/backoff is owned per-session inside the listener (`runManagedSession`),
so one failing Telegram account never affects Discord/Fluxer sessions
(see `src/engine/adapters/platform/index.ts` orchestrator).

## File Map

```
src/engine/adapters/platform/telegram/
├── index.ts                 — public facade; re-exports createTelegramListener + TelegramConfig only
├── types.ts                 — TelegramConfig { botToken, prefix, userId, sessionId }; TelegramEmitter
├── listener.ts              — createTelegramListener factory: token refresh from DB,
│                              getMe validation, slash-menu sync, attachHandlers,
│                              heartbeat, runManagedSession retry loop
├── handlers.ts              — attachHandlers(bot,…): update → unified-event routing
├── wrapper.ts               — TelegramApi extends UnifiedApi, bound per-update to grammy Context
├── slash-commands.ts        — registerSlashMenu over 4 broadcast scopes, hash idempotency,
│                              100-command cap, name/emoji sanitizers
├── unsupported.ts           — addUserToGroup / setGroupReaction stubs (throw — no Bot API)
├── lib/                     — one independently-testable module per UnifiedApi method
│   ├── replyMessage.ts      — full send pipeline (rich → text/media/buttons/mentions)
│   ├── sendMessage.ts       — plain ctx.api.sendMessage to an explicit threadID
│   ├── editMessage.ts       — editMessageText / editMessageMedia (+ rich path via raw API)
│   ├── reactToMessage.ts    — ctx.api.setMessageReaction
│   ├── sendTypingIndicator.ts— ctx.api.sendChatAction (single-shot, ~5 s TTL)
│   ├── sendRichMessage.ts / sendRichMessageDraft.ts / rich-message.types.ts
│   │                          — Bot API 10.1/10.2 rich-message support (new vs upstream)
│   └── getAvatarUrl / getBotID / getFullThreadInfo / getFullUserInfo / getUserInfo /
│       removeGroupImage / removeUserFromGroup / restrictUser / setGroupImage /
│       setGroupName / setNickname / unsendMessage.ts
└── utils/
    ├── helper.util.ts       — normalizeTelegramEvent, normalizeNewChatMembersEvent,
    │                          normalizeLeftChatMemberEvent, normalizeTelegramReactionEvent,
    │                          resolveAttachmentUrls, buildTelegramMentionEntities
    ├── markdownv2.util.ts   — sanitizeMarkdownV2 state machine (CommonMark → MarkdownV2, idempotent)
    ├── raw-api.util.ts      — callRawTelegramApi(ctx, method, payload) via ctx.api.raw escape
    │                          hatch for Bot API methods grammy types do not cover yet
    └── auto-retry.transformer.ts — grammy Transformer auto-retry (replaces Telegraf retry)
```

## Update Routing (`handlers.ts`)

grammy string-filter syntax replaces Telegraf listeners:

| grammy registration | Unified emit |
| --- | --- |
| `bot.on('message:new_chat_members', …)` (`handlers.ts:52`) | `event` (join) |
| `bot.on('message:left_chat_member', …)` (`handlers.ts:60`) | `event` (leave) |
| `bot.on('message', …)` (`handlers.ts:71`) — matches ALL message updates incl. service messages | `message` / `message_reply` |
| `bot.on('message_reaction', …)` (`handlers.ts:120`) | `message_reaction` |
| `bot.on('callback_query', …)` (`handlers.ts:132`) | `button_action` |

Button acknowledgement: `ctx.answerCallbackQuery()` must fire within ~10 s to
dismiss the spinner. The handler deliberately does NOT ack inline —
`button.dispatcher` owns the call so it can surface an alert text on
unauthorized clicks (`handlers.ts:133,155-159`).

## UnifiedApi Mapping (`wrapper.ts`, `lib/`)

All calls go through `ctx.api` (grammy wrappers):

- **reply** — `sendMessage(chatId, text, { entities, parse_mode: MarkdownV2,
  reply_parameters, reply_markup })` (`lib/replyMessage.ts:227-230`); media is
  dispatched by extension to `sendPhoto / sendVideo / sendAnimation / sendAudio /
  sendDocument / sendMediaGroup` (`lib/replyMessage.ts:243-350`); rich style via
  `sendRichMessage` raw call (`lib/replyMessage.ts:89`). Media uploads also emit
  fire-and-forget `sendChatAction` flashes (`lib/replyMessage.ts:126-128`).
- **send** — `ctx.api.sendMessage(targetChatId, text)`, returns `message_id` as
  string (`lib/sendMessage.ts:21-22`).
- **edit** — `ctx.api.editMessageText(chatId, msgId, text, …)`
  (`lib/editMessage.ts:204`); media via
  `editMessageMedia(chatId, mId, InputMedia, …)` (`lib/editMessage.ts:169,188`);
  rich via raw `editMessageText` with `rich_message` (`lib/editMessage.ts:104`).
- **react** — `ctx.api.setMessageReaction(chatId, Number(msgId),
  [{ type: 'emoji', emoji }])` (`lib/reactToMessage.ts:15-20`).
- **typing** — `ctx.api.sendChatAction(chatId, ACTION_MAP[action])`
  (`lib/sendTypingIndicator.ts:39-47`).
- **mentions** — `buildTelegramMentionEntities` translates `{ tag, user_id }` to
  Bot API `text_mention` entities.

URL attachments are forwarded directly to the Bot API (no download-first);
streams are buffered into grammy `InputFile` (`lib/replyMessage.ts:193-224`).

## Unsupported (`unsupported.ts:12-27`)

- `addUserToGroup` — throws; bots cannot add members via the Bot API (directs to
  `createChatInviteLink` instead).
- `setGroupReaction` — throws; no group default-reaction API as of 2026.

## Deltas vs Upstream Telegraf Doc

1. Transport `Telegraf` → `grammy` (`Bot`, `Context`, `Api`, `InputFile`).
2. Launch `bot.launch()` → `run(bot, { runner })` concurrent runner + explicit
   `bot.stop()`/`runner.stop()` teardown.
3. Webhook `createWebhook` → `webhookCallback(bot, 'http', { secretToken })` +
   registry.
4. Filters `message('new_chat_members')` → `bot.on('message:new_chat_members')`.
5. Ack `answerCbQuery` → `ctx.answerCallbackQuery`, owned by button.dispatcher.
6. New modules with no upstream equivalent: `raw-api.util.ts`,
   `rich-message.types.ts`, `sendRichMessage.ts`, `sendRichMessageDraft.ts`,
   `auto-retry.transformer.ts`.
7. `editMessage` needs no `inline_message_id: undefined` placeholder (grammy
   positional `chat_id`/`message_id`).
8. Attachment URL path: direct Bot API forwarding (vs old download-first).
