/**
 * Socket.IO Client Singleton
 *
 * One socket for the whole app, created lazily and never recreated while a
 * reference could still be held. The previous implementation replaced the
 * instance whenever it was disconnected, which orphaned every listener the
 * dashboard had registered on the old socket — a reconnect then looked dead
 * until a full reload.
 *
 * Liveness: Socket.IO's own heartbeat (ping/pong every 25s, 20s timeout)
 * detects a dead transport. The client reconnects forever with jittered
 * backoff; on reconnect, each hook re-subscribes from its `connect` listener
 * (status snapshot, log room) so state is resynced instead of guessed.
 *
 * Visibly-idle tabs: ConnectivityProvider disconnects after five hidden
 * minutes and reconnects on return, so a sleeping phone does not hold a
 * battery-draining socket open.
 */

import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

/** Returns the singleton socket, creating it on first call. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15_000,
      randomizationFactor: 0.5,
      timeout: 15_000,
    })
  }
  return socket
}

/** Connects if not already connected nor mid-handshake. Safe to call often. */
export function connectSocket(): Socket {
  const instance = getSocket()
  if (!instance.connected && !instance.active) instance.connect()
  return instance
}

/** Closes the transport but keeps the singleton + all listeners intact. */
export function disconnectSocket(): void {
  socket?.disconnect()
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false
}
