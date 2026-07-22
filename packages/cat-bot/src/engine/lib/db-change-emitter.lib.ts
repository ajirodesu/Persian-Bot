/**
 * DB Change Emitter — Decoupled Real-Time Database Change Bus
 *
 * Domain-level EventEmitter that repo layers (banned.repo.ts, users.repo.ts,
 * threads.repo.ts) and the dashboard controller (bot-database.controller.ts)
 * publish to whenever a session-scoped user/group record changes — ban,
 * unban, delete, or upsert (first-seen / last-seen refresh).
 *
 * src/server/socket/bot-database.socket.ts is the sole subscriber: it
 * forwards every published event to the Socket.IO room scoped to that
 * session key, mirroring the sessionManager → bot-monitor.socket.ts pattern
 * already used for bot status/log streaming.
 *
 * Publishing from this shared bus — rather than importing socket.io directly
 * into engine/repo modules — means:
 *   - The engine layer stays free of server/transport concerns.
 *   - Every mutation path is covered automatically, whether it originates
 *     from a dashboard HTTP request (ban/unban/delete buttons) or a live
 *     in-chat command (e.g. autoban.ts banning a user mid-conversation) —
 *     both funnel through the same repo functions, so both emit here.
 */
import { EventEmitter } from 'node:events';

export type DbRecordType = 'user' | 'group';
export type DbChangeAction = 'ban' | 'unban' | 'delete' | 'upsert';

export interface DbChangeEvent {
  /** `${userId}:${platform}:${sessionId}` — matches banned.repo.ts's key convention. */
  key: string;
  type: DbRecordType;
  action: DbChangeAction;
  /** bot_user_id (type 'user') or bot_thread_id (type 'group'). */
  id: string;
  /** Partial fields changed by this action, when known (e.g. { is_banned, ban_reason }). */
  patch?: Record<string, unknown>;
}

class DbChangeEmitter extends EventEmitter {
  publish(event: DbChangeEvent): void {
    this.emit('change', event);
  }
}

export const dbChangeEmitter = new DbChangeEmitter();
