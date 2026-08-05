import * as THREE from 'three';

/** Tip-to-tip span the generated garment is scaled to, in metres. */
const TARGET_SPAN = 4.9;
/**
 * The cloak's collar in the source geometry (probed offline): the small neck
 * ring at the top-front of the garment. The mesh is re-origined here so the
 * cape hangs from this point.
 */
const COLLAR_LOCAL = new THREE.Vector3(0.003, 0.314, -0.175);
/** Where the collar pins onto the body: the back of the neck. */
const NECK_ANCHOR = new THREE.Vector3(0, 1.7, -0.12);
/**
 * Drape-depth compression. The garment was authored hanging, and its sag axis
 * becomes world-down in prone flight — at full depth the wings droop ~2 m
 * below the body instead of planing out behind it like the reference.
 */
const DEPTH_SCALE = 0.42;

/**
 * The hero's cape: a Mint-generated bat-wing membrane mesh (swept tips,
 * scalloped cusps, radiating ribs) deformed on the CPU each frame.
 *
 * The authored geometry is the silhouette — it is never rebuilt, only bent.
 * The mesh parents to the body, so unlike a world-space cloth sim it cannot
 * drift or smear when the hero teleports between phases.
 */
export class CapeWing {
  readonly group = new THREE.Group();

  /** 0 furled cloak, 1 full glide spread, >1 flared. */
  spread = 1;
  /** -1..1 steering lean, twists the membrane through a turn. */
  bank = 0;
  /** Extra ripple, 0..2. */
  turbulence = 0.4;
  /** Airspeed in m/s; scales ripple frequency. */
  airspeed = 40;

  private readonly mesh: THREE.Mesh;
  private readonly rest: Float32Array;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly halfSpan: number;
  private readonly topY: number;
  private readonly chord: number;
  private time = 0;

  constructor(model: THREE.Object3D) {
    // Flatten to a single mesh so one geometry can be deformed directly.
    let source: THREE.Mesh | null = null;
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !source) source = mesh;
    });
    if (!source) throw new Error('Cape model contains no mesh.');
    const sourceMesh = source as THREE.Mesh;

    model.updateWorldMatrix(true, true);
    this.geometry = sourceMesh.geometry.clone();
    this.geometry.applyMatrix4(sourceMesh.matrixWorld);

    this.geometry.computeBoundingBox();
    const box = this.geometry.boundingBox as THREE.Box3;
    const size = box.getSize(new THREE.Vector3());
    const scale = size.x > 0.001 ? TARGET_SPAN / size.x : 1;
    // Re-origin on the collar ring so the garment hangs from its neck hole,
    // then scale to span. The source pose already matches flight: leading edge
    // across the top, membrane flowing down-back, hem sagging below.
    this.geometry.translate(-COLLAR_LOCAL.x, -COLLAR_LOCAL.y, -COLLAR_LOCAL.z);
    this.geometry.scale(scale, scale, scale * DEPTH_SCALE);

    this.geometry.computeBoundingBox();
    const scaled = this.geometry.boundingBox as THREE.Box3;
    this.halfSpan = Math.max(scaled.max.x, 0.001);
    this.topY = scaled.max.y;
    this.chord = Math.max(scaled.max.y - scaled.min.y, 0.001);

    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.positions = attribute.array as Float32Array;
    this.rest = new Float32Array(this.positions);

    // The authored colour/normal maps are kept intact; only the shading
    // response is corrected for a night scene:
    //  - the generator returned metalness 1, but leather is a dielectric, and
    //    a metal surface with a charcoal albedo reflects only the dark sky;
    //  - the albedo itself is near-black (~RGB 55), so the tint multiplier is
    //    pushed above 1 to lift it into view without touching the texture,
    //    preserving every rib and grain detail.
    const material = sourceMesh.material as THREE.Material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.side = THREE.DoubleSide;
      // Dark: against the moon the cape must read as a silhouette.
      material.color.setScalar(0.92);
      material.metalness = 0.04;
      // Matte: sharp speculars across the normal-mapped ribs read as crumpled
      // foil once bloom amplifies them.
      material.roughness = 0.9;
      material.envMapIntensity = 0.5;
    }

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    // Collar pinned to the back of the neck: the body sits inside the cape and
    // only the head clears the leading edge.
    this.mesh.position.copy(NECK_ANCHOR);
    this.group.add(this.mesh);
  }

  update(delta: number): void {
    this.time += delta;

    const open = THREE.MathUtils.clamp(this.spread, 0, 1);
    const flare = Math.max(0, this.spread - 1);
    const furl = 1 - open;
    const spanScale = THREE.MathUtils.lerp(0.32, 1, open);
    // Kept subtle: the membrane should read taut and sail-like, not crumpled.
    const rippleAmp = (0.02 + this.turbulence * 0.045) * (1 + this.airspeed * 0.004);
    const wave = this.time * (5 + this.airspeed * 0.06);

    for (let i = 0; i < this.positions.length; i += 3) {
      const rx = this.rest[i];
      const ry = this.rest[i + 1];
      const rz = this.rest[i + 2];

      const u = rx / this.halfSpan;
      const absU = Math.abs(u);
      // 0 at the leading edge, 1 at the scalloped trailing tips.
      const t = THREE.MathUtils.clamp((this.topY - ry) / this.chord, 0, 1);

      const x = rx * spanScale;
      // Tucking sweeps the tips back toward the tail; flaring throws them out.
      const y = ry - furl * absU * 0.55 * this.chord + flare * absU * 0.18 * this.chord;

      // Ripple runs along the span and grows toward the free trailing edge.
      const ripple = Math.sin(u * 4.2 + wave) * rippleAmp * t
        + Math.sin(t * 5.5 + wave * 0.7) * rippleAmp * 0.5 * t;
      // Dihedral: tips lift slightly when spread, fold under when furled.
      const dihedral = absU * absU * (open * 0.07 - furl * 0.5) * this.chord;
      const twist = this.bank * u * 0.3 * this.chord;

      this.positions[i] = x;
      this.positions[i + 1] = y;
      this.positions[i + 2] = rz + ripple + dihedral + twist;
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.mesh.material as THREE.Material;
    material.dispose();
  }
}
