/**
 * Reports where the wing membrane sits relative to the hero's body in world
 * space: body bounds, leading-edge row position, and the vertical gap between
 * them. A membrane that reads as "sitting below Batman" shows up here as a
 * leading edge below the shoulder line.
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
await page.waitForTimeout(3000);

const report = await page.evaluate(() => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  const batman = d.batman;
  const hero = batman.group.position;

  const round = (v) => +v.toFixed(2);
  const rel = (p) => [round(p.x - hero.x), round(p.y - hero.y), round(p.z - hero.z)];

  // Body: the loaded model mesh, excluding lights.
  const bodyBox = new THREE.Box3();
  batman.group.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) bodyBox.expandByObject(o);
  });

  const wingGeom = batman.wing.mesh.geometry;
  const pos = wingGeom.getAttribute('position');
  const COLS = 27;
  const ROWS = 13;

  const rowCentre = (row) => {
    const c = new THREE.Vector3();
    for (let col = 0; col < COLS; col += 1) {
      const i = row * COLS + col;
      c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    return c.divideScalar(COLS);
  };

  const tipL = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
  const tipR = new THREE.Vector3(pos.getX(COLS - 1), pos.getY(COLS - 1), pos.getZ(COLS - 1));

  return {
    heroWorld: [round(hero.x), round(hero.y), round(hero.z)],
    bodyMinRel: rel(bodyBox.min),
    bodyMaxRel: rel(bodyBox.max),
    leadingEdgeRel: rel(rowCentre(0)),
    midRowRel: rel(rowCentre(Math.floor(ROWS / 2))),
    trailingEdgeRel: rel(rowCentre(ROWS - 1)),
    leftTipRel: rel(tipL),
    rightTipRel: rel(tipR),
    // Positive means the leading edge is below the body's vertical centre.
    leadingBelowBodyCentre: round(
      (bodyBox.min.y + bodyBox.max.y) / 2 - rowCentre(0).y,
    ),
  };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
