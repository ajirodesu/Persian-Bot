/**
 * Bet Amount Parsing — shared by economy games.
 *
 * Accepts the same user-facing formats everywhere:
 *   100, 1.5k, 2m, 1b, all/max, half
 *
 * Returns NaN for invalid input so callers can show their own validation
 * message without changing the accepted syntax per command.
 */

/** Parses a bet string against the caller's current balance. */
export function parseBetAmount(raw: string, balance: number): number {
  const value = raw.trim().toLowerCase().replace(/,/g, '');

  if (value === 'all' || value === 'max') return Math.floor(balance);
  if (value === 'half') return Math.floor(balance / 2);

  const match = value.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!match) return NaN;

  const amount = Number(match[1]);
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
