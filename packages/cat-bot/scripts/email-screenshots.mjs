#!/usr/bin/env node
/**
 * Email screenshots — light and dark, phone and desktop.
 *
 * Reads the HTML produced by `preview:emails` and renders each template with
 * Chrome's `prefers-color-scheme` emulation at 375px and 1200px, writing PNGs
 * to docs/email-review/. Run `npm run preview:emails` first.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../.email-preview');
const outDir = path.resolve(here, '../../../docs/email-review');
const chrome =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell`;

const templates = ['verify-user', 'reset-user', 'verify-admin', 'reset-admin'];
const schemes = ['light', 'dark'];
const widths = [
  ['phone', 375, 812],
  ['desktop', 1200, 900],
];

await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
});

for (const slug of templates) {
  const html = await readFile(path.join(srcDir, `${slug}.html`), 'utf8');
  const url = pathToFileURL(path.join(srcDir, `${slug}.html`)).href;
  if (!html.includes('<!DOCTYPE html>')) throw new Error(`${slug}: missing HTML`);
  for (const scheme of schemes) {
    for (const [name, width, height] of widths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: scheme },
      ]);
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.screenshot({
        path: path.join(outDir, `${slug}-${scheme}-${name}.png`),
        fullPage: true,
      });
      await page.close();
    }
  }
}

await browser.close();
console.log(`Wrote email screenshots to ${outDir}`);
