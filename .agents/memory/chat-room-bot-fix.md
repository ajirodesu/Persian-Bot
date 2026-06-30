---
name: Chat Room Bot Fix
description: Why the web chat room's bot never responded and how it was fixed
---

## The Rule
`getNative()` in `chat-room.socket.ts` must NOT set `userId` or `sessionId`.

## Why
`handleMessage` in `message.handler.ts` only calls `isCommandEnabled(userId, platform, sessionId, cmd)` when BOTH `userId` AND `sessionId` are non-empty strings. That DB query checks a `bot_sessions_commands` table row for the specific session. Since the web chat room has no real DB session (it's ephemeral, not a real Discord/Telegram account), the row never exists, causing `isCommandEnabled` to return `false` for every command. Result: the bot replies "No command X found" (or is silent) for everything.

**How to apply:** Keep `getNative()` as `return { platform: 'webchat' }` — no userId, no sessionId. The `isCommandEnabled` if-block is skipped entirely when either field is falsy/absent.
