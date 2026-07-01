/**
 * /quiz — True/False Trivia Game (Economy Integration)
 *
 * Button-only version.
 * Reaction-based answering has been removed completely.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

export const meta: CommandMeta = {
  name: 'quiz',
  aliases: ['trivia'] as string[],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description:
    'Answer a True/False trivia question and earn coins for correct answers. Stats are tracked per user.',
  category: 'Economy',
  usage: '[easy | medium | hard]',
  cooldown: 10,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'difficulty',
      description:
        'Question difficulty: easy, medium, or hard (random if omitted)',
      required: false,
    },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Coin reward per difficulty (easy → low risk/reward, hard → high risk/reward).
 * Mirrors the pay-range scaling used in /work and /fish.
 */
const REWARD_COINS: Record<Difficulty, number> = {
  easy: 50,
  medium: 100,
  hard: 200,
};

/**
 * Button IDs registered by this command.
 *
 * Navigation flow:
 *   [✅ true / ❌ false] → answer evaluated
 *   Result card          → [🔄 play_again]  [💰 balance]
 *   Balance view         → [⬅ back]
 *   ⬅ back               → result card restored
 */
const BUTTON_ID = {
  true: 'true',
  false: 'false',
  playAgain: 'play_again',
  balance: 'balance',
  back: 'back',
} as const;

const TIMEOUT_MS = 20_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface TriviaResult {
  question: string;
  correct_answer: 'True' | 'False';
  difficulty: string;
  category: string;
}

interface TriviaResponse {
  response_code: number;
  results: TriviaResult[];
}

/** Stored in the ✅/❌ answer button contexts (holds question data per message). */
interface ButtonQuizContext extends Record<string, unknown> {
  answer: string;
  question: string;
  messageID: string;
  difficulty: Difficulty;
  category: string;
}

/**
 * Stored in BOTH the 💰 Balance and ⬅ Back button contexts.
 * Each button holds the other's stable ID so navigation can toggle without
 * regenerating IDs on every click.
 */
interface QuizResultBtnCtx extends Record<string, unknown> {
  resultMessage: string;
  playAgainId: string;
  balanceId: string;
  backId: string;
}

/** Quiz stats persisted in the "quiz" collection (fish/work schema pattern). */
interface QuizStats {
  wins: number;
  losses: number;
  totalEarned: number;
  questionCount: number;
}

// ── Module-level trackers ─────────────────────────────────────────────────────
const pendingAnswers = new Map<string, boolean>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

// ── Collection helpers (db.users.collection — fish/work/daily pattern) ────────

/**
 * Returns the "quiz" collection for the given user, creating it on first use.
 * Mirrors getSlotCollection / fish collection init exactly.
 */
async function getQuizCollection(ctx: AppCtx, senderID: string) {
  const userColl = ctx.db.users.collection(senderID);
  if (!(await userColl.isCollectionExist('quiz'))) {
    await userColl.createCollection('quiz');
  }
  return userColl.getCollection('quiz');
}

/**
 * Reads the user's quiz stats from the collection.
 * Returns zeroed defaults when a field has never been written (getMoney pattern).
 */
async function readQuizStats(ctx: AppCtx, senderID: string): Promise<QuizStats> {
  const coll = await getQuizCollection(ctx, senderID);
  return {
    wins: ((await coll.get('wins')) as number | undefined) ?? 0,
    losses: ((await coll.get('losses')) as number | undefined) ?? 0,
    totalEarned: ((await coll.get('totalEarned')) as number | undefined) ?? 0,
    questionCount: ((await coll.get('questionCount')) as number | undefined) ?? 0,
  };
}

/**
 * Persists the user's updated quiz stats.
 * Individual set() calls per field — same explicit pattern as daily/work/fish.
 */
async function saveQuizStats(
  ctx: AppCtx,
  senderID: string,
  stats: QuizStats,
): Promise<void> {
  const coll = await getQuizCollection(ctx, senderID);
  await coll.set('wins', stats.wins);
  await coll.set('losses', stats.losses);
  await coll.set('totalEarned', stats.totalEarned);
  await coll.set('questionCount', stats.questionCount);
}

// ── Context reader (slot.ts readSlotButtonContext pattern) ────────────────────

function readResultBtnCtx(raw: unknown): QuizResultBtnCtx | undefined {
  const c = raw as Partial<QuizResultBtnCtx> | undefined;
  if (!c?.resultMessage || !c.playAgainId || !c.balanceId || !c.backId) {
    return undefined;
  }
  return {
    resultMessage: c.resultMessage,
    playAgainId: c.playAgainId,
    balanceId: c.balanceId,
    backId: c.backId,
  };
}

// ── Core quiz runner (shared by onCommand and 🔄 Play Again) ──────────────────
async function runButtonQuiz(ctx: AppCtx, difficulty: Difficulty): Promise<void> {
  const { chat, button: btn, event, native } = ctx;
  const reward = REWARD_COINS[difficulty];

  let result: TriviaResult;
  try {
    const response = await axios.get<TriviaResponse>(
      `https://opentdb.com/api.php?amount=1&encode=url3986&type=boolean&difficulty=${difficulty}`,
    );
    const first = response.data.results[0];
    if (response.data.response_code !== 0 || !first) {
      throw new Error(`API response_code=${response.data.response_code}`);
    }
    result = first;
  } catch {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Could not fetch a trivia question — the server may be busy. Please try again!',
    });
    return;
  }

  const question = decodeURIComponent(result.question);
  const category = decodeURIComponent(result.category);
  const answer = result.correct_answer;

  const trueId = btn.generateID({ id: BUTTON_ID.true, public: true });
  const falseId = btn.generateID({ id: BUTTON_ID.false, public: true });

  const isFromButtonAction = event?.['type'] === 'button_action';
  let messageID: string | number | null = null;

  const questionBody = [
    `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
    ``,
    question,
    ``,
    `💰 Reward: **${reward} coins** for a correct answer`,
    ``,
    `_You have ${TIMEOUT_MS / 1000} seconds to answer!_`,
  ].join('\n');

  if (isFromButtonAction) {
    const currentMsgID = event['messageID'];
    if (typeof currentMsgID !== 'string' && typeof currentMsgID !== 'number') {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not restart quiz: missing message ID.',
      });
      return;
    }
    messageID = currentMsgID;
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: String(messageID),
      message: questionBody,
      ...(hasNativeButtons(native.platform) ? { button: [trueId, falseId] } : {}),
    });
  } else {
    messageID = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: questionBody,
      ...(hasNativeButtons(native.platform) ? { button: [trueId, falseId] } : {}),
    })) as string | number | null;
  }

  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ Button quiz unavailable: this platform did not return a message ID.',
    });
    return;
  }

  const msgIdStr = String(messageID);

  if (timeouts.has(msgIdStr)) {
    clearTimeout(timeouts.get(msgIdStr)!);
    timeouts.delete(msgIdStr);
  }

  pendingAnswers.set(msgIdStr, false);

  const quizCtx: ButtonQuizContext = {
    answer,
    question,
    messageID: msgIdStr,
    difficulty,
    category,
  };
  btn.createContext({ id: trueId, context: quizCtx });
  btn.createContext({ id: falseId, context: quizCtx });

  const timeoutHandle = setTimeout(() => {
    if (pendingAnswers.get(msgIdStr) === true) return;
    pendingAnswers.delete(msgIdStr);
    timeouts.delete(msgIdStr);

    const playAgainId = btn.generateID({ id: BUTTON_ID.playAgain, public: true });
    btn.createContext({
      id: playAgainId,
      context: { difficulty } satisfies Record<string, unknown>,
    });

    void chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: msgIdStr,
      message: [
        `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
        ``,
        question,
        ``,
        `⏰ **Time's up!** The correct answer was **${answer}**.`,
      ].join('\n'),
      ...(hasNativeButtons(native.platform) ? { button: [playAgainId] } : {}),
    });
  }, TIMEOUT_MS);

  timeouts.set(msgIdStr, timeoutHandle);
}

// ── Answer result handler (button flow) ───────────────────────────────────────
async function showButtonResult(
  ctx: AppCtx,
  userAnswer: 'True' | 'False',
): Promise<void> {
  const { chat, event, session, button: btn, currencies, native } = ctx;

  const quizCtx = session.context as Partial<ButtonQuizContext>;
  const msgId = quizCtx.messageID ?? (event['messageID'] as string);
  const answer = quizCtx.answer ?? '';
  const difficulty = (quizCtx.difficulty ?? 'medium') as Difficulty;
  const question = quizCtx.question ?? '';
  const category = quizCtx.category ?? '';

  if (pendingAnswers.get(msgId) === true) return;
  pendingAnswers.set(msgId, true);

  if (timeouts.has(msgId)) {
    clearTimeout(timeouts.get(msgId)!);
    timeouts.delete(msgId);
  }

  btn.deleteContext(session.id);

  const senderID = event['senderID'] as string | undefined;
  const isCorrect = userAnswer === answer;
  const reward = REWARD_COINS[difficulty];

  let stats: QuizStats = { wins: 0, losses: 0, totalEarned: 0, questionCount: 0 };
  let newBalance = 0;

  if (senderID) {
    stats = await readQuizStats(ctx, senderID);
    stats.questionCount += 1;

    if (isCorrect) {
      stats.wins += 1;
      stats.totalEarned += reward;
      await saveQuizStats(ctx, senderID, stats);
      await currencies.increaseMoney({ user_id: senderID, money: reward });
      newBalance = await currencies.getMoney(senderID);
    } else {
      stats.losses += 1;
      await saveQuizStats(ctx, senderID, stats);
      newBalance = await currencies.getMoney(senderID);
    }
  }

  const winRate =
    stats.questionCount > 0
      ? Math.round((stats.wins / stats.questionCount) * 100)
      : 0;

  const verdictLine = isCorrect
    ? `✅ **Correct!** The answer was **${answer}**. Well done! 🎉`
    : `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${answer}**. 😔`;

  const coinBlock =
    isCorrect && senderID
      ? [
          ``,
          `💰 **+${reward} coins** earned!`,
          `📊 Balance: **${newBalance.toLocaleString()} coins**`,
        ].join('\n')
      : '';

  const statsLine = senderID
    ? [
        ``,
        `🏆 Wins: **${stats.wins}** | Losses: **${stats.losses}** | Win Rate: **${winRate}%**`,
        `💎 Lifetime earned: **${stats.totalEarned.toLocaleString()} coins**`,
      ].join('\n')
    : '';

  const resultMessage = [
    `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
    ``,
    question,
    ``,
    verdictLine,
    ...(coinBlock ? [coinBlock] : []),
    ...(statsLine ? [statsLine] : []),
  ].join('\n');

  const playAgainId = btn.generateID({ id: BUTTON_ID.playAgain, public: true });
  btn.createContext({
    id: playAgainId,
    context: { difficulty } satisfies Record<string, unknown>,
  });

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  const btnCtx: QuizResultBtnCtx = {
    resultMessage,
    playAgainId,
    balanceId,
    backId,
  };

  btn.createContext({ id: balanceId, context: btnCtx });
  btn.createContext({ id: backId, context: btnCtx });

  const buttons = senderID ? [playAgainId, balanceId] : [playAgainId];

  await chat.editMessage({
    style: MessageStyle.MARKDOWN,
    message_id_to_edit: msgId,
    message: resultMessage,
    ...(hasNativeButtons(native.platform) ? { button: buttons } : {}),
  });
}

// ── Button definitions ────────────────────────────────────────────────────────
export const button = {
  [BUTTON_ID.true]: {
    label: '✅ True',
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'True'),
  },

  [BUTTON_ID.false]: {
    label: '❌ False',
    style: ButtonStyle.DANGER,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'False'),
  },

  [BUTTON_ID.playAgain]: {
    label: '🔄 Play Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      const { button: btn, session } = ctx;

      const storedDifficulty = session.context['difficulty'] as
        | Difficulty
        | undefined;
      const difficulty: Difficulty =
        storedDifficulty &&
        (DIFFICULTIES as readonly string[]).includes(storedDifficulty)
          ? storedDifficulty
          : DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium';

      btn.deleteContext(session.id);
      await runButtonQuiz(ctx, difficulty);
    },
  },

  [BUTTON_ID.balance]: {
    label: '💰 Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session, currencies }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const msgId = event['messageID'] as string | undefined;

      const btnCtx = readResultBtnCtx(session.context);

      if (!senderID || !msgId || !btnCtx) return;

      const coins = await currencies.getMoney(senderID);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: [
          `💰 **Coin Balance**`,
          ``,
          `📊 Current balance: **${coins.toLocaleString()} coins**`,
        ].join('\n'),
        ...(hasNativeButtons(native.platform) ? { button: [btnCtx.backId] } : {}),
      });
    },
  },

  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session }: AppCtx) => {
      const msgId = event['messageID'] as string | undefined;

      const btnCtx = readResultBtnCtx(session.context);

      if (!msgId || !btnCtx) {
        if (msgId) {
          await chat.editMessage({
            style: MessageStyle.MARKDOWN,
            message_id_to_edit: msgId,
            message: '❌ Could not restore the result — please run `/quiz` again.',
          });
        }
        return;
      }

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: btnCtx.resultMessage,
        ...(hasNativeButtons(native.platform)
          ? { button: [btnCtx.playAgainId, btnCtx.balanceId] }
          : {}),
      });
    },
  },
};

// ── Command entry point ───────────────────────────────────────────────────────
export const onCommand = async ({
  chat,
  args,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  const rawArg = (args[0] ?? '').toLowerCase();
  const difficulty: Difficulty = (DIFFICULTIES as readonly string[]).includes(rawArg)
    ? (rawArg as Difficulty)
    : DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium';

  await runButtonQuiz({ chat, native, button: btn } as AppCtx, difficulty);
};