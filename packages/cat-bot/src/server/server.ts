/**
 * HTTP Server Bootstrap — Singleton Lifecycle
 *
 * Owns the single app.listen() call for the entire process.
 * Handles graceful shutdown and binds the unified Express app.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { createServer } from 'node:http';
import { env } from '@/engine/config/env.config.js';
import { createApp } from './app.js';
// Socket.IO: attach to the raw HTTP server before listen() so the WS upgrade
// event is captured at the Node.js level rather than going through Express.
import { initSocketIO } from './socket/socket.lib.js';
import { registerValidationHandlers } from './socket/validation.socket.js';
import { registerBotMonitorHandlers } from './socket/bot-monitor.socket.js';
import { registerBotDatabaseHandlers } from './socket/bot-database.socket.js';
import { registerChatRoomHandlers } from './socket/chat-room.socket.js';

/**
 * Starts the singleton Express webhook & API server.
 * Idempotent — multiple bot adapters can safely call this, only binds once.
 */
export function startServer(): void {
  const app = createApp();
  const port = parseInt(env.PORT, 10);
  // Create the HTTP server explicitly so Socket.IO can attach to it.
  // app.listen() internally does the same thing, but we need the handle before listen().
  const httpServer = createServer(app);

  const corsOrigin = env.VITE_URL ? [env.VITE_URL] : (true as const);
  const io = initSocketIO(httpServer, corsOrigin);
  registerValidationHandlers(io);
  registerBotMonitorHandlers(io);
  registerBotDatabaseHandlers(io);
  registerChatRoomHandlers(io);

  // Bind explicitly to 0.0.0.0 — without this Node.js defaults to '::' (IPv6 dual-stack),
  // which silently drops IPv4 traffic in container runtimes where IPV6_V6ONLY=1 is the default.
  // Keep-alive tuning for the inbound server (dashboard API + Telegram webhook mode):
  // longer keepAliveTimeout lets clients/webhook senders reuse the same TCP connection
  // across requests instead of reconnecting each time, and headersTimeout is kept safely
  // above it (Node requirement) without letting a slow client hold a socket forever.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  // Restart-safe binding: when the previous instance is still shutting down
  // (tsx-watch reloads, SIGTERM drains, a lingering dev server), the port can
  // be briefly unavailable. Retry within a bounded window instead of dying on
  // the first EADDRINUSE — a restart must not take the whole bot down.
  // NOTE: httpServer.listen() returns the SAME server instance every time, so
  // the error listener is attached ONCE here and reads the attempt counter —
  // re-attaching per attempt would stack listeners and duplicate every log.
  const BIND_RETRY_LIMIT = 5;
  const BIND_RETRY_DELAY_MS = 1_000;
  let bindAttempt = 0;

  function bindServer(): void {
    bindAttempt += 1;
    httpServer.listen(port, '0.0.0.0', () => {
      logger.info(`Webhook & API server listening on port ${port}`);
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && bindAttempt < BIND_RETRY_LIMIT) {
      logger.warn(
        `[server] Port ${port} busy — retrying in ${BIND_RETRY_DELAY_MS}ms (attempt ${bindAttempt}/${BIND_RETRY_LIMIT})`,
      );
      setTimeout(bindServer, BIND_RETRY_DELAY_MS);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `[server] Port ${port} is still in use after ${BIND_RETRY_LIMIT} attempts — stop the process holding it or change PORT in packages/cat-bot/.env`,
      );
    } else {
      logger.error('[server] Fatal server error:', err);
    }
    process.exit(1);
  });

  bindServer();

  // Note: SIGTERM handling for graceful shutdown is managed globally by
  // the Cat-Bot orchestrator in packages/bot/src/app.ts.
}
