/**
 * Built-in AI tools, adapted to Persian-Bot / Fluxer.
 *
 * The command catalog stays dynamic: `list_commands` searches the live
 * commandRegistry (never pasted into the prompt). Command execution follows
 * the upstream Cat-Bot preview model: `test_command` silently executes
 * commands against a mock proxy so the agent sees the FULL output (text,
 * URL/file attachments, buttons) before anything reaches the chat, then
 * `send_result` delivers one synthesized message merging the stored
 * payloads. Cooldowns are never consumed by previews; all other guards
 * (bans, roles, toggles, platform, maintenance, admin-only) apply.
 *
 * Tools: list_commands, test_command, send_result, get_context,
 *        remember_fact, get_server_info, list_servers.
 *
 * Portions derived from Reze-Bot (MIT) and Cat-Bot (ISC, agent/tools):
 *   https://github.com/GrandpaEJx/Reze-Bot
 *   https://github.com/johnlester-0369/Cat-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { registerTool, type ToolResult } from './tools.js';
import { commandRegistry } from '@/engine/lib/module-registry.lib.js';
import { getProfile } from './memory.js';
import { previewCommands, deliverPreview } from './preview.js';

interface CommandLike {
  meta: {
    name: string;
    aliases?: string[];
    description?: string;
    category?: string;
    usage?: string | string[];
    role?: number;
  };
}

function allCommands(): CommandLike[] {
  const out: CommandLike[] = [];
  const seen = new Set<string>();
  for (const mod of commandRegistry.values()) {
    const meta = (mod as { meta?: CommandLike['meta'] }).meta;
    if (!meta?.name || seen.has(meta.name)) continue;
    seen.add(meta.name);
    out.push({ meta });
  }
  return out;
}

/** Commands the agent may legitimately surface for this caller's role. */
function visibleCommands(role: number): CommandLike[] {
  return allCommands().filter((cmd) => {
    const m = cmd.meta;
    if (!m.name) return false;
    if ((m.category ?? '').toLowerCase() === 'hidden') return false;
    return (m.role ?? 0) <= role;
  });
}

function describe(cmd: CommandLike, prefix: string): string {
  const m = cmd.meta;
  const usage = Array.isArray(m.usage) ? m.usage[0] : m.usage;
  const usageStr = usage ? ` ${usage}` : '';
  const aliases = m.aliases?.length ? ` (aka ${m.aliases.join(', ')})` : '';
  const category = m.category ? ` [${m.category}]` : '';
  return `${prefix}${m.name}${usageStr}${aliases}${category} — ${m.description ?? 'no description'}`;
}

function score(cmd: CommandLike, terms: string[]): number {
  const m = cmd.meta;
  const name = m.name.toLowerCase();
  const aliases = (m.aliases ?? []).map((a) => a.toLowerCase());
  const desc = (m.description ?? '').toLowerCase();
  const cat = (m.category ?? '').toLowerCase();

  let s = 0;
  for (const t of terms) {
    if (name === t || aliases.includes(t)) s += 10;
    else if (name.startsWith(t) || aliases.some((a) => a.startsWith(t))) s += 6;
    else if (name.includes(t) || aliases.some((a) => a.includes(t))) s += 4;
    if (cat === t) s += 3;
    if (desc.includes(t)) s += 2;
  }
  return s;
}

let registered = false;

/** Register every built-in tool exactly once (idempotent). */
export function ensureBuiltins(prefix = '!'): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: 'list_commands',
    description:
      "Search the bot's commands. Use this before test_command when you are not certain a " +
      'command exists or what arguments it takes. Omit the query to see the most common ones.',
    risk: 0,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, e.g. "weather", "image".' },
        limit: { type: 'integer', description: 'How many to return.', default: 8, minimum: 1, maximum: 25 },
      },
      required: [],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const all = visibleCommands(ctx.role);
      if (!all.length) return { ok: false, content: 'No commands are loaded.' };

      const limit = (args.limit as number) ?? 8;
      const query = String(args.query ?? '').trim().toLowerCase();

      if (!query) {
        const sample = all.slice(0, limit).map((c) => describe(c, prefix));
        return {
          ok: true,
          content: `${all.length} commands available to you. A sample:\n${sample.join('\n')}`,
        };
      }

      const terms = query.split(/\s+/).filter(Boolean);
      const ranked = all
        .map((cmd) => ({ cmd, s: score(cmd, terms) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit);

      if (!ranked.length) {
        return {
          ok: true,
          content: `No command matches "${query}". Do not invent one — answer from your own knowledge instead.`,
        };
      }
      return { ok: true, content: ranked.map((x) => describe(x.cmd, prefix)).join('\n') };
    },
  });

  registerTool({
    name: 'test_command',
    description:
      'Silently execute bot commands to preview their full output (text, file ' +
      'attachments, buttons) BEFORE anything reaches the chat. Always use the ' +
      '`commands` array. Returns a `key` plus the captured `calls`, and ' +
      '`attachment_key` / `binary_attachment_key` / `button_key` when the ' +
      'output carries files or buttons. Read the calls, then call ' +
      '`send_result` once to deliver a single synthesized reply. Only use ' +
      'commands you confirmed exist via list_commands.',
    risk: 1,
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: 'Commands to preview in sequence (max 3 per call).',
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command name without the prefix, e.g. "weather".' },
              args: {
                type: 'array',
                description: 'Arguments as separate strings, e.g. ["Manila"].',
                items: { type: 'string' },
              },
            },
            required: ['command'],
          },
        },
      },
      required: ['commands'],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const appCtx = ctx.appCtx;
      if (!appCtx) {
        return { ok: false, content: 'Command preview is unavailable in this context.' };
      }
      if (ctx.aiInitiated === true) {
        return { ok: false, content: 'Recursive command execution is not allowed.' };
      }

      const rawList = Array.isArray(args.commands) ? args.commands : [];
      const cmds: { command: string; args: string[] }[] = [];
      for (const entry of rawList.slice(0, 3)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const command = String((entry as Record<string, unknown>).command ?? '').trim();
        if (!command) continue;
        const rawArgs = (entry as Record<string, unknown>).args;
        const argList = Array.isArray(rawArgs)
          ? rawArgs.map((a) => String(a))
          : typeof rawArgs === 'string'
            ? [rawArgs]
            : [];
        cmds.push({ command, args: argList });
      }
      if (!cmds.length) {
        return { ok: false, content: 'No valid commands given. Pass [{command, args}].' };
      }

      // Role visibility first — never preview commands the user may not run.
      const known = visibleCommands(ctx.role);
      for (const c of cmds) {
        const needle = c.command.toLowerCase();
        const match = known.find(
          (cmd) =>
            cmd.meta.name.toLowerCase() === needle ||
            (cmd.meta.aliases ?? []).some((a) => a.toLowerCase() === needle),
        );
        if (!match) {
          return {
            ok: false,
            content: `No command "${c.command}" is available to this user. Use list_commands to find the right one.`,
          };
        }
      }

      const out = await previewCommands(appCtx, cmds);
      if (!out.ok || !out.key) {
        return { ok: false, content: out.errors.join(' ') || 'Preview failed.' };
      }

      const lines = [
        `Preview key: ${out.key} (${out.callCount} captured call(s))`,
        out.attachmentKey ? `attachment_key: ${out.attachmentKey}` : null,
        out.binaryKey ? `binary_attachment_key: ${out.binaryKey}` : null,
        out.buttonKey ? `button_key: ${out.buttonKey}` : null,
        '',
        'Captured calls:',
        JSON.stringify(out.calls, null, 1).slice(0, 4000),
        ...(out.errors.length > 0 ? ['', `Notes: ${out.errors.join(' ')}`.slice(0, 500)] : []),
        '',
        'Read the calls above, write your reply text, then call send_result ONCE ' +
          'with your message plus any non-null keys. Nothing has been sent to the chat yet.',
      ].filter((l): l is string => l !== null);

      return {
        ok: true,
        content: lines.join('\n'),
        data: {
          key: out.key,
          attachmentKey: out.attachmentKey,
          binaryKey: out.binaryKey,
          buttonKey: out.buttonKey,
        },
      };
    },
  });

  registerTool({
    name: 'send_result',
    description:
      'Deliver ONE unified reply combining your synthesized message text with ' +
      'file attachments and button grids captured by test_command. Pass the ' +
      '`attachment_key` values in `attachment_url`, `binary_attachment_key` ' +
      'values in `attachment`, and `button_key` values in `button`. Keys are ' +
      'single-use. Run all needed test_command calls first, then send once.',
    risk: 1,
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Your synthesized reply text (required). Write it from the captured calls.',
        },
        attachment_url: {
          type: 'array',
          description: 'attachment_key values from test_command (URL files).',
          items: { type: 'string' },
        },
        attachment: {
          type: 'array',
          description: 'binary_attachment_key values from test_command (Buffer files).',
          items: { type: 'string' },
        },
        button: {
          type: 'array',
          description: 'button_key values from test_command.',
          items: { type: 'string' },
        },
      },
      required: ['message'],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const appCtx = ctx.appCtx;
      if (!appCtx) {
        return { ok: false, content: 'Delivery is unavailable in this context.' };
      }
      const message = String(args.message ?? '').trim();
      if (!message) {
        return { ok: false, content: 'Empty message — nothing delivered.' };
      }
      const keys = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      const out = await deliverPreview(appCtx, {
        message,
        attachmentKeys: keys(args.attachment_url),
        binaryKeys: keys(args.attachment),
        buttonKeys: keys(args.button),
      });
      if (!out.ok) return { ok: false, content: out.content };
      return { ok: true, content: out.content, data: { delivered: true } };
    },
  });

  registerTool({
    name: 'get_context',
    description:
      'Current time, server/channel context and who you are speaking to. Use it when the answer ' +
      'depends on the date, the time, or the current conversation setting.',
    risk: 0,
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(_args, ctx): Promise<ToolResult> {
      const profile = getProfile(ctx.senderId);
      const lines = [
        `Time: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`,
        `Platform: ${ctx.platform}`,
        `Chat: ${ctx.isGroup ? 'group/server channel' : 'private'} (id ${ctx.threadId})`,
        `User role level: ${ctx.role}`,
      ];
      if (ctx.chatTitle) lines.push(`Chat title: ${ctx.chatTitle}`);
      if (ctx.userName) lines.push(`User name: ${ctx.userName}`);
      else if (profile?.preferredName || profile?.displayName) {
        lines.push(`User name: ${profile.preferredName ?? profile.displayName}`);
      }
      if (profile?.facts?.length) lines.push(`Known about them: ${profile.facts.join('; ')}`);
      const extra = ctx.extra?.serverInfo;
      if (typeof extra === 'string' && extra.trim()) lines.push(`Server info: ${extra.trim().slice(0, 500)}`);
      return { ok: true, content: lines.join('\n') };
    },
  });

  registerTool({
    name: 'remember_fact',
    description:
      'Store one durable fact about this user, e.g. "Lives in: Manila". Only for things they ' +
      'stated about themselves that are worth recalling later. Never store secrets, credentials, ' +
      'passwords, tokens, or anything they asked you to forget.',
    risk: 1,
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'A short "Label: value" line.' },
      },
      required: ['fact'],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const { getProfile: get, mergeFacts } = await import('./memory.js');
      const fact = String(args.fact ?? '').trim().slice(0, 120);
      if (!fact) return { ok: false, content: 'Empty fact.' };

      const profile = get(ctx.senderId);
      if (!profile) return { ok: false, content: 'No profile store is available.' };

      const before = profile.facts.length;
      mergeFacts(profile, [fact]);
      if (profile.facts.length === before && !profile.facts.includes(fact)) {
        return { ok: false, content: 'That cannot be stored (it may be a secret or a forget request).' };
      }
      return { ok: true, content: `Remembered: ${fact}` };
    },
  });

  registerTool({
    name: 'get_server_info',
    description:
      'Inspect the current server/channel the bot can actually see: platform, thread id, title, ' +
      'member count when available, and bot access. Defaults to the current chat. This is how you ' +
      'answer "tell me about this server" — a lookup failure is itself the answer to access questions.',
    risk: 0,
    parameters: {
      type: 'object',
      properties: {
        server_id: {
          type: 'string',
          description: 'Target server/thread id. Omit for the current chat.',
        },
      },
      required: [],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const raw = String(args.server_id ?? '').trim();
      const target = raw || ctx.threadId;
      const isOther = Boolean(raw) && raw !== ctx.threadId;

      // Another server's details are not the asker's business unless privileged.
      if (isOther && ctx.role < 3) {
        return {
          ok: false,
          content: 'Only bot admins can look up a server other than this one.',
        };
      }

      const lines = [
        `Platform: ${ctx.platform}`,
        `Thread ID: ${target}`,
        `Kind: ${ctx.isGroup ? 'group/server channel' : 'private'}`,
      ];
      if (ctx.chatTitle) lines.push(`Title: ${ctx.chatTitle}`);
      const extra = ctx.extra?.serverInfo;
      if (typeof extra === 'string' && extra.trim()) {
        lines.push(`Details: ${extra.trim().slice(0, 600)}`);
      } else {
        lines.push(
          'Note: live member counts and permission details depend on the platform adapter; ' +
            'only report what is listed here, never guess.',
        );
      }
      return { ok: true, content: lines.join('\n'), data: { threadId: target } };
    },
  });

  registerTool({
    name: 'list_servers',
    description:
      'Which servers/channels this bot session can see. Use it whenever someone asks where the bot ' +
      'is or what it has joined — do not answer that from memory, you cannot know it.',
    risk: 0,
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Narrow the list.',
          enum: ['all', 'server', 'channel'],
          default: 'all',
        },
      },
      required: [],
    },
    async handler(args, ctx): Promise<ToolResult> {
      const extra = ctx.extra?.serverList;
      const lines = [`Session: ${ctx.platform}${ctx.sessionId ? ` / ${ctx.sessionId}` : ''}`];

      // Membership is not public information: ordinary members must not get a
      // full inventory of every server/channel the bot can access.
      if (ctx.role < 3) {
        lines.push('Only bot admins can see the server list itself.');
        if (typeof extra === 'string' && extra.trim()) {
          lines.push(`What can be shared: this chat (${ctx.threadId}).`);
        }
        return { ok: true, content: lines.join('\n') };
      }

      const kind = String(args.kind ?? 'all');
      void kind;
      if (typeof extra === 'string' && extra.trim()) {
        lines.push(extra.trim().slice(0, 2000));
      } else {
        lines.push(
          `Current chat: ${ctx.threadId}${ctx.chatTitle ? ` (${ctx.chatTitle})` : ''}. ` +
            'A full cross-server inventory is not exposed by this platform adapter; ' +
            'report only chats with recorded activity, never guess.',
        );
      }
      return { ok: true, content: lines.join('\n') };
    },
  });
}
