import * as THREE from 'three';
import { forceFrontSide } from './City';
import { disposeObject3D } from '../utils/dispose';
import { makeGlowMaterial, makeGlowPoints } from '../utils/glow';

interface BlimpUnit {
  root: THREE.Group;
  lightPivot: THREE.Object3D;
  pathRadius: number;
  pathHeight: number;
  phase: number;
  speed: number;
  sweepPhase: number;
}

const BLIMP_LENGTH = 170;

/**
 * Patrol blimps drifting on elliptical paths with sweeping searchlight cones.
 *
 * The cones are additive fake-volumetric geometry with NO real lights behind
 * them. Three blimps used to carry nine lights (a SpotLight and two beacon
 * PointLights each) — half the scene's entire light budget for three objects
 * a few hundred pixels across. Three.js forward rendering unrolls every light
 * into every lit fragment shader and evaluates all of them regardless of
 * distance, so those nine were charged to every building pixel in the city.
 * The visible beam never came from the SpotLight, and the running lights are
 * now sprites, so removing them cost nothing on screen.
 */
export class Blimps {
  readonly group = new THREE.Group();

  private readonly units: BlimpUnit[] = [];
  private readonly coneGeometry: THREE.ConeGeometry;
  private readonly runningLightMaterial = makeGlowMaterial(0xff3320, 13);
  private readonly coneMaterial: THREE.ShaderMaterial;

  constructor(blimpModel: THREE.Object3D, rng: () => number) {
    fit(blimpModel, BLIMP_LENGTH);
    forceFrontSide(blimpModel);

    this.coneGeometry = new THREE.ConeGeometry(52, 420, 24, 1, true);
    this.coneGeometry.translate(0, -210, 0);
    this.coneMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0.16 } },
      vertexShader: /* glsl */ `
        varying float vAlong;
        void main() {
          vAlong = -position.y / 420.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlong;
        uniform float uOpacity;
        void main() {
          float fade = (1.0 - vAlong) * vAlong * 4.0;
          gl_FragColor = vec4(0.75, 0.85, 0.95, fade * uOpacity);
        }
      `,
    });

    const configs = [
      { radius: 950, height: 620, speed: 0.014 },
      { radius: 1350, height: 480, speed: -0.011 },
      { radius: 700, height: 760, speed: 0.017 },
    ];

    for (const config of configs) {
      const root = new THREE.Group();
      const model = cloneShared(blimpModel);
      root.add(model);

      const lightPivot = new THREE.Object3D();
      lightPivot.position.set(0, -BLIMP_LENGTH * 0.11, 0);
      root.add(lightPivot);

      const cone = new THREE.Mesh(this.coneGeometry, this.coneMaterial);
      lightPivot.add(cone);

      // Red running lights along the hull, as on real aircraft. Sprites, not
      // real lights — see the note on the class.
      root.add(makeGlowPoints(
        [
          0, BLIMP_LENGTH * 0.09, -BLIMP_LENGTH * 0.42,
          0, BLIMP_LENGTH * 0.09, BLIMP_LENGTH * 0.42,
        ],
        this.runningLightMaterial,
      ));

      this.group.add(root);
      this.units.push({
        root,
        lightPivot,
        pathRadius: config.radius,
        pathHeight: config.height,
        phase: rng() * Math.PI * 2,
        speed: config.speed,
        sweepPhase: rng() * Math.PI * 2,
      });
    }
  }

  update(delta: number, elapsed: number): void {
    for (const unit of this.units) {
      unit.phase += unit.speed * delta;
      const x = Math.cos(unit.phase) * unit.pathRadius;
      const z = Math.sin(unit.phase) * unit.pathRadius * 0.82;
      unit.root.position.set(x, unit.pathHeight, z);
      // Nose along the direction of travel.
      const heading = Math.atan2(
        -Math.sin(unit.phase) * unit.pathRadius * unit.speed,
        Math.cos(unit.phase) * unit.pathRadius * 0.82 * unit.speed,
      );
      unit.root.rotation.y = heading;
      unit.lightPivot.rotation.x = Math.sin(elapsed * 0.35 + unit.sweepPhase) * 0.32;
      unit.lightPivot.rotation.z = Math.cos(elapsed * 0.27 + unit.sweepPhase) * 0.4;
    }
  }

  /** Distance from a point to the nearest blimp, for the HUD tag. */
  nearestDistance(point: THREE.Vector3): number {
    let best = Infinity;
    for (const unit of this.units) {
      best = Math.min(best, unit.root.position.distanceTo(point));
    }
    return best;
  }

  dispose(): void {
    this.coneGeometry.dispose();
    this.coneMaterial.dispose();
    // Drop the glow sprite before the generic teardown: disposeObject3D
    // disposes every texture it finds on a material, and this one is the
    // singleton shared with the city's light points.
    this.runningLightMaterial.map = null;
    this.runningLightMaterial.dispose();
    disposeObject3D(this.group);
  }
}

function fit(model: THREE.Object3D, targetLength: number): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z) || 1;
  model.scale.multiplyScalar(targetLength / length);
  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.sub(center);
}

/** Clone sharing geometry/materials so instances stay cheap. */
function cloneShared(source: THREE.Object3D): THREE.Object3D {
  return source.clone(true);
}
