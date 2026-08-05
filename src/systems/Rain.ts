import * as THREE from 'three';

const COUNT = 900;
const BOX = 90; // rain volume half-extent around the camera

/**
 * Camera-space rain streaks. Line segments stretch along fall velocity plus
 * the camera's motion so speed reads as elongated streaks past the lens.
 */
export class Rain {
  readonly lines: THREE.LineSegments;

  private readonly seeds: Float32Array;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly anchor = new THREE.Vector3();

  constructor(rng: () => number) {
    this.seeds = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i += 1) {
      this.seeds[i] = rng() * BOX * 2 - BOX;
    }
    this.positions = new Float32Array(COUNT * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x93aec4,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geometry, material);
    this.lines.frustumCulled = false;
  }

  update(elapsed: number, cameraPosition: THREE.Vector3, cameraVelocity: THREE.Vector3): void {
    this.anchor.copy(cameraPosition);
    const fallSpeed = 62;
    // Streak = fall + apparent backward motion from the camera's own velocity,
    // clamped so cinematic camera whips don't smear streaks across the sky.
    let streakX = -cameraVelocity.x * 0.02;
    let streakY = -1.6 - fallSpeed * 0.02 - Math.abs(cameraVelocity.y) * 0.012;
    let streakZ = -cameraVelocity.z * 0.02;
    const streakLength = Math.hypot(streakX, streakY, streakZ);
    const maxStreak = 4.2;
    if (streakLength > maxStreak) {
      const scale = maxStreak / streakLength;
      streakX *= scale;
      streakY *= scale;
      streakZ *= scale;
    }

    for (let i = 0; i < COUNT; i += 1) {
      const sx = this.seeds[i * 3];
      const sy = this.seeds[i * 3 + 1];
      const sz = this.seeds[i * 3 + 2];
      const x = this.anchor.x + wrap(sx + elapsed * 3.5, BOX);
      const y = this.anchor.y + wrap(sy - elapsed * fallSpeed, BOX);
      const z = this.anchor.z + wrap(sz, BOX);
      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x + streakX;
      this.positions[o + 4] = y + streakY;
      this.positions[o + 5] = z + streakZ;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

function wrap(value: number, half: number): number {
  const range = half * 2;
  return ((((value + half) % range) + range) % range) - half;
}
