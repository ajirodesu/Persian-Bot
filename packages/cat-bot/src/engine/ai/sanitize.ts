/**
 * Reasoning-tag sanitiser + defensive JSON extraction.
 *
 * Qwen / DeepSeek-R1 style models wrap chain-of-thought in
 * <think>...</think> before the real answer. That block must never reach the
 * user — and must never reach JSON.parse() when an agent needs structured
 * output.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

const OPEN = /<(think|thought|reasoning)>/i;
const CLOSE = /<\/(think|thought|reasoning)>/gi;

export function stripReasoning(raw: string | null | undefined): string {
  if (!raw) return '';
  const text = String(raw);

  // Keep only what follows the final closing tag (covers both complete
  // blocks and providers that strip the opening tag only).
  CLOSE.lastIndex = 0;
  let lastClose = -1;
  let m: RegExpExecArray | null;
  while ((m = CLOSE.exec(text)) !== null) lastClose = m.index + m[0].length;
  if (lastClose >= 0) return text.slice(lastClose).trim();

  // An opening tag with no closer means the model was cut off mid-thought —
  // nothing after it is a usable answer.
  if (OPEN.test(text)) return '';

  return text.trim();
}

/**
 * Pull a JSON object/array out of a model response.
 * Tries raw → fenced → outermost {...} / [...] span. Null when unparseable.
 */
export function extractJSON<T = unknown>(raw: string | null | undefined): T | null {
  const text = stripReasoning(raw);
  if (!text) return null;

  const attempts: string[] = [text];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) attempts.push(fence[1]);

  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));
  }

  for (const candidate of attempts) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Parse `KEY: value` lines into an object — a last resort for models that
 * cannot reliably emit JSON. Only whitelisted `fields` are read, matched
 * case-insensitively ignoring separators.
 */
export function parseLabelledFields(
  raw: string | null | undefined,
  fields: string[],
): Record<string, string> | null {
  const text = stripReasoning(raw);
  if (!text || !fields.length) return null;

  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Map(fields.map((f) => [norm(f), f]));
  const out: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[*\s-]*["']?([A-Za-z][\w -]*)["']?\s*[:=]\s*(.*)$/);
    if (!m?.[1]) continue;

    const key = wanted.get(norm(m[1]));
    if (!key || key in out) continue;

    out[key] = (m[2] ?? '').trim().replace(/^["'`]|["'`,]+$/g, '').trim();
  }

  return Object.keys(out).length > 0 ? out : null;
}
