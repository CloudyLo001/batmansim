/**
 * Scene-graph inspector: jumps to a phase and reports real world-space
 * measurements (hero bounds, tower bounds, cape bounds, building footprints)
 * so QA decisions come from numbers, not dark screenshots.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const state = process.argv[3] ?? 'near-tower';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(150000);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => Boolean(window.__KNIGHTFALL_DEBUG__),
  undefined,
  { timeout: 120000 },
);
await page.evaluate((name) => window.__THREE_GAME_TEST_HOOKS__?.setState(name), state);
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;
  const box = (obj) => {
    const b = new THREE.Box3().setFromObject(obj);
    if (!Number.isFinite(b.min.x)) return null;
    const size = b.getSize(new THREE.Vector3());
    const center = b.getCenter(new THREE.Vector3());
    return {
      min: [+b.min.x.toFixed(1), +b.min.y.toFixed(1), +b.min.z.toFixed(1)],
      max: [+b.max.x.toFixed(1), +b.max.y.toFixed(1), +b.max.z.toFixed(1)],
      size: [+size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1)],
      center: [+center.x.toFixed(1), +center.y.toFixed(1), +center.z.toFixed(1)],
    };
  };

  // The signal tower is the only non-instanced child of the city group.
  let tower = null;
  const instancedFootprints = [];
  d.city.group.children.forEach((child) => {
    if (child.isInstancedMesh) {
      const geometryBox = child.geometry.boundingBox
        ?? (child.geometry.computeBoundingBox(), child.geometry.boundingBox);
      const size = geometryBox.getSize(new THREE.Vector3());
      instancedFootprints.push({
        count: child.count,
        geomSize: [+size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1)],
      });
    } else if (child.type === 'Group' || child.isObject3D) {
      const b = box(child);
      if (b && b.size[1] > 200 && b.size[1] < 500) tower = b;
    }
  });

  return {
    phase: window.__THREE_GAME_DIAGNOSTICS__?.phase,
    heroPos: d.batman.group.position.toArray().map((v) => +v.toFixed(1)),
    heroRot: [d.batman.group.rotation.x, d.batman.group.rotation.y, d.batman.group.rotation.z]
      .map((v) => +v.toFixed(2)),
    heroBox: box(d.batman.group),
    capeBox: box(d.batman.cape.mesh),
    towerBox: tower,
    towerTopY: +d.city.towerTopY.toFixed(1),
    spireTopY: +d.city.spireTopY.toFixed(1),
    cameraPos: d.camera.position.toArray().map((v) => +v.toFixed(1)),
    instancedFootprints: instancedFootprints.slice(0, 8),
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
