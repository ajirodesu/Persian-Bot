/**
 * Transactional email system.
 *
 * Design intent: the same "telemetry printout" as the product — a ruled
 * document, not a marketing card. One accent, one button, a large legible
 * code, and copy that states exactly what happened and what to do next.
 *
 * Engineering constraints:
 * - Table-based layout with inline styles; `<style>` only enhances dark mode
 *   and small screens. Gmail, Outlook desktop/web, Apple Mail, Yahoo and
 *   mobile clients all render the inline baseline.
 * - 600px max width, fluid below it.
 * - Light by default (most clients), with a real `prefers-color-scheme: dark`
 *   palette plus `[data-ogsc]` overrides for Outlook.com dark mode.
 * - No images: the mark is a CSS square and text, so the email is fully
 *   readable with images blocked and no alt-text can be missed.
 * - Every colour, size, radius and spacing value comes from `EMAIL_TOKENS`.
 *
 * Contrast (light): ink #15181A on #FFFFFF = 17.8:1, muted #5C6760 on #FFFFFF
 * = 6.1:1, white on accent #0B7A55 = 5.1:1. Dark: #E6EAE3 on #141817 = 14.9:1,
 * #A6B0A8 on #141817 = 7.4:1, #062017 on #3DDC97 = 11.2:1.
 */

export interface EmailTemplate {
  subject: string
  preheader: string
  html: string
  text: string
}

type EmailScope = 'user' | 'admin'

interface BaseEmailOptions {
  /** Recipient display name. Falls back to a neutral greeting. */
  name?: string | undefined
  /** Where the primary button points. Repeated as a plain-URL fallback. */
  actionUrl: string
  /** Support destination shown in the footer. */
  supportUrl?: string
}

interface CodeEmailOptions extends BaseEmailOptions {
  code: string
  expiresInMinutes?: number
}

// ── Tokens ───────────────────────────────────────────────────────────────────

const LIGHT = {
  page: '#F3F5F2',
  card: '#FFFFFF',
  ink: '#15181A',
  muted: '#5C6760',
  hairline: '#DCE2DB',
  accent: '#0B7A55',
  accentInk: '#FFFFFF',
  codeBg: '#F1F5F0',
  codeBorder: '#CBD8CD',
  footer: '#7A847D',
} as const

const DARK = {
  page: '#0B0D0C',
  card: '#141817',
  ink: '#E6EAE3',
  muted: '#A6B0A8',
  hairline: '#2A312C',
  accent: '#3DDC97',
  accentInk: '#062017',
  codeBg: '#0F1312',
  codeBorder: '#2E3A31',
  footer: '#8A948C',
} as const

export const EMAIL_TOKENS = {
  width: 600,
  radius: 4,
  color: { light: LIGHT, dark: DARK },
  font: {
    // Email-safe stacks only. No webfont: most clients strip @font-face, so a
    // second webfont would silently fail and change the layout mid-inbox.
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  },
  type: {
    h1: 26,
    h1Mobile: 22,
    eyebrow: 11,
    body: 16,
    bodyMobile: 15,
    small: 13,
    code: 34,
    codeMobile: 28,
    wordmark: 16,
  },
  space: {
    pageY: 32,
    card: 40,
    cardMobile: 22,
    block: 20,
    tight: 10,
    footerY: 28,
  },
  line: {
    body: 1.6,
    heading: 1.15,
  },
} as const

export const SUPPORT_URL = 'https://github.com/ajirodesu/Persian-Bot/issues'

// ── Escaping ─────────────────────────────────────────────────────────────────

/** Escapes user-controlled strings (names/emails) before interpolation. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeUrl(value: string): string {
  return escapeHtml(value).replace(/ /g, '%20')
}

// ── Shared building blocks ───────────────────────────────────────────────────

function button(url: string, label: string): string {
  const { radius, font, type, space, color } = EMAIL_TOKENS
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" bgcolor="${color.light.accent}" class="email-button-cell" style="border-radius:${radius}px; background-color:${color.light.accent};">
        <a href="${escapeUrl(url)}" target="_blank" rel="noopener" class="email-button" style="display:inline-block; padding:14px 24px; font-family:${font.body}; font-size:${type.body}px; font-weight:700; line-height:1; color:${color.light.accentInk}; text-decoration:none; border-radius:${radius}px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p class="email-muted" style="margin:${space.tight}px 0 0; font-family:${font.mono}; font-size:${type.eyebrow}px; line-height:1.5; color:${color.light.muted}; word-break:break-all;">
    Button not working? <a href="${escapeUrl(url)}" target="_blank" rel="noopener" style="color:${color.light.accent}; text-decoration:underline;">Open the link instead</a>
  </p>`
}

function codeBlock(code: string): string {
  const { font, type, space, color, radius } = EMAIL_TOKENS
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-code-wrap">
    <tr>
      <td align="center" style="padding:${space.block}px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="center" bgcolor="${color.light.codeBg}" class="email-code-cell" style="padding:22px 20px; border:1px solid ${color.light.codeBorder}; border-radius:${radius}px; background-color:${color.light.codeBg};">
              <span class="email-code" style="font-family:${font.mono}; font-size:${type.code}px; line-height:1; font-weight:700; letter-spacing:0.24em; color:${color.light.accent}; mso-line-height-rule:exactly;">${escapeHtml(code)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`
}

/** Paragraph with the shared body rhythm. */
function p(html: string, options: { muted?: boolean } = {}): string {
  const { font, type, space, color, line } = EMAIL_TOKENS
  return `<p class="email-text${options.muted ? ' email-muted' : ''}" style="margin:0 0 ${space.tight}px; font-family:${font.body}; font-size:${type.body}px; line-height:${line.body}; color:${options.muted ? color.light.muted : color.light.ink};">${html}</p>`
}

// ── Shell ────────────────────────────────────────────────────────────────────

function shell({
  preheader,
  scopeLabel,
  eyebrow,
  headingText,
  content,
  supportUrl,
}: {
  preheader: string
  scopeLabel: string
  eyebrow: string
  headingText: string
  content: string
  supportUrl: string
}): string {
  const t = EMAIL_TOKENS
  const c = t.color.light
  const cardPad = t.space.card

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(headingText)}</title>
  <!--[if mso]>
  <style>
    body, table, td, p, a { font-family: Arial, Helvetica, sans-serif !important; }
    .email-code { font-family: Consolas, 'Courier New', monospace !important; }
  </style>
  <![endif]-->
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; outline:none; text-decoration:none; }
    a { text-decoration:none; }
    .email-page { background-color:${c.page}; }
    .email-card { background-color:${c.card}; border:1px solid ${c.hairline}; }
    .email-text { color:${c.ink}; }
    .email-heading { color:${c.ink}; }
    .email-muted { color:${c.muted}; }
    .email-code-cell { background-color:${c.codeBg}; border-color:${c.codeBorder}; }
    .email-code { color:${c.accent}; }
    .email-button-cell { background-color:${c.accent}; }
    .email-button { color:${c.accentInk}; }
    .email-footer { color:${c.footer}; }

    @media only screen and (max-width:600px) {
      .email-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
      .email-pad { padding-left:${t.space.cardMobile}px !important; padding-right:${t.space.cardMobile}px !important; }
      .email-h1 { font-size:${t.type.h1Mobile}px !important; }
      .email-text { font-size:${t.type.bodyMobile}px !important; }
      .email-code { font-size:${t.type.codeMobile}px !important; letter-spacing:0.18em !important; }
    }

    @media (prefers-color-scheme: dark) {
      .email-page { background-color:${DARK.page} !important; }
      .email-card { background-color:${DARK.card} !important; border-color:${DARK.hairline} !important; }
      .email-text, .email-heading { color:${DARK.ink} !important; }
      .email-muted { color:${DARK.muted} !important; }
      .email-code-cell { background-color:${DARK.codeBg} !important; border-color:${DARK.codeBorder} !important; }
      .email-code { color:${DARK.accent} !important; }
      .email-button-cell { background-color:${DARK.accent} !important; }
      .email-button { color:${DARK.accentInk} !important; }
      .email-footer { color:${DARK.footer} !important; }
    }

    /* Outlook.com dark mode (non-standard), still the most reliable hook. */
    [data-ogsc] .email-page { background-color:${DARK.page} !important; }
    [data-ogsc] .email-card { background-color:${DARK.card} !important; border-color:${DARK.hairline} !important; }
    [data-ogsc] .email-text, [data-ogsc] .email-heading { color:${DARK.ink} !important; }
    [data-ogsc] .email-muted, [data-ogsc] .email-footer { color:${DARK.muted} !important; }
    [data-ogsc] .email-code { color:${DARK.accent} !important; }
  </style>
</head>
<body class="email-page" bgcolor="${c.page}" style="margin:0; padding:0; background-color:${c.page}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; font-size:1px; color:${c.page}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">
    ${escapeHtml(preheader)}
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.page}" class="email-page" style="background-color:${c.page};">
    <tr>
      <td align="center" class="email-page" style="padding:${t.space.pageY}px 12px; background-color:${c.page};">

        <!-- Masthead -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:${t.width}px;">
          <tr>
            <td class="email-pad" style="padding:0 0 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <span style="display:inline-block; width:10px; height:10px; background-color:${c.accent}; vertical-align:middle; margin-right:9px;"></span>
                    <span class="email-heading" style="font-family:${t.font.body}; font-size:${t.type.wordmark}px; font-weight:700; letter-spacing:0.14em; color:${c.ink}; vertical-align:middle;">CAT-BOT</span>
                  </td>
                  <td align="right" valign="middle" class="email-footer" style="font-family:${t.font.mono}; font-size:${t.type.eyebrow}px; letter-spacing:0.16em; color:${c.footer};">
                    ${escapeHtml(scopeLabel)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:${t.width}px;">
          <tr>
            <td class="email-card" bgcolor="${c.card}" style="background-color:${c.card}; border:1px solid ${c.hairline}; border-radius:${t.radius}px; overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="email-pad" style="padding:${cardPad}px ${cardPad}px 0;">
                    <p style="margin:0 0 14px; font-family:${t.font.mono}; font-size:${t.type.eyebrow}px; letter-spacing:0.18em; text-transform:uppercase; color:${c.accent};">${escapeHtml(eyebrow)}</p>
                    <h1 class="email-h1 email-heading" style="margin:0 0 16px; font-family:${t.font.body}; font-size:${t.type.h1}px; line-height:${t.line.heading}; font-weight:700; color:${c.ink};">${escapeHtml(headingText)}</h1>
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td class="email-pad" style="padding:${t.space.block}px ${cardPad}px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px; background-color:${c.hairline}; line-height:1px; font-size:0;">&nbsp;</td></tr></table>
                  </td>
                </tr>
                <tr>
                  <td class="email-pad" style="padding:${t.space.footerY}px ${cardPad}px;">
                    <p class="email-footer" style="margin:0 0 6px; font-family:${t.font.body}; font-size:${t.type.small}px; line-height:1.6; color:${c.footer};">
                      Cat-Bot · Operations console. This is a transactional message about your account, not marketing.
                    </p>
                    <p class="email-footer" style="margin:0; font-family:${t.font.body}; font-size:${t.type.small}px; line-height:1.6; color:${c.footer};">
                      Need help? <a href="${escapeUrl(supportUrl)}" target="_blank" rel="noopener" style="color:${c.accent}; text-decoration:underline;">Open a support issue</a>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Copy helpers ─────────────────────────────────────────────────────────────

function greeting(name: string | undefined): string {
  return name && name.trim().length > 0
    ? `Hello ${escapeHtml(name)},`
    : 'Hello,'
}

function securityNote(what: string): string {
  return `<div style="margin-top:${EMAIL_TOKENS.space.block}px;">${p(
    `Didn't request this? ${what}`,
    { muted: true },
  )}</div>`
}

// ── Templates ────────────────────────────────────────────────────────────────

/** Email verification (user or admin scope). */
export function buildVerificationEmail(
  options: CodeEmailOptions & { scope?: EmailScope },
): EmailTemplate {
  const { name, code, actionUrl, supportUrl = SUPPORT_URL } = options
  const expires = options.expiresInMinutes ?? 10
  const admin = options.scope === 'admin'
  const subject = admin
    ? 'Your Cat-Bot admin verification code'
    : 'Your Cat-Bot verification code'
  const heading = admin ? 'Verify admin access' : 'Verify your email'
  const scopeLabel = admin ? 'ADMIN SECURITY' : 'ACCOUNT SECURITY'
  const purpose = admin
    ? 'verify the new email address on your Cat-Bot admin account'
    : 'verify your email address and activate your Cat-Bot account'
  const didNotRequest = admin
    ? 'If you did not change the admin email address, contact the repository owner immediately.'
    : 'If you did not create a Cat-Bot account, no action is needed.'

  const intro =
    p(greeting(name)) +
    p(
      admin
        ? 'Use the code below to verify the new email address on your Cat-Bot admin account.'
        : 'Use the code below to verify your email address and activate your Cat-Bot account.',
    )

  const content = `${intro}
  ${codeBlock(code)}
  ${p(`This code expires in ${expires} minutes. It can be used once.`, { muted: true })}
  ${button(actionUrl, admin ? 'Open admin console' : 'Enter your code')}
  ${securityNote(didNotRequest)}`

  const preheader = `${admin ? 'Admin' : 'Your'} verification code expires in ${expires} minutes.`

  return {
    subject,
    preheader,
    html: shell({
      preheader,
      scopeLabel,
      eyebrow: 'Verification',
      headingText: heading,
      content,
      supportUrl,
    }),
    text: `${admin ? 'CAT-BOT / ADMIN SECURITY' : 'CAT-BOT / ACCOUNT SECURITY'}

${heading}

${name ? `Hello ${name},` : 'Hello,'}

Use the code below to ${purpose}:

    ${code}

This code expires in ${expires} minutes. It can be used once.

${admin ? 'Open the admin console' : 'Enter your code'}: ${actionUrl}

Didn't request this? ${didNotRequest}

--
Cat-Bot · Operations console
This is a transactional message about your account, not marketing.
Support: ${supportUrl}
`,
  }
}

/** Password reset (user or admin scope). */
export function buildPasswordResetEmail(
  options: CodeEmailOptions & { scope?: EmailScope },
): EmailTemplate {
  const { name, code, actionUrl, supportUrl = SUPPORT_URL } = options
  const expires = options.expiresInMinutes ?? 10
  const admin = options.scope === 'admin'
  const subject = admin
    ? 'Reset your Cat-Bot admin password'
    : 'Reset your Cat-Bot password'
  const heading = admin ? 'Reset your admin password' : 'Reset your password'
  const scopeLabel = admin ? 'ADMIN SECURITY' : 'ACCOUNT SECURITY'
  const didNotRequest = admin
    ? 'If you did not request an admin password reset, someone may be targeting this account — contact the repository owner and do not share this code.'
    : 'If you did not request a password reset, your password has not changed and no action is needed.'

  const intro =
    p(greeting(name)) +
    p(
      admin
        ? 'Use the code below to set a new password for your Cat-Bot admin account.'
        : 'Use the code below to set a new password for your Cat-Bot account.',
    )

  const content = `${intro}
  ${codeBlock(code)}
  ${p(`This code expires in ${expires} minutes. It can be used once.`, { muted: true })}
  ${button(actionUrl, 'Reset password')}
  ${securityNote(didNotRequest)}`

  const preheader = `Your password reset code expires in ${expires} minutes.`

  return {
    subject,
    preheader,
    html: shell({
      preheader,
      scopeLabel,
      eyebrow: 'Password reset',
      headingText: heading,
      content,
      supportUrl,
    }),
    text: `${admin ? 'CAT-BOT / ADMIN SECURITY' : 'CAT-BOT / ACCOUNT SECURITY'}

${heading}

${name ? `Hello ${name},` : 'Hello,'}

Use the code below to set a new password for your Cat-Bot${admin ? ' admin' : ''} account:

    ${code}

This code expires in ${expires} minutes. It can be used once.

Reset password: ${actionUrl}

Didn't request this? ${didNotRequest}

--
Cat-Bot · Operations console
This is a transactional message about your account, not marketing.
Support: ${supportUrl}
`,
  }
}
