/**
 * PostCSS config.
 *
 * Tailwind CSS v4 is wired up through the @tailwindcss/vite plugin (see
 * vite.config.ts), which processes and prefixes CSS with Lightning CSS — so
 * `tailwindcss` is intentionally NOT registered as a PostCSS plugin here.
 * Autoprefixer remains for any legacy/3rd-party CSS that still needs it.
 */
export default {
  plugins: {
    autoprefixer: {},
  },
}
