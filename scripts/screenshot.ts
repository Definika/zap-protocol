// Headless screenshots with the locally installed Chromium-based browser (no browser download).
//
//   node scripts/screenshot.ts <url-or-file> <out.png> [width] [height] [waitMs] [--click "Button text"]...
//
// Each --click clicks the first element with that exact text and waits 1.5s, in order, before the screenshot.
// Set BROWSER_PATH to override the browser executable.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((p): p is string => !!p);

const args = process.argv.slice(2);
const clicks: string[] = [];
for (let i = args.indexOf('--click'); i >= 0; i = args.indexOf('--click')) clicks.push(...args.splice(i, 2).slice(1));
const [target, out, width = '1440', height = '900', wait = '2500'] = args;
if (!target || !out) {
  console.error('usage: node scripts/screenshot.ts <url-or-file> <out.png> [width] [height] [waitMs]');
  process.exit(1);
}
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('no Chromium-based browser found; set BROWSER_PATH');

const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
for (const text of clicks) {
  await page.getByText(text, { exact: true }).first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}${errors.length ? `\nerrors:\n  ${errors.slice(0, 10).join('\n  ')}` : ''}`);
