/**
 * Credential Validation — Socket.IO Handlers
 *
 * Registers authentication middleware on the provided Socket.IO server.
 * Called once from server.ts after initSocketIO().
 *
 * Auth strategy: extract better-auth session cookie from the socket handshake
 * headers — browsers include cookies automatically when withCredentials: true.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { auth } from '@/server/lib/better-auth.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module

// ── Socket.IO handler registration ────────────────────────────────────────────

/**
 * Registers the authentication middleware on the provided Socket.IO server.
 */
export function registerValidationHandlers(io: SocketIOServer): void {
  // Authenticate every socket connection via the better-auth session cookie.
  // Unauthenticated sockets are rejected before any event handler runs.
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers['cookie'] ?? '';
      const headers = new Headers({ cookie: cookieHeader });
      const session = await auth.api.getSession({ headers });
      if (!session) {
        next(new Error('Authentication required: no valid session cookie'));
        return;
      }
      // Store userId on socket.data so event handlers don't repeat the auth call
      socket.data['userId'] = session.user.id as string;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data['userId'] as string;
    logger.info(`[socket] Connected: ${socket.id} (user=${userId})`);

    socket.on('disconnect', () => {
      logger.info(`[socket] Disconnected: ${socket.id}`);
    });
  });
}
