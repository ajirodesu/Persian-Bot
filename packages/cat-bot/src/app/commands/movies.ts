/**
 * /movies — OMDB Movie Search
 *
 * Looks up a movie by title via the OMDB API and replies with its
 * details (rating, genre, actors, plot, etc.) plus the official poster
 * image when one is available.
 *
 * Usage: /movies <movie title>
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'movies',
  aliases: ['mov'] as string[],
  version: '1.0.1',
  role: Role.ANYONE,
  author: 'rifat, fixed by liane and symer and convert by AjiroDesu',
  description: 'Search movie details using the OMDB API.',
  category: 'Media',
  usage: '<movie title>',
  cooldown: 5,
  hasPrefix: true,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OmdbMovie {
  Title: string;
  Year: string;
  Rated: string;
  Released: string;
  Runtime: string;
  Genre: string;
  Director: string;
  Writer: string;
  Actors: string;
  Plot: string;
  Language: string;
  Country: string;
  Awards: string;
  Poster: string;
  Ratings: Array<{ Source: string; Value: string }>;
  Metascore: string;
  imdbRating: string;
  imdbVotes: string;
  imdbID: string;
  Type: string;
  BoxOffice: string;
  Response: string;
}

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { args, usage } = ctx;
  if (!args.length) {
    await usage();
    return;
  }

  const query = args.join(' ').trim();
  const apiKey = 'ec7115';
  const url = `https://www.omdbapi.com/?t=${encodeURIComponent(query)}&plot=full&apikey=${apiKey}`;

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

  let movie: OmdbMovie;
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`OMDB API responded with status ${response.status}`);
    movie = (await response.json()) as OmdbMovie;
  } catch (err) {
    const error = err as { message?: string };
    await fail(
      `❌ Failed to fetch movie data.\n\`${error.message ?? 'Unknown error'}\``,
    );
    return;
  }

  if (movie.Response === 'False') {
    await fail(`🔍 No movie found for **${query}**.`);
    return;
  }

  const caption =
    `🎬 **${movie.Title}** (${movie.Year})\n` +
    `⭐ **IMDB:** ${movie.imdbRating}\n` +
    `📂 **Genre:** ${movie.Genre}\n` +
    `🎭 **Actors:** ${movie.Actors}\n` +
    `📝 **Plot:** ${movie.Plot}\n` +
    `🌐 **Language:** ${movie.Language}\n` +
    `🎬 **Director:** ${movie.Director}\n` +
    `⌛ **Runtime:** ${movie.Runtime}`;

  if (movie.Poster && movie.Poster !== 'N/A') {
    try {
      await finish({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment_url: [{ name: 'movie_poster.jpg', url: movie.Poster }],
      });
    } catch {
      // Poster fetch failed — fall back to text-only
      await finish({ style: MessageStyle.MARKDOWN, message: caption });
    }
  } else {
    await finish({ style: MessageStyle.MARKDOWN, message: caption });
  }
};
