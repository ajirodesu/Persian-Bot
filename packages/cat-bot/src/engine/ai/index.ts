/**
 * AI subsystem barrel — Reze-style agent engine adapted to Persian-Bot.
 *
 * Portions derived from Reze-Bot (MIT):
 *   https://github.com/GrandpaEJx/Reze-Bot
 * See THIRD_PARTY_NOTICES.md.
 */

export * from './provider/index.js';
export * from './agent-types.js';
export * from './sanitize.js';
export * from './tools.js';
export * from './tool-parse.js';
export * from './config.js';
export * from './runner.js';
export * from './loop.js';
export * from './prompt-builder.js';
export * from './prompt-agent.js';
export * from './memory.js';
export * from './builtin-tools.js';
export * from './graph.js';
export * from './service.js';

// These modules also export a `__test` seam object, so they are re-exported
// by name to avoid `export *` ambiguity.
export { prefetch, renderPrefetch, RULES } from './prefetch.js';
export type { PrefetchRule, PrefetchResult } from './prefetch.js';
export { judge } from './moderator.js';
export type { JudgeInput } from './moderator.js';
export { compileOrder, coercePolicyPatch, diffPatch } from './policy.js';
export type { PolicyPatch } from './policy.js';
export { getPolicy, applyPatch, savePolicy, defaultPolicyFor } from './policy-store.js';
export type { PolicyStoreHandles } from './policy-store.js';
export { recordModeration, recentModerations, clearPolicyCache, clearAudit } from './policy-store.js';
export type { ModAuditEntry } from './policy-store.js';
export { draftPost, rewritePost, coerceDraft, MAX_POST_LENGTH } from './editor.js';
export type { Draft } from './editor.js';
export { judgeWithConsensus, isBorderline, ESCALATION_BAND } from './consensus.js';
export type { ConsensusResult } from './consensus.js';
export * from './mcp/scan.js';
export { listMcpTools, callMcpTool } from './mcp/client.js';
export { getIntegrationTools, isUsableBy, probeIntegration } from './mcp/integrations.js';
export { validateIntegrationInput } from './mcp/validate.js';
