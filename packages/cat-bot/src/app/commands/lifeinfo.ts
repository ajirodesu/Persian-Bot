/**
 * /lifeinfo — Lifetime Body Statistics (conversational)
 *
 * Uses the onReply flow instead of requiring a command argument:
 *   1. User: /lifeinfo
 *   2. Bot:  Please reply and type your `<birthdate (YYYY-MM-DD)>`
 *   3. User: [quotes bot] 2005-05-17
 *   4. Bot:  🧬 **Life Info** — age, heartbeats, breaths, amazing facts, ...
 *
 * The bot's prompt is registered as a pending onReply state (keyed by the
 * bot-sent message ID). When the user quotes that message, dispatchOnReply
 * matches the ID, reads the birthdate from the reply, validates it, and
 * queries the Nexray "livefunfact" endpoint. Invalid input re-prompts.
 *
 * API: GET https://api.nexray.eu.cc/fun/livefunfact?birthdate=YYYY-MM-DD
 * Response shape: { status, author, result: { basic_info, cardiovascular,
 *   respiratory, metabolic_summary, amazing_facts, life_comparison, ... } }
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

/** Pending-flow state registered on the bot's birthdate prompt message. */
const STATE = {
  awaiting_birthdate: 'awaiting_birthdate',
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

interface LiveFunFactResult {
  birth_date?: string;
  basic_info?: {
    age_in_years?: number;
    age_in_months?: number;
    age_in_weeks?: number;
    age_in_days?: number;
    age_in_hours?: number;
  };
  respiratory?: {
    total_breaths?: number;
    total_air_volume_l?: number;
    oxygen_consumed_l?: number;
  };
  cardiovascular?: {
    heart_beats_total?: number;
    blood_pumped_l?: number;
    blood_distance_km?: number;
  };
  metabolic_summary?: {
    total_calories_burned?: number;
    water_processed_l?: number;
    waste_products_kg?: number;
  };
  amazing_facts?: {
    total_body_cells?: number;
    bacterial_cells?: number;
    total_dna_length_km?: number;
    blood_vessel_length_km?: number;
    neuron_connections?: number;
    bone_strength_psi?: number;
  };
  life_comparison?: {
    world_life_expectancy?: number;
    percentage_of_life_lived?: number;
    estimated_remaining_years?: number;
  };
  medical_disclaimer?: string;
}

interface LiveFunFactResponse {
  status?: boolean;
  result?: LiveFunFactResult;
}


// ── Helpers ──────────────────────────────────────────────────────────────────

/** Formats a (possibly huge) number with thousands separators for readability. */
function fmt(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? 'N/A'
    : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Validates that the argument is a real, non-future YYYY-MM-DD date. */
function isValidBirthdate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;

  // Reject impossible rollovers like 2024-02-31.
  const [year, month, day] = value.split('-').map(Number);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  return date.getTime() <= Date.now();
}

// ── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchLifeData(birthdate: string): Promise<LiveFunFactResult> {
  const url = createUrl('nexray', '/fun/livefunfact', { birthdate });
  const { data } = await axios.get<LiveFunFactResponse>(url, {
    timeout: 10_000,
    headers: { Accept: 'application/json' },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (!data?.result) {
    throw new Error(
      `Life info API returned ${data ? 'an invalid response' : 'no data'}`,
    );
  }

  return data.result;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatLifeInfo(birthdate: string, info: LiveFunFactResult): string {
  const basic = info.basic_info;
  const resp = info.respiratory;
  const cardio = info.cardiovascular;
  const metabolic = info.metabolic_summary;
  const facts = info.amazing_facts;
  const compare = info.life_comparison;

  const age = basic
    ? `**${fmt(basic.age_in_years)} yrs** · ${fmt(basic.age_in_months)} months · ${fmt(
        basic.age_in_days,
      )} days`
    : 'N/A';

  const lines: string[] = [
    `🧬 **Life Info**`,
    `🎂 Birthdate: **${birthdate}**`,
    ``,
    `**⏳ Time Alive**`,
    `👶 Age: ${age}`,
    `💓 Total heartbeats: **${fmt(cardio?.heart_beats_total)}**`,
    `🌬️ Total breaths: **${fmt(resp?.total_breaths)}**`,
    `🫁 Oxygen consumed: **${fmt(resp?.oxygen_consumed_l)} L**`,
    `🔁 Blood pumped: **${fmt(cardio?.blood_pumped_l)} L**`,
    `🔥 Calories burned: **${fmt(metabolic?.total_calories_burned)}**`,
    ``,
    `**✨ Amazing Facts**`,
    `🔬 Total body cells: **${fmt(facts?.total_body_cells)}**`,
    `🦠 Bacterial cells: **${fmt(facts?.bacterial_cells)}**`,
    `🧬 Total DNA length: **${fmt(facts?.total_dna_length_km)} km**`,
    `🩸 Blood vessel length: **${fmt(facts?.blood_vessel_length_km)} km**`,
    `🧠 Neuron connections: **${fmt(facts?.neuron_connections)}**`,
    `🦴 Bone strength: **${fmt(facts?.bone_strength_psi)} psi**`,
    ``,
    `**📊 Life Comparison**`,
    `🌍 World life expectancy: **${fmt(compare?.world_life_expectancy)} yrs**`,
    `📈 Life already lived: **${fmt(compare?.percentage_of_life_lived)}%**`,
    `⏳ Estimated remaining: **${fmt(compare?.estimated_remaining_years)} yrs**`,
  ];

  if (info.medical_disclaimer) {
    lines.push(``, `_${info.medical_disclaimer}_`);
  }

  return lines.join('\n');
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'lifeinfo',
  aliases: ['lifefact', 'life'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Get lifetime body statistics. Reply to the bot with your birthdate (YYYY-MM-DD).',
  category: 'Utility',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async ({ chat, state }: AppCtx): Promise<void> => {
  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      'Please reply and type your `<birthdate (YYYY-MM-DD)>`\nExample: `2005-05-17`',
  });

  // Guard: platforms that do not return a message ID from replyMessage cannot
  // support onReply because there is no stable key to register the state on.
  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ onReply unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  state.create({
    id: state.generateID({ id: String(messageID) }),
    state: STATE.awaiting_birthdate,
    context: {},
  });
};

// ── Reply Handler ─────────────────────────────────────────────────────────────

export const onReply = {
  /**
   * User replied to the bot's prompt with a birthdate. Validates it and, when
   * valid, fetches + sends the life info. Invalid input re-prompts by
   * registering a fresh state on the new (error) message so the user can retry.
   */
  [STATE.awaiting_birthdate]: async ({
    chat,
    session,
    event,
    state,
  }: AppCtx): Promise<void> => {
    // Remove the current state before continuing to prevent double-firing if
    // the user replies to the same prompt message a second time.
    state.delete(session.id);

    const raw = ((event['message'] as string | undefined) ?? '').trim();
    const birthdate = raw.split(/\s+/)[0] ?? '';

    if (!isValidBirthdate(birthdate)) {
      const retryID = await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ **Invalid birthdate.**\nPlease reply and type your `<birthdate (YYYY-MM-DD)>` (e.g. `2005-05-17`).',
      });

      if (retryID) {
        state.create({
          id: state.generateID({ id: String(retryID) }),
          state: STATE.awaiting_birthdate,
          context: {},
        });
      }
      return;
    }

    try {
      const info = await fetchLifeData(birthdate);
      const message = formatLifeInfo(birthdate, info);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message,
      });
    } catch (err) {
      const error = err as { message?: string };
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Failed to fetch life info for **${birthdate}**: \`${
          error.message ?? 'Unknown error'
        }\``,
      });
    }
  },
};
