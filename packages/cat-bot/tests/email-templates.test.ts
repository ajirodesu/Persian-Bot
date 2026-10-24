/**
 * Email rendering verification.
 *
 * These tests enforce the contract the templates promise: table layout,
 * token-only colours, dark-mode hooks, a readable plain-text alternative,
 * escaped user input, and no image dependency. If a template regresses to a
 * hardcoded hex or a bare <div> layout, CI catches it here.
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_TOKENS,
  SUPPORT_URL,
  buildPasswordResetEmail,
  buildVerificationEmail,
  escapeHtml,
  type EmailTemplate,
} from '@/server/email-template/index';

const CODE = '482913';
const ACTION = 'http://localhost:5000/reset-password?email=ajiro%40example.com';

const templates: Array<[string, EmailTemplate]> = [
  [
    'user verification',
    buildVerificationEmail({ name: 'Ajiro Desu', code: CODE, scope: 'user', actionUrl: ACTION }),
  ],
  [
    'user reset',
    buildPasswordResetEmail({ name: 'Ajiro Desu', code: CODE, scope: 'user', actionUrl: ACTION }),
  ],
  [
    'admin verification',
    buildVerificationEmail({ name: 'Ajiro Desu', code: CODE, scope: 'admin', actionUrl: ACTION }),
  ],
  [
    'admin reset',
    buildPasswordResetEmail({ name: 'Ajiro Desu', code: CODE, scope: 'admin', actionUrl: ACTION }),
  ],
];

const allowedColours = new Set<string>(
  [EMAIL_TOKENS.color.light, EMAIL_TOKENS.color.dark]
    .flatMap((palette) => Object.values(palette))
    .map((value) => value.toLowerCase()),
);

describe.each(templates)('%s email', (_label, email) => {
  it('has a specific subject and preheader', () => {
    expect(email.subject.length).toBeGreaterThan(10);
    expect(email.subject).not.toMatch(/free|act now|urgent|winner|!!!|all caps/i);
    expect(email.preheader.length).toBeGreaterThan(10);
    expect(email.html).toContain(escapeHtml(email.preheader));
  });

  it('uses a 600px table layout with a single primary action', () => {
    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).toContain(`max-width:${EMAIL_TOKENS.width}px`);
    expect(email.html).toContain('class="email-button"');
    // One primary action, plus the plain-link fallback to the same URL.
    expect(email.html.match(/class="email-button"/g)).toHaveLength(1);
    expect(email.html).toContain('Button not working?');
  });

  it('supports light and dark mode in every major-client hook', () => {
    expect(email.html).toContain('name="color-scheme" content="light dark"');
    expect(email.html).toContain('prefers-color-scheme: dark');
    expect(email.html).toContain('[data-ogsc]');
    expect(email.html).toContain('@media only screen and (max-width:600px)');
    expect(email.html).toContain('bgcolor=');
  });

  it('renders the code large, legible and outside an image', () => {
    expect(email.html).toContain('class="email-code"');
    expect(email.html).toContain(CODE);
    expect(email.html).not.toContain('<img');
    expect(email.text).toContain(CODE);
  });

  it('ships a real plain-text alternative', () => {
    expect(email.text).toContain('CAT-BOT');
    expect(email.text).toContain(ACTION);
    expect(email.text).toContain(SUPPORT_URL);
    expect(email.text).toContain("Didn't request this?");
    expect(email.text).not.toContain('<html');
    expect(email.text).not.toContain('<table');
  });

  it('states what happened, the expiry, and how to get help', () => {
    expect(email.html).toContain('expires in 10 minutes');
    expect(email.html).toContain("Didn't request this?");
    expect(email.html).toContain(SUPPORT_URL);
    expect(email.html).toContain('not marketing');
  });

  it('uses only token colours', () => {
    const hexes = email.html.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) {
      expect(allowedColours.has(hex.toLowerCase()), `non-token colour ${hex}`).toBe(true);
    }
  });
});

describe('escaping', () => {
  it('escapes names before interpolation', () => {
    const email = buildVerificationEmail({
      name: '<script>alert("x")</script>',
      code: CODE,
      actionUrl: ACTION,
    });
    expect(email.html).not.toContain('<script>alert');
    expect(email.html).toContain('&lt;script&gt;');
    // Escaped copy must not leak into the text part either.
    expect(email.text).toContain('<script>alert("x")</script>');
  });

  it('escapeHtml covers the five HTML metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
