/**
 * AI Agent — admin_generate_command tool
 *
 * SYSTEM ADMIN ONLY. Analyzes a natural-language request against the bot's
 * existing commands and the reference command templates (examples/commands),
 * then returns a complete command authoring kit: the relevant example source,
 * the existing command inventory (to avoid name collisions and mirror real
 * conventions), a conventions checklist, and a ready-to-fill TypeScript
 * scaffold. The model finishes the handler logic and writes the file with
 * admin_add_command — validation and the write stay in that tool.
 */

import type { ToolMeta, ToolContext } from '../agent-tool.types.js';
import {
  requireSystemAdmin,
  listCommandFiles,
  listExampleCommands,
  readExampleCommand,
  COMMANDS_REPO_DIR,
  EXAMPLES_COMMANDS_DIR,
} from '../lib/admin-source-tools.lib.js';

// ============================================================================
// TOOL DEFINITION
// ============================================================================

const INTERACTION_KINDS: string[] = [
  'command',
  'onReply',
  'onChat',
  'buttons',
  'onReact',
];
type InteractionKind =
  | 'command'
  | 'onReply'
  | 'onChat'
  | 'buttons'
  | 'onReact';

const ROLE_VALUES: string[] = [
  'anyone',
  'thread_admin',
  'premium',
  'bot_admin',
  'system_admin',
];
type RoleValue =
  | 'anyone'
  | 'thread_admin'
  | 'premium'
  | 'bot_admin'
  | 'system_admin';

/** Which example template each interaction kind should follow. */
const EXAMPLE_BY_KIND: Record<InteractionKind, string> = {
  command: 'example_command.ts',
  onReply: 'example_reply.ts',
  onChat: 'example_on_chat.ts',
  buttons: 'example_buttons.ts',
  onReact: 'example_react.ts',
};

export const meta: ToolMeta = {
  name: 'admin_generate_command',
  description:
    'SYSTEM ADMIN ONLY — analyze a request for a NEW bot command and return ' +
    'a command authoring kit (reference template, existing-command inventory ' +
    'for collision/convention checks, conventions checklist, and a scaffold) ' +
    `so the command can be written to ${COMMANDS_REPO_DIR}. Sources analyzed: ` +
    'the user request, the existing command roster, and the reference ' +
    'templates in examples/commands. The generated command must follow the ' +
    'project structure: export `meta` (CommandMeta) and an onCommand/onChat/' +
    'onReply/onReact/button handler. After this tool returns, write the ' +
    'finalized source with admin_add_command.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description:
          "The user's message describing the command to build — what it does, " +
          'what it replies, any arguments it needs.',
      },
      interaction: {
        type: 'string',
        enum: INTERACTION_KINDS,
        description:
          'Handler style the command needs. command (default) = simple reply; ' +
          'onReply = multi-step quote-reply flow; onChat = passive listener on ' +
          'every message; buttons = interactive buttons; onReact = emoji ' +
          'reaction flow.',
      },
      filename: {
        type: 'string',
        description:
          "Suggested command file name, e.g. 'joke.ts'. Omit to have the tool " +
          'derive one from the request.',
      },
      role: {
        type: 'string',
        enum: ROLE_VALUES,
        description:
          'Minimum role. anyone (default), thread_admin, premium, bot_admin, ' +
          'or system_admin.',
      },
    },
    required: ['request'],
  },
  adminOnly: true,
};

// ============================================================================
// TOOL RUN
// ============================================================================

/** Converts free-form role words into a meta.role value. */
function resolveRole(role?: string): RoleValue {
  const r = String(role ?? '').trim().toLowerCase();
  if (r.startsWith('thread')) return 'thread_admin';
  if (r.startsWith('premium')) return 'premium';
  if (r.startsWith('bot')) return 'bot_admin';
  if (r.startsWith('system') || r === 'admin') return 'system_admin';
  return 'anyone';
}

/** Derives a kebab-case .ts filename from the request when none was given. */
function deriveFilename(request: string): string {
  const slug = request
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
  return (slug || 'new-command') + '.ts';
}

/** Picks the short-ish, representative real commands to show conventions. */
function pickConventionSamples(names: string[]): string[] {
  const prefer = ['ping.ts', 'say.ts', 'cointoss.ts', 'help.ts', 'ai.ts'];
  const chosen: string[] = [];
  for (const p of prefer) if (names.includes(p)) chosen.push(p);
  return chosen;
}

export const initialize = async (
  args: {
    request?: string;
    interaction?: string;
    filename?: string;
    role?: string;
  },
  ctx: ToolContext,
): Promise<string> => {
  const denial = await requireSystemAdmin(ctx);
  if (denial) return denial;

  const request = String(args.request ?? '').trim();
  if (!request) {
    return 'No request provided — describe the command to build (what it does, what it replies, any arguments).';
  }

  const kind = (INTERACTION_KINDS as readonly string[]).includes(
    String(args.interaction ?? ''),
  )
    ? (args.interaction as InteractionKind)
    : 'command';
  const role = resolveRole(args.role);
  const filename = String(args.filename ?? '').trim() || deriveFilename(request);
  const exampleFile = EXAMPLE_BY_KIND[kind];

  try {
    // ── Source analysis ──────────────────────────────────────────────────────
    const existing = await listCommandFiles();
    const examples = await listExampleCommands();
    const exampleSource = await readExampleCommand(exampleFile);

    const collision = existing.includes(filename);
    const similar = existing.filter((f) =>
      f.toLowerCase().includes(filename.replace(/\.ts$/, '').toLowerCase()),
    );
    const samples = pickConventionSamples(existing);

    const roleLine: Record<RoleValue, string> = {
      anyone: 'Role.ANYONE (0) — any user can invoke it.',
      thread_admin: 'Role.THREAD_ADMIN (1) — thread/group admins and above.',
      premium: 'Role.PREMIUM (2) — premium users and above.',
      bot_admin: 'Role.BOT_ADMIN (3) — bot admins and system admins only.',
      system_admin:
        'Role.SYSTEM_ADMIN (4) — only globally-configured system admins.',
    };

    const lines: string[] = [];
    lines.push(`# Command Authoring Kit — "${filename}"`);
    lines.push('');
    lines.push('## Request to build');
    lines.push(request);
    lines.push('');
    lines.push('## Analysis');
    lines.push(
      `- Interaction style: \`${kind}\` — follow the template ` +
        `\`${exampleFile}\` verbatim for the handler shape and imports.`,
    );
    lines.push(`- Suggested filename: \`${filename}\``);
    lines.push(`- Suggested role: ${roleLine[role]}`);
    lines.push(
      collision
        ? `- COLLISION: \`${filename}\` already exists in the commands folder — ` +
          'use admin_edit_command instead, or choose a different filename.'
        : `- Name available: \`${filename}\` is not taken (of ${existing.length} commands).`,
    );
    if (similar.length > 0) {
      lines.push(
        `- Similar existing names (avoid semantic duplication): ${similar.join(', ')}`,
      );
    }
    lines.push('');
    lines.push('## Conventions checklist');
    lines.push(
      '- Export `meta: CommandMeta` — name, version (\'1.0.0\'), role, author, ' +
        'description, usage, cooldown, hasPrefix: true.',
    );
    lines.push(
      '- meta.name must be lowercase; meta.role uses the Role constant from ' +
        '`@/engine/constants/role.constants.js`.',
    );
    lines.push(
      '- Reply with `chat.replyMessage({ style: MessageStyle.MARKDOWN, message })`; ' +
        'for usage errors call `await usage()`.',
    );
    lines.push(
      '- Use `@/` path aliases for all imports (e.g. ' +
        '`@/engine/types/controller.types.js`).',
    );
    lines.push(
      '- Gate private flows by sender: `const senderID = event[\'senderID\'] as string | undefined`.',
    );
    lines.push(
      '- Define typed options in meta.options with `OptionType` from ' +
        '`@/engine/modules/command/command-option.constants.js` when the command ' +
        'takes key:value arguments; read them via ctx.options.',
    );
    lines.push(
      '- Buttons: only attach when the platform supports them — guard with ' +
        '`hasNativeButtons(native.platform)` and `@/engine/utils/ui-capabilities.util.js`.',
    );
    lines.push(
      '- Buttons/replies edit in place with `chat.editMessage({ ..., message_id_to_edit })` ' +
        'inside onClick handlers.',
    );
    if (samples.length > 0) {
      lines.push(
        `- Real-world references to mirror: ${samples.join(', ')} ` +
          '(read them with admin_read_command if needed).',
      );
    }
    lines.push('');
    lines.push('## Reference template (full source)');
    lines.push('```ts');
    lines.push(exampleSource.replace(/```/g, '\\`\\`\\`'));
    lines.push('```');
    lines.push('');
    lines.push(
      `## All example templates in ${EXAMPLES_COMMANDS_DIR}: ${examples.join(', ')}`,
    );
    lines.push(
      `## All existing commands in ${COMMANDS_REPO_DIR} (${existing.length}): ` +
        existing.join(', '),
    );
    lines.push('');
    lines.push('## Generated scaffold (fill in and write with admin_add_command)');
    lines.push('```ts');
    lines.push(
      `import type { AppCtx } from '@/engine/types/controller.types.js';\n` +
        `import { Role } from '@/engine/constants/role.constants.js';\n` +
        `import { MessageStyle } from '@/engine/constants/message-style.constants.js';\n` +
        `import type { CommandMeta } from '@/engine/types/module-meta.types.js';\n\n` +
        `export const meta: CommandMeta = {\n` +
        `  name: '${filename.replace(/\.ts$/, '')}',\n` +
        `  aliases: [] as string[],\n` +
        `  version: '1.0.0',\n` +
        `  role: Role.${role.toUpperCase()},\n` +
        `  author: 'AI Agent',\n` +
        `  description: 'TODO: one-line description',\n` +
        `  category: 'Utility',\n` +
        `  usage: '',\n` +
        `  cooldown: 5,\n` +
        `  hasPrefix: true,\n` +
        `};\n\n` +
        `export const onCommand = async ({ chat }: AppCtx) => {\n` +
        `  await chat.replyMessage({\n` +
        `    style: MessageStyle.MARKDOWN,\n` +
        `    message: 'TODO: reply for /${filename.replace(/\.ts$/, '')}',\n` +
        `  });\n` +
        `};\n`,
    );
    lines.push('```');
    lines.push('');
    lines.push(
      'Complete the scaffold per the request and conventions, then write it ' +
        'with admin_add_command. The command activates after a bot restart.',
    );

    return lines.join('\n');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};