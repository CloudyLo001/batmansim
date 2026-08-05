import * as THREE from 'three';
import { WORLD } from '../game/World';
import type { FlightSample } from './FlightModel';

export interface CityModels {
  spire: THREE.Object3D;
  slab: THREE.Object3D;
  twin: THREE.Object3D;
  neonBlock: THREE.Object3D;
  industrial: THREE.Object3D;
  bridge: THREE.Object3D;
  ferrisWheel: THREE.Object3D;
  signalTower: THREE.Object3D;
}

interface MeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
}

interface NormalizedModel {
  parts: MeshPart[];
  height: number;
  radius: number;
}

interface Placement {
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

const GRID_CELL = 100;
const GRID_HALF = 2400;

/** Ocean disc radius; must stay inside the camera far plane. */
const OCEAN_RADIUS = 7200;
/** Mean colour of the skybox horizon band, sampled from the panorama. */
export const HORIZON_COLOR = 0x394a5a;

/**
 * Composes the island metropolis from the generated building set using
 * InstancedMesh per mesh part, and exposes a max-height field that the
 * flight model uses as its soft floor.
 */
export class City implements FlightSample {
  readonly group = new THREE.Group();
  /**
   * Landing spot on the signal tower, raycast from the real crown geometry so
   * it survives the asset changing. Set during construction.
   */
  readonly perchPoint = new THREE.Vector3();
  /** World Y of the spire tip where the bat-signal projector sits. */
  spireTopY = WORLD.towerPerchHeight;

  private readonly heightGrid: Float32Array;
  private readonly gridSize: number;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private beaconMaterial: THREE.PointsMaterial | null = null;

  constructor(models: CityModels, rng: () => number) {
    this.gridSize = Math.ceil((GRID_HALF * 2) / GRID_CELL);
    this.heightGrid = new Float32Array(this.gridSize * this.gridSize);

    const spire = normalizeModel(models.spire, 305);
    const slab = normalizeModel(models.slab, 185);
    const twin = normalizeModel(models.twin, 255);
    const neon = normalizeModel(models.neonBlock, 95);
    const industrial = normalizeModel(models.industrial, 150);
    const bridge = normalizeModel(models.bridge, 130);
    const ferris = normalizeModel(models.ferrisWheel, 160);

    const kinds: Array<{ model: NormalizedModel; placements: Placement[] }> = [
      { model: spire, placements: [] },
      { model: slab, placements: [] },
      { model: twin, placements: [] },
      { model: neon, placements: [] },
      { model: industrial, placements: [] },
      { model: bridge, placements: [] },
      { model: ferris, placements: [] },
    ];

    // --- Building lots on a jittered grid across the island.
    const spacing = 132;
    for (let x = -WORLD.cityRadius; x <= WORLD.cityRadius; x += spacing) {
      for (let z = -WORLD.cityRadius; z <= WORLD.cityRadius; z += spacing) {
        const radial = Math.hypot(x, z);
        if (radial > WORLD.cityRadius) continue;
        // Clear space around the signal tower so it reads as the landmark.
        const toTower = Math.hypot(x - WORLD.towerPosition.x, z - WORLD.towerPosition.z);
        if (toTower < 300) continue;
        if (rng() < 0.34) continue;

        const jitterX = x + (rng() - 0.5) * spacing * 0.55;
        const jitterZ = z + (rng() - 0.5) * spacing * 0.55;
        const inner = 1 - radial / WORLD.cityRadius; // 1 at center, 0 at coast
        const roll = rng();
        let kind: number;
        if (inner > 0.62) kind = roll < 0.42 ? 0 : roll < 0.72 ? 2 : 1;
        else if (inner > 0.3) kind = roll < 0.3 ? 1 : roll < 0.5 ? 0 : roll < 0.75 ? 4 : 3;
        else kind = roll < 0.52 ? 3 : roll < 0.78 ? 4 : 1;

        kinds[kind].placements.push({
          x: jitterX,
          z: jitterZ,
          rotation: Math.floor(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.2,
          scale: 0.82 + rng() * 0.42,
        });
      }
    }

    // --- Fixed landmarks: two bridges off the coast, ferris wheel waterfront.
    kinds[5].placements.push(
      { x: WORLD.cityRadius + 240, z: 420, rotation: Math.PI / 2, scale: 1.6 },
      { x: -WORLD.cityRadius - 260, z: -300, rotation: Math.PI / 2, scale: 1.5 },
    );
    kinds[6].placements.push({
      x: 880,
      z: WORLD.cityRadius - 420,
      rotation: -Math.PI / 4,
      scale: 1.05,
    });

    for (const { model, placements } of kinds) {
      if (placements.length === 0) continue;
      this.addInstances(model, placements);
    }

    // --- The signal tower is a unique hero placement, not instanced.
    // fitModel bakes normalization into the model's own transform, so the
    // world placement goes on a parent group rather than overwriting it.
    const towerHeight = 358;
    const tower = models.signalTower;
    fitModel(tower, towerHeight);
    const towerRoot = new THREE.Group();
    towerRoot.position.set(WORLD.towerPosition.x, 0, WORLD.towerPosition.z);
    towerRoot.rotation.y = Math.PI; // gargoyle face toward the approach
    towerRoot.add(tower);
    this.group.add(towerRoot);
    towerRoot.updateMatrixWorld(true);
    this.resolvePerchPoint(towerRoot);
    this.spireTopY = towerHeight * 0.97;
    // Deliberately not stamped into the height field: the tower is the
    // destination, so the glide floor must let the player descend onto it.

    // --- Island base + ocean.
    const baseGeometry = new THREE.CylinderGeometry(WORLD.cityRadius + 160, WORLD.cityRadius + 260, 60, 48);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0d13, roughness: 0.9, metalness: 0.05 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = -30;
    this.group.add(base);
    this.disposables.push(baseGeometry, baseMaterial);

    // Ocean disc sized to sit inside the camera far plane, fading to the sky's
    // own horizon tone at its rim. A hard-edged or fully fogged plane reads as
    // a razor-straight seam against the unfogged skybox.
    const oceanGeometry = new THREE.CircleGeometry(OCEAN_RADIUS, 96);
    const oceanMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        uNear: { value: new THREE.Color(0x05080f) },
        uHorizon: { value: new THREE.Color(HORIZON_COLOR) },
        uRadius: { value: OCEAN_RADIUS },
      },
      vertexShader: /* glsl */ `
        varying float vDist;
        void main() {
          vDist = length(position.xy);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDist;
        uniform vec3 uNear;
        uniform vec3 uHorizon;
        uniform float uRadius;
        void main() {
          float t = clamp(vDist / uRadius, 0.0, 1.0);
          // Night water stays dark across most of its extent and only lifts to
          // the sky tone in a thin band at the horizon, then dissolves into the
          // skybox so no rim is visible.
          vec3 color = mix(uNear, uHorizon, smoothstep(0.76, 0.985, t));
          float alpha = 1.0 - smoothstep(0.94, 1.0, t);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = WORLD.oceanLevel - 4;
    ocean.renderOrder = -1;
    this.group.add(ocean);
    this.disposables.push(oceanGeometry, oceanMaterial);

    this.addRedLights(rng);

  }

  /** Blinks the rooftop aircraft-warning beacons out of phase. */
  update(elapsed: number): void {
    if (!this.beaconMaterial) return;
    this.beaconMaterial.opacity = 0.55 + Math.sin(elapsed * 2.1) * 0.35;
  }

  /**
   * City light dressing, tuned against the reference footage: dense warm
   * window glows, red aircraft beacons, big soft district-glow pools that
   * bloom like whole lit blocks, and a distant shoreline city on the horizon.
   */
  private addRedLights(rng: () => number): void {
    const beaconPositions: number[] = [];
    const neonPositions: number[] = [];
    const windowPositions: number[] = [];
    const districtPositions: number[] = [];

    for (let attempt = 0; attempt < 2600; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * WORLD.cityRadius;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = this.groundHeightAt(x, z);
      if (height < 40) continue;
      if (beaconPositions.length < 330 && height > 150 && attempt % 5 === 0) {
        // Beacon sits just above the roofline it belongs to.
        beaconPositions.push(x, height + 6, z);
      } else if (windowPositions.length < 1500) {
        // Lit windows scattered through the building mass, not just streets.
        windowPositions.push(x, 15 + rng() * height * 0.8, z);
      } else if (neonPositions.length < 720) {
        neonPositions.push(x, 12 + rng() * 40, z);
      }
    }

    // Big soft pools of light over whole districts — the reference city reads
    // as patches of bloom, not individual points.
    for (let i = 0; i < 46; i += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * WORLD.cityRadius * 0.92;
      districtPositions.push(
        Math.cos(angle) * radius,
        30 + rng() * 90,
        Math.sin(angle) * radius,
      );
    }

    this.beaconMaterial = makeGlowMaterial(0xff2a1e, 26);
    const beacons = makeGlowPoints(beaconPositions, this.beaconMaterial);
    this.group.add(beacons);
    this.disposables.push(this.beaconMaterial, beacons.geometry);

    const windowMaterial = makeGlowMaterial(0xffd9a2, 16);
    windowMaterial.opacity = 0.7;
    const windows = makeGlowPoints(windowPositions, windowMaterial);
    this.group.add(windows);
    this.disposables.push(windowMaterial, windows.geometry);

    const neonMaterial = makeGlowMaterial(0xff7a2a, 34);
    neonMaterial.opacity = 0.75;
    const neon = makeGlowPoints(neonPositions, neonMaterial);
    this.group.add(neon);
    this.disposables.push(neonMaterial, neon.geometry);

    const districtMaterial = makeGlowMaterial(0xffb264, 380);
    districtMaterial.opacity = 0.075;
    const districts = makeGlowPoints(districtPositions, districtMaterial);
    this.group.add(districts);
    this.disposables.push(districtMaterial, districts.geometry);

    // Distant mainland shoreline: the warm band on the reference horizon.
    const shorePositions: number[] = [];
    const shoreAzimuth = 0.9; // radians; off the island's +x/+z quarter
    for (let i = 0; i < 170; i += 1) {
      const angle = shoreAzimuth + (rng() - 0.5) * 1.7;
      const radius = 5200 + rng() * 1200;
      shorePositions.push(
        Math.cos(angle) * radius,
        8 + rng() * 70,
        Math.sin(angle) * radius,
      );
    }
    const shoreMaterial = makeGlowMaterial(0xff9540, 290);
    shoreMaterial.opacity = 0.055;
    shoreMaterial.fog = false;
    const shore = makeGlowPoints(shorePositions, shoreMaterial);
    this.group.add(shore);
    this.disposables.push(shoreMaterial, shore.geometry);

    // A couple of real red lights so nearby stonework actually catches colour.
    const glowA = new THREE.PointLight(0xff3a24, 900, 700, 2);
    glowA.position.set(320, 190, 240);
    const glowB = new THREE.PointLight(0xff5a20, 700, 620, 2);
    glowB.position.set(-540, 150, -430);
    this.group.add(glowA, glowB);
  }

  /**
   * Finds the highest solid surface on the tower crown by raycasting down over
   * a grid, so the hero lands on real geometry rather than a guessed height.
   */
  private resolvePerchPoint(towerRoot: THREE.Object3D): void {
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    let bestY = -Infinity;

    // Search an annulus around the tower axis: the centre is the spire needle,
    // which is neither standable nor a good silhouette (it would put the hero
    // above the signal projector). An outboard ledge keeps the spire and beam
    // rising behind him.
    for (let dz = -60; dz <= 60; dz += 4) {
      for (let dx = -60; dx <= 60; dx += 4) {
        const radial = Math.hypot(dx, dz);
        if (radial < 18 || radial > 60) continue;
        origin.set(WORLD.towerPosition.x + dx, 700, WORLD.towerPosition.z + dz);
        raycaster.set(origin, down);
        const hit = raycaster.intersectObject(towerRoot, true)[0];
        if (!hit || hit.point.y <= bestY) continue;
        bestY = hit.point.y;
        this.perchPoint.copy(hit.point);
      }
    }

    if (!Number.isFinite(bestY)) {
      // Never leave the objective unreachable if the crown misses every ray.
      this.perchPoint.set(
        WORLD.towerPosition.x,
        WORLD.towerPerchHeight,
        WORLD.towerPosition.z,
      );
    }
  }

  groundHeightAt(x: number, z: number): number {
    const gx = Math.floor((x + GRID_HALF) / GRID_CELL);
    const gz = Math.floor((z + GRID_HALF) / GRID_CELL);
    if (gx < 0 || gz < 0 || gx >= this.gridSize || gz >= this.gridSize) return 0;
    return this.heightGrid[gz * this.gridSize + gx];
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private addInstances(model: NormalizedModel, placements: Placement[]): void {
    const placementMatrices = placements.map((placement) => {
      const matrix = new THREE.Matrix4();
      matrix.compose(
        new THREE.Vector3(placement.x, 0, placement.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, placement.rotation, 0)),
        new THREE.Vector3(placement.scale, placement.scale, placement.scale),
      );
      this.stampHeight(placement.x, placement.z, model.radius * placement.scale, model.height * placement.scale);
      return matrix;
    });

    const composed = new THREE.Matrix4();
    for (const part of model.parts) {
      const instanced = new THREE.InstancedMesh(part.geometry, part.material, placementMatrices.length);
      instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      placementMatrices.forEach((placementMatrix, index) => {
        composed.multiplyMatrices(placementMatrix, part.localMatrix);
        instanced.setMatrixAt(index, composed);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = false;
      instanced.receiveShadow = false;
      this.group.add(instanced);
      this.disposables.push(instanced);
    }
  }

  private stampHeight(x: number, z: number, radius: number, height: number): void {
    const minGx = Math.max(0, Math.floor((x - radius + GRID_HALF) / GRID_CELL));
    const maxGx = Math.min(this.gridSize - 1, Math.floor((x + radius + GRID_HALF) / GRID_CELL));
    const minGz = Math.max(0, Math.floor((z - radius + GRID_HALF) / GRID_CELL));
    const maxGz = Math.min(this.gridSize - 1, Math.floor((z + radius + GRID_HALF) / GRID_CELL));
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      for (let gx = minGx; gx <= maxGx; gx += 1) {
        const index = gz * this.gridSize + gx;
        if (this.heightGrid[index] < height) this.heightGrid[index] = height;
      }
    }
  }
}

/** Soft round glow sprite shared by every emissive light point. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create glow texture context.');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

let sharedGlowTexture: THREE.CanvasTexture | null = null;

function makeGlowMaterial(color: number, size: number): THREE.PointsMaterial {
  sharedGlowTexture ??= makeGlowTexture();
  return new THREE.PointsMaterial({
    color,
    size,
    map: sharedGlowTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
}

function makeGlowPoints(positions: number[], material: THREE.PointsMaterial): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/** Scale a model so its bounding-box height matches target, base at y=0. */
function fitModel(model: THREE.Object3D, targetHeight: number): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0.001 ? targetHeight / size.y : 1;
  model.scale.multiplyScalar(scale);
  bounds.setFromObject(model);
  model.position.y -= bounds.min.y;
  model.position.x -= (bounds.min.x + bounds.max.x) / 2;
  model.position.z -= (bounds.min.z + bounds.max.z) / 2;
}

function normalizeModel(model: THREE.Object3D, targetHeight: number): NormalizedModel {
  fitModel(model, targetHeight);
  model.updateWorldMatrix(true, true);
  const parts: MeshPart[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push({
      geometry: mesh.geometry,
      material: mesh.material,
      localMatrix: mesh.matrixWorld.clone(),
    });
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    parts,
    height: targetHeight,
    radius: Math.max(size.x, size.z) / 2,
  };
}
