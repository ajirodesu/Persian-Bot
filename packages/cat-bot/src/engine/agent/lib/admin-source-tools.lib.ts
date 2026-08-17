/**
 * AI Agent — Admin Source Tools (shared core)
 *
 * Backs the `admin_*` MCP tools that manage bot source code. Every operation
 * is locked down three ways:
 *
 *   1. ADMIN-GATED — only registered system administrators may invoke them.
 *      Authorization is checked against the system-admin set for the sender
 *      and FAILS CLOSED: an auth-check error (or missing sender ID) is a
 *      denial, never an allow.
 *
 *   2. SCOPE-LOCKED — command edits may touch ONLY files inside
 *      `packages/cat-bot/src/app/commands` (the "commands folder"), and API
 *      edits ONLY the free-API registry file
 *      `packages/cat-bot/src/engine/lib/apis.lib.ts` ("api/lib"). No other
 *      path in the repository can be read or written through these tools.
 *
 *   3. WORKING-TREE ONLY — writes never stage, commit, or push. The admin
 *      panel's Git tab drives the explicit stage → commit → push workflow.
 *
 * Capability contract: when an operation genuinely cannot be carried out
 * (scope violation, unresolved repository, unrecognised file layout, content
 * that is not a valid command module), the tool replies that it cannot handle
 * the request and instructs the user to try again with a higher-capability AI
 * model — see cannotHandle(). Ordinary recoverable mistakes (file not found,
 * already exists, bad argument format) return plain, actionable errors.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getRepoRootOrThrow } from '@/server/lib/local-git.lib.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { resolveAgentContext } from '../agent.util.js';
import type { ToolContext } from '../agent-tool.types.js';

// ── Scope ─────────────────────────────────────────────────────────────────────
// The ONLY filesystem locations these tools may touch, expressed as
// repository-relative paths — the same namespace the Admin File Manager uses.
// The examples folder is READ-ONLY reference material for command generation
// (never written to); command writes are locked to COMMANDS_REPO_DIR and API
// edits to APIS_REPO_FILE.
export const COMMANDS_REPO_DIR = 'packages/cat-bot/src/app/commands';
export const APIS_REPO_FILE = 'packages/cat-bot/src/engine/lib/apis.lib.ts';
export const EXAMPLES_COMMANDS_DIR = 'packages/cat-bot/examples/commands';

const MAX_WRITE_BYTES = 256 * 1024;
const MAX_READ_BYTES = 64 * 1024;

// ── Admin gate ────────────────────────────────────────────────────────────────

/** Uniform refusal shown to anyone who is not a registered system admin. */
export const ADMIN_ONLY_REFUSAL =
  '⛔ This tool is restricted to system administrators. ' +
  'Only a registered system admin may manage bot source code.';

/**
 * Returns a refusal message when the sender is NOT a system admin, or null
 * when the call may proceed. Fail-closed: missing sender ID or an auth-check
 * error both deny.
 */
export async function requireSystemAdmin(
  ctx: ToolContext,
): Promise<string | null> {
  const { senderID } = resolveAgentContext(ctx);
  if (!senderID) return ADMIN_ONLY_REFUSAL;
  try {
    return (await isSystemAdmin(senderID)) ? null : ADMIN_ONLY_REFUSAL;
  } catch {
    return ADMIN_ONLY_REFUSAL;
  }
}

// ── Capability messaging ──────────────────────────────────────────────────────

/**
 * The "the AI cannot handle this" reply: names the reason and instructs the
 * user to try again with a higher-capability AI model.
 */
export function cannotHandle(reason: string): string {
  return (
    `I cannot handle this request — ${reason} ` +
    'Please try again using a higher-capability AI model (for example, ' +
    'switch the bot\u2019s configured model to a more capable one in the ' +
    'dashboard under AI Integration).'
  );
}

/** Throws an Error whose message is a full cannotHandle() reply. */
function cannotHandleError(reason: string): Error {
  return new Error(cannotHandle(reason));
}

// ── Path helpers (scope-locked) ───────────────────────────────────────────────

/**
 * Absolute filesystem path for a repository-relative path. Uses the same root
 * resolution as the Admin File Manager (ADMIN_REPO_PATH env or the nearest git
 * checkout). An unresolvable repository is a capability failure, not a user
 * error — reported through cannotHandle().
 */
function absRepoPath(repoPath: string): string {
  let root: string;
  try {
    root = getRepoRootOrThrow();
  } catch (err) {
    throw cannotHandleError(
      err instanceof Error
        ? err.message
        : 'the repository root could not be resolved.',
    );
  }
  return path.join(root, ...repoPath.split('/'));
}

/** Defense in depth: a repo path must sit under the allowed prefix. */
function assertWithinScope(repoPath: string, allowedPrefix: string): void {
  if (repoPath !== allowedPrefix && !repoPath.startsWith(allowedPrefix + '/')) {
    throw cannotHandleError(
      `that file (${repoPath}) is outside the permitted scope of this tool.`,
    );
  }
}

// ── Command file scope ────────────────────────────────────────────────────────

const COMMAND_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.ts$/;

/**
 * Validates a command filename and returns its repository-relative path. The
 * result is always `${COMMANDS_REPO_DIR}/${filename}` — construction, not
 * trust, is what keeps the write inside the commands folder.
 */
export function commandRepoPath(filename: string): string {
  const name = String(filename ?? '').trim();
  if (!COMMAND_FILE_RE.test(name)) {
    throw new Error(
      `Invalid command filename "${name}" — must be a single .ts file name ` +
        '(letters, digits, hyphens and underscores only; no slashes, no path traversal).',
    );
  }
  return `${COMMANDS_REPO_DIR}/${name}`;
}

// ── File I/O (scoped) ─────────────────────────────────────────────────────────

/** Lists the .ts files in the commands folder (sorted). */
export async function listCommandFiles(): Promise<string[]> {
  let names: string[];
  try {
    names = await fsp.readdir(absRepoPath(COMMANDS_REPO_DIR));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw cannotHandleError(
        `the commands folder (${COMMANDS_REPO_DIR}) does not exist in this checkout.`,
      );
    }
    throw err;
  }
  return names.filter((n) => n.endsWith('.ts')).sort();
}

/** Reads a scoped file, bounded to MAX_READ_BYTES. */
async function readScopedFile(
  repoPath: string,
  allowedPrefix: string,
): Promise<string> {
  assertWithinScope(repoPath, allowedPrefix);
  const abs = absRepoPath(repoPath);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new Error(`File not found: ${repoPath}`);
  }
  if (stat.isDirectory()) {
    throw new Error(`${repoPath} is a folder, not a file`);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(
      `File is too large to read through this tool (${stat.size} bytes > ${MAX_READ_BYTES} limit).`,
    );
  }
  return fsp.readFile(abs, 'utf8');
}

/** Reads a scoped file inside the commands folder. */
export async function readRepoFile(repoPath: string): Promise<string> {
  return readScopedFile(repoPath, COMMANDS_REPO_DIR);
}

// ── Command examples (read-only reference) ────────────────────────────────────

const EXAMPLE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.ts$/;

/**
 * Validates an example filename and returns its repo path. Construction keeps
 * the path inside the examples folder — and examples are READ-ONLY: there is
 * no write path that accepts these paths.
 */
export function exampleCommandRepoPath(filename: string): string {
  const name = String(filename ?? '').trim();
  if (!EXAMPLE_FILE_RE.test(name)) {
    throw new Error(
      `Invalid example filename "${name}" — must be a single .ts file name (no slashes).`,
    );
  }
  return `${EXAMPLES_COMMANDS_DIR}/${name}`;
}

/** Lists the reference command examples in examples/commands (sorted). */
export async function listExampleCommands(): Promise<string[]> {
  let names: string[];
  try {
    names = await fsp.readdir(absRepoPath(EXAMPLES_COMMANDS_DIR));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `The examples folder (${EXAMPLES_COMMANDS_DIR}) does not exist in this checkout.`,
        { cause: err },
      );
    }
    throw err;
  }
  return names.filter((n) => n.endsWith('.ts')).sort();
}

/** Reads a command example from examples/commands (reference templates). */
export async function readExampleCommand(filename: string): Promise<string> {
  return readScopedFile(
    exampleCommandRepoPath(filename),
    EXAMPLES_COMMANDS_DIR,
  );
}

/**
 * Writes a scoped file. `create: true` creates a new file (fails when it
 * exists); `create: false` overwrites an existing file (fails when missing).
 */
export async function writeRepoFile(
  repoPath: string,
  content: string,
  create: boolean,
): Promise<void> {
  assertWithinScope(repoPath, COMMANDS_REPO_DIR);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(
      `Content is too large to write (${bytes} bytes > ${MAX_WRITE_BYTES} limit).`,
    );
  }
  const abs = absRepoPath(repoPath);
  if (create) {
    try {
      await fsp.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Already exists: ${repoPath} — use admin_edit_command to modify it.`,
          { cause: err },
        );
      }
      throw err;
    }
  } else {
    try {
      await fsp.access(abs);
    } catch {
      throw new Error(
        `File not found: ${repoPath} — use admin_add_command to create it.`,
      );
    }
    await fsp.writeFile(abs, content, 'utf8');
  }
}

/** Deletes a scoped file. */
export async function deleteRepoFile(repoPath: string): Promise<void> {
  assertWithinScope(repoPath, COMMANDS_REPO_DIR);
  try {
    await fsp.rm(absRepoPath(repoPath), { force: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${repoPath}`, { cause: err });
    }
    throw err;
  }
}

// ── Command module validation ─────────────────────────────────────────────────

/**
 * Light structural check that content is a plausible command module: it must
 * export `meta` (CommandMeta) or a multi-command `commands` array, and carry
 * an `onCommand`/`onChat` handler. Catching obviously invalid modules here is
 * a capability check — if the model produced something that cannot be a
 * command, the tool says it cannot handle the task and advises a
 * higher-capability model.
 */
export function assertCommandModuleContent(
  content: string,
  filename: string,
): void {
  const hasMeta =
    /\bexport\s+const\s+meta\b/.test(content) ||
    /\bexport\s+const\s+commands\b/.test(content);
  const hasHandler = /\bonCommand\b/.test(content) || /\bonChat\b/.test(content);
  if (!hasMeta || !hasHandler) {
    throw cannotHandleError(
      `"${filename}" is not a valid command module — a command file must export ` +
        '`meta` (CommandMeta: name, version, role, author, description, usage, ' +
        'cooldown) and an `onCommand` (or `onChat`) handler. The model could not ' +
        'produce a valid command module for this task.',
    );
  }
}

// ── Deployment / save guidance ────────────────────────────────────────────────

export type HostingPlatform = 'render' | 'railway' | 'other';

/**
 * Detects where the bot is hosted from well-known platform env vars. Render
 * sets `RENDER=true` on every service; Railway sets `RAILWAY_*` vars. Anything
 * else is treated as self-hosted / other.
 */
export function detectHostingPlatform(): HostingPlatform {
  if (
    process.env['RENDER'] ||
    process.env['RENDER_INSTANCE_ID'] ||
    process.env['RENDER_SERVICE_ID']
  ) {
    return 'render';
  }
  if (
    process.env['RAILWAY_PROJECT_ID'] ||
    process.env['RAILWAY_PUBLIC_DOMAIN'] ||
    process.env['RAILWAY_SERVICE_NAME'] ||
    process.env['RAILWAY_PROJECT_NAME']
  ) {
    return 'railway';
  }
  return 'other';
}

/**
 * Save-guidance appended after a successful admin edit. On Render/Railway the
 * working-tree changes only reach the deployed bot after an explicit push, so
 * the AI relays the exact dashboard navigation path (Admin Dashboard > Files >
 * Git > Push). Everywhere else it falls back to the generic git workflow hint.
 */
export function saveChangesHint(): string {
  const platform = detectHostingPlatform();
  if (platform === 'render' || platform === 'railway') {
    return (
      `To save these changes on ${platform === 'render' ? 'Render' : 'Railway'}: ` +
      'open the Admin Dashboard, go to Files > Git, and click Push. ' +
      'Changes are not committed or deployed automatically.'
    );
  }
  return (
    'Nothing was committed or pushed: use the admin panel Files > Git tab to ' +
    'stage, commit, and push these changes.'
  );
}

// ── Free-API registry (apis.lib.ts) ───────────────────────────────────────────

/** One entry of the `APIs` registry in apis.lib.ts. */
export interface ApiRegistryEntry {
  name: string;
  baseURL: string;
  apiKey?: string;
}

const API_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Validates a registry key (lowercase letters, digits, underscores). */
export function validateApiName(name: string): string {
  const n = String(name ?? '').trim();
  if (!API_NAME_RE.test(n)) {
    throw new Error(
      `Invalid API name "${n}" — use lowercase letters, digits and underscores only (e.g. 'myapi').`,
    );
  }
  return n;
}

/** Validates an absolute http(s) base URL. */
export function validateApiBaseURL(url: string): string {
  const u = String(url ?? '').trim();
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('not http(s)');
    }
  } catch {
    throw new Error(
      `Invalid base URL "${u}" — must be an absolute http(s) URL, e.g. 'https://api.example.com'.`,
    );
  }
  return u;
}

/** Detects the file's dominant line ending so edits preserve it. */
function normalizeEol(
  content: string,
): { text: string; eol: '\n' | '\r\n' } {
  const crlf = content.match(/\r\n/g)?.length ?? 0;
  const lf = content.match(/(?<!\r)\n/g)?.length ?? 0;
  return { text: content.replace(/\r\n/g, '\n'), eol: crlf > lf ? '\r\n' : '\n' };
}

const REGISTRY_BLOCK_START = 'export const APIs = {';

/** Parses the `APIs` registry block into { name, baseURL, apiKey? } entries. */
export function parseApisRegistry(content: string): ApiRegistryEntry[] {
  const text = content.replace(/\r\n/g, '\n');
  const entries: ApiRegistryEntry[] = [];
  const re = /^ {2}([a-z0-9_]+):\s*\{([^}]*)\},?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[2] ?? '';
    const baseURL = /baseURL:\s*'([^']*)'/.exec(body)?.[1] ?? '';
    const apiKey = /APIKey:\s*'([^']*)'/.exec(body)?.[1];
    const entry: ApiRegistryEntry = { name: m[1]!, baseURL };
    if (apiKey) entry.apiKey = apiKey;
    entries.push(entry);
  }
  return entries;
}

/**
 * Inserts a new provider into the `APIs` registry. Returns the updated file
 * content (original line endings preserved). Throws when the registry layout
 * is unrecognisable (a capability failure) or the name already exists.
 */
export function addApiRegistryEntry(
  content: string,
  name: string,
  baseURL: string,
  apiKey?: string,
): string {
  const { text, eol } = normalizeEol(content);
  const start = text.indexOf(REGISTRY_BLOCK_START);
  if (start === -1) {
    throw cannotHandleError(
      'the free-API registry in apis.lib.ts no longer matches the expected layout.',
    );
  }
  const close = text.indexOf('\n} as const', start + REGISTRY_BLOCK_START.length);
  if (close === -1) {
    throw cannotHandleError(
      'the free-API registry in apis.lib.ts no longer matches the expected layout.',
    );
  }
  if (parseApisRegistry(text).some((e) => e.name === name)) {
    throw new Error(`API "${name}" is already registered.`);
  }
  const entry =
    `  ${name}: {\n` +
    `    baseURL: '${baseURL}',\n` +
    (apiKey ? `    APIKey: '${apiKey}',\n` : '') +
    `  },\n`;
  const updated = text.slice(0, close + 1) + entry + text.slice(close + 1);
  return updated.replace(/\n/g, eol);
}

/**
 * Removes a provider from the `APIs` registry. Returns the updated file
 * content (original line endings preserved). Throws when not registered.
 */
export function removeApiRegistryEntry(
  content: string,
  name: string,
): string {
  const { text, eol } = normalizeEol(content);
  const re = new RegExp(`^  ${name}: \\{[^}]*\\},?\\n`, 'gm');
  if (!re.test(text)) {
    throw new Error(`API "${name}" is not registered in the APIs registry.`);
  }
  return text.replace(re, '').replace(/\n/g, eol);
}
