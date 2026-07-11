/**
 * Global HTTP/HTTPS Keep-Alive Agents
 *
 * Every command module that calls an external API (weather, memes, images, AI, etc.)
 * imports the default `axios` instance directly — there are 270+ command modules and
 * no shared client. Without this module, EVERY outbound axios request opens a brand
 * new TCP socket (and, for HTTPS, redoes the full TLS handshake) because Node's
 * default agents do not reuse connections. That adds 50-300ms of pure connection
 * setup latency on top of the actual API round-trip for every single command that
 * hits an external API — directly inflating perceived bot response time ("ping").
 *
 * Importing this module once at boot (side-effect import in engine/app.ts, before any
 * command module is loaded) sets process-wide keep-alive agents as the axios defaults.
 * Every axios.get/post call across every command module then reuses pooled sockets to
 * the same host instead of paying the handshake cost on every invocation — with zero
 * changes required in any of the 270+ command files.
 *
 * `maxSockets`/`maxFreeSockets` are set generously — Cat-Bot fans out many concurrent
 * command invocations across users/platforms, so the pool must not become a new
 * bottleneck under load.
 */
import http from 'http';
import https from 'https';
import dns from 'dns';
import axios from 'axios';

export const keepAliveHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

export const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

// Applied as axios's process-wide defaults — every module that does `import axios from
// 'axios'` shares this same singleton instance, so this configuration is global.
axios.defaults.httpAgent = keepAliveHttpAgent;
axios.defaults.httpsAgent = keepAliveHttpsAgent;
// Sockets are pooled per-host with 'lifo' so the most recently used (already-warm) socket
// is reused first under bursty traffic, instead of round-robining across the whole pool and
// letting idle sockets expire — fewer new connections need to be opened under load.
// `scheduling` is a real, documented http.Agent constructor option (Node ≥14.5) but is not
// yet reflected as a settable property in the bundled @types/node Agent interface.
(keepAliveHttpAgent as unknown as { scheduling: string }).scheduling = 'lifo';
(keepAliveHttpsAgent as unknown as { scheduling: string }).scheduling = 'lifo';

// Fail fast on genuinely stalled external APIs — a hung request would otherwise sit for
// however long axios lets it, blocking that user's command indefinitely instead of just
// erroring out with a clear timeout. Individual commands may still override this per-call.
axios.defaults.timeout = 10_000;

/**
 * Tiny in-memory DNS cache (TTL-bounded) shared by every axios call. Node's default
 * `dns.lookup` re-resolves the hostname on every single request — for the same handful
 * of media/API hosts hit repeatedly (imgur, popcat, etc.) that's a wasted resolver
 * round-trip on top of the request itself. Caching hostnames for a few minutes removes
 * that lookup entirely on warm hosts while still picking up DNS changes periodically.
 */
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
type DnsCacheEntry = { address: string; family: number; expiresAt: number };
const dnsCache = new Map<string, DnsCacheEntry>();

function cachedLookup(
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
): void {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    callback(null, cached.address, cached.family);
    return;
  }
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) {
      callback(err, '', 0);
      return;
    }
    dnsCache.set(hostname, {
      address,
      family,
      expiresAt: Date.now() + DNS_CACHE_TTL_MS,
    });
    callback(null, address, family);
  });
}

// `lookup` is a real axios/Node http(s).request option (forwarded straight through to
// Node's connection logic), but the bundled axios/@types/node overload signatures don't
// line up with our simplified single-address callback shape — cast through `any` at the
// assignment boundary only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(axios.defaults as any).lookup = cachedLookup;

// Also set Node's own global agents so any command using the native `http`/`https`
// modules (or third-party libs that default to the global agent) gets the same benefit.
// `keepAlive` is a real, writable runtime property on Agent (set from constructor options)
// but is typed read-only in @types/node — the cast below only bypasses the type checker,
// not any actual restriction.
type MutableAgentOptions = { keepAlive: boolean; maxSockets: number };
(http.globalAgent as unknown as MutableAgentOptions).keepAlive = true;
(http.globalAgent as unknown as MutableAgentOptions).maxSockets = 256;
(https.globalAgent as unknown as MutableAgentOptions).keepAlive = true;
(https.globalAgent as unknown as MutableAgentOptions).maxSockets = 256;
