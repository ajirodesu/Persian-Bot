/**
 * /quiz — True/False Trivia Game (Economy Integration)
 *
 * Fetches a boolean True/False question from the Open Trivia Database and
 * awards coins for correct answers. All economy logic follows the existing
 * codebase patterns exactly:
 *
 * ── Economy patterns used ────────────────────────────────────────────────────
 *
 *   db.users.collection (daily/work/fish pattern)
 *     Every stat is persisted in a "quiz" collection on bot_users_session.data.
 *     Collection is initialised on first use (isCollectionExist → createCollection).
 *     Each field is written with an individual set() call to keep intent explicit.
 *
 *   Collection schema (bot_users_session.data → "quiz" key):
 *     { wins, losses, totalEarned, questionCount }
 *
 *   currencies API (transfer/fish pattern)
 *     increaseMoney() is fully awaited before getMoney() is called so the
 *     balance read is always post-credit and never stale.
 *
 *   Button context (slot.ts pattern)
 *     After an answer, a QuizResultBtnCtx object is stored in BOTH the
 *     💰 Balance and ⬅ Back button contexts. Each button therefore knows
 *     the other button's stable ID — no ID regeneration on navigation.
 *     A typed context-reader helper (readResultBtnCtx) mirrors readSlotButtonContext.
 *
 *   Button scoping (fish/work/rps pattern)
 *     ✅ True / ❌ False / 🔄 Play Again → public: true  (group trivia — any member can play)
 *     💰 Balance / ⬅ Back              → public: false (scoped to the answering user)
 *
 *   hasNativeButtons (daily/work/fish/slot pattern)
 *     All button injection is gated with hasNativeButtons(native.platform).
 *     The isButtonPlatform helper gates the button vs reaction-based answer flow.
 *
 * ── Platform-split answer flow ───────────────────────────────────────────────
 *
 *   Discord & Telegram  → native inline buttons
 *     1. onCommand sends the question with ✅ True / ❌ False.
 *     2. ButtonQuizContext stores the correct answer per-message.
 *     3. On click: stats updated, coins credited, result card edited in-place.
 *        Result card shows [🔄 Play Again] [💰 Balance].
 *     4. 💰 Balance: edits card to live balance + [⬅ Back] (slot toggle pattern).
 *     5. ⬅ Back: restores the exact result card from stored context.
 *     6. A setTimeout reveals the answer on TIMEOUT_MS with a 🔄 Play Again button.
 *
 *   Non-button platforms  → emoji reactions
 *     ❤️ / ❤ → True   |   😢 → False
 *     Correct answers award coins via the same economy API. The reply includes
 *     the earned coins, the post-credit balance (getMoney after increaseMoney),
 *     and the running quiz stats, all with proper spacing.
 *
 * ── Difficulty ───────────────────────────────────────────────────────────────
 *   easy → 50 coins | medium → 100 coins | hard → 200 coins
 *   Accepts an optional argument: easy | medium | hard.
 *   Any other value (or none) picks a difficulty at random.
 *   Play Again preserves the previous difficulty.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
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

const REACT = {
  TRUE: '❤',
  TRUE_DISCORD: '❤️',
  FALSE: '😢',
} as const;

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
 * Navigation flow (Discord & Telegram):
 *   [✅ true / ❌ false] → answer evaluated
 *   Result card          → [🔄 play_again]  [💰 balance]
 *   Balance view         → [⬅ back]
 *   ⬅ back              → result card restored
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

/** Stored in the state system for the FB emoji-reaction flow. */
interface ReactQuizContext extends Record<string, unknown> {
  answer: string;
  question: string;
  messageID: string;
  difficulty: string;
  category: string;
}

/**
 * Stored in BOTH the 💰 Balance and ⬅ Back button contexts (slot.ts pattern).
 * Each button holds the other's stable ID so navigation can toggle without
 * regenerating IDs on every click.
 */
interface QuizResultBtnCtx extends Record<string, unknown> {
  /** Full rendered result card text — restored verbatim by ⬅ Back. */
  resultMessage: string;
  /** Stable play_again button ID — back button restores this into the result card. */
  playAgainId: string;
  /** Stable balance button ID — back button restores this into the result card. */
  balanceId: string;
  /** Stable back button ID — balance button attaches this to the balance view. */
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

// ── Platform helper ───────────────────────────────────────────────────────────
function isButtonPlatform(platform: string): boolean {
  return platform === Platforms.Discord || platform === Platforms.Telegram;
}

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
async function saveQuizStats(ctx: AppCtx, senderID: string, stats: QuizStats): Promise<void> {
  const coll = await getQuizCollection(ctx, senderID);
  await coll.set('wins', stats.wins);
  await coll.set('losses', stats.losses);
  await coll.set('totalEarned', stats.totalEarned);
  await coll.set('questionCount', stats.questionCount);
}

// ── Context reader (slot.ts readSlotButtonContext pattern) ────────────────────

/**
 * Safely casts the raw session context to QuizResultBtnCtx.
 * Returns undefined if any required field is missing, preventing partial state bugs.
 */
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

  // ── Fetch question ─────────────────────────────────────────────────────────
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

  // Answer buttons: public: true — any group member can participate (rps pattern)
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
    // Play Again: edit existing message in-place (RPS pattern — clean chat)
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
    // Initial command: send a fresh message
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

  // Cancel any previous timeout for this message (prevents overlap on Play Again)
  if (timeouts.has(msgIdStr)) {
    clearTimeout(timeouts.get(msgIdStr)!);
    timeouts.delete(msgIdStr);
  }

  pendingAnswers.set(msgIdStr, false);

  // Store the question context in both answer buttons so onClick can evaluate
  const quizCtx: ButtonQuizContext = { answer, question, messageID: msgIdStr, difficulty, category };
  btn.createContext({ id: trueId, context: quizCtx });
  btn.createContext({ id: falseId, context: quizCtx });

  // Timeout: reveal answer + Play Again (no coins awarded — no answer was given)
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

// ── Answer result handler (Discord & Telegram button flow) ────────────────────
async function showButtonResult(ctx: AppCtx, userAnswer: 'True' | 'False'): Promise<void> {
  const { chat, event, session, button: btn, currencies, native } = ctx;

  const quizCtx = session.context as Partial<ButtonQuizContext>;
  const msgId = quizCtx.messageID ?? (event['messageID'] as string);
  const answer = quizCtx.answer ?? '';
  const difficulty = (quizCtx.difficulty ?? 'medium') as Difficulty;
  const question = quizCtx.question ?? '';
  const category = quizCtx.category ?? '';

  // Guard: reject double-clicks and stale clicks after timeout
  if (pendingAnswers.get(msgId) === true) return;
  pendingAnswers.set(msgId, true);

  if (timeouts.has(msgId)) {
    clearTimeout(timeouts.get(msgId)!);
    timeouts.delete(msgId);
  }

  // Clean up answer button contexts — question has been resolved
  btn.deleteContext(session.id);

  const senderID = event['senderID'] as string | undefined;
  const isCorrect = userAnswer === answer;
  const reward = REWARD_COINS[difficulty];

  // ── Update quiz collection + award coins (fish/work/daily pattern) ─────────
  let stats: QuizStats = { wins: 0, losses: 0, totalEarned: 0, questionCount: 0 };
  let newBalance = 0;

  if (senderID) {
    // Read current stats before mutation
    stats = await readQuizStats(ctx, senderID);
    stats.questionCount += 1;

    if (isCorrect) {
      stats.wins += 1;
      stats.totalEarned += reward;
      // Persist stats BEFORE crediting coins (daily pattern: state durable even if message fails)
      await saveQuizStats(ctx, senderID, stats);
      // increaseMoney must fully resolve before getMoney — transfer/fish pattern
      await currencies.increaseMoney({ user_id: senderID, money: reward });
      newBalance = await currencies.getMoney(senderID);
    } else {
      stats.losses += 1;
      await saveQuizStats(ctx, senderID, stats);
      // Still read balance so the result card can show a consistent figure
      newBalance = await currencies.getMoney(senderID);
    }
  }

  // ── Build result message ──────────────────────────────────────────────────
  const winRate =
    stats.questionCount > 0
      ? Math.round((stats.wins / stats.questionCount) * 100)
      : 0;

  const verdictLine = isCorrect
    ? `✅ **Correct!** The answer was **${answer}**. Well done! 🎉`
    : `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${answer}**. 😔`;

  // Coin block only shown on a correct answer (work/fish message pattern)
  const coinBlock =
    isCorrect && senderID
      ? [``, `💰 **+${reward} coins** earned!`, `📊 Balance: **${newBalance.toLocaleString()} coins**`].join('\n')
      : '';

  // Stats line shown whenever we have a senderID (fish stats-line pattern)
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

  // ── Generate buttons (slot.ts pattern) ────────────────────────────────────
  // playAgain: public: true  — any group member can start a new round
  // balance:   public: false — scoped to this user (fish/work pattern)
  // back:      public: false — scoped to this user
  const playAgainId = btn.generateID({ id: BUTTON_ID.playAgain, public: true });
  btn.createContext({
    id: playAgainId,
    context: { difficulty } satisfies Record<string, unknown>,
  });

  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  // Both balance and back receive the same context object containing each
  // other's stable IDs — slot.ts pattern; no ID regeneration needed on navigation.
  const btnCtx: QuizResultBtnCtx = { resultMessage, playAgainId, balanceId, backId };
  btn.createContext({ id: balanceId, context: btnCtx });
  btn.createContext({ id: backId, context: btnCtx });

  const buttons = senderID
    ? [playAgainId, balanceId]   // balance only meaningful when we have a user
    : [playAgainId];

  await chat.editMessage({
    style: MessageStyle.MARKDOWN,
    message_id_to_edit: msgId,
    message: resultMessage,
    ...(hasNativeButtons(native.platform) ? { button: buttons } : {}),
  });
}

// ── Button definitions ────────────────────────────────────────────────────────
export const button = {
  // ── ✅ True ─────────────────────────────────────────────────────────────────
  [BUTTON_ID.true]: {
    label: '✅ True',
    style: ButtonStyle.SUCCESS,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'True'),
  },

  // ── ❌ False ────────────────────────────────────────────────────────────────
  [BUTTON_ID.false]: {
    label: '❌ False',
    style: ButtonStyle.DANGER,
    onClick: async (ctx: AppCtx) => showButtonResult(ctx, 'False'),
  },

  // ── 🔄 Play Again ───────────────────────────────────────────────────────────
  // Context: { difficulty } — preserved across round restarts (original pattern).
  // Cleans up its own context before delegating to runButtonQuiz (RPS pattern).
  [BUTTON_ID.playAgain]: {
    label: '🔄 Play Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      const { button: btn, session } = ctx;

      const storedDifficulty = session.context['difficulty'] as Difficulty | undefined;
      const difficulty: Difficulty =
        storedDifficulty && (DIFFICULTIES as readonly string[]).includes(storedDifficulty)
          ? storedDifficulty
          : (DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium');

      btn.deleteContext(session.id);
      await runButtonQuiz(ctx, difficulty);
    },
  },

  // ── 💰 Balance ──────────────────────────────────────────────────────────────
  // Switches the card to a live balance view using getMoney (always current).
  // Attaches ⬅ Back using the stable backId stored in its own context.
  // Does NOT call deleteContext — context must survive for ⬅ Back to read (slot pattern).
  [BUTTON_ID.balance]: {
    label: '💰 Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, native, session, currencies }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const msgId = event['messageID'] as string | undefined;

      const btnCtx = readResultBtnCtx(session.context);

      if (!senderID || !msgId || !btnCtx) return;

      // getMoney returns the live total — always accurate (currencies pattern)
      const coins = await currencies.getMoney(senderID);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: [
          `💰 **Coin Balance**`,
          ``,
          `📊 Current balance: **${coins.toLocaleString()} coins**`,
        ].join('\n'),
        // Back button ID is stable — taken from stored context (slot pattern)
        ...(hasNativeButtons(native.platform) ? { button: [btnCtx.backId] } : {}),
      });
    },
  },

  // ── ⬅ Back ──────────────────────────────────────────────────────────────────
  // Restores the result card verbatim from context — no network call needed.
  // Re-attaches playAgainId and balanceId from the stored context (slot pattern).
  // Does NOT call deleteContext — same session context may be used again (toggle loop).
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
        // Restore the full result card text exactly as it was (slot back pattern)
        message: btnCtx.resultMessage,
        // Re-attach both stable button IDs from the stored context
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
  state,
  args,
  native,
  button: btn,
}: AppCtx): Promise<void> => {
  const rawArg = (args[0] ?? '').toLowerCase();
  const difficulty: Difficulty = (DIFFICULTIES as readonly string[]).includes(rawArg)
    ? (rawArg as Difficulty)
    : (DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)] ?? 'medium');

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH A — Discord & Telegram: native inline buttons
  // ════════════════════════════════════════════════════════════════════════════
  if (isButtonPlatform(native.platform)) {
    await runButtonQuiz({ chat, state, native, button: btn } as AppCtx, difficulty);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BRANCH B — emoji reaction flow (platforms without native buttons)
  // ════════════════════════════════════════════════════════════════════════════

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
  const reward = REWARD_COINS[difficulty];

  const messageID = await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      `🧠 **Trivia Quiz** — _${difficulty}_ · ${category}`,
      ``,
      question,
      ``,
      `💰 Reward: **${reward} coins** for a correct answer`,
      ``,
      `❤️ → **True**   |   😢 → **False**`,
      `_You have ${TIMEOUT_MS / 1000} seconds to react!_`,
    ].join('\n'),
  });

  if (!messageID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        '❌ onReact unavailable: this platform did not return a message ID from chat.replyMessage().',
    });
    return;
  }

  const msgIdStr = String(messageID);
  pendingAnswers.set(msgIdStr, false);

  state.create({
    id: state.generateID({ id: msgIdStr }),
    state: [REACT.TRUE, REACT.TRUE_DISCORD, REACT.FALSE],
    context: {
      answer,
      question,
      messageID: msgIdStr,
      difficulty,
      category,
    } satisfies ReactQuizContext,
  });

  setTimeout(() => {
    const alreadyAnswered = pendingAnswers.get(msgIdStr) ?? false;
    pendingAnswers.delete(msgIdStr);
    if (!alreadyAnswered) {
      void chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⏰ **Time's up!** The correct answer was **${answer}**.`,
      });
    }
  }, TIMEOUT_MS);
};

// ── Shared reaction evaluator (FB Messenger & FB Page flow) ───────────────────
async function handleReact(ctx: AppCtx, userAnswer: 'True' | 'False'): Promise<void> {
  const { chat, session, state, event, currencies } = ctx;

  const reactCtx = session.context as Partial<ReactQuizContext>;
  const msgId = reactCtx.messageID ?? '';
  const correctAnswer = reactCtx.answer ?? '';
  const difficulty = (reactCtx.difficulty ?? 'medium') as Difficulty;
  const reward = REWARD_COINS[difficulty];

  pendingAnswers.set(msgId, true);
  state.delete(session.id);

  const senderID = event['senderID'] as string | undefined;
  const isCorrect = userAnswer === correctAnswer;

  if (isCorrect) {
    // ── Update quiz stats + credit coins ────────────────────────────────────
    let stats: QuizStats = { wins: 0, losses: 0, totalEarned: 0, questionCount: 0 };
    let newBalance = 0;

    if (senderID) {
      stats = await readQuizStats(ctx, senderID);
      stats.questionCount += 1;
      stats.wins += 1;
      stats.totalEarned += reward;
      // Persist before crediting coins (daily pattern: state durable even if reply fails)
      await saveQuizStats(ctx, senderID, stats);
      // increaseMoney must fully resolve before getMoney (transfer/fish pattern)
      await currencies.increaseMoney({ user_id: senderID, money: reward });
      newBalance = await currencies.getMoney(senderID);
    }

    const winRate =
      stats.questionCount > 0
        ? Math.round((stats.wins / stats.questionCount) * 100)
        : 0;

    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message: [
        `✅ **Correct!** The answer was **${correctAnswer}**. Well done! 🎉`,
        ``,
        `💰 **+${reward} coins** earned!`,
        `📊 Balance: **${newBalance.toLocaleString()} coins**`,
        ``,
        `🏆 Wins: **${stats.wins}** | Losses: **${stats.losses}** | Win Rate: **${winRate}%**`,
        `💎 Lifetime earned: **${stats.totalEarned.toLocaleString()} coins**`,
      ].join('\n'),
    });
  } else {
    // ── Update stats for a wrong answer (no coin change) ────────────────────
    if (senderID) {
      const stats = await readQuizStats(ctx, senderID);
      stats.questionCount += 1;
      stats.losses += 1;
      await saveQuizStats(ctx, senderID, stats);

      const winRate =
        stats.questionCount > 0
          ? Math.round((stats.wins / stats.questionCount) * 100)
          : 0;

      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: [
          `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${correctAnswer}**. 😔`,
          ``,
          `🏆 Wins: **${stats.wins}** | Losses: **${stats.losses}** | Win Rate: **${winRate}%**`,
          `💎 Lifetime earned: **${stats.totalEarned.toLocaleString()} coins**`,
        ].join('\n'),
      });
    } else {
      await chat.reply({
        style: MessageStyle.MARKDOWN,
        message: `❌ **Wrong!** You answered **${userAnswer}**, but the correct answer was **${correctAnswer}**. 😔`,
      });
    }
  }
}

// ── Reaction handlers (FB Messenger & FB Page only) ───────────────────────────
export const onReact = {
  /** ❤  (U+2764)       — "True" on FB Messenger & FB Page */
  [REACT.TRUE]: async (ctx: AppCtx) => handleReact(ctx, 'True'),
  /** ❤️ (U+2764+FE0F)  — "True" on Discord (Variation Selector-16 appended) */
  [REACT.TRUE_DISCORD]: async (ctx: AppCtx) => handleReact(ctx, 'True'),
  /** 😢                — "False" on all platforms */
  [REACT.FALSE]: async (ctx: AppCtx) => handleReact(ctx, 'False'),
};