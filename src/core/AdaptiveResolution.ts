/** Never drop below this, however slow the machine — it gets too soft to read. */
const MIN_DPR = 0.75;
/** Ignore the first second: asset decode and shader compile spikes are not signal. */
const SETTLE_SECONDS = 1;
/** How often the resolution may change. Each change reallocates the bloom mips. */
const ADJUST_INTERVAL = 0.6;
/** Slower than ~48fps: give up pixels. */
const DOWN_MS = 21;
/** Faster than ~77fps: there is headroom to spend. */
const UP_MS = 13;
/** Asymmetric on purpose — shed load quickly, reclaim it cautiously, so the
 *  controller settles instead of oscillating around the threshold. */
const STEP_DOWN = 0.15;
const STEP_UP = 0.07;
const EMA_ALPHA = 0.18;
/** Below this the resize is not worth the render-target reallocation. */
const MIN_CHANGE = 0.02;

/**
 * Scales render resolution to hold a frame-rate target.
 *
 * Samples wall-clock frame time itself rather than taking the loop's delta:
 * `Loop` clamps that to 50ms, so it cannot represent a stall and would report a
 * machine running at 5fps as running at 20.
 */
export class AdaptiveResolution {
  private dprValue: number;
  private averageMs = 1000 / 60;
  private sinceAdjust = 0;
  private age = 0;
  private lastTime = 0;

  constructor(private readonly maxDpr: number) {
    this.dprValue = this.ceiling();
  }

  /**
   * The highest ratio worth rendering at right now.
   *
   * Clamped to the display's own ratio, not just maxDpr: on a 1x display,
   * starting at 1.75 means the first five downward steps change the framebuffer
   * by nothing at all, and the controller appears frozen while the frame rate
   * is already bad.
   */
  private ceiling(): number {
    return Math.min(this.maxDpr, window.devicePixelRatio || 1);
  }

  get dpr(): number {
    return this.dprValue;
  }

  /** Smoothed frame time in milliseconds, for diagnostics. */
  get frameMs(): number {
    return this.averageMs;
  }

  /**
   * Call once per frame. Returns true when the resolution changed enough that
   * the caller should resize the renderer and the post chain.
   */
  sample(): boolean {
    const now = performance.now();
    if (this.lastTime === 0) {
      this.lastTime = now;
      return false;
    }
    const elapsedMs = now - this.lastTime;
    this.lastTime = now;
    this.age += elapsedMs / 1000;
    if (this.age < SETTLE_SECONDS) return false;

    // One huge stall — a GC pause, a shader compile, the tab being restored —
    // must not cost a resolution step by itself.
    if (elapsedMs < 500) {
      this.averageMs += (elapsedMs - this.averageMs) * EMA_ALPHA;
    }

    this.sinceAdjust += elapsedMs / 1000;
    if (this.sinceAdjust < ADJUST_INTERVAL) return false;
    this.sinceAdjust = 0;

    const ceiling = this.ceiling();
    const previous = Math.min(this.dprValue, ceiling);
    this.dprValue = previous;
    if (this.averageMs > DOWN_MS) {
      // Step proportionally to how far over budget we are. A machine sitting at
      // 50ms/frame should not spend ten seconds walking down in 0.15s.
      const severity = Math.min(3, this.averageMs / DOWN_MS);
      this.dprValue = Math.max(MIN_DPR, this.dprValue - STEP_DOWN * severity);
    } else if (this.averageMs < UP_MS) {
      this.dprValue = Math.min(ceiling, this.dprValue + STEP_UP);
    }
    return Math.abs(this.dprValue - previous) > MIN_CHANGE;
  }

  /**
   * Forget the last timestamp, so a gap the renderer was not responsible for
   * (a pause, a resize, a tab switch) is not measured as a slow frame.
   */
  resume(): void {
    this.lastTime = 0;
  }
}
