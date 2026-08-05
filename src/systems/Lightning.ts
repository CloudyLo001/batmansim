import * as THREE from 'three';

/**
 * Periodic storm flashes: spikes a rim light behind the hero and reports a
 * 0..1 flash amount that the post pass adds to the frame.
 */
export class Lightning {
  /** Current flash brightness, consumed by PostFX each frame. */
  flashAmount = 0;

  private nextStrike: number;
  private strikePattern: number[] = [];
  private patternIndex = 0;
  private patternTimer = 0;

  constructor(
    private readonly flashLight: THREE.DirectionalLight,
    private readonly rng: () => number,
  ) {
    this.nextStrike = 4 + rng() * 6;
  }

  /** Cue an immediate strike (used by the landing cinematic hero shot). */
  forceStrike(): void {
    this.nextStrike = 0;
  }

  update(delta: number, elapsed: number, heroPosition: THREE.Vector3): void {
    void elapsed;
    this.nextStrike -= delta;
    if (this.nextStrike <= 0 && this.strikePattern.length === 0) {
      // Double or triple flicker like real strikes.
      const flickers = 2 + Math.floor(this.rng() * 2);
      this.strikePattern = [];
      for (let i = 0; i < flickers; i += 1) {
        this.strikePattern.push(0.5 + this.rng() * 0.5, -(0.05 + this.rng() * 0.1));
      }
      this.patternIndex = 0;
      this.patternTimer = 0;
      this.nextStrike = 7 + this.rng() * 9;
      // Strike direction roughly behind/beside the hero for rim silhouettes.
      const angle = this.rng() * Math.PI * 2;
      this.flashLight.position.set(
        heroPosition.x + Math.cos(angle) * 1200,
        heroPosition.y + 500,
        heroPosition.z + Math.sin(angle) * 1200,
      );
    }

    if (this.strikePattern.length > 0) {
      this.patternTimer -= delta;
      if (this.patternTimer <= 0) {
        const value = this.strikePattern[this.patternIndex];
        if (value >= 0) {
          this.flashAmount = value;
          this.patternTimer = 0.045 + this.rng() * 0.05;
        } else {
          this.flashAmount = 0;
          this.patternTimer = -value;
        }
        this.patternIndex += 1;
        if (this.patternIndex >= this.strikePattern.length) {
          this.strikePattern = [];
          this.flashAmount = 0;
        }
      }
    } else {
      this.flashAmount = Math.max(0, this.flashAmount - delta * 6);
    }

    this.flashLight.intensity = this.flashAmount * 4.5;
  }
}
