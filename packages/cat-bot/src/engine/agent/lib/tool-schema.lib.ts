import { Role } from '@/engine/constants/role.constants.js';
import type { CatalogEntry } from './command-catalog.lib.js';

/**
 * Needle 3 Tool Schemas — converts Persian-Bot command metadata into
 * Needle-compatible JSON Schema tool definitions.
 *
 * Design decision (documented): Needle 3 is given exactly THREE tools —
 * `help`, `test_command`, `send_result` — following the Cat-Bot workflow.
 * The dynamic command catalogue is NOT exposed as N separate tools; instead
 * the sorted allowed command names are embedded as the `command` enum inside
 * the test_command schema, and the grouped catalogue is rendered into the
 * system prompt. This keeps tool delivery modular (no giant AI file), gives
 * the engine native selection over a closed vocabulary (unknown names are
 * rejected by schema validation before execution), and preserves the
 * help → test_command → send_result execution policy.
 *
 * Every schema below is proper JSON Schema (type / properties / required /
 * enum / minLength / maxLength / minItems / maxItems).
 */

const ROLE_LABEL: Record<number, string> = {
  [Role.ANYONE]: 'All users',
  [Role.THREAD_ADMIN]: 'Group administrators',
  [Role.PREMIUM]: 'Premium users',
  [Role.BOT_ADMIN]: 'Bot admin',
  [Role.SYSTEM_ADMIN]: 'System admin',
};

export interface NeedleToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Renders one catalogue entry as the per-command detail block for help(). */
export function renderCommandDetail(entry: CatalogEntry, prefix: string): string {
  const HR = '─────────────────';
  const roleLabel = ROLE_LABEL[entry.role] ?? String(entry.role);
  const usageLine = `${prefix}${entry.name}${entry.usage ? ` ${entry.usage}` : ''}`;
  return [
    `『 ${entry.name} 』`,
    `» ${entry.description}`,
    ``,
    HR,
    `Category : ${entry.category}`,
    `Usage    : ${usageLine}`,
    HR,
    `Role     : ${roleLabel}`,
  ].join('\n');
}

function strProp(description: string, extra?: Record<string, unknown>) {
  return { type: 'string', description, ...(extra ?? {}) };
}

/** The `help` tool schema (static shape — catalogue-aware at runtime). */
export function helpToolSchema(): NeedleToolDefinition {
  return {
    name: 'help',
    description:
      'Get the paginated command list or full command details. ' +
      'Accepts a command name or a page number. ' +
      "Use before 'test_command' to view command arguments and verify access.",
    parameters: {
      type: 'object',
      properties: {
        query: strProp(
          "An exact command name (e.g. 'ping'), a page number (e.g. '2'), or omit/empty for page 1.",
          { maxLength: 64 },
        ),
      },
      required: [],
    },
  };
}

/** The `test_command` schema — `command` enum is the live allowed catalogue. */
export function testCommandToolSchema(allowedNames: string[]): NeedleToolDefinition {
  return {
    name: 'test_command',
    description:
      'Execute commands silently to intercept and preview their output. Always use the ' +
      '`commands` array. Returns a `key` and a `calls` array describing what each command ' +
      'would send. Read `calls` to understand the output, then deliver with `send_result`. ' +
      'When the combined output contains more than one attachment, `button_key` is null ' +
      'because platforms cannot deliver multiple file attachments alongside buttons.',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: 'List of commands to test in sequence.',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command name without prefix (must be in the available catalogue).',
                ...(allowedNames.length > 0 ? { enum: allowedNames } : { minLength: 1, maxLength: 64 }),
              },
              args: {
                type: 'array',
                description: 'Arguments',
                maxItems: 50,
                items: { type: 'string', maxLength: 2000 },
              },
            },
            required: ['command', 'args'],
          },
        },
      },
      required: ['commands'],
    },
  };
}

/** The `send_result` schema — the mandatory final action of every turn. */
export function sendResultToolSchema(): NeedleToolDefinition {
  return {
    name: 'send_result',
    description:
      'Deliver a unified reply to the user combining your synthesized message text with ' +
      'URL attachments (attachment_url) and button grids captured by one or more test_command calls. ' +
      'Write the `message` yourself based on the `calls` content returned by test_command. ' +
      'Pass any non-null `attachment_key` values in `attachment_url` and any non-null ' +
      '`button_key` values in `button` — all entries are merged into a single platform reply. ' +
      'Run all needed test_command calls before calling this tool once to combine results. ' +
      'Each key is single-use and is deleted after delivery. ' +
      'ALWAYS call this tool exactly once as the final action of every turn, including ' +
      'pure conversation (message only, no keys).',
    parameters: {
      type: 'object',
      properties: {
        message: strProp(
          'Your synthesized reply text, written from the `calls` content returned by test_command. ' +
            'This is the primary text the user will see.',
          { minLength: 1, maxLength: 4000 },
        ),
        attachment_url: {
          type: 'array',
          description:
            'Optional list of `attachment_key` values from test_command (the `attachment_key` ' +
            'field, not the main `key`). Omit or pass [] when no attachments were produced.',
          maxItems: 10,
          items: { type: 'string', maxLength: 256 },
        },
        attachment: {
          type: 'array',
          description:
            'Optional list of `binary_attachment_key` values from test_command. ' +
            'Omit or pass [] when no binary attachments were produced.',
          maxItems: 10,
          items: { type: 'string', maxLength: 256 },
        },
        button: {
          type: 'array',
          description:
            'Optional list of `button_key` values from test_command (the `button_key` field, ' +
            'not the main `key`). Omit or pass [] when no buttons were produced.',
          maxItems: 10,
          items: { type: 'string', maxLength: 256 },
        },
      },
      required: ['message'],
    },
  };
}

/** All three workflow tools in delivery order, with the live catalogue bound in. */
export function buildNeedleTools(allowedNames: string[]): NeedleToolDefinition[] {
  return [
    helpToolSchema(),
    testCommandToolSchema(allowedNames),
    sendResultToolSchema(),
  ];
}
