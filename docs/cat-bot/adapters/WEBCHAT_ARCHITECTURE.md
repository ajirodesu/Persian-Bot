<!--
  PERSIAN-BOT NATIVE DOC — WebChat adapter (Socket.IO in-app chat).
  No upstream equivalent exists: upstream Cat-Bot has no webchat platform.
-->

# WebChat Adapter — Socket.IO Architecture (Native)

## Overview

WebChat is platform id **3** (`Platforms.Webchat = 'webchat'`,
`src/engine/modules/platform/platform.constants.ts:26,35,42`).
It is the in-app Chat Room transport: a per-socket `WebChatApi` instance wired
to a per-session in-memory store via a `WebchatSessionProvider` injected by
`src/server/socket/chat-room.socket.ts`
(`src/engine/adapters/platform/webchat/api.ts:1-13,65-74`).

It deliberately **bypasses** the unified platform emitter:
`src/engine/adapters/platform/index.ts` has zero Webchat references and only
creates/forwards `discord` / `telegram` / `fluxer` listeners, and
`spawnDynamicSession` supports only those three (throws otherwise). WebChat
sessions live and die with their Socket.IO connection instead.

## API Surface (`src/engine/adapters/platform/webchat/api.ts`)

`class WebChatApi extends UnifiedApi` (`api.ts:86-87`,
`override platform = Platforms.Webchat`).

| Method | Socket event |
| --- | --- |
| `sendTypingIndicator` (`:299-304`) | `chatroom:typing { threadID, action }` |
| `sendMessage` (`:306-318`) | `chatroom:bot_message` |
| `replyMessage` (`:320-341`) | `chatroom:bot_message` (text + style + buttons + attachments) |
| `editMessage` (`:343-393`) | `chatroom:bot_edit` |
| `unsendMessage` (`:395-402`) | `chatroom:bot_delete { id }` |
| `reactToMessage` (`:417-434`, bot-only) | `chatroom:reaction` |

Identity/group helpers (single-user 1:1 room semantics):

- `getUserInfo` (`:436-451`), `getFullUserInfo` (`:460-473`)
- `getFullThreadInfo` — 1:1 thread, user is admin (`:482-497`)
- `getBotID` → `'cat-bot'` (`:499-501`)
- `getUserName` / `getThreadName` / `getMemberCount = 2` (`:503-515`)

Helpers: `resolveAttachments` converts `Buffer`/`Readable` to base64 data-URLs
and passes `attachment_url` through (`:208-247`); `extToType` (`:115-128`),
`extToMime` (`:134-165`), `actionFromAttachments` (`:173-181`); `storeAndEmit`
pushes to the session store and emits (`:287-291`).

## Authoring Notes

- Command code is identical to other platforms: `chat.replyMessage`,
  `chat.editMessage`, buttons via `button.generateID` all work; the adapter
  translates them to socket events above.
- No credentials/verification flow: there is no token to verify (unlike
  Discord/Telegram/Fluxer dashboard flows) — the socket session IS the identity.
- `platform` filtering: use `Platforms.Webchat` (`'webchat'`, id `3`) with the
  standard `platform-filter.util.ts` helpers; see `DOCS.md` → Platform Filtering.
