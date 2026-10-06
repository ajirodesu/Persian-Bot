/**
 * Live model catalog — fetches each provider's real model list with the
 * operator's own stored key, so dashboard pickers show what actually exists
 * instead of hardcoded guesses.
 *
 * Keys are resolved server-side from the DB snapshot and never leave the
 * server; failures come back as errors, never partial guesses.
 */

import { createProvider, listProviders } from './provider/index.js';
import { providerSettings } from './config.js';

export interface ProviderModelList {
  provider: string;
  models: string[];
}

/** Fetch live model ids for one provider using the caller's stored key. */
export async function listProviderModels(
  provider: string,
  userId?: string,
): Promise<ProviderModelList> {
  const name = provider.trim().toLowerCase();
  if (!listProviders().includes(name)) {
    throw new Error(`Unknown provider "${provider}".`);
  }
  const settings = providerSettings(name, userId);
  if (!settings.apiKey && name !== 'ollama' && name !== 'lmstudio') {
    throw new Error(`No API key configured for provider "${name}".`);
  }
  const instance = createProvider(name, {
    apiKey: settings.apiKey ?? 'local',
    ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    timeout: 15_000,
    maxRetries: 0,
  });
  if (!instance.listModels) {
    throw new Error(`Provider "${name}" does not expose a models endpoint.`);
  }
  const models = await instance.listModels();
  return { provider: name, models };
}
