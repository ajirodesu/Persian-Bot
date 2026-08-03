/**
 * /rps — Rock Paper Scissors (Economy Integration)
 *
 * A classic game upgraded with optional wagering, win-streak bonuses,
 * persistent stats, and the full economy button flow from quiz/slot/fish.
 *
 * ── Economy patterns used ────────────────────────────────────────────────────
 *
 *   db.users.collection (daily/work/fish/quiz pattern)
 *     Stats are persisted in an "rps" collection on bot_users_session.data.
 *     Collection is initialised on first use (isCollectionExist → createCollection).
 *     Each field is written with an individual set() call to keep intent explicit.
 *
 *   Collection schema (bot_users_session.data → "rps" key):
 *     { wins, losses, draws, streak, bestStreak, totalEarned, totalLost }
 *
 *   currencies API (transfer/fish/quiz pattern)
 *     increaseMoney / decreaseMoney are fully awaited before getMoney() is
 *     called so the balance read is always post-transaction and never stale.
 *
 *   parseBetInput (slot.ts pattern)
 *     Supports raw numbers, k/m/b suffixes, "all"/"max"/"half" shorthands.
 *     Omitting a bet defaults to free-play mode (fixed 20-coin reward for a win).
 *
 *   Button context (slot/quiz pattern)
 *     After the result, an RpsResultBtnCtx is stored in BOTH the 💰 Balance
 *     and ⬅ Back button contexts. Each button holds the other's stable ID —
 *     no regeneration needed on navigation. A typed reader helper
 *     (readRpsResultBtnCtx) mirrors readSlotButtonContext / readResultBtnCtx.
 *
 *   Button scoping (fish/work/quiz pattern)
 *     🪨 Rock / 📄 Paper / ✂️ Scissors / 🔄 Play Again → public: false
 *       (RPS is a 1-player game — scoped to the user who started it)
 *     💰 Balance / ⬅ Back → public: false (always user-scoped)
 *
 * ── Win-Streak Bonus ─────────────────────────────────────────────────────────
 *   streak ≥  3 → +10% on top of the wager payout
 *   streak ≥  5 → +25%
 *   streak ≥ 10 → +50%
 *   Free-play wins also scale: the fixed reward is multiplied by the bonus.
 *
 * ── Wager modes ──────────────────────────────────────────────────────────────
 *   /rps          → free-play: win = +FREE_WIN_COINS (× streak bonus), loss/draw = 0
 *   /rps <amount> → wagered:   win = +bet (× streak bonus), loss = −bet, draw = refund
 *   Bet shorthands: all | max | half | 100k | 2m | 1b
 *
 * ── Platform support ───────────────────────────────────────────────────────────
 *   Discord & Telegram only — native inline buttons required.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';

export const meta: CommandMeta = {
  name: 'rps',
  aliases: ['rockpaperscissors', 'janken'] as string[],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'JohnDev19',
  description:
    'Play Rock, Paper, Scissors. Optionally wager coins and build a win streak for bonus payouts. Stats are tracked per user.',
  category: 'Economy',
  usage: '[bet amount]',
  cooldown: 3,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'bet',
      description: 'Amount to bet (optional, e.g. 100, 1k, all)',
      required: false,
    },
  ],
};

// ── Constants ─────────────────────────────────────────────────────────────────

const CHOICES = ['rock', 'paper', 'scissors'] as const;
type Choice = (typeof CHOICES)[number];

/** Coins awarded for a win in free-play mode (no wager). */
const FREE_WIN_COINS = 20;

/** Maximum fraction of balance that can be wagered (slot.ts rule). */
const MAX_BET_PERCENTAGE = 0.75;

const EMOJIS: Record<Choice, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};

/**
 * Win-streak bonus thresholds.
 * Applied to both wagered payouts and the FREE_WIN_COINS reward.
 * The highest matching tier wins (array is checked high → low).
 */
const STREAK_TIERS: { min: number; bonus: number; label: string }[] = [
  { min: 10, bonus: 0.5, label: '🔥🔥🔥 **+50% streak bonus!**' },
  { min: 5, bonus: 0.25, label: '🔥🔥 **+25% streak bonus!**' },
  { min: 3, bonus: 0.1, label: '🔥 **+10% streak bonus!**' },
];

const BUTTON_ID = {
  rock: 'rock',
  paper: 'paper',
  scissors: 'scissors',
  playAgain: 'play_again',
  balance: 'balance',
  back: 'back',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type GameOutcome = 'win' | 'loss' | 'draw';

/** Stats persisted in the "rps" collection (fish/work/quiz schema pattern). */
interface RpsStats {
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  totalEarned: number;
  totalLost: number;
}

/**
 * Stored in the choice button contexts so onClick knows the game state.
 * Mirrors ButtonQuizContext from quiz.ts.
 */
interface RpsChoiceCtx extends Record<string, unknown> {
  /** Wagered amount; 0 = free-play. */
  bet: number;
}

/**
 * Stored in BOTH the 💰 Balance and ⬅ Back button contexts (slot/quiz pattern).
 * Each button holds the other's stable ID for toggle navigation.
 */
interface RpsResultBtnCtx extends Record<string, unknown> {
  resultMessage: string;
  playAgainId: string;
  balanceId: string;
  backId: string;
  /** Preserve bet so Play Again restarts with the same amount. */
  bet: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses user bet input (slot.ts parseBetInput — verbatim).
 * Supports plain numbers, k/m/b suffixes, and "all"/"max"/"half".
 */
function parseBetInput(raw: string, balance: number): number {
  const value = raw.trim().toLowerCase().replace(/,/g, '');
  if (!value) return NaN;
  if (value === 'all' || value === 'max') return Math.floor(balance);
  if (value === 'half') return Math.floor(balance / 2);

  const match = value.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return NaN;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return NaN;

  const suffix = match[2]?.toLowerCase();
  const multiplier =
    suffix === 'k'
      ? 1_000
      : suffix === 'm'
        ? 1_000_000
        : suffix === 'b'
          ? 1_000_000_000
          : 1;

  return Math.floor(amount * multiplier);
}

function getOutcome(player: Choice, bot: Choice): GameOutcome {
  if (player === bot) return 'draw';
  if (
    (player === 'rock' && bot === 'scissors') ||
    (player === 'paper' && bot === 'rock') ||
    (player === 'scissors' && bot === 'paper')
  )
    return 'win';
  return 'loss';
}

/** Returns the active streak bonus tier for a given streak count, or null. */
function getStreakTier(streak: number) {
  return STREAK_TIERS.find((t) => streak >= t.min) ?? null;
}

/** Applies the streak bonus multiplier and returns the bonus coin amount. */
function applyStreakBonus(base: number, streak: number): number {
  const tier = getStreakTier(streak);
  return tier ? Math.floor(base * tier.bonus) : 0;
}

// ── Context reader (slot/quiz readSlotButtonContext pattern) ──────────────────

function readRpsResultBtnCtx(raw: unknown): RpsResultBtnCtx | undefined {
  const c = raw as Partial<RpsResultBtnCtx> | undefined;
  if (!c?.resultMessage || !c.playAgainId || !c.balanceId || !c.backId) {
    return undefined;
  }
  return {
    resultMessage: c.resultMessage,
    playAgainId: c.playAgainId,
    balanceId: c.balanceId,
    backId: c.backId,
    bet: c.bet ?? 0,
  };
}

// ── Collection helpers (fish/work/quiz pattern) ───────────────────────────────

async function getRpsCollection(ctx: AppCtx, senderID: string) {
  const userColl = ctx.db.users.collection(senderID);
  if (!(await userColl.isCollectionExist('rps'))) {
    await userColl.createCollection('rps');
  }
  return userColl.getCollection('rps');
}

async function readRpsStats(ctx: AppCtx, senderID: string): Promise<RpsStats> {
  const coll = await getRpsCollection(ctx, senderID);
  return {
    wins: ((await coll.get('wins')) as number | undefined) ?? 0,
    losses: ((await coll.get('losses')) as number | undefined) ?? 0,
    draws: ((await coll.get('draws')) as number | undefined) ?? 0,
    streak: ((await coll.get('streak')) as number | undefined) ?? 0,
    bestStreak: ((await coll.get('bestStreak')) as number | undefined) ?? 0,
    totalEarned: ((await coll.get('totalEarned')) as number | undefined) ?? 0,
    totalLost: ((await coll.get('totalLost')) as number | undefined) ?? 0,
  };
}

/** Individual set() calls per field — same explicit pattern as daily/work/fish/quiz. */
async function saveRpsStats(
  ctx: AppCtx,
  senderID: string,
  stats: RpsStats,
): Promise<void> {
  const coll = await getRpsCollection(ctx, senderID);
  await coll.set('wins', stats.wins);
  await coll.set('losses', stats.losses);
  await coll.set('draws', stats.draws);
  await coll.set('streak', stats.streak);
  await coll.set('bestStreak', stats.bestStreak);
  await coll.set('totalEarned', stats.totalEarned);
  await coll.set('totalLost', stats.totalLost);
}

// ── Game prompt builder ───────────────────────────────────────────────────────

function buildQuestionMessage(bet: number): string {
  const betLine =
    bet > 0
      ? `💰 Wager: **$${bet.toLocaleString()}**`
      : `🆓 Free-play — win **$${FREE_WIN_COINS}** (+ streak bonus)`;
  return [`🤜 **Rock, Paper, Scissors!**`, ``, betLine, ``, `Choose your weapon:`].join('\n');
}

// ── Core game runner (shared between onCommand and 🔄 Play Again) ─────────────

async function startRpsGame(ctx: AppCtx, bet: number): Promise<void> {
  const { chat, button: btn, event } = ctx;

  const rockId = btn.generateID({ id: BUTTON_ID.rock, public: false });
  const paperId = btn.generateID({ id: BUTTON_ID.paper, public: false });
  const scissorsId = btn.generateID({ id: BUTTON_ID.scissors, public: false });

  // Each choice button carries the bet in its context (quiz ButtonQuizContext pattern)
  const choiceCtx: RpsChoiceCtx = { bet };
  btn.createContext({ id: rockId, context: choiceCtx });
  btn.createContext({ id: paperId, context: choiceCtx });
  btn.createContext({ id: scissorsId, context: choiceCtx });

  const buttons: string[] = [rockId, paperId, scissorsId];

  if (event['type'] === 'button_action') {
    // Play Again: edit in-place (RPS / quiz Play Again pattern — clean chat)
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message: buildQuestionMessage(bet),
      message_id_to_edit: event['messageID'] as string,
      button: buttons,
    });
  } else {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildQuestionMessage(bet),
      button: buttons,
    });
  }
}

// ── Suspense animation (native-button flow) ────────────────────────────────────
// Cycles Rock → Paper → Scissors on the SAME message via sequential editMessage
// calls before the bot's choice is generated or the winner is determined — the
// outcome literally does not exist yet while this is playing, so there is no way
// for the result to appear before the animation finishes.

/** Order the animation cycles through — always Rock → Paper → Scissors. */
const ANIMATION_SEQUENCE: readonly Choice[] = ['rock', 'paper', 'scissors'];

/** Delay between each animation frame. Short enough to feel snappy, long enough to read. */
const ANIMATION_FRAME_DELAY_MS = 550;

function buildAnimationFrame(playerChoice: Choice, frame: Choice): string {
  return [
    `🤜 **Rock, Paper, Scissors!**`,
    ``,
    `👤 You chose: **${playerChoice.toUpperCase()}** ${EMOJIS[playerChoice]}`,
    ``,
    `🤖 ${EMOJIS[frame]} ${frame.toUpperCase()}...`,
  ].join('\n');
}

/**
 * Plays the Rock → Paper → Scissors suspense animation in place on `msgId`,
 * with no buttons attached (prevents taps mid-animation). Always awaits every
 * frame in order — the caller cannot proceed to compute a result until this
 * promise resolves, which only happens after the full sequence has rendered.
 */
async function playChoiceAnimation(
  ctx: AppCtx,
  msgId: string,
  playerChoice: Choice,
): Promise<void> {
  const { chat } = ctx;
  for (const frame of ANIMATION_SEQUENCE) {
    await chat.editMessage({
      style: MessageStyle.MARKDOWN,
      message_id_to_edit: msgId,
      message: buildAnimationFrame(playerChoice, frame),
    });
    await sleep(ANIMATION_FRAME_DELAY_MS);
  }
}

// ── Result handler (shared by all three choice buttons) ───────────────────────

async function resolveChoice(ctx: AppCtx, playerChoice: Choice): Promise<void> {
  const { chat, event, session, button: btn, currencies } = ctx;

  const choiceCtx = session.context as Partial<RpsChoiceCtx>;
  const bet = choiceCtx.bet ?? 0;
  const senderID = event['senderID'] as string | undefined;
  const msgId = event['messageID'] as string;

  // Clean up choice button contexts — round is resolved
  btn.deleteContext(session.id);

  // ── Play the suspense animation FIRST — nothing below this line (bot's choice,
  // outcome, stats, payout) is computed until every frame has been shown and read.
  await playChoiceAnimation(ctx, msgId, playerChoice);

  const botChoice = pick(CHOICES);
  const outcome = getOutcome(playerChoice, botChoice);

  // ── Update stats + apply economy (fish/quiz pattern) ─────────────────────
  let stats: RpsStats = {
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    totalEarned: 0,
    totalLost: 0,
  };
  let netChange = 0;
  let newBalance = 0;
  let streakBonusCoins = 0;
  let streakBonusLabel = '';

  if (senderID) {
    stats = await readRpsStats(ctx, senderID);

    if (outcome === 'win') {
      stats.wins += 1;
      stats.streak += 1;
      if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;

      const base = bet > 0 ? bet : FREE_WIN_COINS;
      streakBonusCoins = applyStreakBonus(base, stats.streak);
      const tier = getStreakTier(stats.streak);
      if (tier) streakBonusLabel = tier.label;

      netChange = base + streakBonusCoins;
      stats.totalEarned += netChange;

      // Persist before crediting (daily pattern — state durable even if reply fails)
      await saveRpsStats(ctx, senderID, stats);
      await currencies.increaseMoney({ user_id: senderID, money: netChange });
    } else if (outcome === 'loss') {
      stats.losses += 1;
      stats.streak = 0;

      if (bet > 0) {
        netChange = -bet;
        stats.totalLost += bet;
      }
      await saveRpsStats(ctx, senderID, stats);
      if (bet > 0) {
        await currencies.decreaseMoney({ user_id: senderID, money: bet });
      }
    } else {
      // draw — refund (no money movement)
      stats.draws += 1;
      stats.streak = 0;
      await saveRpsStats(ctx, senderID, stats);
    }

    // getMoney after currency mutation — always post-transaction (fish/quiz pattern)
    newBalance = await currencies.getMoney(senderID);
  }

  // ── Build result message ──────────────────────────────────────────────────
  const outcomeEmoji =
    outcome === 'win' ? '🎉' : outcome === 'draw' ? '🤝' : '💀';
  const outcomeText =
    outcome === 'win' ? 'You won!' : outcome === 'draw' ? "It's a tie!" : 'You lost!';

  const choiceLine = `👤 You: **${playerChoice.toUpperCase()}** ${EMOJIS[playerChoice]}\n🤖 Bot: **${botChoice.toUpperCase()}** ${EMOJIS[botChoice]}`;

  // Coin block (work/fish/quiz message pattern)
  let coinBlock = '';
  if (senderID && outcome === 'win') {
    const baseLine =
      bet > 0
        ? `💰 **+$${(bet).toLocaleString()}** won!`
        : `💰 **+$${FREE_WIN_COINS}** (free-play reward)`;
    const bonusLine =
      streakBonusCoins > 0
        ? `\n${streakBonusLabel} **+$${streakBonusCoins.toLocaleString()}**`
        : '';
    const totalLine =
      streakBonusCoins > 0
        ? `\n💎 Total earned: **+$${netChange.toLocaleString()}**`
        : '';
    coinBlock = `\n${baseLine}${bonusLine}${totalLine}\n📊 Balance: **$${newBalance.toLocaleString()}**`;
  } else if (senderID && outcome === 'loss' && bet > 0) {
    coinBlock = `\n💸 **−$${bet.toLocaleString()}** lost!\n📊 Balance: **$${newBalance.toLocaleString()}**`;
  } else if (senderID && outcome === 'draw' && bet > 0) {
    coinBlock = `\n↩️ Wager **refunded** — no dollars exchanged.\n📊 Balance: **$${newBalance.toLocaleString()}**`;
  }

  // Streak line (quiz stats-line pattern)
  const streakLine = senderID
    ? [
        ``,
        `🔥 Streak: **${stats.streak}** | Best: **${stats.bestStreak}**`,
        `🏆 W: **${stats.wins}** / L: **${stats.losses}** / D: **${stats.draws}**`,
        `💎 Lifetime earned: **$${stats.totalEarned.toLocaleString()}** | Lost: **$${stats.totalLost.toLocaleString()}**`,
      ].join('\n')
    : '';

  const resultMessage = [
    `${outcomeEmoji} **${outcomeText}**`,
    ``,
    choiceLine,
    ...(coinBlock ? [coinBlock] : []),
    ...(streakLine ? [streakLine] : []),
  ].join('\n');

  // ── Generate navigation buttons (slot/quiz pattern) ───────────────────────
  // play_again: public: false — scoped to the user who started this round
  // balance:    public: false — always user-scoped
  // back:       public: false — always user-scoped
  const playAgainId = btn.generateID({ id: BUTTON_ID.playAgain, public: false });
  const balanceId = btn.generateID({ id: BUTTON_ID.balance, public: false });
  const backId = btn.generateID({ id: BUTTON_ID.back, public: false });

  // Store bet in play_again context so Play Again restarts with same wager
  btn.createContext({
    id: playAgainId,
    context: { bet } satisfies Record<string, unknown>,
  });

  // Both balance and back receive the full context object (slot/quiz pattern)
  const btnCtx: RpsResultBtnCtx = { resultMessage, playAgainId, balanceId, backId, bet };
  btn.createContext({ id: balanceId, context: btnCtx });
  btn.createContext({ id: backId, context: btnCtx });

  const buttons = senderID ? [playAgainId, balanceId] : [playAgainId];

  await chat.editMessage({
    style: MessageStyle.MARKDOWN,
    message_id_to_edit: msgId,
    message: resultMessage,
    button: buttons,
  });
}

// ── Button definitions ────────────────────────────────────────────────────────

export const button = {
  // ── 🪨 Rock ──────────────────────────────────────────────────────────────
  [BUTTON_ID.rock]: {
    label: `Rock ${EMOJIS.rock}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => resolveChoice(ctx, 'rock'),
  },

  // ── 📄 Paper ─────────────────────────────────────────────────────────────
  [BUTTON_ID.paper]: {
    label: `Paper ${EMOJIS.paper}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => resolveChoice(ctx, 'paper'),
  },

  // ── ✂️ Scissors ──────────────────────────────────────────────────────────
  [BUTTON_ID.scissors]: {
    label: `Scissors ${EMOJIS.scissors}`,
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => resolveChoice(ctx, 'scissors'),
  },

  // ── 🔄 Play Again ─────────────────────────────────────────────────────────
  // Context: { bet } — preserved across restarts (quiz play_again pattern).
  // Deletes its own context before delegating to startRpsGame (quiz RPS pattern).
  [BUTTON_ID.playAgain]: {
    label: '🔄 Play Again',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => {
      const { button: btn, session } = ctx;
      const bet = (session.context['bet'] as number | undefined) ?? 0;
      btn.deleteContext(session.id);
      await startRpsGame(ctx, bet);
    },
  },

  // ── 💰 Balance ────────────────────────────────────────────────────────────
  // Does NOT delete context — must survive for ⬅ Back to read (slot/quiz pattern).
  [BUTTON_ID.balance]: {
    label: '💰 Balance',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, session, currencies }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const msgId = event['messageID'] as string | undefined;
      const btnCtx = readRpsResultBtnCtx(session.context);
      if (!senderID || !msgId || !btnCtx) return;

      // getMoney always returns the live total (currencies pattern)
      const coins = await currencies.getMoney(senderID);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        message: [
          `💰 **Dollar Balance**`,
          ``,
          `📊 Current balance: **$${coins.toLocaleString()}**`,
        ].join('\n'),
        // Back button ID is stable — taken from stored context (slot/quiz pattern)
        button: [btnCtx.backId],
      });
    },
  },

  // ── ⬅ Back ───────────────────────────────────────────────────────────────
  // Restores the result card verbatim — no network call needed (slot/quiz pattern).
  // Does NOT delete context — toggle loop must survive repeated clicks.
  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, session }: AppCtx) => {
      const msgId = event['messageID'] as string | undefined;
      const btnCtx = readRpsResultBtnCtx(session.context);

      if (!msgId || !btnCtx) {
        if (msgId) {
          await chat.editMessage({
            style: MessageStyle.MARKDOWN,
            message_id_to_edit: msgId,
            message: '❌ Could not restore the result — please run `/rps` again.',
          });
        }
        return;
      }

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: msgId,
        // Restore the full result card text exactly as stored (slot back pattern)
        message: btnCtx.resultMessage,
        // Re-attach both stable button IDs from context (quiz/slot pattern)
        button: [btnCtx.playAgainId, btnCtx.balanceId],
      });
    },
  },
};

// ── Command entry point ───────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  args,
  event,
  currencies,
  button: btn,
  state,
}: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;

  // ── Parse wager ───────────────────────────────────────────────────────────
  let bet = 0;
  if (args[0]) {
    if (!senderID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Could not identify your user ID on this platform.',
      });
      return;
    }

    const balance = await currencies.getMoney(senderID);
    const parsed = parseBetInput(args[0], balance);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `❌ Invalid bet amount — use a number, **all**, **half**, or a shorthand like **10k**.`,
          ``,
          `📊 Your balance: **$${balance.toLocaleString()}**`,
        ].join('\n'),
      });
      return;
    }

    if (parsed > balance) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `⚠️ You don't have enough dollars.`,
          ``,
          `You tried to bet **$${parsed.toLocaleString()}** but only have **$${balance.toLocaleString()}**.`,
        ].join('\n'),
      });
      return;
    }

    const maxBet = Math.floor(balance * MAX_BET_PERCENTAGE);
    if (parsed > maxBet) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: [
          `⚠️ You cannot bet more than **${Math.round(MAX_BET_PERCENTAGE * 100)}%** of your balance.`,
          ``,
          `Maximum bet: **$${maxBet.toLocaleString()}** (your balance: **$${balance.toLocaleString()}**)`,
        ].join('\n'),
      });
      return;
    }

    bet = parsed;
  }

  // Discord & Telegram only — native inline buttons required.
  await startRpsGame(
    { chat, event, currencies, button: btn, state } as AppCtx,
    bet,
  );
};
