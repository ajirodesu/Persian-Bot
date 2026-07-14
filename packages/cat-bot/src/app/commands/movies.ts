/**
 * /movies — OMDB Movie Search
 *
 * Looks up a movie by title via the OMDB API and replies with its
 * details (rating, genre, actors, plot, etc.) plus the official poster
 * image when one is available.
 *
 * Usage: /movies <movie title>
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { withLoadingMedia } from '@/engine/utils/media-loading.util.js';

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

  const loading = await withLoadingMedia(ctx, `🎬 **Looking up "${query}"...**`);

  let movie: OmdbMovie;
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`OMDB API responded with status ${response.status}`);
    movie = (await response.json()) as OmdbMovie;
  } catch (err) {
    const error = err as { message?: string };
    await loading.fail(
      `❌ Failed to fetch movie data.\n\`${error.message ?? 'Unknown error'}\``,
    );
    return;
  }

  if (movie.Response === 'False') {
    await loading.fail(`🔍 No movie found for **${query}**.`);
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
      await loading.finish({
        style: MessageStyle.MARKDOWN,
        message: caption,
        attachment_url: [{ name: 'movie_poster.jpg', url: movie.Poster }],
      });
    } catch {
      // Poster fetch failed — fall back to text-only
      await loading.finish({ style: MessageStyle.MARKDOWN, message: caption });
    }
  } else {
    await loading.finish({ style: MessageStyle.MARKDOWN, message: caption });
  }
};
