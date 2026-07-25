/**
 * Middleware Infrastructure — Registry + Chain Runner
 *
 * Extracted from middleware/registry.ts and middleware/runner.ts as stateful
 * single-purpose infrastructure. The type definitions (MiddlewareFn, MiddlewareUse,
 * OnCommandCtx, etc.) remain in middleware/types.ts to keep the type layer
 * co-located with the middleware hooks that consume them.
 *
 * Dependency direction: lib/middleware.lib.ts → middleware/types.ts → lib/options-map.lib.ts
 * No circular dependency — lib files never import back from middleware/types.ts
 * for anything other than type definitions.
 */

import type {
  MiddlewareFn,
  MiddlewareUse,
  OnCommandCtx,
  OnChatCtx,
  OnReplyCtx,
  OnReactCtx,
  OnButtonClickCtx,
  OnEventCtx,
} from '@/engine/types/middleware.types.js';

// ── Registry ──────────────────────────────────────────────────────────────────

class MiddlewareRegistry implements MiddlewareUse {
  #onCommand: MiddlewareFn<OnCommandCtx>[] = [];
  #onChat: MiddlewareFn<OnChatCtx>[] = [];
  #onReply: MiddlewareFn<OnReplyCtx>[] = [];
  #onReact: MiddlewareFn<OnReactCtx>[] = [];
  #onButtonClick: MiddlewareFn<OnButtonClickCtx>[] = [];
  #onEvent: MiddlewareFn<OnEventCtx>[] = [];

  // Cached snapshots — middleware is only registered at boot time (side-effect import
  // in middleware/index.ts) and never mutated afterward. Caching avoids allocating a
  // new array copy on every message/event dispatch (the hot path).
  #snapCommand: MiddlewareFn<OnCommandCtx>[] | null = null;
  #snapChat: MiddlewareFn<OnChatCtx>[] | null = null;
  #snapReply: MiddlewareFn<OnReplyCtx>[] | null = null;
  #snapReact: MiddlewareFn<OnReactCtx>[] | null = null;
  #snapButtonClick: MiddlewareFn<OnButtonClickCtx>[] | null = null;
  #snapEvent: MiddlewareFn<OnEventCtx>[] | null = null;

  onCommand(middlewares: MiddlewareFn<OnCommandCtx>[]): void {
    this.#onCommand.push(...middlewares);
    this.#snapCommand = null;
  }

  onChat(middlewares: MiddlewareFn<OnChatCtx>[]): void {
    this.#onChat.push(...middlewares);
    this.#snapChat = null;
  }

  onReply(middlewares: MiddlewareFn<OnReplyCtx>[]): void {
    this.#onReply.push(...middlewares);
    this.#snapReply = null;
  }

  onReact(middlewares: MiddlewareFn<OnReactCtx>[]): void {
    this.#onReact.push(...middlewares);
    this.#snapReact = null;
  }

  onButtonClick(middlewares: MiddlewareFn<OnButtonClickCtx>[]): void {
    this.#onButtonClick.push(...middlewares);
    this.#snapButtonClick = null;
  }

  onEvent(middlewares: MiddlewareFn<OnEventCtx>[]): void {
    this.#onEvent.push(...middlewares);
    this.#snapEvent = null;
  }

  /** Snapshot copy — cached after first call; invalidated on registration. */
  getOnCommand(): MiddlewareFn<OnCommandCtx>[] {
    return (this.#snapCommand ??= [...this.#onCommand]);
  }

  getOnChat(): MiddlewareFn<OnChatCtx>[] {
    return (this.#snapChat ??= [...this.#onChat]);
  }

  getOnReply(): MiddlewareFn<OnReplyCtx>[] {
    return (this.#snapReply ??= [...this.#onReply]);
  }

  getOnReact(): MiddlewareFn<OnReactCtx>[] {
    return (this.#snapReact ??= [...this.#onReact]);
  }

  getOnButtonClick(): MiddlewareFn<OnButtonClickCtx>[] {
    return (this.#snapButtonClick ??= [...this.#onButtonClick]);
  }

  getOnEvent(): MiddlewareFn<OnEventCtx>[] {
    return (this.#snapEvent ??= [...this.#onEvent]);
  }
}

/**
 * Singleton — all dispatchers share this instance so registrations in
 * src/middleware/index.ts are visible everywhere at runtime.
 */
export const middlewareRegistry = new MiddlewareRegistry();

/** Typed as MiddlewareUse to expose only the registration surface at call sites. */
export const use: MiddlewareUse = middlewareRegistry;

// ── Chain Runner ──────────────────────────────────────────────────────────────

/**
 * Runs `middlewares` sequentially, then calls `finalHandler` once all have called next().
 * Designed to be called from dispatchers — each dispatch site provides its own finalHandler.
 *
 * WHY SEQUENTIAL AND NOT Promise.all?
 *   Parallelizing middleware breaks the short-circuit contract. If a fast guard (e.g., ban check)
 *   and a slow DB read run concurrently, the slow read wastes CPU/DB resources even if the request
 *   is banned. Sequential execution ensures fast guards protect expensive downstream operations.
 *   It also guarantees context mutations (like populating ctx.options) are safely available to the next step.
 *
 * Short-circuit contract:
 *   A middleware that does NOT call next() halts the chain at that point.
 *   Neither subsequent middleware nor the final handler will execute.
 *   This is the intended pattern for guard clauses (validation rejection,
 *   rate-limit enforcement, permission checks).
 *
 * NOTE: `finalHandler` must not call next(). Doing so would re-invoke finalHandler, not
 * advance the middleware chain (the chain is already exhausted at that point).
 */
export function runMiddlewareChain<TCtx>(
  middlewares: MiddlewareFn<TCtx>[],
  ctx: TCtx,
  finalHandler: () => Promise<void>,
): Promise<void> {
  let index = -1;

  function dispatch(i: number): Promise<void> {
    if (i <= index)
      return Promise.reject(new Error('next() called multiple times'));
    index = i;
    const mw = middlewares[i];
    try {
      if (mw !== undefined) {
        return Promise.resolve(mw(ctx, () => dispatch(i + 1)));
      } else {
        return Promise.resolve(finalHandler());
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return dispatch(0);
}
