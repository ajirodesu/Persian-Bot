/**
 * Recipe Command
 * Fetches a random meal recipe with instructions and ingredients.
 * Includes a "New Recipe" button to refresh without re-issuing the command.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

const TIMEOUT = 8000;
const API_URL = 'https://www.themealdb.com/api/json/v1/1/random.php';

export const meta: CommandMeta = {
  name: 'recipe',
  aliases: ['meal', 'food', 'cook'] as string[],
  version: '1.2.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Get a random recipe suggestion.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

interface MealDbMeal {
  strMeal: string;
  strCategory?: string;
  strArea?: string;
  strInstructions?: string;
  strMealThumb?: string;
  [key: string]: string | undefined;
}

interface MealDbResponse {
  meals?: MealDbMeal[];
}

async function fetchRecipe(): Promise<MealDbMeal | null> {
  try {
    const { data } = await axios.get<MealDbResponse>(API_URL, {
      timeout: TIMEOUT,
    });
    return data?.meals?.[0] ?? null;
  } catch {
    return null;
  }
}

function formatRecipe(meal: MealDbMeal): string {
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (meal[`strIngredient${i}`] ?? '').trim();
    const measure = (meal[`strMeasure${i}`] ?? '').trim();
    if (ing) {
      ingredients.push(`- ${ing}${measure ? ` (${measure})` : ''}`);
    }
  }

  let caption =
    `🍽️ **${meal.strMeal}**\n` +
    `📂 Category: ${meal.strCategory ?? 'Misc'}\n` +
    `🌎 Area: ${meal.strArea ?? 'Unknown'}\n\n` +
    `📝 **Instructions:**\n${meal.strInstructions ?? 'No instructions provided.'}\n\n` +
    `🥕 **Ingredients:**\n${ingredients.join('\n')}`;

  // Telegram caption limit — trim if needed
  if (caption.length > 1020) {
    caption = caption.substring(0, 1015) + '...';
  }

  return caption;
}

const BUTTON_ID = { newRecipe: 'new_recipe' } as const;

async function fetchAndSendRecipe(ctx: AppCtx): Promise<void> {
  const { native, button, session } = ctx;

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const meal = await fetchRecipe();
    if (!meal)
      throw new Error('Could not fetch a recipe. The kitchen is closed.');

    const caption = formatRecipe(meal);

    // Reuse active instance ID if triggered via button; generate new one for fresh command
    const buttonId = isButtonAction
      ? session.id
      : button.generateID({ id: BUTTON_ID.newRecipe, public: true });

    await finish({
      style: MessageStyle.MARKDOWN,
      message: caption,
      ...(meal.strMealThumb
        ? { attachment_url: [{ name: 'meal.jpg', url: meal.strMealThumb }] }
        : {}),
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(`⚠️ **Error:** ${error.message ?? 'Unknown error'}`);
  }
}

export const button = {
  [BUTTON_ID.newRecipe]: {
    label: '🔁 New Recipe',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => fetchAndSendRecipe(ctx),
  },
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await fetchAndSendRecipe(ctx);
};
