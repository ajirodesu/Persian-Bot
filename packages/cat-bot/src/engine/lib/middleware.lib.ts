/**
 * Middleware Infrastructure — Registry and Chain Runner
 * Cached snapshots avoid array allocation on every hot-path dispatch call.
 */

import type {
  MiddlewareFn, MiddlewareUse, OnCommandCtx, OnChatCtx,
  OnReplyCtx, OnReactCtx, OnButtonClickCtx, OnEventCtx,
} from '@/engine/types/middleware.types.js';

class MiddlewareRegistry implements MiddlewareUse {
  #onCommand: MiddlewareFn<OnCommandCtx>[] = [];
  #onChat: MiddlewareFn<OnChatCtx>[] = [];
  #onReply: MiddlewareFn<OnReplyCtx>[] = [];
  #onReact: MiddlewareFn<OnReactCtx>[] = [];
  #onButtonClick: MiddlewareFn<OnButtonClickCtx>[] = [];
  #onEvent: MiddlewareFn<OnEventCtx>[] = [];

  // Cached snapshots — invalidated on registration, cached after first dispatch.
  #snapCommand: MiddlewareFn<OnCommandCtx>[] | null = null;
  #snapChat: MiddlewareFn<OnChatCtx>[] | null = null;
  #snapReply: MiddlewareFn<OnReplyCtx>[] | null = null;
  #snapReact: MiddlewareFn<OnReactCtx>[] | null = null;
  #snapButtonClick: MiddlewareFn<OnButtonClickCtx>[] | null = null;
  #snapEvent: MiddlewareFn<OnEventCtx>[] | null = null;

  onCommand(middlewares: MiddlewareFn<OnCommandCtx>[]): void { this.#onCommand.push(...middlewares); this.#snapCommand = null; }
  onChat(middlewares: MiddlewareFn<OnChatCtx>[]): void { this.#onChat.push(...middlewares); this.#snapChat = null; }
  onReply(middlewares: MiddlewareFn<OnReplyCtx>[]): void { this.#onReply.push(...middlewares); this.#snapReply = null; }
  onReact(middlewares: MiddlewareFn<OnReactCtx>[]): void { this.#onReact.push(...middlewares); this.#snapReact = null; }
  onButtonClick(middlewares: MiddlewareFn<OnButtonClickCtx>[]): void { this.#onButtonClick.push(...middlewares); this.#snapButtonClick = null; }
  onEvent(middlewares: MiddlewareFn<OnEventCtx>[]): void { this.#onEvent.push(...middlewares); this.#snapEvent = null; }

  getOnCommand(): MiddlewareFn<OnCommandCtx>[] { return (this.#snapCommand ??= [...this.#onCommand]); }
  getOnChat(): MiddlewareFn<OnChatCtx>[] { return (this.#snapChat ??= [...this.#onChat]); }
  getOnReply(): MiddlewareFn<OnReplyCtx>[] { return (this.#snapReply ??= [...this.#onReply]); }
  getOnReact(): MiddlewareFn<OnReactCtx>[] { return (this.#snapReact ??= [...this.#onReact]); }
  getOnButtonClick(): MiddlewareFn<OnButtonClickCtx>[] { return (this.#snapButtonClick ??= [...this.#onButtonClick]); }
  getOnEvent(): MiddlewareFn<OnEventCtx>[] { return (this.#snapEvent ??= [...this.#onEvent]); }
}

/** Singleton — registrations in src/middleware/index.ts are visible everywhere at runtime. */
export const middlewareRegistry = new MiddlewareRegistry();
/** Typed as MiddlewareUse to expose only the registration surface at call sites. */
export const use: MiddlewareUse = middlewareRegistry;

/**
 * Runs `middlewares` sequentially, then calls `finalHandler` once all have called next().
 *
 * Sequential (not Promise.all): fast guards (ban check) protect expensive downstream work.
 * Context mutations (like populating ctx.options) must be visible to the next step.
 *
 * Short-circuit: a middleware that does NOT call next() halts the chain — used for guard clauses.
 */
export function runMiddlewareChain<TCtx>(
  middlewares: MiddlewareFn<TCtx>[],
  ctx: TCtx,
  finalHandler: () => Promise<void>,
): Promise<void> {
  let index = -1;
  function dispatch(i: number): Promise<void> {
    if (i <= index) return Promise.reject(new Error('next() called multiple times'));
    index = i;
    const mw = middlewares[i];
    try {
      if (mw !== undefined) return Promise.resolve(mw(ctx, () => dispatch(i + 1)));
      else return Promise.resolve(finalHandler());
    } catch (err) {
      return Promise.reject(err);
    }
  }
  return dispatch(0);
}
