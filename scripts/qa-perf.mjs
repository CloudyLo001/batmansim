/**
 * Frame-cost harness: measures render time with the camera parked in fixed
 * city-facing and ocean-facing views, plus real draw-call / triangle counts.
 *
 * The simulation is frozen (setPausedForScreenshot) so the only variable is
 * what is on screen. Run it before and after a rendering change and diff.
 *
 * Usage: node scripts/qa-perf.mjs [url] [label]
 *
 * CAVEAT: headless Chromium here runs SwiftShader, a software rasterizer.
 * Fragment-ALU savings (light count, back-face culling) show up faithfully.
 * Early-Z / hierarchical-Z savings do NOT — a real GPU gains far more from
 * those than SwiftShader does. Treat the city/ocean RATIO as the signal.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const label = process.argv[3] ?? 'run';

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__KNIGHTFALL_DEBUG__), undefined, { timeout: 240000 });
await page.waitForFunction(
  () => document.querySelector('#loading')?.classList.contains('done'),
  undefined,
  { timeout: 240000 },
);

// Freeze the sim: update() early-returns but render() still runs every frame,
// so the camera stays put and frame time reflects pure render cost.
await page.evaluate(() => {
  window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);
  document.querySelector('#title-screen')?.setAttribute('hidden', '');
  document.querySelector('#hud')?.classList.add('hud-hidden');
});

/**
 * Times `frames` frames with the camera parked.
 *
 * Each sample ends with gl.finish(). Without it this measures rAF callback
 * intervals, not rendering: WebGL calls return before the GPU has done the
 * work, so an expensive frame and a cheap one look identical until something
 * forces a sync.
 */
const measure = async (name, place, frames = 25) => {
  await page.evaluate(place);
  await page.waitForTimeout(1500); // let shader compiles and the first draw settle

  const result = await page.evaluate(async (count) => {
    const canvas = document.querySelector('#game-canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

    // Drain anything already queued so the first sample is not inflated.
    await nextFrame();
    gl.finish();

    const samples = [];
    let last = performance.now();
    for (let n = 0; n < count; n += 1) {
      await nextFrame();
      gl.finish();
      const now = performance.now();
      samples.push(now - last);
      last = now;
    }
    samples.sort((a, b) => a - b);
    const info = window.__THREE_GAME_DIAGNOSTICS__?.renderer;
    return {
      median: samples[Math.floor(samples.length / 2)],
      p90: samples[Math.floor(samples.length * 0.9)],
      calls: info?.calls,
      triangles: info?.triangles,
    };
  }, frames);

  console.log(
    `${name.padEnd(18)} median ${result.median.toFixed(1).padStart(7)} ms`
    + `   p90 ${result.p90.toFixed(1).padStart(7)} ms`
    + `   calls ${String(result.calls).padStart(4)}`
    + `   tris ${String(result.triangles).padStart(9)}`,
  );
  return result;
};

console.log(`--- ${label} ---`);

/**
 * Both views use the SAME camera and differ only in whether the city group is
 * rendered. Pointing the camera somewhere else instead would change the sky,
 * the moon's huge additive halo sprites and the rain in frame too, and the
 * comparison would measure framing rather than the city.
 */
const withCity = await measure('city visible', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  d.city.group.visible = true;
  d.camera.position.set(0, 210, 900);
  d.camera.lookAt(0, 160, -600);
  d.camera.updateMatrixWorld(true);
});

const withoutCity = await measure('city hidden', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  d.city.group.visible = false;
  d.camera.position.set(0, 210, 900);
  d.camera.lookAt(0, 160, -600);
  d.camera.updateMatrixWorld(true);
});

// The gameplay case: mid-glide altitude, city filling the frame.
await measure('city (glide alt)', () => {
  const d = window.__KNIGHTFALL_DEBUG__;
  d.city.group.visible = true;
  d.camera.position.set(260, 640, 1400);
  d.camera.lookAt(0, 200, -900);
  d.camera.updateMatrixWorld(true);
});

const cost = withCity.median - withoutCity.median;
console.log(
  `\ncity costs ${cost.toFixed(1)} ms/frame on top of everything else`
  + `  (${(withCity.median / withoutCity.median).toFixed(2)}x)`,
);

await browser.close();
