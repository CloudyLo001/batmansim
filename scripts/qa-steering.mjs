/**
 * Verifies steering direction against the pilot's own frame.
 *
 * Forward is (sin h, 0, cos h), so the pilot's right is (-cos h, 0, sin h).
 * Steering right must move the hero along that vector.
 *
 * The flight model is stepped directly at a fixed timestep rather than in real
 * time: under software rendering the page runs at ~3 fps, which advances far
 * too little simulation for a turn to develop.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(180000);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 180000 });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));
await page.waitForTimeout(1200);

// --- 1. Real input path: does the key reach steerX with the right sign? ---
/** The steering axis eases, so it must settle to neutral between trials. */
const settle = async () => {
  await page.waitForFunction(
    () => Math.abs(window.__KNIGHTFALL_DEBUG__.input.keyX) < 0.1,
    undefined,
    { timeout: 60000 },
  );
};

const readSteer = async (label, press, release) => {
  await settle();
  await press();
  // Hold until the eased axis has actually reached full deflection.
  await page.waitForFunction(
    () => Math.abs(window.__KNIGHTFALL_DEBUG__.input.steerX) > 0.8,
    undefined,
    { timeout: 60000 },
  );
  const steerX = await page.evaluate(() => window.__KNIGHTFALL_DEBUG__.input.steerX);
  await release();
  console.log(`${label} -> steerX=${steerX.toFixed(2)}`);
  return steerX;
};

await page.mouse.move(320, 180);
const steerD = await readSteer(
  'D key      ',
  () => page.keyboard.down('KeyD'),
  () => page.keyboard.up('KeyD'),
);
const steerA = await readSteer(
  'A key      ',
  () => page.keyboard.down('KeyA'),
  () => page.keyboard.up('KeyA'),
);
await settle();
await page.mouse.move(620, 180);
await page.waitForTimeout(600);
const steerMouse = await page.evaluate(() => window.__KNIGHTFALL_DEBUG__.input.steerX);
await page.mouse.move(320, 180);
console.log(`Mouse right -> steerX=${steerMouse.toFixed(2)}`);

// --- 2. Turn direction: step the model at a fixed timestep. ---
const simulate = (steerX) => page.evaluate((sx) => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  const flight = d.flight;
  const start = new THREE.Vector3(0, 1000, 0);
  flight.reset(start, Math.PI, 50);
  const startHeading = flight.heading;
  const fakeInput = { steerX: sx, steerY: 0, diveHeld: false };
  const sampler = { groundHeightAt: () => 0 };
  for (let i = 0; i < 120; i += 1) flight.update(1 / 60, fakeInput, sampler);
  const rightX = -Math.cos(startHeading);
  const rightZ = Math.sin(startHeading);
  return {
    drift: (flight.position.x - start.x) * rightX + (flight.position.z - start.z) * rightZ,
    roll: flight.roll,
  };
}, steerX);

const report = async (label, steerX) => {
  const { drift, roll } = await simulate(steerX);
  const dir = drift > 2 ? 'RIGHT' : drift < -2 ? 'LEFT' : 'straight';
  // Negative roll = right wing down = banking right.
  const bank = roll < -0.05 ? 'banks right' : roll > 0.05 ? 'banks left' : 'level';
  console.log(`${label} steer=${steerX.toFixed(2)} -> travels ${dir} (${drift.toFixed(1)}m), ${bank}`);
  return { drift, roll };
};

console.log('--- simulated turn ---');
const right = await report('steer right', 1);
const left = await report('steer left ', -1);

const inputOk = steerD > 0.5 && steerA < -0.5 && steerMouse > 0.5;
const turnOk = right.drift > 2 && left.drift < -2;
// The visible lean must agree with the direction of travel.
const bankOk = right.roll < 0 && left.roll > 0;
console.log(`input ${inputOk ? 'OK' : 'BAD'} | turn ${turnOk ? 'OK' : 'INVERTED'} | bank ${bankOk ? 'OK' : 'MISMATCHED'}`);
await browser.close();
process.exit(inputOk && turnOk && bankOk ? 0 : 1);
