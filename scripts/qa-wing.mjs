/**
 * Fast wing check: jumps straight to the glide, then captures level flight, a
 * hard bank, a dive and the swoop. Also reports the membrane's world bounds so
 * a stretched or collapsed wing is caught by numbers, not just by eye.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const outDir = process.argv[3] ?? 'qa-wing';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);

const issues = [];
page.on('pageerror', (error) => issues.push(`[pageerror] ${error.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') issues.push(`[console] ${m.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 180000 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));

const measure = () => page.evaluate(() => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  const wingBox = new THREE.Box3().setFromObject(d.batman.wing.group);
  const size = wingBox.getSize(new THREE.Vector3());
  const hero = d.batman.group.position;
  const center = wingBox.getCenter(new THREE.Vector3());
  return {
    phase: window.__THREE_GAME_DIAGNOSTICS__?.phase,
    wingSize: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
    // Distance from hero to wing centre catches a membrane left behind.
    wingOffset: +center.distanceTo(hero).toFixed(2),
    spread: +d.batman.wing.spread.toFixed(2),
    camDist: +d.camera.position.distanceTo(hero).toFixed(2),
  };
});

const shoot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 180000 });
  console.log(name, JSON.stringify(await measure()));
};

await page.waitForTimeout(2500);
await shoot('a-level');

await page.mouse.move(900, 270);
await page.waitForTimeout(2500);
await shoot('b-bank-right');

await page.mouse.move(480, 270);
await page.waitForTimeout(1500);
await page.mouse.down();
await page.waitForTimeout(2500);
await shoot('c-dive');

await page.mouse.up();
await page.waitForTimeout(2000);
await shoot('d-swoop');

await page.keyboard.down('KeyA');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyA');
await shoot('e-wasd-left');

// Escape must pause, and the menu must offer resume/restart.
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await shoot('f-paused');
const pauseState = await page.evaluate(() => {
  const overlay = document.querySelector('#pause-overlay');
  const frame = window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0;
  return {
    overlayVisible: overlay ? !overlay.hasAttribute('hidden') : false,
    frameAtPause: frame,
    hasResume: Boolean(document.querySelector('#resume-button')),
    hasRestart: Boolean(document.querySelector('#restart-button')),
  };
});
await page.waitForTimeout(1200);
const simFrozen = await page.evaluate((y) => {
  const d = window.__KNIGHTFALL_DEBUG__;
  return Math.abs(d.batman.group.position.y - y) < 0.001;
}, await page.evaluate(() => window.__KNIGHTFALL_DEBUG__.batman.group.position.y));
console.log('PAUSE:', JSON.stringify({ ...pauseState, simFrozen }));

await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const resumed = await page.evaluate(() =>
  document.querySelector('#pause-overlay')?.hasAttribute('hidden') ?? false);
console.log('RESUMED:', resumed);

console.log('ISSUES:', issues.length ? issues.slice(0, 6) : 'none');
await browser.close();
