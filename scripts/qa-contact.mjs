/**
 * Verifies the contact-restart rule and the absence of the climbing ending.
 *
 * Each case places the hero just above a surface and lets the real game loop
 * run. A pass means the screen fade engaged and the title screen came back —
 * i.e. the run actually reset — rather than the hero being quietly pushed clear
 * by an altitude floor, which is what used to happen.
 *
 * Software rendering runs at ~3 fps and Loop clamps delta to 50 ms, so a real
 * second buys only ~0.15 s of simulation. The waits below are generous.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180000);

const warnings = [];
page.on('console', (message) => {
  if (message.type() === 'warning') warnings.push(message.text());
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 180000 });

const titleVisible = () => page.evaluate(() => {
  const el = document.querySelector('#title-screen');
  return Boolean(el) && !el.hidden;
});

/** Drops the hero at `place()` and reports whether the run reset. */
const crashCase = async (label, place) => {
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'));
  // The overlay hides on a timer, so wait for the condition, not a guessed delay.
  await page.waitForFunction(
    () => document.querySelector('#title-screen')?.hidden === true,
    undefined,
    { timeout: 30000 },
  );

  const spot = await page.evaluate(place);
  // Watch for the blackout, then for the title coming back.
  let faded = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!faded) {
      faded = await page.evaluate(() => document.querySelector('#screen-fade')?.classList.contains('opaque') ?? false);
    }
    if (await titleVisible()) break;
    await page.waitForTimeout(250);
  }
  const reset = await titleVisible();
  console.log(
    `${label.padEnd(22)} ${reset ? 'RESTARTED' : 'NO RESTART'} `
    + `(fade ${faded ? 'seen' : 'MISSING'}) ${spot}`,
  );
  return reset && faded;
};

/**
 * A BROAD tall roof, scored by the lowest point within 30 m rather than by peak
 * height. The tallest single cell in the city is a 378 m spire barely wider
 * than the hero's step: he clears it in one frame and the surface under him
 * drops to 111 m, which tests nothing.
 */
const TALLEST = `
  const d = window.__KNIGHTFALL_DEBUG__;
  let best = { h: 0, x: 0, z: 0 };
  for (let x = -1400; x <= 1400; x += 40) {
    for (let z = -1400; z <= 1400; z += 40) {
      let low = Infinity;
      for (const dx of [-30, 0, 30]) {
        for (const dz of [-30, 0, 30]) {
          low = Math.min(low, d.city.groundHeightAt(x + dx, z + dz));
        }
      }
      if (low > best.h) best = { h: low, x, z };
    }
  }
`;

// --- Rooftop: touching a roof hundreds of metres up, where the ocean rule
// cannot be what fires. ---
const building = await crashCase('building rooftop', new Function(`
  ${TALLEST}
  d.flight.reset(new d.THREE.Vector3(best.x, best.h + 1, best.z), Math.PI, 46);
  return 'roof ' + best.h.toFixed(0) + 'm';
`));

// --- Facade: flown horizontally into the side of that same tower, which is the
// case a player actually hits. Entry speed is high so the approach resolves in
// a few simulated seconds under software rendering. ---
const facade = await crashCase('building facade', new Function(`
  ${TALLEST}
  const flyY = best.h * 0.6;
  // Back off along +Z (heading PI travels -Z) to the first cell that is clear
  // at that altitude, so he starts in open air and flies into the wall.
  let startZ = best.z + 60;
  for (let dz = 60; dz <= 200; dz += 20) {
    if (d.city.groundHeightAt(best.x, best.z + dz) + 6 < flyY) { startZ = best.z + dz; break; }
  }
  d.flight.reset(new d.THREE.Vector3(best.x, flyY, startZ), Math.PI, 110);
  return 'entering at y=' + flyY.toFixed(0) + ' from ' + (startZ - best.z).toFixed(0) + 'm out';
`));

// --- Ocean: well outside the island, just above the waterline. ---
const ocean = await crashCase('ocean', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  d.flight.reset(new d.THREE.Vector3(0, 4, 2200), Math.PI, 46);
  return 'sea level';
});

// --- Streets: over the island but between the towers. ---
const streets = await crashCase('island / streets', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  let found = { x: 0, z: 0 };
  for (let x = -900; x <= 900; x += 20) {
    for (let z = -900; z <= 900; z += 20) {
      if (d.city.groundHeightAt(x, z) === 0) { found = { x, z }; break; }
    }
  }
  d.flight.reset(new THREE.Vector3(found.x, 4, found.z), Math.PI, 46);
  return `street ${found.x},${found.z}`;
});

// --- Blimps: dropped straight onto one. ---
const blimp = await crashCase('blimp', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const unit = d.blimps.units?.[0]?.root ?? null;
  if (!unit) return 'no blimp handle';
  // Sit well above any rooftop so only the blimp can be what he touches.
  d.flight.reset(unit.position.clone(), Math.PI, 46);
  return `blimp at y=${unit.position.y.toFixed(0)}`;
});

// --- The climbing ending must be gone entirely. ---
const endCardGone = await page.evaluate(() => !document.querySelector('#end-card'));
await page.evaluate(() => {
  for (const name of ['catch', 'climb', 'outro', 'complete']) {
    window.__THREE_GAME_TEST_HOOKS__.setState(name);
  }
});
await page.waitForTimeout(400);
const climbStatesGone = ['catch', 'climb', 'outro', 'complete']
  .every((name) => warnings.some((w) => w.includes(`Unknown test state: ${name}`)));

console.log(`end card removed  ${endCardGone ? 'OK' : 'STILL PRESENT'}`);
console.log(`climb phases gone ${climbStatesGone ? 'OK' : 'STILL REACHABLE'}`);

const ok = building && facade && ocean && streets && blimp && endCardGone && climbStatesGone;
console.log(ok ? 'ALL OK' : 'FAILURES ABOVE');
await browser.close();
process.exit(ok ? 0 : 1);
