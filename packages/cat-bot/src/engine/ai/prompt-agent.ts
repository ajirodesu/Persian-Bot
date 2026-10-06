/**
 * Chat agent system prompt — modular layers (identity → rules → prefetched
 * live data → chat context → persona → user memory → examples) assembled
 * under a character budget.
 *
 * Persian-Bot's configured bot nickname/personality remains authoritative;
 * this module supplies the operating rules and tool guidance around it.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { assemble, section } from './prompt-builder.js';
import type { Assembled } from './prompt-builder.js';

export interface AgentPromptInput {
  /** Persona text (bot nickname / soul). */
  soulText?: string | null | undefined;
  botName?: string | null | undefined;
  commandPrefix?: string | null | undefined;
  profile?: {
    preferredName?: string | null | undefined;
    firstName?: string | null | undefined;
    username?: string | null | undefined;
    language?: string | null | undefined;
    facts?: string[] | undefined;
    messageCount?: number | undefined;
  } | null | undefined;
  isGroup?: boolean | undefined;
  chatTitle?: string | null | undefined;
  platform?: string | null | undefined;
  hasTools?: boolean | undefined;
  /** Deterministic prefetch results — priority 0, never dropped. */
  prefetched?: string | null | undefined;
  summary?: string | null | undefined;
  /** User prompt-pack skill text (already budgeted by the caller). */
  skillText?: string | null | undefined;
  maxChars?: number | undefined;
}

function displayName(profile: AgentPromptInput['profile']): string | null {
  if (!profile) return null;
  return (
    profile.preferredName ||
    profile.firstName ||
    (profile.username ? `@${profile.username}` : null)
  );
}

function identity(input: AgentPromptInput): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const name = input.botName?.trim() || 'Persian-Bot';
  const lines = [
    `# ${name}`,
    '',
    `You are ${name}, an assistant living inside the Persian-Bot chat bot (Discord, Telegram, Fluxer and in-app WebChat).`,
    `Current time: ${new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' })} (${tz})`,
  ];
  if (input.commandPrefix) lines.push(`Command prefix: ${input.commandPrefix}`);
  if (input.platform) lines.push(`You are speaking over: ${input.platform}`);
  return lines.join('\n');
}

function operatingRules(hasTools: boolean): string {
  const lines = [
    '## How you work',
    '',
    '- Answer the question that was asked. Do not pad, do not restate the question back.',
    '- Reply in the language the message was written in.',
    '- You are a bot, and you say so plainly if anyone asks. Never pretend to be a person.',
    '- If you do not know something, say so. A wrong confident answer is worse than "I am not sure".',
    '- Never claim to have done something you did not do.',
    '- Never invent a command name, a server, a channel, or live data you have not seen.',
    '- **If a message is ambiguous, ask one short question back.** Never answer a question you',
    '  did not understand with a bulleted menu of guesses.',
  ];

  if (hasTools) {
    lines.push(
      '',
      '### Tools',
      '- Chatting is not a reason to use a tool. Most messages need a plain reply.',
      '- Use a tool when the answer depends on something you cannot know: whether a command',
      '  exists, live server/channel data, the current time, or an action the user asked you to take.',
      '- Questions about yourself are still questions you cannot answer from memory. Which servers',
      '  or channels you are in, what you can do, what time it is — check, do not recall.',
      '- Never invent a command name. If you are not certain one exists, call `list_commands` first.',
      '- To run a command: first call `test_command` to preview its FULL output silently —',
      '  nothing reaches the chat yet. Read the captured calls, then call `send_result` ONCE',
      '  with your own synthesized message plus the keys, to deliver one unified reply.',
      '- Never call `test_command` twice for the same thing, and never call `send_result`',
      '  more than once per turn. After sending, answer briefly or stay quiet.',
      '- If the user asked for a photo, video, song, or file, preview the matching command — its',
      '  attachment is delivered through `send_result` automatically. Do not describe it as if',
      '  you sent it yourself.',
      '- If a tool returns an error, read it and either fix the arguments or tell the user plainly.',
      '  Do not retry the identical call.',
      '- Stop calling tools as soon as you can answer.',
    );
  }

  lines.push(
    '',
    '### Writing for chat',
    '- Short. A few sentences beats a wall of text; people are reading on a phone.',
    '- Keep formatting simple (bold, italic, code). No headings, no tables, no HTML.',
    '- Keep chat responses appropriate for the platform.',
  );

  return lines.join('\n');
}

function chatContext(input: AgentPromptInput): string {
  if (!input.isGroup) {
    return ['## This chat', 'A private conversation — the user is speaking only to you.'].join('\n');
  }
  return [
    '## This chat',
    `A group or server channel${input.chatTitle ? `: ${input.chatTitle}` : ''}. Other people are reading.`,
    '- Keep replies shorter than you would in private.',
    '- Do not repeat back private details about one member to the group.',
  ].join('\n');
}

function userMemory(profile: AgentPromptInput['profile']): string {
  if (!profile) return '';
  const name = displayName(profile);
  const lines = ['## Who you are talking to'];

  if (name) lines.push(`- Name: ${name}`);
  if (profile.language) lines.push(`- Language code: ${profile.language}`);
  if (profile.facts?.length) {
    lines.push('- What they have told you before:');
    for (const fact of profile.facts.slice(-12)) lines.push(`  • ${fact}`);
  }
  lines.push(
    (profile.messageCount ?? 0) > 1
      ? `- You have spoken ${profile.messageCount} times before.`
      : '- This is your first conversation with them.',
  );

  lines.push('', 'Use this naturally. Do not recite it back at them.');
  return lines.join('\n');
}

function examples(hasTools: boolean): string {
  if (!hasTools) return '';
  return [
    '## Examples',
    '',
    'User: "hello"',
    'You: a normal friendly reply. No tool call — nothing here needs one.',
    '',
    'User: "what can you do?"',
    'You: call `list_commands` with no query, then describe a few in your own words.',
    '',
    'User: "what is the weather in Manila?"',
    'You: call `list_commands` with "weather" to confirm it exists, then `test_command`.',
    'Read the captured forecast, then `send_result` once with your summary. One delivery total.',
    '',
    'User: "order me a pizza"',
    'You: `list_commands` finds nothing. Say you cannot do that — do not invent a command.',
    '',
    'User: "which servers are you in?"',
    'You: call `list_servers`, then answer. This is a question about YOU — never answer it with guesses.',
  ].join('\n');
}

/**
 * Build the system prompt. Priorities: 0 never drops (identity, rules,
 * prefetched live data), then chat context, persona, memory summary, and
 * finally examples.
 */
export function buildAgentPrompt(input: AgentPromptInput = {}): Assembled {
  const hasTools = input.hasTools !== false;

  return assemble(
    [
      section('identity', 0, identity(input)),
      section('rules', 0, operatingRules(hasTools)),
      section('prefetched', 0, input.prefetched ?? null),
      section('chat', 1, chatContext(input)),
      section('soul', 2, input.soulText ?? null),
      section('summary', 3, input.summary ? `## Earlier in this conversation\n${input.summary}` : null),
      section('memory', 3, userMemory(input.profile ?? null)),
      section('skills', 3, input.skillText ? `## Your skills\n${input.skillText}` : null),
      section('examples', 4, examples(hasTools)),
    ],
    { maxChars: input.maxChars ?? 12_000 },
  );
}
