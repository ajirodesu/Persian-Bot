/**
 * Animal Photos Service — shared implementation for the animal-photo family.
 *
 * Each provider has its own response shape, so `extractUrl` is the one
 * per-config hook that normalizes it down to a plain image URL string. The
 * delivery and button contract is identical across all six commands.
 */

import axios from 'axios';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import { createMessageDelivery } from './message-delivery.service.js';

export interface AnimalConfig {
  name: string;
  label: string;
  emoji: string;
  buttonLabel: string;
  apiUrl: string;
  apiParams?: Record<string, string>;
  /** Normalizes whatever shape this provider returns down to an image URL. */
  extractUrl: (data: unknown) => string | null;
}

async function fetchAnimalImage(config: AnimalConfig): Promise<string | null> {
  try {
    const { data } = await axios.get(config.apiUrl, {
      ...(config.apiParams ? { params: config.apiParams } : {}),
      headers: { Accept: 'application/json' },
      timeout: 10000,
    });
    return config.extractUrl(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${config.name}] fetchAnimalImage error:`, msg);
    return null;
  }
}

export function animalButtonId(config: AnimalConfig): string {
  return `${config.name}-next`;
}

/** Runs the shared animal-photo fetch/render flow for a family config. */
export async function runAnimalPhoto(
  ctx: AppCtx,
  config: AnimalConfig,
): Promise<void> {
  const { native, button, session } = ctx;
  const isButtonAction = ctx.event['type'] === 'button_action';
  const delivery = createMessageDelivery(ctx);

  try {
    const imageUrl = await fetchAnimalImage(config);

    if (!imageUrl) {
      await delivery.fail(
        `⚠️ **Error:** Could not retrieve a ${config.name} image.`,
      );
      return;
    }

    // Derive the file extension so MIME detection works correctly on all
    // platforms — these providers occasionally serve gifs alongside photos.
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: animalButtonId(config), public: true });

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message: `${config.emoji} **${config.label}**`,
      attachment_url: [{ name: `${config.name}.${ext}`, url: imageUrl }],
      ...(hasNativeButtons(native.platform)
        ? { button: [resolvedButtonId] }
        : {}),
    });
  } catch {
    await delivery.fail(
      `⚠️ **System Error:** Failed to fetch a ${config.name} image. Please try again later.`,
    );
  }
}

export interface AnimalButtonDefinition {
  label: string;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  onClick: (ctx: AppCtx) => Promise<void>;
}

/** Builds the next-image button for a family config. */
export function createAnimalButton(
  config: AnimalConfig,
): Record<string, AnimalButtonDefinition> {
  return {
    [animalButtonId(config)]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx): Promise<void> =>
        runAnimalPhoto(ctx, config),
    },
  };
}
