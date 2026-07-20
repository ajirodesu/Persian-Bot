/**
 * Telegram — Raw Bot API Call Helper
 *
 * grammY exposes `ctx.api.raw` as a low-level, string-keyed HTTP transport
 * that talks directly to `https://api.telegram.org/bot<token>/<method>`,
 * bypassing the typed method wrappers grammY generates from its own bundled
 * schema. This is the standard escape hatch for calling Bot API methods that
 * postdate the installed grammy version's type definitions — such as
 * sendRichMessage / sendRichMessageDraft (Bot API 10.1, June 11 2026) and the
 * InputRichBlock* family (Bot API 10.2, July 14 2026), neither of which grammY
 * ^1.44 knows about.
 *
 * A single narrow `any`-cast lives here so the rest of the rich-message
 * implementation can stay fully typed against our own hand-authored
 * interfaces (see ./rich-message.types.ts) instead of scattering casts.
 */
import type { Context } from 'grammy';

/**
 * Invokes an arbitrary Bot API method by name via grammY's raw transport,
 * typed against the caller-supplied request/response shapes.
 */
export async function callRawTelegramApi<TPayload extends object, TResult>(
  ctx: Context,
  method: string,
  payload: TPayload,
): Promise<TResult> {
  // grammY's raw transport is intentionally untyped for methods outside its
  // bundled schema — a single narrow cast here keeps every other file typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = ctx.api.raw as any;
  const fn = raw[method] as
    | ((p: TPayload) => Promise<TResult>)
    | undefined;
  if (typeof fn !== 'function') {
    throw new Error(
      `[telegram] Bot API method "${method}" is not available on the installed grammY raw transport.`,
    );
  }
  return fn.call(raw, payload);
}
