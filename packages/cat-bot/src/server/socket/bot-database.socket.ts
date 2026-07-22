/**
 * Bot Database — Socket.IO Handlers for Real-Time Database Panel Sync
 *
 * Forwards dbChangeEmitter events onto the shared Socket.IO server so the
 * dashboard's Database panel (users/groups, ban state) stays live without
 * polling, mirroring bot-monitor.socket.ts's status/log pattern.
 *
 *   'bot:database:subscribe'   { key }              → client joins the session's room
 *   'bot:database:unsubscribe' { key }               → client leaves the room
 *   'bot:database:change'      DbChangeEvent          ← pushed on every ban/unban/
 *                                                        delete/upsert for that session
 *
 * `key` is `${userId}:${platform}:${sessionId}` — the same convention used by
 * banned.repo.ts / users.repo.ts / threads.repo.ts when publishing to
 * dbChangeEmitter, and by sessionManager for bot status events.
 *
 * Authentication is handled by validation.socket.ts's io.use() middleware,
 * which rejects unauthenticated connections before any handler here fires.
 */
import type { Server as SocketIOServer } from 'socket.io';
import { dbChangeEmitter, type DbChangeEvent } from '@/engine/lib/db-change-emitter.lib.js';

const roomFor = (key: string): string => `bot-database:${key}`;

export function registerBotDatabaseHandlers(io: SocketIOServer): void {
  // Single subscriber to the domain-level bus — forwards every published change
  // exclusively to the room scoped to that session, so only dashboard tabs
  // actively viewing that bot's Database panel receive the update.
  dbChangeEmitter.on('change', (data: DbChangeEvent) => {
    io.to(roomFor(data.key)).emit('bot:database:change', data);
  });

  io.on('connection', (socket) => {
    socket.on('bot:database:subscribe', (key: unknown) => {
      if (typeof key !== 'string' || !key) return;
      void socket.join(roomFor(key));
    });

    socket.on('bot:database:unsubscribe', (key: unknown) => {
      if (typeof key !== 'string' || !key) return;
      void socket.leave(roomFor(key));
    });
  });
}
