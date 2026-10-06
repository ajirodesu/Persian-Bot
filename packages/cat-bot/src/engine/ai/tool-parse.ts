/**
 * Tolerant tool-call parser.
 *
 * Small and free models ignore the given protocol and emit tool calls in
 * whichever shape their fine-tune used. All of these mean the same thing:
 *
 *   TOOL: {"name":"list_commands","arguments":{"query":"weather"}}
 *   <tool_call>{"name": "list_commands", ...}</tool_call>
 *   <function=list_commands>{"query":"weather"}</function>
 *   Action: list_commands / Action Input: {...}
 *   list_commands({"query": "weather"})
 *   {"tool":"list_commands","args":{...}}
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { extractJSON } from './sanitize.js';

export interface ParsedCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParseOutcome {
  calls: ParsedCall[];
  /** Reply with any tool-call syntax removed. */
  cleaned: string;
  /** Which strategy matched — for logging and tests. */
  via: string | null;
}

const NAME_KEYS = ['name', 'tool', 'tool_name', 'function', 'function_name', 'action', 'recipient_name'];
const ARG_KEYS = ['arguments', 'args', 'parameters', 'params', 'input', 'tool_input', 'action_input'];

function pickName(o: Record<string, unknown>): string | null {
  for (const k of NAME_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = (v as Record<string, unknown>).name;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return null;
}

function pickArgs(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of ARG_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      const parsed = extractJSON<Record<string, unknown>>(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      continue;
    }
    if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }

  for (const k of NAME_KEYS) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = pickArgs(v as Record<string, unknown>);
      if (Object.keys(nested).length > 0) return nested;
    }
  }

  // Models sometimes inline arguments as siblings of the name:
  //   {"tool":"test_command","commands":[{"command":"weather"}]}
  const leftovers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (NAME_KEYS.includes(k)) continue;
    if (ARG_KEYS.includes(k) && typeof v !== 'string') continue;
    leftovers[k] = v;
  }
  return leftovers;
}

function fromObject(raw: unknown): ParsedCall | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = pickName(o);
  if (!name) return null;
  return { name, args: pickArgs(o) };
}

type Strategy = (text: string, known: string[]) => ParseOutcome | null;

/** <tool_call>{...}</tool_call> — Qwen / Hermes / many Llama fine-tunes. */
const tagged: Strategy = (text) => {
  const re = /<(tool_call|function_call|tool)>([\s\S]*?)(?:<\/\1>|$)/gi;
  const calls: ParsedCall[] = [];
  let cleaned = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const call = fromObject(extractJSON(m[2] ?? ''));
    if (call) {
      calls.push(call);
      cleaned = cleaned.replace(m[0], '');
    }
  }
  return calls.length > 0 ? { calls, cleaned: cleaned.trim(), via: 'tagged' } : null;
};

/** <function=name>{args}</function> */
const functionTag: Strategy = (text) => {
  const re = /<function\s*=\s*([\w.-]+)\s*>([\s\S]*?)(?:<\/function>|$)/gi;
  const calls: ParsedCall[] = [];
  let cleaned = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const args = extractJSON<Record<string, unknown>>(m[2] ?? '') ?? {};
    calls.push({
      name: m[1]!,
      args: typeof args === 'object' && !Array.isArray(args) ? args : {},
    });
    cleaned = cleaned.replace(m[0], '');
  }
  return calls.length > 0 ? { calls, cleaned: cleaned.trim(), via: 'function-tag' } : null;
};

/** TOOL: {...} text protocol. */
const toolLine: Strategy = (text) => {
  const m = text.match(/^[ \t]*TOOL[:=][ \t]*(\{[\s\S]*)$/im);
  if (!m?.[1]) return null;
  const call = fromObject(extractJSON(m[1]));
  if (!call) return null;
  return { calls: [call], cleaned: text.replace(m[0], '').trim(), via: 'tool-line' };
};

/** name({...}) — function-call syntax. Guarded by the known-tool list. */
const callSyntax: Strategy = (text, known) => {
  const re = /(?:^|\s|TOOL[:=]\s*)([a-zA-Z_][\w.]*)\s*\(\s*(\{[\s\S]*?\})\s*\)/m;
  const m = text.match(re);
  if (!m?.[1]) return null;
  if (known.length > 0 && !known.includes(m[1])) return null;

  const args = extractJSON<Record<string, unknown>>(m[2] ?? '{}') ?? {};
  return {
    calls: [{ name: m[1], args: typeof args === 'object' && !Array.isArray(args) ? args : {} }],
    cleaned: text.replace(m[0], '').trim(),
    via: 'call-syntax',
  };
};

/** ReAct: "Action: name" + "Action Input: {...}". */
const react: Strategy = (text) => {
  const nameMatch = text.match(/^[ \t]*Action[ \t]*:[ \t]*([\w.-]+)[ \t]*$/im);
  if (!nameMatch?.[1]) return null;

  const inputMatch = text.match(/^[ \t]*Action[ _]?Input[ \t]*:[ \t]*([\s\S]*?)(?:\n\s*\n|$)/im);
  const args = inputMatch?.[1]
    ? (extractJSON<Record<string, unknown>>(inputMatch[1]) ?? {})
    : {};

  let cleaned = text.replace(nameMatch[0], '');
  if (inputMatch?.[0]) cleaned = cleaned.replace(inputMatch[0], '');

  return {
    calls: [{ name: nameMatch[1], args: typeof args === 'object' && !Array.isArray(args) ? args : {} }],
    cleaned: cleaned.replace(/^[ \t]*Thought[ \t]*:.*$/gim, '').trim(),
    via: 'react',
  };
};

/**
 * A JSON object anywhere in the reply that names a tool. Guarded by the
 * known-tool list so ordinary JSON in an answer is never executed.
 */
const looseJson: Strategy = (text, known) => {
  const candidates: string[] = [];

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let f: RegExpExecArray | null;
  while ((f = fence.exec(text)) !== null) {
    if (f[1]) candidates.push(f[1]);
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const c of candidates) {
    const call = fromObject(extractJSON(c));
    if (!call) continue;
    if (known.length > 0 && !known.includes(call.name)) continue;

    const idx = text.indexOf(c.trim());
    const cleaned =
      idx >= 0
        ? (text.slice(0, idx) + text.slice(idx + c.trim().length))
            .replace(/```(?:json)?/gi, '')
            .trim()
        : text;
    return { calls: [call], cleaned, via: 'loose-json' };
  }
  return null;
};

/**
 * The whole reply is a bare tool name. Only accepted when the reply is
 * essentially nothing else, so a sentence mentioning a tool is not hijacked.
 */
const bareName: Strategy = (text, known) => {
  const trimmed = text.trim().replace(/^[`"'*]+|[`"'*.]+$/g, '');
  if (!known.includes(trimmed)) return null;
  return { calls: [{ name: trimmed, args: {} }], cleaned: '', via: 'bare-name' };
};

const STRATEGIES: Strategy[] = [tagged, functionTag, toolLine, callSyntax, react, looseJson, bareName];

/**
 * Parse tool calls out of a model reply. `known` is the list of tool names
 * actually available — strategies that could misfire on prose refuse to fire
 * without a match.
 */
export function parseToolCalls(text: string, known: string[] = []): ParseOutcome {
  if (!text?.trim()) return { calls: [], cleaned: '', via: null };

  for (const strategy of STRATEGIES) {
    const out = strategy(text, known);
    if (out?.calls.length) return out;
  }
  return { calls: [], cleaned: text.trim(), via: null };
}
