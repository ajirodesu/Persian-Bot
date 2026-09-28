"""
Cactus Needle 3 service adapter.

Minimal HTTP adapter around the OFFICIAL Needle 3 runtime
(``cactus-needle`` package, generation 3). This process runs as an
independent service (e.g. Render Service B) while Persian-Bot runs as
Render Service A. Persian-Bot communicates with this service over
authenticated HTTPS; the two process lifecycles are never coupled.

Responsibilities (only):
  - authenticate each request (Bearer token, constant-time compare)
  - receive agent input (system prompt + JSON-Schema tool definitions + text)
  - load/use the official ``needle.Needle`` runtime (tools/system/weights)
  - maintain per-session Needle agent state (multi-turn conversation state;
    one ``Needle`` instance per Persian-Bot AI session id)
  - execute exactly ONE Needle turn per request and return the structured
    result verbatim (type / success / error / error_code / function_calls /
    reasoning / confidence / suppressed_calls / validation)

What this adapter deliberately does NOT do:
  - execute Persian-Bot commands (help / test_command / send_result run
    inside Persian-Bot, which owns platforms, permissions and sessions)
  - implement MCP, Skills, LangChain, or any other agent framework/LLM
    (the deployed Needle 3 build supports neither MCP nor Skills; the
    ``/capabilities`` endpoint reports that truthfully)

Needle 3 API actually used (cactus-needle 3.0.1, verified against
``needle/__init__.py`` and ``llms.txt``):
  - ``Needle(tools=[...], system=..., weights=..., tool_index_path=...)``
    where each tool is a raw JSON-Schema dict
    ``{"name", "description", "parameters", "triggers"?}``.
  - ``agent.complete(text="", max_new_tokens=512) -> dict`` — one stateful
    turn. The same instance continues the conversation across calls, which
    is how Persian-Bot drives multi-turn tool execution: it calls
    ``/v1/agent/complete`` with the user text, executes the returned
    ``function_calls`` locally, then calls ``/v1/agent/complete`` again
    with the JSON-encoded tool results.
  - ``agent.reset()`` — clears conversation state for a session.

Endpoints:
  GET  /health          — unauthenticated liveness probe (Render health check)
  GET  /capabilities    — authenticated; real feature detection, never hardcoded
                          on the Persian-Bot side (this service IS the source)
  POST /v1/agent/complete {session_id, system?, tools, input, max_new_tokens?}
  POST /v1/agent/reset    {session_id}
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

try:
    import needle as needle_pkg
    from needle import Needle as _Needle

    NEEDLE_VERSION = getattr(needle_pkg, "__version__", "unknown")
    NEEDLE_AVAILABLE = True
    NEEDLE_IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover - import failure path
    _Needle = None  # type: ignore[assignment]
    NEEDLE_VERSION = "unavailable"
    NEEDLE_AVAILABLE = False
    NEEDLE_IMPORT_ERROR = str(exc)


# ---------------------------------------------------------------------------
# Configuration (environment only; never committed)
# ---------------------------------------------------------------------------

def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name, default)
    return value.strip()


AUTH_TOKEN = _env("NEEDLE_AUTH_TOKEN")
WEIGHTS_PATH = _env("NEEDLE_WEIGHTS_PATH")  # optional tuned .cact weights file
TOOL_INDEX_PATH = _env("NEEDLE_TOOL_INDEX_PATH")  # optional retrieval index path
HOST = _env("NEEDLE_HOST", "0.0.0.0")
PORT = int(_env("NEEDLE_PORT", _env("PORT", "8787")) or 8787)
GENERATION = int(_env("NEEDLE_GENERATION", "3") or 3)
MAX_NEW_TOKENS = int(_env("NEEDLE_MAX_NEW_TOKENS", "512") or 512)
SESSION_TTL_SECONDS = int(_env("NEEDLE_SESSION_TTL_SECONDS", "1800") or 1800)

SERVICE_STARTED_AT = time.time()

# ---------------------------------------------------------------------------
# Session state: one official Needle instance per Persian-Bot AI session id.
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_sessions: dict[str, dict] = {}


def _now() -> float:
    return time.time()


def _prune_sessions() -> None:
    now = _now()
    expired = [
        sid
        for sid, entry in _sessions.items()
        if now - entry["last_used"] > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        entry = _sessions.pop(sid, None)
        try:
            if entry is not None:
                entry["agent"].close()
        except Exception:
            pass


def _tools_fingerprint(tools: object) -> str:
    raw = json.dumps(tools, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_or_create_agent(session_id: str, system: str, tools: list):
    """Return the stateful Needle instance for a session.

    A new instance is created when the session is unknown/expired or when
    the (system, tools) contract changed; otherwise the existing instance
    keeps its multi-turn conversation state.
    """
    if not NEEDLE_AVAILABLE or _Needle is None:
        raise RuntimeError(
            "Needle runtime unavailable"
            + (f": {NEEDLE_IMPORT_ERROR}" if NEEDLE_IMPORT_ERROR else "")
        )
    fingerprint = hashlib.sha256(
        (system + "\n" + _tools_fingerprint(tools)).encode("utf-8")
    ).hexdigest()
    with _lock:
        _prune_sessions()
        entry = _sessions.get(session_id)
        if entry is not None and entry["fingerprint"] == fingerprint:
            entry["last_used"] = _now()
            return entry["agent"]
        if entry is not None:
            try:
                entry["agent"].close()
            except Exception:
                pass
        kwargs: dict = {
            "tools": tools,
            "generation": GENERATION,
        }
        if system:
            kwargs["system"] = system
        if WEIGHTS_PATH:
            kwargs["weights"] = WEIGHTS_PATH
        if TOOL_INDEX_PATH:
            kwargs["tool_index_path"] = TOOL_INDEX_PATH
        agent = _Needle(**kwargs)
        _sessions[session_id] = {
            "agent": agent,
            "fingerprint": fingerprint,
            "last_used": _now(),
        }
        return agent


def _reset_session(session_id: str) -> bool:
    with _lock:
        entry = _sessions.get(session_id)
        if entry is None:
            return False
        try:
            entry["agent"].reset()
        except Exception:
            pass
        entry["last_used"] = _now()
        return True


def _capabilities() -> dict:
    """Real capability detection for THIS service build.

    MCP / Skills: the deployed cactus-needle 3.0.1 runtime exposes no MCP
    client/server, no MCP transport, and no Skills system (zero ``mcp`` /
    ``skill`` symbols in the package). They are therefore reported as
    unsupported — never faked.
    """
    return {
        "toolCalling": NEEDLE_AVAILABLE,
        "mcp": False,
        "skills": False,
        "mcpReason": "Not supported by this Needle 3 build",
        "skillsReason": "Not supported by this Needle 3 build",
        "generation": GENERATION,
        "needleVersion": NEEDLE_VERSION,
        "runtimeAvailable": NEEDLE_AVAILABLE,
    }


# ---------------------------------------------------------------------------
# HTTP layer (stdlib only)
# ---------------------------------------------------------------------------

JSON_HEADERS = (("Content-Type", "application/json"),)


def _read_json(handler: BaseHTTPRequestHandler, limit: int = 4 * 1024 * 1024):
    length_header = handler.headers.get("Content-Length")
    try:
        length = int(length_header) if length_header else 0
    except ValueError:
        length = 0
    if length <= 0 or length > limit:
        return None, "empty or oversized request body"
    try:
        raw = handler.rfile.read(length)
        return json.loads(raw.decode("utf-8")), None
    except Exception as exc:
        return None, f"malformed JSON body: {exc}"


class _Handler(BaseHTTPRequestHandler):
    server_version = "NeedleService/1.0"

    def log_message(self, fmt, *args):  # keep logs free of secrets
        pass

    # -- helpers ---------------------------------------------------------
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        for key, value in JSON_HEADERS:
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self) -> bool:
        if not AUTH_TOKEN:
            return False
        presented = (self.headers.get("Authorization") or "").strip()
        if not presented.lower().startswith("bearer "):
            return False
        candidate = presented[7:].strip()
        return hmac.compare_digest(candidate, AUTH_TOKEN)

    def _require_auth(self) -> bool:
        if not AUTH_TOKEN:
            self._send(
                503,
                {"error": "service has no NEEDLE_AUTH_TOKEN configured"},
            )
            return False
        if not self._authed():
            self._send(401, {"error": "unauthorized"})
            return False
        return True

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._send(
                200,
                {
                    "status": "ok" if NEEDLE_AVAILABLE else "degraded",
                    "needleVersion": NEEDLE_VERSION,
                    "generation": GENERATION,
                    "runtimeAvailable": NEEDLE_AVAILABLE,
                    "uptimeSeconds": int(_now() - SERVICE_STARTED_AT),
                },
            )
            return
        if path == "/capabilities":
            if not self._require_auth():
                return
            self._send(200, _capabilities())
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/agent/complete":
            if not self._require_auth():
                return
            body, err = _read_json(self)
            if err is not None:
                self._send(400, {"error": err})
                return
            assert isinstance(body, dict)
            session_id = str(body.get("session_id") or "").strip()
            system = str(body.get("system") or "")
            tools = body.get("tools")
            needle_input = body.get("input")
            try:
                max_new_tokens = int(body.get("max_new_tokens") or MAX_NEW_TOKENS)
            except (TypeError, ValueError):
                self._send(400, {"error": "max_new_tokens must be an integer"})
                return
            if not session_id:
                self._send(400, {"error": "session_id is required"})
                return
            if not isinstance(tools, list) or len(tools) == 0:
                self._send(400, {"error": "tools must be a non-empty array"})
                return
            if not isinstance(needle_input, str):
                self._send(400, {"error": "input must be a string"})
                return
            try:
                agent = _get_or_create_agent(session_id, system, tools)
                # ONE official Needle turn. The returned dict already has the
                # documented shape (type/success/error/function_calls/
                # reasoning/confidence/suppressed_calls/validation) and is
                # forwarded verbatim — never reshaped or invented.
                result = agent.complete(
                    needle_input, max_new_tokens=max_new_tokens
                )
            except RuntimeError as exc:
                self._send(503, {"error": str(exc)})
                return
            except Exception as exc:
                self._send(502, {"error": f"needle execution failed: {exc}"})
                return
            if not isinstance(result, dict):
                self._send(502, {"error": "malformed needle response"})
                return
            self._send(200, {"result": result})
            return
        if path == "/v1/agent/reset":
            if not self._require_auth():
                return
            body, err = _read_json(self)
            if err is not None:
                self._send(400, {"error": err})
                return
            assert isinstance(body, dict)
            session_id = str(body.get("session_id") or "").strip()
            if not session_id:
                self._send(400, {"error": "session_id is required"})
                return
            self._send(200, {"reset": _reset_session(session_id)})
            return
        self._send(404, {"error": "not found"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), _Handler)
    print(f"[needle-service] listening on {HOST}:{PORT} (gen {GENERATION})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
