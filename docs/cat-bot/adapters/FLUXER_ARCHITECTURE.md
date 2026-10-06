<!--
  PERSIAN-BOT NATIVE DOC — Fluxer adapter (@fluxerjs/core).
  No upstream equivalent exists: upstream Cat-Bot ships facebook-messenger
  (fca-unofficial) + facebook-page (Graph API webhook) transports, which this
  fork replaces entirely with the Fluxer platform. Upstream comparison material
  (native SDK call shapes) is preserved in DOCS.md for context only.
-->

# Fluxer Adapter — @fluxerjs/core Architecture (Native)

## Overview

`fluxer` is platform id **4** via **`@fluxerjs/core ^2.2.0`**
(`packages/cat-bot/package.json:37`), a Discord-like guild/channel chat SDK
(`src/engine/adapters/platform/fluxer/client.ts:29`,
`src/engine/adapters/platform/fluxer/wrapper.ts:14-21`).

There are **no** `facebook-messenger` / `facebook-page` transports in this repo:
`src/engine/adapters/platform/` contains only `discord`, `telegram`,
`webchat`, `fluxer`. Any upstream doc section describing `fca-unofficial`
callbacks, numbered text-menu button emulation, or Graph API Button Templates
is historical comparison only — the runtime replacement is this adapter.

Registered in `src/engine/modules/platform/platform.constants.ts:20-44` as
`Fluxer: 'fluxer'` (`PLATFORM_TO_ID[fluxer] = 4`).

## File Map

```
src/engine/adapters/platform/fluxer/
├── index.ts                 — createFluxerListener({ token, prefix, userId, sessionId });
│                              start(commands) / stop() via runManagedSession;
│                              heartbeat over Routes.gatewayBot() (index.ts:99-106)
├── client.ts                — createFluxerClient(token): new Client(), login(token),
│                              wait Events.Ready; auth errors fatal, others auto-reconnect
├── event-handlers.ts        — attachEventHandlers(): SDK event → unified emit
├── wrapper.ts               — createFluxerApi(channel, guild, rawMessage, client):
│                              UnifiedApi(platform = fluxer); resolveChannel + channelSendFn
│                              delegate to lib/*
├── unsupported.ts           — throwing stubs for operations the token/SDK cannot do
├── lib/
│   ├── sendMessage.ts       — channel.send({ content, files, embeds })
│   ├── replyMessage.ts      — targetCh.send({ …, replyTo: { channelId, messageId } })
│   ├── editMessage.ts       — messages.fetch(id) then msg.edit({ content, embeds })
│   ├── reactToMessage.ts    — messages.fetch(id) (or cached raw) + message.react(emoji)
│   ├── getAvatarUrl / getBotID / getFullThreadInfo / getFullUserInfo / getUserInfo /
│   │   removeUserFromGroup / restrictUser / sendMessage / sendTypingIndicator /
│   │   setGroupName / setNickname / unsendMessage.ts
└── utils/
    ├── normalizers.util.ts  — normalizeMessageCreateEvent (:92-133),
    │                          normalizeMessageReactionAdd (:143-159),
    │                          normalizeMessageDelete (:168-180),
    │                          normalizeMemberAdd (:26-54) / Remove (:60-72);
    │                          attachments as att.id/url/filename (:77-86)
    └── helper.util.ts       — buildFluxerMentionMsg: @tag → <@userId> (:42-68);
                               re-export urlToStream/urlToBuffer + streamToBuffer
```

## Event Routing (`event-handlers.ts:40-172`)

| SDK event | Unified emit |
| --- | --- |
| `MessageCreate` (plain) (`:53-85`) | `message` |
| `MessageCreate` (reply) | `message_reply` |
| `MessageReactionAdd` (`:88-119`) | `message_reaction` |
| `MessageDelete` (`:122-134`) | `message_unsend` |
| `GuildMemberAdd` / `GuildMemberRemove` (`:137-169`) | `event` (join/leave) |

Button taps arrive through the same `message`/`button_action` unified path as
Discord (no numbered-menu emulation, no postback webhook — that was the old
`fca-unofficial`/Graph API world).

## UnifiedApi Mapping (`wrapper.ts`, `lib/`)

- **send** (`wrapper.ts:119-134` → `lib/sendMessage.ts:31-84`) —
  `channel.send({ content, files, embeds })` (`:111-115`). Image URLs become
  `EmbedBuilder().setImage(url)` (`:53`); non-image URLs become `{ name, url }`
  files (`:77-80`); streams are buffered to `{ name, data }` (`:67-75`).
  Cross-channel: `targetCh.send(text)` (`wrapper.ts:129`).
- **reply** (`wrapper.ts:187-236` → `lib/replyMessage.ts:43-89`) — with `replyId`:
  `targetCh.send({ content, files, embeds, replyTo: { channelId, messageId } })`
  (`:219-224`); else plain `send` (`:227-231`). Buttons are ignored and `style`
  is void on this transport (`replyMessage.ts:87`).
- **edit** (`wrapper.ts:253-256` → `lib/editMessage.ts:19-59`) —
  `messages.fetch(id)` then `msg.edit({ content, embeds })` (`:24,55-58`).
  Stream `attachment` edits throw (`:26-31`); image `attachment_url` maps to
  embeds (`:48-53`).
- **react** (`wrapper.ts:238-245` → `lib/reactToMessage.ts:19-20`) —
  `messages.fetch(id)` (or cached raw) + `message.react(emoji)`.

## Unsupported (`unsupported.ts:22-49`, wired `wrapper.ts:157-185`)

- `addUserToGroup` — invite-link only, no bot-side add.
- `setGroupReaction` — no thread-emoji API.
- `setGroupImage` / `removeGroupImage` — bot token lacks guild-icon rights.
- Stream-attachment `editMessage` — throws (`lib/editMessage.ts:26-31`).

## Server Hierarchy

`SERVER_HIERARCHY_PLATFORMS = [discord, fluxer]`
(`platform.constants.ts:55-63`). `isServerHierarchyPlatform()` true means the
server → channel model applies: `bot_discord_server` / `bot_discord_channel`
persistence, server-scoped bans, and the dashboard server → channels panel all
treat Fluxer exactly like Discord. Identity helpers: `getMemberCount →
guild.memberCount` (`wrapper.ts:321-324`), `leaveThread →
client.user.leaveGuild(id)` (`:325-329`).
