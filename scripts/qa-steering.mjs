/**
 * Verifies steering direction IN SCREEN SPACE.
 *
 * Every previous version of this check reasoned about world axes ("forward is
 * (sin h, 0, cos h), so the pilot's right is...") and every one of them got the
 * sign wrong, because `roll` turns about the model's forward axis while
 * `heading` turns about world Y and the two conventions run opposite here.
 *
 * So this script derives nothing. It frames the hero with the real chase camera
 * and projects world points through THREE's own projection matrix, then asserts
 * on the resulting normalised device coordinates:
 *
 *   NDC x > 0  =  right half of the screen
 *   NDC y > 0  =  upper half of the screen
 *
 * "D turns right" means the hero ends up on the right of the frame he started
 * in. "D leans right" means his right wingtip renders below his left one. Both
 * are exactly what a player sees, and neither can be re-derived incorrectly.
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
/**
 * Puts the run back into the glide. The world is solid now and this script
 * takes tens of real seconds per trial, so the hero reaches the city and
 * crashes mid-measurement; once the run resets to the title, `input.update` no
 * longer runs and steerX would sit at 0 forever. beginGlide is idempotent, so
 * calling it before each trial just re-launches him from the start point.
 */
const ensureGliding = () => page.evaluate(
  () => window.__THREE_GAME_TEST_HOOKS__.setState('active-play'),
);

/** The steering axis eases, so it must settle to neutral between trials. */
const settle = async () => {
  await page.waitForFunction(
    () => Math.abs(window.__KNIGHTFALL_DEBUG__.input.keyX) < 0.1,
    undefined,
    { timeout: 60000 },
  );
};

const readSteer = async (label, press, release) => {
  await ensureGliding();
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

// --- 2. The mouse must not steer and must not dive. ---
await ensureGliding();
// Wait out the easing completely, or the tail of the A-key release reads as
// residual mouse steer.
await page.waitForFunction(
  () => Math.abs(window.__KNIGHTFALL_DEBUG__.input.steerX) < 0.005,
  undefined,
  { timeout: 60000 },
);
await page.mouse.move(620, 40);
await page.mouse.down();
await page.waitForTimeout(500);
const mouse = await page.evaluate(() => ({
  steerX: window.__KNIGHTFALL_DEBUG__.input.steerX,
  steerY: window.__KNIGHTFALL_DEBUG__.input.steerY,
  dive: window.__KNIGHTFALL_DEBUG__.input.diveHeld,
}));
await page.mouse.up();
console.log(
  `Mouse held far top-right -> steerX=${mouse.steerX.toFixed(2)} `
  + `steerY=${mouse.steerY.toFixed(2)} dive=${mouse.dive}`,
);

// --- 3. Turn + bank direction, measured in screen space. ---
const simulate = (steerX) => page.evaluate((sx) => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  const { flight, rig, camera, batman } = d;

  const start = new THREE.Vector3(0, 1000, 0);
  const startHeading = Math.PI;
  flight.reset(start, startHeading, 50);

  const fakeInput = { steerX: sx, steerY: 0, diveHeld: false };
  const step = (frames) => {
    for (let i = 0; i < frames; i += 1) flight.update(1 / 60, fakeInput);
  };

  // --- Turn direction, against the frame he started in. ---
  // Frame the hero as the game would at the instant the turn begins, then
  // FREEZE that camera and see which side of it he slides toward. Keep the run
  // short: once he leaves the frustum, edge perspective makes NDC unreliable.
  rig.snapBehind(start, startHeading, flight.pitch);
  camera.updateMatrixWorld(true);
  const frozen = camera.clone();
  step(40);
  const turnNdcX = flight.position.clone().project(frozen).x;

  // --- Bank direction, against the frame he is actually in. ---
  // Measured with a camera snapped behind his CURRENT attitude, because the
  // chase camera keeps him centred — a player never sees him lean from 70 m
  // off to the side of a stale viewpoint.
  step(20);
  rig.snapBehind(flight.position, flight.heading, flight.pitch);
  camera.updateMatrixWorld(true);

  batman.group.position.copy(flight.position);
  batman.group.rotation.set(-flight.pitch, flight.heading, flight.roll, 'YXZ');
  batman.group.updateMatrixWorld(true);
  // Local +/-X are the two wing directions; which of them is the right wing is
  // exactly what must not be assumed, so they are labelled by where they land
  // on screen, not by their axis.
  const tipA = batman.group.localToWorld(new THREE.Vector3(3, 0, 0)).project(camera);
  const tipB = batman.group.localToWorld(new THREE.Vector3(-3, 0, 0)).project(camera);
  const screenRightTip = tipA.x > tipB.x ? tipA : tipB;
  const screenLeftTip = tipA.x > tipB.x ? tipB : tipA;

  return {
    turnNdcX,
    // > 0 means the wing on the right of the screen is the LOW one = leaning right.
    leanRight: screenLeftTip.y - screenRightTip.y,
    roll: flight.roll,
  };
}, steerX);

const report = async (label, steerX) => {
  const r = await simulate(steerX);
  const dir = r.turnNdcX > 0.02 ? 'RIGHT' : r.turnNdcX < -0.02 ? 'LEFT' : 'straight';
  const bank = r.leanRight > 0.01 ? 'leans RIGHT' : r.leanRight < -0.01 ? 'leans LEFT' : 'level';
  console.log(
    `${label} steer=${steerX.toFixed(2)} -> travels ${dir} (ndcX ${r.turnNdcX.toFixed(2)}), `
    + `${bank} (roll ${(r.roll * 57.3).toFixed(0)}deg)`,
  );
  return r;
};

console.log('--- simulated turn (screen space) ---');
const right = await report('D / steer right', 1);
const left = await report('A / steer left ', -1);

const inputOk = steerD > 0.5 && steerA < -0.5;
const mouseOk = Math.abs(mouse.steerX) < 0.01 && Math.abs(mouse.steerY) < 0.01 && !mouse.dive;
// D goes to the right of the screen, A to the left. Nothing derived.
const turnOk = right.turnNdcX > 0.02 && left.turnNdcX < -0.02;
// ...and he leans INTO whichever way he is going.
const bankOk = right.leanRight > 0.01 && left.leanRight < -0.01;

console.log(
  `input ${inputOk ? 'OK' : 'BAD'} | mouse-inert ${mouseOk ? 'OK' : 'STILL ACTIVE'} `
  + `| turn ${turnOk ? 'OK' : 'INVERTED'} | bank ${bankOk ? 'OK' : 'LEANING OUT OF TURN'}`,
);
await browser.close();
process.exit(inputOk && mouseOk && turnOk && bankOk ? 0 : 1);
