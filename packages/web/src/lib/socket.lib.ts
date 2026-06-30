/**
 * Socket.IO Client Singleton
 *
 * Provides a single persistent socket connection shared across the application.
 * Connection is lazy — only established when getSocket() is first called.
 * This avoids opening a socket on every page load; only validation pages need it.
 *
 * withCredentials: true ensures the session cookie travels with the handshake
 * so the server-side authentication middleware can verify the user identity.
 */

import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * Returns the singleton socket, creating it on first call.
 * The Vite dev proxy forwards /socket.io/ to the Express server,
 * so window.location.origin works in both dev and production.
 */
export function getSocket(): Socket {
  if (!socket || !socket.connected) {
    socket = io(window.location.origin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    })
  }
  return socket
}

/** Closes the socket connection and clears the singleton. */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
