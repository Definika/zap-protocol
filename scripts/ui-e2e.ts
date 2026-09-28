// Browser end-to-end on localnet with the dev build's test wallet: log in, enable trading (faucet + account + deposit
// in one signature), open a position through the order form, then visit every page. Screenshots and console errors go
// to the output directory.
//
//   node scripts/ui-e2e.ts [appUrl] [outDir]

import { chromium, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.data/ui-e2e';
mkdirSync(out, { recursive: true });
const executablePath = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p): p is string => !!p && existsSync(p));
if (!executablePath) throw new Error('no Chromium-based browser found; set BROWSER_PATH');

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url()}`));

let n = 0;
const shot = async (name: string) => {
  const file = `${out}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('shot', file);
};
const click = async (p: Page, text: string, exact = true) => {
  await p.getByText(text, { exact }).first().click();
};
const waitText = (text: string, ms = 30_000) => page.getByText(text).first().waitFor({ timeout: ms });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2_500);
await click(page, 'Continue with Google');
await page.waitForTimeout(3_000);
await shot('logged-in');

// enable trading from the header's Deposit button
await click(page, 'Deposit');
await page.waitForTimeout(1_000);
await shot('enable-modal');
await page.locator('button', { hasText: /^Enable trading/ }).first().click();
await page.getByText('Enable trading ·').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(4_000);
await shot('trading-enabled');

// open a long through the order form (margin 250 at the default leverage)
await page.locator('button', { hasText: /^Open Long$/ }).first().click();
await page.waitForTimeout(800);
await shot('confirm');
await click(page, 'Confirm');
await waitText('Long opened').catch(() => errors.push('no "Long opened" toast'));
await page.waitForTimeout(3_000);
await shot('position-open');

const toast = async (text: string) => {
  await waitText(text).catch(() => errors.push(`no "${text}" toast`));
  await page.waitForTimeout(1_500);
};

// TP / SL from the positions row
await page.locator('button[title="Edit TP / SL"]').first().click();
await page.waitForTimeout(600);
await click(page, '+50%');
await click(page, '−25%');
await shot('tpsl-dialog');
await click(page, 'Save TP / SL');
await toast('TP / SL updated');
await shot('tpsl-set');

// a limit long 3% under the mark
await page.locator('button', { hasText: /^Limit$/ }).first().click();
await page.waitForTimeout(400);
const px = page.getByLabel('Order price');
const mark = Number(await px.inputValue());
await px.fill((mark * 0.97).toFixed(3));
await page.locator('button', { hasText: /^Limit Long$/ }).first().click();
await page.waitForTimeout(600);
await click(page, 'Confirm');
await toast('Limit order placed');
await page.locator('button', { hasText: /^Orders/ }).first().click();
await page.waitForTimeout(800);
await shot('orders');
await page.locator('button', { hasText: /^Positions/ }).first().click();

// close half through the edit dialog
await page.locator('button', { hasText: /^Edit$/ }).first().click();
await page.waitForTimeout(500);
await page.locator('button', { hasText: /^Close$/ }).last().click();
await page.waitForTimeout(400);
await click(page, '50%');
await click(page, 'Close 50%');
await toast('Position reduced');
await shot('reduced');

for (const p of ['Markets', 'Portfolio', 'Vault', 'Leaderboard']) {
  await page.locator('nav button', { hasText: p }).first().click();
  await page.waitForTimeout(2_500);
  await shot(p.toLowerCase());
}
// vault deposit from the trading balance
await page.locator('nav button', { hasText: 'Vault' }).first().click();
await page.waitForTimeout(1_000);
await page.getByLabel('Vault amount').fill('1000');
await click(page, 'Deposit USDC');
await toast('Deposited to vault');
await shot('vault-deposit');

// close what's left, then look at the history
await page.locator('nav button', { hasText: 'Trade' }).first().click();
await page.waitForTimeout(1_000);
await page.locator('button', { hasText: /^Close$/ }).first().click();
await toast('Position closed');
await page.locator('button', { hasText: /^Trade history/ }).first().click();
await page.waitForTimeout(1_500);
await shot('history');

await browser.close();
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no errors');
