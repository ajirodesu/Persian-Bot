/**
 * Vanilla HTML Email Templates
 *
 * Mapped directly from packages/web/src/styles/theme/aqua.css — the current
 * default Cat-Bot dashboard theme (dark teal, "Aqua"). The design mirrors the
 * auth pages' glass treatment: a dark ambient surface, a frosted rounded card
 * with a subtle top-edge specular catch, and an aqua glow-ring brand badge.
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

// "Primary container" tint used behind the logo badge — mirrors the
// bg-primary-container/80 pill the web app uses behind Logo/icons in its own
// auth headers (ForgotPassword, AccountVerification, ResetPassword, Login).
const PRIMARY_CONTAINER = '#0d241f'; // primary-container at ~80% strength
const ON_PRIMARY_CONTAINER = '#bdf3e9'; // --aqua-color-on-primary-container rgb(199 250 232)

/**
 * Cat-Bot brand mark, inlined as raw SVG (not an <img>) so it renders with no
 * external request and no broken-image icon if remote images are blocked —
 * the single most common reason transactional-email logos fail to show up.
 * Path data is copied verbatim from packages/web/src/components/ui/Logo.tsx
 * so the email mark matches the web app exactly. fill="currentColor" lets it
 * pick up the wrapping element's `color`, same trick Logo.tsx relies on in
 * the web app — that's also why the dark-mode override below only needs to
 * flip `.text-primary`'s `color`, not touch the SVG itself.
 */
function buildLogoMarkSvg(sizePx: number): string {
  return `<svg width="${sizePx}" height="${sizePx}" viewBox="-28 -28 568 413" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cat-Bot">
    <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M 52,14 L 45,32 L 45,64 L 50,91 L 57,110 L 19,134 L 51,139 L 35,154 L 15,180 L 5,201 L 0,223 L 18,206 L 29,201 L 13,260 L 11,292 L 17,313 L 26,326 L 43,339 L 30,314 L 28,287 L 38,255 L 39,261 L 41,261 L 40,264 L 56,290 L 71,306 L 90,320 L 128,338 L 188,353 L 229,357 L 301,356 L 343,350 L 384,339 L 420,322 L 446,302 L 465,278 L 475,256 L 484,279 L 485,303 L 481,319 L 468,338 L 478,333 L 492,318 L 501,297 L 502,274 L 498,250 L 484,201 L 486,200 L 512,220 L 507,199 L 495,175 L 482,158 L 462,139 L 465,137 L 486,136 L 493,133 L 486,131 L 457,111 L 466,78 L 468,36 L 465,23 L 454,8 L 431,0 L 403,1 L 372,9 L 345,22 L 292,10 L 233,9 L 198,14 L 168,23 L 138,8 L 101,0 L 80,0 L 67,3 Z M 73,27 L 78,23 L 93,22 L 116,28 L 134,37 L 160,57 L 201,41 L 249,34 L 280,35 L 305,39 L 354,56 L 369,43 L 393,29 L 421,22 L 438,25 L 444,35 L 444,58 L 438,86 L 433,96 L 401,77 L 398,73 L 422,65 L 421,62 L 402,56 L 390,56 L 364,64 L 364,66 L 389,83 L 420,115 L 435,136 L 450,165 L 458,193 L 459,214 L 455,236 L 444,260 L 423,284 L 404,298 L 385,308 L 340,322 L 299,328 L 241,330 L 187,325 L 140,313 L 110,299 L 93,287 L 77,271 L 62,247 L 55,222 L 56,188 L 67,155 L 93,113 L 120,85 L 150,64 L 124,56 L 111,56 L 89,64 L 115,74 L 81,97 L 77,90 L 70,60 L 69,38 Z"/>
    <path fill="currentColor" d="M 326,172 L 322,174 L 317,179 L 315,183 L 314,198 L 317,205 L 322,210 L 327,212 L 336,212 L 340,210 L 347,202 L 349,192 L 348,185 L 344,177 L 337,172 Z"/>
    <path fill="currentColor" d="M 176,172 L 171,175 L 166,182 L 165,185 L 165,198 L 169,206 L 172,209 L 178,212 L 187,212 L 194,208 L 198,203 L 200,195 L 200,188 L 197,180 L 192,174 L 187,172 Z"/>
    <path fill="currentColor" d="M 232,209 L 230,213 L 231,223 L 239,232 L 248,237 L 249,240 L 246,245 L 237,252 L 230,255 L 217,257 L 214,260 L 214,265 L 217,268 L 234,268 L 250,259 L 256,252 L 259,256 L 270,264 L 282,269 L 295,269 L 301,265 L 301,260 L 299,258 L 278,253 L 273,250 L 265,241 L 265,238 L 275,231 L 283,221 L 284,215 L 279,207 L 271,204 L 241,204 Z"/>
  </svg>`;
}

/**
 * Rounded "glow ring" avatar badge holding the brand mark, mirroring the
 * h-12 w-12 rounded-2xl bg-primary-container/80 border-primary/20 `glow-ring`
 * pill the auth pages join to their heading (e.g. "Verify your email"). Sits
 * at the top of every transactional email in place of a plain text wordmark.
 * `glow-ring` in the web app is a faint primary halo, emulated here via a soft
 * box-shadow. The mark renders at h-6 w-6 (24px) in on-primary-container, the
 * same size/color the auth pages use for `<Logo className="h-6 w-6 text-on-primary-container" />`.
 */
function buildLogoBadge(): string {
  return `<div class="logo-badge" style="box-sizing: border-box; width: 48px; height: 48px; padding: 12px; border-radius: 16px; background-color: ${PRIMARY_CONTAINER}; border: 1px solid rgba(49, 224, 190, 0.22); color: ${ON_PRIMARY_CONTAINER}; line-height: 0; box-shadow: 0 12px 28px -10px rgba(49, 224, 190, 0.45);">
    ${buildLogoMarkSvg(24)}
  </div>`;
}

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
      .logo-badge { background-color: ${PRIMARY_CONTAINER} !important; border-color: rgba(49, 224, 190, 0.22) !important; color: ${ON_PRIMARY_CONTAINER} !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.surfaceContainerLow}; color: ${COLORS.onSurface}; -webkit-font-smoothing: antialiased;">
  ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${previewText}</div>` : ''}

  <div class="card-glass" style="max-width: 600px; margin: 32px auto; background-color: ${COLORS.surface}; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.08); overflow: hidden; box-shadow: 0 28px 56px -18px rgba(0, 0, 0, 0.6);">
    <div class="card-specular"></div>

    <!-- Header -->
    <div style="padding: 36px 32px 8px; text-align: center;">
      <div style="display: inline-block; margin-bottom: 14px;">
        ${buildLogoBadge()}
      </div>
      <div style="font-size: 20px; font-weight: 650; letter-spacing: -0.02em; color: ${COLORS.onSurface}; margin: 0;">Cat-Bot</div>
    </div>

    <!-- Content -->
    <div class="text-on-surface-variant" style="padding: 16px 32px 8px; font-size: 16px; line-height: 1.55; color: ${COLORS.onSurfaceVariant};">
      ${content}
    </div>

    <!-- Footer -->
    <div style="padding: 24px 32px 32px; text-align: center;">
      <p class="text-outline-variant" style="margin: 0; font-size: 13px; line-height: 1.6; color: ${COLORS.outlineVariant};">
        This is an automated message from Cat-Bot. Please do not reply.
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
