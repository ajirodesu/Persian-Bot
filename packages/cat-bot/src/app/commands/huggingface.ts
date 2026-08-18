/**
 * huggingface.ts — /huggingface — Search Hugging Face models
 *
 * Port of canis's huggingface.ts: queries the HF model API and returns the
 * top result's metadata.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

export const meta: CommandMeta = {
  name: 'huggingface',
  aliases: ['hf'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description: 'Search for models on Hugging Face.',
  category: 'ai',
  usage: '<query>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

interface HfModel {
  modelId: string;
  tags?: string[];
  library_name?: string | null;
  pipeline_tag?: string | null;
  likes?: number;
  downloads?: number;
  createdAt?: string;
  private?: boolean;
}

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, usage } = ctx;
  const query = args.join(' ').trim();
  if (!query) {
    await usage();
    return;
  }

  try {
    const response = await axios.get<HfModel[]>(
      `https://huggingface.co/api/models?search=${encodeURIComponent(query)}`,
      { timeout: 20_000 },
    );

    const models = response.data?.[0];
    if (!models) {
      await chat.replyMessage({
        message: `No models found for "${query}".`,
      });
      return;
    }

    const tags = (models.tags ?? []).slice(0, 5).join(', ') || 'N/A';
    const info = [
      `\`${models.modelId}\``,
      `${tags}`,
      ``,
      `Library: ${models.library_name ?? 'N/A'}`,
      `Pipeline: ${models.pipeline_tag ?? 'N/A'}`,
      `Likes: ${models.likes ?? 0}`,
      `Downloads: ${models.downloads ?? 0}`,
      `Created At: ${models.createdAt ? new Date(models.createdAt).toLocaleString() : 'N/A'}`,
      `Private: ${models.private ? 'Yes' : 'No'}`,
      `Model URL: https://huggingface.co/${models.modelId}`,
    ].join('\n');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: info,
    });
  } catch {
    await chat.replyMessage({
      message: '⚠️ Failed to search Hugging Face. Please try again.',
    });
  }
};
