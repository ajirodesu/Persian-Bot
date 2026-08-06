/**
 * Vanilla HTML Email Templates
 *
 * Mapped directly from packages/web/src/styles/theme/aqua.css — the current
 * default Cat-Bot dashboard theme (dark teal, "Aqua"). The design mirrors the
 * auth pages' glass treatment: a dark ambient surface and a frosted rounded
 * card with a subtle top-edge specular catch.
 *
 * Email clients are fickle about advanced CSS, so the layout leans on inline
 * styles (solid colors + inline-block) and only uses a <style> block for the
 * body glows and dark-mode overrides; the ambient radial gradients degrade
 * gracefully to solid backgrounds in clients that strip them.
 */

export const COLORS = {
  primary: '#34e0be', // var(--aqua-color-primary)    rgb(52 224 190)
  onPrimary: '#051617', // var(--aqua-color-on-primary)  rgb(5 22 23)
  surface: '#070e11', // var(--aqua-color-surface)     rgb(7 14 17)
  onSurface: '#f0f7f5', // var(--aqua-color-on-surface)  rgb(240 247 245)
  onSurfaceVariant: '#98a8a4', // var(--aqua-color-on-surface-variant) rgb(152 168 164)
  surfaceContainerLow: '#0a1114', // var(--aqua-color-surface-container-low) rgb(10 17 20)
  outlineVariant: '#2a3634', // var(--aqua-color-outline-variant)       rgb(42 54 52)
};

// The Aqua theme is dark by default, so the forced dark-mode overrides simply
// restate the same swatches to keep transactional mail consistent with the app
// regardless of the reader's preferred color scheme.
export const DARK_COLORS = {
  primary: '#34e0be',
  onPrimary: '#051617',
  surface: '#070e11',
  onSurface: '#f0f7f5',
  onSurfaceVariant: '#98a8a4',
  surfaceContainerLow: '#0a1114',
  outlineVariant: '#2a3634',
};

// ── Layout shell ───────────────────────────────────────────────────────────────

// Wraps dynamic content within our branded email layout shell.
export function buildEmailLayout(
  content: string,
  previewText?: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Cat-Bot</title>
  <style>
    /* Base color scheme definitions for the client */
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }

    /* Ambient glow — blurred primary/tertiary halos behind the card, the same
       treatment the auth pages paint (bg-primary/[0.06] + bg-tertiary/[0.05]).
       Clients that ignore background-image fall back to the solid surface. */
    .body-bg {
      background-color: ${COLORS.surfaceContainerLow};
      background-image:
        radial-gradient(52% 38% at 12% 0%, rgba(49, 224, 190, 0.1), transparent 100%),
        radial-gradient(48% 42% at 94% 100%, rgba(129, 140, 248, 0.09), transparent 100%);
    }

    /* Frosted glass card — solid aqua surface with a hairline border plus a
       faint top-edge specular catch (surface-specular in the web app). */
    .card-glass {
      background-color: ${COLORS.surface};
      background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 42px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: 0 28px 56px -18px rgba(0, 0, 0, 0.6);
    }
    .card-glass > .card-specular {
      height: 1px;
      background-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1) 30%, rgba(49, 224, 190, 0.35) 50%, rgba(255, 255, 255, 0.1) 70%, transparent);
    }

    /* Dark mode overrides using !important to bypass inline styles */
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: ${DARK_COLORS.surfaceContainerLow} !important; color: ${DARK_COLORS.onSurface} !important; }
      .card-glass { background-color: ${DARK_COLORS.surface} !important; border-color: rgba(255, 255, 255, 0.08) !important; }
      .text-on-surface-variant { color: ${DARK_COLORS.onSurfaceVariant} !important; }
      .text-outline-variant { color: ${DARK_COLORS.outlineVariant} !important; }
      .btn-primary { background-color: ${DARK_COLORS.primary} !important; color: ${DARK_COLORS.onPrimary} !important; border-color: ${DARK_COLORS.primary} !important; box-shadow: 0 10px 22px -8px rgba(49, 224, 190, 0.45) !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.surfaceContainerLow}; color: ${COLORS.onSurface}; -webkit-font-smoothing: antialiased;">
  ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${previewText}</div>` : ''}

  <div class="card-glass" style="max-width: 600px; margin: 32px auto; background-color: ${COLORS.surface}; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.08); overflow: hidden; box-shadow: 0 28px 56px -18px rgba(0, 0, 0, 0.6);">
    <div class="card-specular"></div>

    <!-- Content -->
    <div class="text-on-surface-variant" style="padding: 36px 32px 8px; font-size: 16px; line-height: 1.55; color: ${COLORS.onSurfaceVariant};">
      ${content}
    </div>

    <!-- Footer -->
    <div style="padding: 28px 32px 36px; text-align: center;">
      <p class="text-outline-variant" style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.outlineVariant};">Cat-Bot</p>
      <p class="text-outline-variant" style="margin: 0; font-size: 13px; line-height: 1.6; color: ${COLORS.outlineVariant};">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>

  </div>
</body>
</html>`;
}

// Builds a reliable cross-client HTML button using divs — filled primary, the
// same primary/on-primary recipe as the web app's Button variant="filled".
export function buildButton(href: string, label: string): string {
  return `<div style="margin: 20px 0;">
    <a href="${href}" target="_blank" class="btn-primary" style="display: inline-block; padding: 13px 26px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; color: ${COLORS.onPrimary}; background-color: ${COLORS.primary}; text-decoration: none; border-radius: 10px; border: 1px solid ${COLORS.primary}; box-shadow: 0 10px 22px -8px rgba(49, 224, 190, 0.45);">
      ${label}
    </a>
  </div>`;
}
