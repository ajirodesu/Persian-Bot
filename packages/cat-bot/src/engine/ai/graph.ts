/**
 * Node graph runtime — bounded multi-agent orchestration.
 *
 * A graph is a map of nodes plus an entry point. Each node reads shared
 * state, returns a patch, and names the next node. Kinds: agent, tool,
 * transform, gate, router, parallel.
 *
 * Every execution is bounded (max steps, max visits per node, total
 * timeout). Graphs are validated before running so dangling references are
 * caught before expensive work begins. Each run produces a trace.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions.
 */

import { runLoop } from './loop.js';
import { askAgentText } from './runner.js';
import { executeTool } from './tools.js';
import type { Tool, ToolContext } from './tools.js';
import type { AgentConfig } from './agent-types.js';

export type State = Record<string, unknown>;
export type Patch = State | void | undefined;

/** Returning null ends the run. */
export type NextRef = string | null;

export interface NodeResultMeta {
  note?: string;
  model?: string;
}

interface Common {
  id: string;
  /** Where to go when the node finishes. Omit to end the run. */
  next?: NextRef;
  /** 'fail' aborts the run; 'continue' records the error and follows `next`. */
  onError?: 'fail' | 'continue';
}

export interface AgentNode extends Common {
  kind: 'agent';
  /** Agent config name. */
  agent?: string;
  system: (state: State) => string;
  user: (state: State) => string;
  /** Present = full tool loop; absent = a single turn. */
  tools?: Tool[];
  maxSteps?: number;
  overrides?: Partial<AgentConfig>;
  /** Map the model's text into a state patch. */
  output: (text: string, state: State) => Patch;
}

export interface ToolNode extends Common {
  kind: 'tool';
  tool: string;
  args: (state: State) => Record<string, unknown>;
  output: (result: { ok: boolean; content: string; data?: unknown }, state: State) => Patch;
}

export interface TransformNode extends Common {
  kind: 'transform';
  run: (state: State) => Patch | Promise<Patch>;
}

export interface GateNode extends Common {
  kind: 'gate';
  when: (state: State) => boolean | Promise<boolean>;
  then: NextRef;
  otherwise: NextRef;
}

export interface RouterNode extends Common {
  kind: 'router';
  routes: { to: NextRef; when: (state: State) => boolean | Promise<boolean>; label?: string }[];
  fallback: NextRef;
}

export interface ParallelNode extends Common {
  kind: 'parallel';
  /** Node ids to run concurrently. Their own `next` is ignored. */
  branches: string[];
}

export type Node = AgentNode | ToolNode | TransformNode | GateNode | RouterNode | ParallelNode;

export interface Graph {
  name: string;
  entry: string;
  nodes: Record<string, Node>;
}

export interface TraceEntry {
  step: number;
  node: string;
  kind: string;
  ms: number;
  ok: boolean;
  note?: string;
  error?: string;
  next?: NextRef;
}

export interface GraphOptions {
  ctx?: ToolContext;
  /** Turn-scoped tools visible to `tool` nodes (same semantics as the loop). */
  tools?: Tool[];
  maxSteps?: number;
  /** Cycle guard: how often one node may run in a single graph run. */
  maxVisitsPerNode?: number;
  timeoutMs?: number;
  onTrace?: (entry: TraceEntry) => void | Promise<void>;
}

export interface GraphResult {
  state: State;
  trace: TraceEntry[];
  stopReason: 'end' | 'max_steps' | 'max_visits' | 'timeout' | 'error';
  error?: string;
}

const DEFAULTS = { maxSteps: 25, maxVisitsPerNode: 4, timeoutMs: 120_000 };

/** Catch dangling edges before the graph runs. */
export function validateGraph(graph: Graph): string[] {
  const errors: string[] = [];
  const ids = new Set(Object.keys(graph.nodes));

  if (!ids.has(graph.entry)) errors.push(`entry "${graph.entry}" is not a node`);

  const check = (from: string, ref: NextRef | undefined, label: string): void => {
    if (ref === undefined || ref === null) return;
    if (!ids.has(ref)) errors.push(`${from}.${label} points at "${ref}", which is not a node`);
  };

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.id !== id) errors.push(`node key "${id}" does not match its id "${node.id}"`);
    check(id, node.next, 'next');
    if (node.kind === 'gate') {
      check(id, node.then, 'then');
      check(id, node.otherwise, 'otherwise');
    }
    if (node.kind === 'router') {
      node.routes.forEach((r, i) => check(id, r.to, `routes[${i}]`));
      check(id, node.fallback, 'fallback');
    }
    if (node.kind === 'parallel') {
      for (const b of node.branches) {
        if (!ids.has(b)) errors.push(`${id}.branches includes "${b}", which is not a node`);
      }
    }
  }
  return errors;
}

async function runNode(
  node: Node,
  state: State,
  opts: GraphOptions & { _graph?: Graph },
): Promise<{ patch: Patch; next: NextRef; meta: NodeResultMeta }> {
  switch (node.kind) {
    case 'transform': {
      const patch = await node.run(state);
      return { patch, next: node.next ?? null, meta: {} };
    }

    case 'gate': {
      const pass = await node.when(state);
      return {
        patch: undefined,
        next: pass ? node.then : node.otherwise,
        meta: { note: pass ? 'then' : 'otherwise' },
      };
    }

    case 'router': {
      for (const route of node.routes) {
        if (await route.when(state)) {
          return { patch: undefined, next: route.to, meta: { note: route.label ?? String(route.to) } };
        }
      }
      return { patch: undefined, next: node.fallback, meta: { note: 'fallback' } };
    }

    case 'tool': {
      if (!opts.ctx) throw new Error(`node "${node.id}" needs a ToolContext — pass ctx to runGraph`);
      const result = await executeTool(node.tool, node.args(state), opts.ctx, opts.tools);
      return {
        patch: node.output(result, state),
        next: node.next ?? null,
        meta: { note: result.ok ? 'ok' : result.content.slice(0, 60) },
      };
    }

    case 'agent': {
      const system = node.system(state);
      const user = node.user(state);

      if (node.tools?.length) {
        if (!opts.ctx) throw new Error(`node "${node.id}" has tools but no ToolContext`);
        const res = await runLoop({
          ...(node.agent !== undefined ? { agent: node.agent } : {}),
          system,
          messages: [{ role: 'user', content: user }],
          tools: node.tools,
          ctx: opts.ctx,
          ...(node.maxSteps !== undefined ? { maxSteps: node.maxSteps } : {}),
          ...(node.overrides ? { overrides: node.overrides } : {}),
        });
        return {
          patch: node.output(res.text, state),
          next: node.next ?? null,
          meta: {
            note: `${res.stopReason}, ${res.toolCalls.length} tool call(s)`,
            ...(res.model ? { model: res.model } : {}),
          },
        };
      }

      const res = await askAgentText(node.agent ?? 'default', {
        system,
        user,
        ...(node.overrides ? { overrides: node.overrides } : {}),
        ...(opts.ctx?.userId ? { userId: opts.ctx.userId } : {}),
      });
      return {
        patch: node.output(res.data, state),
        next: node.next ?? null,
        meta: { model: `${res.provider}/${res.model}` },
      };
    }

    case 'parallel': {
      // Branch order, not completion order, decides patch precedence.
      const results = await Promise.all(
        node.branches.map(async (id) => {
          const branch = opts._graph?.nodes[id];
          if (!branch) throw new Error(`parallel branch "${id}" is not a node`);
          return runNode(branch, state, opts);
        }),
      );

      const merged: State = {};
      for (const r of results) {
        if (r.patch) Object.assign(merged, r.patch);
      }
      return { patch: merged, next: node.next ?? null, meta: { note: `${node.branches.length} branches` } };
    }
  }
}

export async function runGraph(
  graph: Graph,
  initialState: State = {},
  opts: GraphOptions = {},
): Promise<GraphResult> {
  const problems = validateGraph(graph);
  if (problems.length > 0) {
    return {
      state: initialState,
      trace: [],
      stopReason: 'error',
      error: `Invalid graph "${graph.name}": ${problems.join('; ')}`,
    };
  }

  const maxSteps = opts.maxSteps ?? DEFAULTS.maxSteps;
  const maxVisits = opts.maxVisitsPerNode ?? DEFAULTS.maxVisitsPerNode;
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULTS.timeoutMs);

  const runtimeOpts: GraphOptions & { _graph?: Graph } = { ...opts, _graph: graph };

  const state: State = { ...initialState };
  const trace: TraceEntry[] = [];
  const visits = new Map<string, number>();

  let current: NextRef = graph.entry;
  let step = 0;

  while (current) {
    step++;
    if (step > maxSteps) return { state, trace, stopReason: 'max_steps' };
    if (Date.now() > deadline) return { state, trace, stopReason: 'timeout' };

    const seen = (visits.get(current) ?? 0) + 1;
    visits.set(current, seen);
    if (seen > maxVisits) {
      return {
        state,
        trace,
        stopReason: 'max_visits',
        error: `node "${current}" ran ${seen} times — cycle guard`,
      };
    }

    const node: Node = graph.nodes[current]!;
    const started = Date.now();

    try {
      const { patch, next, meta } = await runNode(node, state, runtimeOpts);
      if (patch) Object.assign(state, patch);

      const entry: TraceEntry = {
        step,
        node: node.id,
        kind: node.kind,
        ms: Date.now() - started,
        ok: true,
        next,
        ...(meta.note ? { note: meta.note } : {}),
      };
      // Preserve model attribution when present without breaking exactOptionalPropertyTypes.
      if (meta.model) entry.note = entry.note ? `${entry.note} [${meta.model}]` : `[${meta.model}]`;
      trace.push(entry);
      await opts.onTrace?.(entry);
      current = next;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const entry: TraceEntry = {
        step,
        node: node.id,
        kind: node.kind,
        ms: Date.now() - started,
        ok: false,
        error: message,
        next: node.onError === 'continue' ? (node.next ?? null) : null,
      };
      trace.push(entry);
      await opts.onTrace?.(entry);

      if (node.onError !== 'continue') {
        return { state, trace, stopReason: 'error', error: `node "${node.id}": ${message}` };
      }
      current = node.next ?? null;
    }
  }

  return { state, trace, stopReason: 'end' };
}

/** Render a trace as an indented list — for logs or a debug reply. */
export function formatTrace(trace: TraceEntry[]): string {
  return trace
    .map(
      (t) =>
        `${String(t.step).padStart(2)}. ${t.ok ? '✓' : '✗'} ${t.node} (${t.kind}, ${t.ms}ms)` +
        `${t.note ? ` — ${t.note}` : ''}${t.error ? ` — ${t.error}` : ''}` +
        `${t.next ? ` → ${t.next}` : ''}`,
    )
    .join('\n');
}
