/**
 * Second-opinion moderation as a graph.
 *
 * A verdict landing just below the confidence bar is the expensive case: the
 * bot will not act on it, so the owner has to read a flag. Asking a second,
 * different model — which never sees the first verdict (no anchoring) — and
 * acting only on agreement converts many of those into decisions without
 * lowering the bar for a single model.
 *
 *   judge → gate: borderline? —no→ done
 *                  │yes
 *                  ▼
 *             second → reconcile → done
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { runGraph, formatTrace } from './graph.js';
import { judge } from './moderator.js';
import { coerceVerdict } from './agent-types.js';
import type { Graph, State } from './graph.js';
import type { ChatPolicy, Verdict } from './agent-types.js';
import type { JudgeInput } from './moderator.js';

/** How far below the bar is still worth a second look. */
export const ESCALATION_BAND = 0.25;

export interface ConsensusResult {
  verdict: Verdict;
  /** 'agent' for a single call, 'consensus' when two models were combined. */
  stage: 'agent' | 'consensus';
  trace: string;
  error?: string;
  models: string[];
}

function isActionable(v: Verdict): boolean {
  return v.action !== 'allow' && v.action !== 'flag';
}

/** Borderline = would act, but not confidently — and not hopelessly below. */
export function isBorderline(v: Verdict, policy: ChatPolicy): boolean {
  if (!isActionable(v)) return false;
  return v.confidence < policy.minConfidence && v.confidence >= policy.minConfidence - ESCALATION_BAND;
}

function buildGraph(input: JudgeInput, policy: ChatPolicy): Graph {
  return {
    name: 'moderation-consensus',
    entry: 'judge',
    nodes: {
      judge: {
        id: 'judge',
        kind: 'transform',
        next: 'borderline',
        async run(state: State) {
          const { verdict, error, model } = await judge(input);
          return {
            first: verdict,
            verdict,
            models: [...((state.models as string[] | undefined) ?? []), model ?? 'unknown'],
            ...(error ? { error } : {}),
          };
        },
      },

      borderline: {
        id: 'borderline',
        kind: 'gate',
        when: (state) => isBorderline(state.first as Verdict, policy),
        then: 'second',
        otherwise: 'done',
      },

      second: {
        id: 'second',
        kind: 'transform',
        next: 'reconcile',
        async run(state: State) {
          const { verdict, error, model } = await judge({ ...input }, 'moderator2');
          return {
            second: verdict,
            models: [...((state.models as string[] | undefined) ?? []), model ?? 'unknown'],
            ...(error ? { secondError: error } : {}),
          };
        },
      },

      reconcile: {
        id: 'reconcile',
        kind: 'transform',
        next: 'done',
        run(state: State) {
          const a = state.first as Verdict;
          const b = state.second as Verdict;

          const agree = isActionable(b) && b.action === a.action;
          if (!agree) {
            return {
              verdict: coerceVerdict({
                action: a.action,
                category: a.category,
                confidence: Math.min(a.confidence, b.confidence),
                reason: `models disagreed (${a.action}/${a.confidence.toFixed(2)} vs ${b.action}/${b.confidence.toFixed(2)}) — ${a.reason}`,
              }),
              consensus: false,
            };
          }

          // Agreement raises confidence to the stronger of the two rather than
          // the average — averaging would keep many escalations under the bar
          // and make the whole step pointless.
          return {
            verdict: coerceVerdict({
              action: a.action,
              category: a.category,
              confidence: Math.max(a.confidence, b.confidence),
              reason: `two models agreed: ${a.reason}`,
            }),
            consensus: true,
          };
        },
      },

      done: { id: 'done', kind: 'transform', next: null, run: () => undefined },
    },
  };
}

/** Judge a message, escalating to a second model when borderline + opted in. */
export async function judgeWithConsensus(
  input: JudgeInput,
  policy: ChatPolicy,
): Promise<ConsensusResult> {
  if (!policy.secondOpinion) {
    const { verdict, error, model } = await judge(input);
    return {
      verdict,
      stage: 'agent',
      trace: 'single pass (second opinion off)',
      models: [model ?? 'unknown'],
      ...(error ? { error } : {}),
    };
  }

  const result = await runGraph(buildGraph(input, policy), { models: [] }, { maxSteps: 8, timeoutMs: 45_000 });

  const verdict =
    (result.state.verdict as Verdict | undefined) ??
    coerceVerdict({ action: 'allow', category: 'unknown', confidence: 0, reason: 'consensus graph produced no verdict' });

  return {
    verdict,
    stage: result.state.second ? 'consensus' : 'agent',
    trace: formatTrace(result.trace),
    models: (result.state.models as string[] | undefined) ?? [],
    ...(result.error ? { error: result.error } : {}),
  };
}

export const __test = { isBorderline, buildGraph, ESCALATION_BAND };
