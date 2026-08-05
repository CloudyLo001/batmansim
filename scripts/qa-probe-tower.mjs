/**
 * Raycasts down onto the signal tower across a grid to map its upper surface,
 * so the gargoyle perch can be placed on real geometry instead of guessed at.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(150000);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 120000 });

const report = await page.evaluate(() => {
  const d = window.__KNIGHTFALL_DEBUG__;
  const THREE = d.THREE;

  // Isolate the tower: the city child whose bounds match the landmark.
  let tower = null;
  d.city.group.children.forEach((child) => {
    if (child.isInstancedMesh || child.isMesh) return;
    const b = new THREE.Box3().setFromObject(child);
    const size = b.getSize(new THREE.Vector3());
    if (size.y > 300 && size.y < 400) tower = child;
  });
  if (!tower) return { error: 'tower not found' };

  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const rows = [];
  const cx = -140;
  const cz = -1280;
  for (let dz = -90; dz <= 90; dz += 15) {
    const row = [];
    for (let dx = -90; dx <= 90; dx += 15) {
      raycaster.set(new THREE.Vector3(cx + dx, 520, cz + dz), down);
      const hits = raycaster.intersectObject(tower, true);
      row.push(hits.length ? +hits[0].point.y.toFixed(0) : 0);
    }
    rows.push({ dz, heights: row });
  }

  // Best "ledge": highest surface that is NOT the central spire, preferring
  // points offset from the tower axis so the camera can orbit outside.
  let best = null;
  for (let dz = -90; dz <= 90; dz += 5) {
    for (let dx = -90; dx <= 90; dx += 5) {
      const radial = Math.hypot(dx, dz);
      if (radial < 25 || radial > 95) continue;
      raycaster.set(new THREE.Vector3(cx + dx, 520, cz + dz), down);
      const hits = raycaster.intersectObject(tower, true);
      if (!hits.length) continue;
      const y = hits[0].point.y;
      const score = y + radial * 0.35; // favor high AND outboard
      if (!best || score > best.score) best = { dx, dz, y: +y.toFixed(1), radial: +radial.toFixed(0), score };
    }
  }

  return { grid: rows, best, xLabels: '-90..90 step 15' };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
