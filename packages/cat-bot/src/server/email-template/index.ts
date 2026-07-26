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

// Light-mode "primary container" tint used behind the logo badge — mirrors the
// bg-primary-container/80 pill the web app uses behind Logo/icons in its own
// headers (ForgotPassword, AccountVerification, etc).
const PRIMARY_CONTAINER = '#dbe4ff'; // var(--light-color-primary-container)
const DARK_PRIMARY_CONTAINER = '#28407a'; // var(--dark-color-primary-container)

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
 * Circular "profile picture" style badge — a rounded avatar bubble holding the
 * brand mark, matching the h-12 w-12 rounded-2xl bg-primary-container/80
 * badge the web app itself uses above headings like "Account Recovery" and
 * "Verify your email". Sits at the top of every transactional email in place
 * of a plain text wordmark.
 */
function buildLogoBadge(): string {
  return `<div class="logo-badge text-primary" style="box-sizing: border-box; width: 48px; height: 48px; padding: 12px; border-radius: 16px; background-color: ${PRIMARY_CONTAINER}; border: 1px solid ${COLORS.primary}33; color: ${COLORS.primary}; line-height: 0;">
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
      .logo-badge { background-color: ${DARK_PRIMARY_CONTAINER} !important; border-color: ${DARK_COLORS.primary}33 !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: ${COLORS.surfaceContainerLow}; color: ${COLORS.onSurface}; -webkit-font-smoothing: antialiased;">
  ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${previewText}</div>` : ''}
  
  <div class="card-bg" style="max-width: 600px; margin: 0 auto; background-color: ${COLORS.surface}; border-radius: 12px; border: 1px solid ${COLORS.outlineVariant}; overflow: hidden; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div class="header-bg" style="padding: 24px 32px; border-bottom: 1px solid ${COLORS.outlineVariant}; background-color: ${COLORS.surface};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
        <tr>
          <td style="vertical-align: middle;">
            ${buildLogoBadge()}
          </td>
          <td style="vertical-align: middle; padding-left: 12px;">
            <h1 class="text-primary" style="font-size: 22px; font-weight: 600; color: ${COLORS.primary}; letter-spacing: -0.02em; margin: 0;">
              Cat-Bot
            </h1>
          </td>
        </tr>
      </table>
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
