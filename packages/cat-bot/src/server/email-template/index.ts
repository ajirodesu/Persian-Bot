/**
 * Vanilla HTML Email Templates
 *
 * Mapped directly from packages/web/src/styles/theme/light.css
 * and dark.css tokens. Uses semantic div containers and inline CSS
 * for a clean layout, with a <style> block for dark mode overrides.
 */

export const COLORS = {
  primary: '#4472d2', // var(--light-color-primary)
  onPrimary: '#ffffff', // var(--light-color-on-primary)
  surface: '#ffffff', // var(--light-color-surface)
  onSurface: '#000000', // var(--light-color-on-surface)
  onSurfaceVariant: '#324157', // var(--light-color-on-surface-variant)
  surfaceContainerLow: '#f8fafc', // var(--light-color-surface-container-low)
  outlineVariant: '#90a1b9', // var(--light-color-outline-variant)
};

export const DARK_COLORS = {
  primary: '#c4d8fd', // var(--dark-color-primary)
  onPrimary: '#0e1e3e', // var(--dark-color-on-primary)
  surface: '#1f2b3d', // var(--dark-color-surface)
  onSurface: '#ffffff', // var(--dark-color-on-surface)
  onSurfaceVariant: '#cad5e2', // var(--dark-color-on-surface-variant)
  surfaceContainerLow: '#172031', // var(--dark-color-surface-container-low)
  outlineVariant: '#45556c', // var(--dark-color-outline-variant)
};

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
    
    /* Dark mode overrides using !important to bypass inline styles */
    @media (prefers-color-scheme: dark) {
      .body-bg { background-color: ${DARK_COLORS.surfaceContainerLow} !important; color: ${DARK_COLORS.onSurface} !important; }
      .card-bg { background-color: ${DARK_COLORS.surface} !important; border-color: ${DARK_COLORS.outlineVariant} !important; }
      .header-bg { background-color: ${DARK_COLORS.surface} !important; border-bottom-color: ${DARK_COLORS.outlineVariant} !important; }
      .footer-bg { background-color: ${DARK_COLORS.surfaceContainerLow} !important; border-top-color: ${DARK_COLORS.outlineVariant} !important; }
      .text-primary { color: ${DARK_COLORS.primary} !important; }
      .text-on-surface-variant { color: ${DARK_COLORS.onSurfaceVariant} !important; }
      .text-outline-variant { color: ${DARK_COLORS.outlineVariant} !important; }
      .btn-primary { background-color: ${DARK_COLORS.primary} !important; color: ${DARK_COLORS.onPrimary} !important; border-color: ${DARK_COLORS.primary} !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.surfaceContainerLow}; color: ${COLORS.onSurface}; -webkit-font-smoothing: antialiased;">
  ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${previewText}</div>` : ''}
  
  <div class="card-bg" style="max-width: 600px; margin: 0 auto; background-color: ${COLORS.surface}; border-radius: 12px; border: 1px solid ${COLORS.outlineVariant}; overflow: hidden; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div class="header-bg" style="padding: 24px 32px; border-bottom: 1px solid ${COLORS.outlineVariant}; background-color: ${COLORS.surface};">
      <h1 class="text-primary" style="font-size: 22px; font-weight: 600; color: ${COLORS.primary}; letter-spacing: -0.02em; margin: 0;">
        Cat-Bot
      </h1>
    </div>

    <!-- Content -->
    <div class="text-on-surface-variant" style="padding: 32px; font-size: 16px; line-height: 1.5; color: ${COLORS.onSurfaceVariant};">
      ${content}
    </div>

    <!-- Footer -->
    <div class="footer-bg" style="padding: 24px 32px; background-color: ${COLORS.surfaceContainerLow}; text-align: center; border-top: 1px solid ${COLORS.outlineVariant};">
      <p class="text-outline-variant" style="margin: 0; font-size: 14px; color: ${COLORS.outlineVariant};">
        This is an automated message from Cat-Bot. Please do not reply.
      </p>
    </div>

  </div>
</body>
</html>`;
}

// Builds a reliable cross-client HTML button using divs.
export function buildButton(href: string, label: string): string {
  return `<div style="margin: 16px 0;">
    <a href="${href}" target="_blank" class="btn-primary" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: ${COLORS.onPrimary}; background-color: ${COLORS.primary}; text-decoration: none; border-radius: 8px; border: 1px solid ${COLORS.primary};">
      ${label}
    </a>
  </div>`;
}
