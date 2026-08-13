/**
 * Fluxer Platform — Client Factory
 *
 * Single responsibility: create, configure, and boot the @fluxerjs/core Client.
 * All gateway, login, and process-lifecycle concerns are isolated here so the
 * listener orchestrator never touches transport config.
 *
 * WHY: Mirrors discord/client.ts so each platform owns its own bootstrap and the
 * orchestrator stays transport-agnostic.
 */

import { Client, Events } from '@fluxerjs/core';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js';
import { isAuthError } from '@/engine/lib/retry.lib.js';

/**
 * Creates a @fluxerjs/core Client, logs in with the given token, and waits for
 * the Ready event.
 *
 * Process signal handlers are NOT registered here — the orchestrator (index.ts)
 * calls client.destroy() on stop, and the SDK reconnects automatically on
 * gateway drops.
 */
export async function createFluxerClient(
  token: string,
  sessionLogger: SessionLogger,
  onFatalError?: (err: Error) => void,
): Promise<Client> {
  const client = new Client();

  await new Promise<void>((resolve, reject) => {
    // Events.Ready avoids raw strings that could rename between SDK versions
    client.once(Events.Ready, () => {
      sessionLogger.info(
        `[fluxer] Logged in as ${client.user?.username ?? ''}`,
      );
      resolve();
    });
    // Reject the bootstrap Promise on login failure so the retry loop can classify
    // the error: TokenInvalid → shouldRetry returns false → immediate fail (no retries).
    client.login(token).catch(reject);
  });

  // The SDK emits 'error' on WebSocket failures and unhandled REST errors.
  // Without this listener, Node.js treats an emitted 'error' with no handler as a
  // fatal exception that terminates the entire process — taking all other platforms down too.
  // The SDK manages gateway reconnection internally, so we only need to absorb the event.
  client.on('error', (err: Error) => {
    if (isAuthError(err)) {
      // Pass authentication drops up to the orchestrator to sync UI
      sessionLogger.error(
        '[fluxer] Session offline — token revoked or auth error mid-session',
        { error: err },
      );
      onFatalError?.(err);
    } else {
      sessionLogger.error(
        '[fluxer] Client error (gateway will auto-reconnect)',
        { error: err },
      );
    }
  });

  return client;
}