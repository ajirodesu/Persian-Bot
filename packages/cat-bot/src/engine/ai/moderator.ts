/**
 * Moderator agent — classifies one message and returns a structured verdict.
 * Only reached for messages deterministic rules could not settle, so it may
 * be the slow, expensive step. Malformed output coerces to a safe
 * allow/unknown/0-confidence verdict the enforcement gate refuses to act on.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { askAgentJSON } from './runner.js';
import { coerceVerdict, MOD_CATEGORIES } from './agent-types.js';
import type { ChatPolicy, Verdict } from './agent-types.js';

export interface JudgeInput {
  /** Message text or caption. */
  text: string;
  /** URLs / mentions extracted from the message. */
  links: string[];
  policy: ChatPolicy;
  /** Recent admin posts / pinned messages — the topicality evidence. */
  context: string[];
  sender?: {
    name?: string | null | undefined;
    username?: string | null | undefined;
    isNew?: boolean | undefined;
  } | undefined;
  chatTitle?: string | null | undefined;
  forwarded?: boolean | undefined;
  /** Dashboard owner id — selects their DB-backed provider snapshot. */
  userId?: string | undefined;
}

const SYSTEM = [
  'You are the moderation expert for a group chat. You judge ONE message and return a verdict.',
  '',
  'You are strict about advertising and scams, and deliberately permissive about ordinary conversation.',
  'Members sharing something relevant to what is being discussed is normal and must be allowed.',
  '',
  '## Categories',
  `Pick exactly one: ${MOD_CATEGORIES.join(', ')}.`,
  '- legit    : ordinary message, nothing to act on',
  '- related  : contains a link, but it follows on from the admin/pinned context below',
  '- promo    : advertising the sender\'s own channel, group, service or product',
  '- referral : affiliate / referral / "use my code" link',
  '- scam     : fake giveaway, investment bait, impersonation, too-good-to-be-true offer',
  '- phishing : tries to collect credentials, seed phrases, OTPs or payment details',
  '- nsfw     : sexual or graphic content',
  '- flood    : repetition or spam volume',
  '- offtopic : unrelated to the chat, but harmless',
  '',
  '## Rules',
  '1. Judge only the message given. Do not speculate about what the sender might do next.',
  '2. If the link plausibly follows on from the admin/pinned context, category is "related" and action is "allow".',
  '3. A link alone is not promotion. Documentation, news, a source for a claim, a reply to a question — all allow.',
  '4. Use "delete" only for content the policy names as deniable. Otherwise "allow", or "flag" when genuinely unsure.',
  '5. confidence is how certain you are, 0 to 1. Below 0.7 means you are not sure — say so rather than inflating it.',
  '6. reason must be one short sentence a group admin can read in a log.',
  '',
  '## Output',
  '{"action": "...", "category": "...", "confidence": 0.0, "reason": "..."}',
].join('\n');

function buildUserPrompt(input: JudgeInput): string {
  const p = input.policy;
  const parts: string[] = [];

  parts.push('## Policy for this chat');
  parts.push(`Deniable categories: ${p.links.denyCategories.join(', ') || '(none)'}`);
  parts.push(`Always-allowed domains: ${p.links.allowDomains.join(', ') || '(none)'}`);
  parts.push(`Always-denied domains: ${p.links.denyDomains.join(', ') || '(none)'}`);
  parts.push(`Allow links that follow the admin context: ${p.links.allowIfRelatedToContext ? 'yes' : 'no'}`);
  if (p.notes.length) {
    parts.push('');
    parts.push('Owner instructions, in their own words — these take precedence:');
    for (const note of p.notes) parts.push(`- ${note}`);
  }

  parts.push('');
  parts.push('## Recent admin / pinned context');
  parts.push(
    input.context.length > 0
      ? input.context.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(nothing recent — you cannot judge topical relevance, so do not claim a link is related)',
  );

  parts.push('');
  parts.push('## Message to judge');
  if (input.chatTitle) parts.push(`Chat: ${input.chatTitle}`);
  const who = input.sender?.username ? `@${input.sender.username}` : (input.sender?.name ?? 'unknown');
  parts.push(`Sender: ${who}${input.sender?.isNew ? ' (joined recently)' : ''}`);
  if (input.forwarded) parts.push('This message was forwarded from elsewhere.');
  parts.push(`Links found: ${input.links.length > 0 ? input.links.join(', ') : '(none)'}`);
  parts.push('Text:');
  parts.push('"""');
  parts.push(input.text.slice(0, 2000) || '(no text)');
  parts.push('"""');

  return parts.join('\n');
}

/**
 * Judge a message. Never throws for model reasons — failures return a
 * zero-confidence allow, which the enforcement gate refuses to act on.
 */
export async function judge(
  input: JudgeInput,
  agent = 'moderator',
): Promise<{ verdict: Verdict; error?: string; model?: string }> {
  try {
    const res = await askAgentJSON(
      agent,
      { system: SYSTEM, user: buildUserPrompt(input), userId: input.userId },
      coerceVerdict,
      ['action', 'category', 'confidence', 'reason'],
    );
    return { verdict: res.data, model: `${res.provider}/${res.model}` };
  } catch (err) {
    return {
      verdict: { action: 'allow', category: 'unknown', confidence: 0, reason: 'moderator agent unavailable' },
      error: (err as Error)?.message ?? String(err),
    };
  }
}

export const __test = { SYSTEM, buildUserPrompt };
