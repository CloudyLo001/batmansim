/** Drives the tower approach and reports any runtime error that kills the loop. */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(120000);

const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}\n${error.stack ?? ''}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 120000 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('near-tower'));

for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(1000);
  const snapshot = await page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    const dbg = window.__KNIGHTFALL_DEBUG__;
    return {
      phase: d?.phase,
      frame: d?.frame,
      perch: dbg?.perchPoint?.toArray().map((v) => +v.toFixed(1)),
      heroY: +(dbg?.batman?.group.position.y ?? 0).toFixed(1),
    };
  });
  console.log(i, JSON.stringify(snapshot));
  if (errors.length) break;
}

console.log('ERRORS:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
