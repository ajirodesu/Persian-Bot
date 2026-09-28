# Cactus Needle 3 service (separate host)

This directory is **Service B**. Persian-Bot (`packages/cat-bot`) is **Service A**.
Needle 3 is the only AI engine; Persian-Bot decides and executes, Needle 3 only
decides *which tool call* to make.

## Runtime actually used

- Package: `cactus-needle==3.0.1` (generation 3 engine)
- Public API used (verified against `needle/__init__.py`, `needle/agent/tools.py`,
  `llms.txt` in [`cactus-compute/needle`](https://github.com/cactus-compute/needle)):
  - `Needle(tools=[...], system=..., weights=..., tool_index_path=...)`
  - `agent.complete(text, max_new_tokens) -> dict`
  - `agent.reset()` / `agent.close()`
- Response shape forwarded verbatim: `type / success / error / error_code /
  function_calls / reasoning / confidence / suppressed_calls / validation`.
  Empty `function_calls` = legitimate refusal/off-topic state.
- Tool retrieval for large toolsets happens **engine-side** (built-in retrieval
  head renders top-5 per turn when `len(tools) > 5`); there is no Python-level
  retrieval API to call, so Persian-Bot simply sends the full allowed catalogue
  and lets the engine select.
- The Python package ships **no serving mode** (only a local `needle playground`
  demo server and the native prebuilt-engine `--serve` flag). `app.py` is the
  small stdlib-only HTTP adapter that exposes the exact contract Persian-Bot
  needs. No LangChain, no second LLM, no extra framework.

## Capability truth table (detected, not assumed)

| Capability  | Supported by this build |
| ----------- | ----------------------- |
| Tool calling (JSON Schema tools, multi-turn, confidence, suppressed calls) | Yes |
| MCP | **No** — no MCP symbols exist in cactus-needle 3.0.1 |
| Skills | **No** — no Skills system exists in cactus-needle 3.0.1 |

`GET /capabilities` returns this table live; the Persian-Bot dashboard renders
MCP / Skills as "Not supported by this Needle 3 build".

## Run locally

```bash
cd needle-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
NEEDLE_AUTH_TOKEN=dev-secret python3 app.py
# health: curl localhost:8787/health
```

## Test (no weights required — runtime is stubbed)

```bash
cd needle-service
python3 test_adapter.py
```

## Environment

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `NEEDLE_AUTH_TOKEN` | yes (prod) | Bearer secret; must match Persian-Bot `NEEDLE_AUTH_TOKEN` |
| `NEEDLE_HOST` / `NEEDLE_PORT` (`PORT`) | no | Bind address (default `0.0.0.0:8787`) |
| `NEEDLE_GENERATION` | no | `3` (default) |
| `NEEDLE_WEIGHTS_PATH` | no | Tuned `.cact` weights file (generation auto-detected by the runtime) |
| `NEEDLE_TOOL_INDEX_PATH` | no | Retrieval index persistence path (passed to `Needle`) |
| `NEEDLE_MAX_NEW_TOKENS` | no | Default `512` |
| `NEEDLE_SESSION_TTL_SECONDS` | no | Per-session instance TTL (default `1800`) |

## Deploy

See `render.yaml` / `Dockerfile`. Set `NEEDLE_AUTH_TOKEN` as a secret on both
services. Persian-Bot `Test Connection` performs a real authenticated
`GET /capabilities` call — state is never faked.
