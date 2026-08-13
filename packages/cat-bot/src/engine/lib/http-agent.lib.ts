/**
 * Global HTTP/HTTPS Keep-Alive Agents
 *
 * Side-effect import (engine/app.ts) — sets process-wide keep-alive agents on
 * axios before any command module loads, so all outbound requests reuse pooled
 * sockets instead of paying a fresh TCP+TLS handshake per call.
 */
import http from 'http';
import https from 'https';
import dns from 'dns';
import axios from 'axios';

const keepAliveHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

axios.defaults.httpAgent = keepAliveHttpAgent;
axios.defaults.httpsAgent = keepAliveHttpsAgent;
// 'lifo' reuses the most recently used (already-warm) socket first under bursty traffic.
// `scheduling` is a real Node ≥14.5 option but missing from @types/node — cast required.
(keepAliveHttpAgent as unknown as { scheduling: string }).scheduling = 'lifo';
(keepAliveHttpsAgent as unknown as { scheduling: string }).scheduling = 'lifo';

// Fail fast on stalled external APIs; individual commands may override per-call.
axios.defaults.timeout = 10_000;

// In-memory DNS cache: avoids re-resolving the same handful of media/API hosts on
// every request. TTL of 5 min picks up DNS changes while skipping most redundant lookups.
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
type DnsCacheEntry = { address: string; family: number; expiresAt: number };
const dnsCache = new Map<string, DnsCacheEntry>();

function cachedLookup(
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    callback(null, cached.address, cached.family);
    return;
  }
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) { callback(err, '', 0); return; }
    dnsCache.set(hostname, { address, family, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    callback(null, address, family);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(axios.defaults as any).lookup = cachedLookup;

// Apply to Node's global agents so native http/https users get the same benefit.
// `keepAlive` is writable at runtime but typed read-only in @types/node — cast required.
type MutableAgentOptions = { keepAlive: boolean; maxSockets: number };
(http.globalAgent as unknown as MutableAgentOptions).keepAlive = true;
(http.globalAgent as unknown as MutableAgentOptions).maxSockets = 256;
(https.globalAgent as unknown as MutableAgentOptions).keepAlive = true;
(https.globalAgent as unknown as MutableAgentOptions).maxSockets = 256;
