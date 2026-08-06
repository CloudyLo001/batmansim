/**
 * Headless QA driver: loads the game, waits through loading, captures phase
 * screenshots (intro, glide, dive, landing, perched), console errors, and
 * renderer diagnostics. Usage: node scripts/qa-run.mjs [url] [outDir]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const outDir = process.argv[3] ?? 'qa-shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(150000);

const consoleIssues = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleIssues.push(`[${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => consoleIssues.push(`[pageerror] ${error.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });

const diag = () => page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  return d
    ? {
        phase: d.phase,
        frame: d.frame,
        calls: d.renderer.calls,
        triangles: d.renderer.triangles,
        player: d.player,
      }
    : null;
});

const shoot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 150000 });
  const d = await diag();
  console.log(name, JSON.stringify(d));
};

// Wait for loading to finish (assets streamed) or error out.
try {
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('done') ||
      document.querySelector('#loading-status')?.classList.contains('error'),
    undefined,
    { timeout: 90000 },
  );
} catch {
  console.log('LOADING TIMEOUT');
}
const loadingError = await page.evaluate(
  () => document.querySelector('#loading-status')?.classList.contains('error')
    ? document.querySelector('#loading-status')?.textContent
    : null,
);
if (loadingError) {
  console.log('LOADING ERROR:', loadingError);
  await shoot('00-loading-error');
  await browser.close();
  process.exit(1);
}

// Landing-only mode: skip straight to the tower approach.
const landingOnly = process.argv[4] === 'landing';
if (!landingOnly) {
// Intro beats.
await page.waitForTimeout(1200);
await shoot('01-intro-batwing');
await page.waitForTimeout(3000);
await shoot('02-intro-freefall');
await page.waitForTimeout(3200);
await shoot('03-intro-capesnap');

// Wait for glide handoff.
await page.waitForFunction(
  () => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'glide',
  undefined,
  { timeout: 420000 },
);
await page.waitForTimeout(1500);
await shoot('04-glide');

// Steer right for a banking shot.
await page.keyboard.down('KeyD');
await page.waitForTimeout(1800);
await shoot('05-banking');
await page.keyboard.up('KeyD');

// Dive.
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(2000);
await shoot('06-dive');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(1600);
await shoot('07-swoop');

}

// Approach the tower for the real landing cinematic.
await page.evaluate(() => {
  window.__THREE_GAME_TEST_HOOKS__?.setState('near-tower');
});
await page.waitForTimeout(600);
await shoot('08-approach');
await page.waitForFunction(
  () => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'landing',
  undefined,
  { timeout: 420000 },
);
await page.waitForTimeout(900);
await shoot('09-landing');
await page.waitForFunction(
  () => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'perched',
  undefined,
  { timeout: 420000 },
);
await page.waitForTimeout(1500);
await shoot('10-perched');
const promptState = await page.evaluate(() => {
  const prompt = document.querySelector('#center-prompt');
  return {
    text: prompt?.textContent,
    visible: prompt?.classList.contains('visible'),
    opacity: prompt ? getComputedStyle(prompt).opacity : null,
  };
});
console.log('PROMPT:', JSON.stringify(promptState));

console.log('CONSOLE ISSUES:', consoleIssues.length ? consoleIssues.slice(0, 12) : 'none');
await browser.close();
