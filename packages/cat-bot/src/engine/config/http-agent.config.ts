/**
 * Global HTTP Keep-Alive Bootstrap
 *
 * WHY THIS EXISTS:
 * Nearly every command module (shoti.ts, rankup.ts, download.ts, bluearchive.ts,
 * and ~20 others) calls `axios.get(url)` directly against third-party free-API
 * providers (see engine/lib/apis.lib.ts) to fetch media/data on every single
 * command invocation. Node's `http`/`https` modules default their global agents
 * to `keepAlive: false`, which means every one of those requests — and every
 * urlToStream() download of an attachment_url — opens a brand new TCP connection
 * and, for HTTPS, a brand new TLS handshake, even when the bot is talking to the
 * exact same host (e.g. Aqua API, Discord CDN) it just talked to a second ago.
 * That handshake overhead (commonly 100–300ms, more on slower/geo-distant hosts)
 * is pure latency added to every media response.
 *
 * Setting `keepAlive: true` on Node's global agents makes every axios call in the
 * codebase reuse a pooled, already-negotiated connection to a given host for
 * subsequent requests — with zero changes required in any individual command
 * file, since axios falls back to `http.globalAgent` / `https.globalAgent`
 * whenever a call site doesn't pass its own `httpAgent`/`httpsAgent` option.
 *
 * MUST be imported before any HTTP request is made anywhere in the process —
 * app.ts imports this as its very first local import for that reason.
 */

import http from 'http';
import https from 'https';

http.globalAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 128,
  maxFreeSockets: 32,
});

https.globalAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 128,
  maxFreeSockets: 32,
});
