/**
 * Discord Platform — Client Factory
 *
 * Single responsibility: create, configure, and boot the Discord.js Client.
 * All gateway intent, partial message, login, and process-lifecycle concerns
 * are isolated here so the listener orchestrator never touches transport config.
 *
 * WHY: Extracted from index.ts — a 360-line monolith that mixed client
 * bootstrapping with slash command registration and event handler wiring.
 * Separating client lifecycle makes it testable and replaceable independently.
 */

import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import { isAuthError } from '@/engine/lib/retry.lib.js';

/**
 * Creates a Discord.js Client with all required intents and partials,
 * logs in with the given token, and waits for the ClientReady event.
 *
 * Process signal handlers (SIGINT/SIGTERM) are registered to gracefully
 * destroy the WebSocket connection before exit — prevents zombie connections
 * that would keep the bot "online" in Discord's eyes after Ctrl+C.
 */
export async function createDiscordClient(
  token: string,
  sessionLogger: SessionLogger,
  onFatalError?: (err: Error) => void,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Partials are required so reaction/delete events fire on uncached messages
    // sent before the bot last restarted — without them only cached messages trigger
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  // WHY A TIMEOUT IS REQUIRED: client.login() can hang forever with neither
  // ClientReady nor an error firing — e.g. the WebSocket handshake to Discord's
  // gateway stalls on a flaky/blocked outbound connection. Without a timeout, this
  // bootstrap Promise never settles, so boot() never resolves or rejects,
  // runManagedSession's lock is never released in its `finally`, and every later
  // Start click is met with "start is busy" forever — the session looks stuck
  // rather than actually retrying.
  const LOGIN_TIMEOUT_MS = 30_000;
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sessionLogger.error(
        `[discord] Login timed out after ${LOGIN_TIMEOUT_MS}ms — no ClientReady event received (gateway handshake stalled)`,
      );
      // Best-effort cleanup so a half-connected client isn't leaked before the
      // caller's own cleanup() runs on the next retry attempt.
      client.destroy().catch(() => {});
      reject(new Error('DiscordLoginTimeout'));
    }, LOGIN_TIMEOUT_MS);

    // Events.ClientReady avoids raw strings that could rename between discord.js versions
    client.once(Events.ClientReady, (c) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sessionLogger.info(`[discord] Logged in as ${c.user.tag}`);
      resolve();
    });
    // Reject the bootstrap Promise on login failure so startSessionWithRetry can classify
    // the error: TokenInvalid → shouldRetry returns false → immediate fail (no retries).
    client.login(token).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });

  // discord.js emits 'error' on WebSocket failures and unhandled REST errors.
  // Without this listener, Node.js treats an emitted 'error' with no handler as a
  // fatal exception that terminates the entire process — taking all other platforms down too.
  // discord.js manages gateway reconnection internally, so we only need to absorb the event.
  client.on('error', (err: Error) => {
    if (isAuthError(err)) {
      // Pass authentication drops up to the orchestrator to sync UI
      sessionLogger.error(
        '[discord] Session offline — token revoked or auth error mid-session',
        { error: err },
      );
      onFatalError?.(err);
    } else {
      sessionLogger.error(
        '[discord] Client error (gateway will auto-reconnect)',
        { error: err },
      );
    }
  });

  return client;
}
