/**
 * Local email preview.
 *
 * Writes every transactional template to .email-preview/ as HTML + plain text
 * and builds a small index for eyeballing them in a browser. No network, no
 * mail provider, no credentials.
 *
 *   npm run preview:emails -w packages/cat-bot
 *   # then open packages/cat-bot/.email-preview/index.html
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  type EmailTemplate,
} from '../src/server/email-template/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../.email-preview');

const SAMPLE = {
  name: 'Ajiro Desu',
  code: '482913',
  userEmail: 'ajiro@example.com',
  base: 'http://localhost:5000',
};

const CASES: Array<{ slug: string; label: string; variant: string; email: EmailTemplate }> = [
  {
    slug: 'verify-user',
    label: 'Verify email (user)',
    variant: 'ACCOUNT SECURITY',
    email: buildVerificationEmail({
      name: SAMPLE.name,
      code: SAMPLE.code,
      scope: 'user',
      actionUrl: `${SAMPLE.base}/account-verification?email=${encodeURIComponent(SAMPLE.userEmail)}`,
    }),
  },
  {
    slug: 'reset-user',
    label: 'Reset password (user)',
    variant: 'ACCOUNT SECURITY',
    email: buildPasswordResetEmail({
      name: SAMPLE.name,
      code: SAMPLE.code,
      scope: 'user',
      actionUrl: `${SAMPLE.base}/reset-password?email=${encodeURIComponent(SAMPLE.userEmail)}`,
    }),
  },
  {
    slug: 'verify-admin',
    label: 'Verify email (admin)',
    variant: 'ADMIN SECURITY',
    email: buildVerificationEmail({
      name: SAMPLE.name,
      code: SAMPLE.code,
      scope: 'admin',
      actionUrl: `${SAMPLE.base}/admin`,
    }),
  },
  {
    slug: 'reset-admin',
    label: 'Reset password (admin)',
    variant: 'ADMIN SECURITY',
    email: buildPasswordResetEmail({
      name: SAMPLE.name,
      code: SAMPLE.code,
      scope: 'admin',
      actionUrl: `${SAMPLE.base}/admin/reset-password?email=${encodeURIComponent(SAMPLE.userEmail)}`,
    }),
  },
];

await mkdir(outDir, { recursive: true });

for (const item of CASES) {
  await writeFile(path.join(outDir, `${item.slug}.html`), item.email.html, 'utf8');
  await writeFile(path.join(outDir, `${item.slug}.txt`), item.email.text, 'utf8');
}

const links = CASES.map(
  (item) =>
    `<li><a href="./${item.slug}.html">${item.label}</a> · <a href="./${item.slug}.txt">plain text</a><br><small>Subject: ${item.email.subject}<br>Preheader: ${item.email.preheader}</small></li>`,
).join('\n');

const index = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cat-Bot transactional email preview</title>
<style>
  body { font: 15px/1.6 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; margin: 40px auto; max-width: 760px; padding: 0 20px; color: #15181A; background: #F3F5F2; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  li { margin: 18px 0; padding: 16px; background: #fff; border: 1px solid #DCE2DB; border-radius: 4px; }
  a { color: #0B7A55; }
  small { color: #5C6760; }
  .note { color: #5C6760; }
</style>
</head>
<body>
  <h1>Cat-Bot transactional email</h1>
  <p class="note">Light/dark rendering is controlled by the OS or mail client; open each file and switch your system theme to preview both palettes. Screenshots at 375/1200 px in both schemes: <code>npm run preview:emails:shots -w packages/cat-bot</code>.</p>
  <ul>${links}</ul>
</body>
</html>`;

await writeFile(path.join(outDir, 'index.html'), index, 'utf8');

console.log(`Wrote ${CASES.length} templates (HTML + text) to ${outDir}`);
