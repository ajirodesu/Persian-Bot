/**
 * AI Agent — Provider Clients
 *
 * Lazy, key-cached client factories for every LLM provider the agent supports,
 * ported from mrepol742/project-canis (src/components/ai/*):
 *
 *   OpenAI-compatible chat-completions (one OpenAI SDK client, baseURL routed):
 *     • openrouter — https://openrouter.ai/api/v1
 *     • groq       — https://api.groq.com/openai/v1
 *     • nvidia     — https://integrate.api.nvidia.com/v1
 *     • openai     — native OpenAI
 *   Native SDK:
 *     • gemini     — @google/genai (GoogleGenAI)
 *
 * Clients are cached per (baseURL, apiKey) so per-user keys from the dashboard
 * never share a client with another user, while repeated turns reuse one.
 */

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

export type AgentProviderId =
  'openrouter' | 'groq' | 'nvidia' | 'openai' | 'gemini' | 'zen';

export const AGENT_PROVIDER_IDS: AgentProviderId[] = [
  'openrouter',
  'groq',
  'nvidia',
  'openai',
  'gemini',
  'zen',
];

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return (
    typeof value === 'string' &&
    (AGENT_PROVIDER_IDS as string[]).includes(value)
  );
}

// ── OpenAI-compatible clients ──────────────────────────────────────────────────

const BASE_URLS: Partial<Record<AgentProviderId, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  openai: 'https://api.openai.com/v1',
  zen: 'https://opencode.ai/zen/v1',
};

/** Cache keyed by `${baseURL}::${apiKey}` so per-user keys stay isolated. */
const openAiLikeCache = new Map<string, OpenAI>();

export function getOpenAiLikeClient(
  provider: AgentProviderId,
  apiKey?: string,
): OpenAI {
  const baseURL = BASE_URLS[provider];
  const cacheKey = `${baseURL ?? 'default'}::${apiKey ?? ''}`;
  const cached = openAiLikeCache.get(cacheKey);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: apiKey ?? 'missing',
    ...(baseURL ? { baseURL } : {}),
  });
  openAiLikeCache.set(cacheKey, client);
  return client;
}

// ── Gemini ─────────────────────────────────────────────────────────────────────

const geminiCache = new Map<string, GoogleGenAI>();

export function getGeminiClient(apiKey?: string): GoogleGenAI {
  const cacheKey = apiKey ?? '';
  const cached = geminiCache.get(cacheKey);
  if (cached) return cached;
  const client = new GoogleGenAI({ apiKey: apiKey ?? 'missing' });
  geminiCache.set(cacheKey, client);
  return client;
}

// No env fallbacks — keys and models come exclusively from each user's
// dashboard config (ai-config resolution supplies the default model).
