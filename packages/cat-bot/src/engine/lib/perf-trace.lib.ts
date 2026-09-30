/**
 * Author: AjiroDesu
 *
 * Near-zero-overhead hot-path latency tracing for Cat-Bot's dispatch pipeline.
 *
 * Disabled by default. Set CATBOT_PERF_TRACE=1 to emit per-stage timings
 * (stage name + milliseconds, 3 decimals) to stderr. When disabled, each
 * mark compiles to a single boolean check (~1ns) with no allocation, no
 * I/O, and no clock read — the flag is captured once at module load so
 * there is not even a process.env lookup per event.
 *
 * Stages are marked by the message handler and command dispatcher; the
 * scripts/bench harness also uses perfNow() for its own measurements.
 */
const TRACE_ENABLED: boolean = process.env['CATBOT_PERF_TRACE'] === '1';

export function perfTraceEnabled(): boolean {
  return TRACE_ENABLED;
}

/** Monotonic nanosecond clock. Call once per stage boundary. */
export function perfNow(): bigint {
  return process.hrtime.bigint();
}

/** Emits one stderr line for the elapsed time since `startNs`. No-op unless traced. */
export function perfMark(stage: string, startNs: bigint): void {
  if (!TRACE_ENABLED) return;
  const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
  process.stderr.write(`[perf] ${stage} ${ms.toFixed(3)}ms\n`);
}
