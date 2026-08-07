/**
 * Headless QA driver: loads the game, waits through loading, captures phase
 * screenshots (title, glide, dive, approach, landing, complete), console
 * errors, and renderer diagnostics.
 *
 * Usage: node scripts/qa-run.mjs [url] [outDir] [landing]
 *
 * Software rendering manages ~1 fps and Loop clamps delta to 50 ms, so the
 * scripted beats cost minutes of wall clock. Every phase wait is condition-
 * based with a huge timeout for that reason.
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

// Landing-only mode: skip straight to the pad approach.
const landingOnly = process.argv[4] === 'landing';
if (!landingOnly) {
// The title screen, with the hero hanging behind it.
await page.waitForTimeout(1500);
await shoot('01-title');

// Start the run. Clicking Start would work too, but the hook is deterministic.
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));
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

// Approach the landing pad, with the objective marker and range panel live.
await page.evaluate(() => {
  window.__THREE_GAME_TEST_HOOKS__?.setState('near-pad');
});
await page.waitForTimeout(2000);
await shoot('08-approach');
const hudState = await page.evaluate(() => ({
  distance: document.querySelector('#objective-distance')?.textContent,
  markerOpacity: document.querySelector('#objective-marker')?.style.opacity,
  range: document.querySelector('#surveillance-range')?.textContent,
  rangeActive: document.querySelector('#surveillance-tag')?.classList.contains('active'),
}));
console.log('HUD:', JSON.stringify(hudState));

// The landing beat itself.
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('land'));
await page.waitForFunction(
  () => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'landing',
  undefined,
  { timeout: 420000 },
);
await page.waitForTimeout(2000);
await shoot('09-landing');

await page.waitForFunction(
  () => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'complete',
  undefined,
  { timeout: 420000 },
);
// The card fades in over ~1.1s of real time, not simulated time.
await page.waitForTimeout(2500);
await shoot('10-complete');
const cardState = await page.evaluate(() => {
  const card = document.querySelector('#mission-complete');
  return {
    title: document.querySelector('#mc-title')?.textContent,
    visible: card?.classList.contains('visible'),
    opacity: card ? getComputedStyle(card).opacity : null,
    complete: window.__THREE_GAME_DIAGNOSTICS__?.complete,
  };
});
console.log('CARD:', JSON.stringify(cardState));

console.log('CONSOLE ISSUES:', consoleIssues.length ? consoleIssues.slice(0, 12) : 'none');
await browser.close();
