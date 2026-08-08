/**
 * Vanilla HTML Email Templates
 *
 * Mapped directly from packages/web/src/styles/theme/aqua.css — the current
 * default Cat-Bot dashboard theme (dark teal, "Aqua"). The design mirrors the
 * auth pages' glass treatment: a dark ambient surface and a frosted rounded
 * card with a subtle top-edge specular catch.
 *
 * Responsive strategy:
 *   - The container is fluid (width:100%) and never exceeds 760px, so it
 *     stretches gracefully on desktop/large mail panes instead of floating as
 *     a small column, while staying full-width and comfortable on phones.
 *   - A <style> block in the <head> holds shared classes + media queries
 *     (@media ≤600px tightens spacing/typography, @media ≥1024px adds air on
 *     large displays). Every class has a matching inline style fallback so
 *     clients that strip <style> still render correctly.
 *
 * Email clients are fickle about advanced CSS, so the layout leans on tables
 * + inline styles and only uses media queries for the padding/type tweaks.
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
  surface: '#0a1114',
  onSurface: '#f0f7f5',
  onSurfaceVariant: '#98a8a4',
  surfaceContainerLow: '#070e11',
  outlineVariant: '#2a3634',
};

// Shared <style> block — CSS class hooks let media queries reshape padding and
// type at every breakpoint while the inline styles below act as the baseline.
const STYLE_BLOCK = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  * { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }

  .body-bg {
    background-color: ${COLORS.surfaceContainerLow};
    background-image:
      radial-gradient(46% 30% at 12% 0%, rgba(52, 224, 190, 0.10), transparent 100%),
      radial-gradient(42% 34% at 100% 100%, rgba(129, 140, 248, 0.08), transparent 100%);
  }

  .email-container { width: 100%; max-width: 760px; margin: 0 auto; }

  .card {
    background-color: ${COLORS.surface};
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 64px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    box-shadow: 0 24px 64px -20px rgba(0, 0, 0, 0.65);
    overflow: hidden;
  }
  .card > .card-specular { height: 2px; background-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.12) 30%, rgba(52, 224, 190, 0.5) 50%, rgba(255, 255, 255, 0.12) 70%, transparent); }

  .header { padding: 28px 44px 0; }
  .content { padding: 32px 44px 8px; font-size: 17px; line-height: 1.65; color: ${COLORS.onSurfaceVariant}; }
  .footer { padding: 28px 44px 40px; text-align: center; }

  .otp-box {
    display: inline-block;
    margin: 28px 0 8px;
    padding: 24px 46px;
    border-radius: 16px;
    background-color: ${COLORS.surfaceContainerLow};
    border: 1px solid ${COLORS.outlineVariant};
    box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.6);
  }
  .otp-code {
    display: block;
    font-size: 32px;
    font-weight: 800;
    letter-spacing: 0.24em;
    color: ${COLORS.primary};
    font-family: 'SF Mono', 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    text-align: center;
  }

  @media only screen and (min-width: 1024px) {
    .card { border-radius: 28px; }
    .header { padding: 36px 56px 0 !important; }
    .content { padding: 40px 56px 12px !important; }
    .otp-box { padding: 28px 54px !important; margin: 32px 0 10px !important; }
    .otp-code { font-size: 36px !important; }
    .footer { padding: 32px 56px 44px !important; }
  }

  @media only screen and (max-width: 600px) {
    .email-container { max-width: 100% !important; }
    .card { border-radius: 18px !important; }
    .header { padding: 22px 20px 0 !important; }
    .content { padding: 24px 20px 6px !important; font-size: 15px !important; line-height: 1.55 !important; }
    .otp-box { padding: 16px 18px !important; margin: 24px 0 6px !important; }
    .otp-code { font-size: 24px !important; letter-spacing: 0.18em !important; }
    .footer { padding: 22px 20px 30px !important; }
  }

  @media (prefers-color-scheme: dark) {
    .body-bg { background-color: ${DARK_COLORS.surfaceContainerLow} !important; }
    .card { background-color: ${DARK_COLORS.surface} !important; border-color: rgba(255, 255, 255, 0.08) !important; }
    .text-on-surface-variant { color: ${DARK_COLORS.onSurfaceVariant} !important; }
    .text-outline-variant { color: ${DARK_COLORS.outlineVariant} !important; }
  }
`;

// ── Layout shell ───────────────────────────────────────────────────────────────

// Wraps dynamic content within our branded email layout shell. Fluid container
// (max 760px) + table scaffolding keeps the card centered and readable on any
// window size, from a 320px phone to a 4K desktop mail client.
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
  <style>${STYLE_BLOCK}</style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.surfaceContainerLow}; color: ${COLORS.onSurface}; -webkit-font-smoothing: antialiased;">
  ${previewText ? `<div style="display: none; max-height: 0; overflow: hidden;">${previewText}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="body-bg">
    <tr>
      <td align="center" style="padding: 24px 16px 40px;">
        <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 760px; margin: 0 auto;">
          <tr>
            <td class="card" style="background-color: ${COLORS.surface}; background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 64px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; box-shadow: 0 24px 64px -20px rgba(0, 0, 0, 0.65); overflow: hidden;">
              <div class="card-specular" style="height: 2px; background-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.12) 30%, rgba(52, 224, 190, 0.5) 50%, rgba(255, 255, 255, 0.12) 70%, transparent);"></div>

              <!-- Card header — brand row that scales with the container -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="header" style="padding: 28px 44px 0;">
                <tr>
                  <td align="left" style="font-size: 17px; font-weight: 700; letter-spacing: 0.04em; color: ${COLORS.onSurface};">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${COLORS.primary}; margin-right: 8px; vertical-align: middle;"></span>Cat-Bot
                  </td>
                  <td align="right" style="font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: ${COLORS.outlineVariant};">
                    Automated email
                  </td>
                </tr>
              </table>

              <!-- Content -->
              <div class="content" style="padding: 32px 44px 8px; font-size: 17px; line-height: 1.65; color: ${COLORS.onSurfaceVariant};">
                ${content}
              </div>

              <!-- Footer -->
              <div class="footer" style="padding: 28px 44px 40px; text-align: center;">
                <p class="text-outline-variant" style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.outlineVariant};">Cat-Bot</p>
                <p class="text-outline-variant" style="margin: 0; font-size: 13px; line-height: 1.6; color: ${COLORS.outlineVariant};">
                  This is an automated message. Please do not reply to this email.
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Renders a large, phone-style one-time code that recipients copy into the
// verification/reset form. Glyph-spaced so it scans easily in every client,
// and scales up on large windows / down on narrow phones via .otp-box/.otp-code.
export function buildCodeBlock(code: string): string {
  const digits = code.split('').join(' ');
  return `<div style="text-align: center; width: 100%;">
    <div class="otp-box" style="display: inline-block; margin: 28px 0 8px; padding: 24px 46px; border-radius: 16px; background-color: ${COLORS.surfaceContainerLow}; border: 1px solid ${COLORS.outlineVariant}; box-shadow: 0 14px 30px -16px rgba(0, 0, 0, 0.6);">
      <span class="otp-code" style="display: block; font-size: 32px; font-weight: 800; letter-spacing: 0.24em; color: ${COLORS.primary}; font-family: 'SF Mono', 'Cascadia Code', 'Roboto Mono', Consolas, monospace; text-align: center;">${digits}</span>
    </div>
  </div>`;
}