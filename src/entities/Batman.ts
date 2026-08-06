import * as THREE from 'three';
import { CapeWing } from '../systems/CapeWing';
import { disposeObject3D } from '../utils/dispose';

export type BatmanClipRole = 'falling' | 'diveLand' | 'crouch';
export type BatmanState =
  | 'skydive'
  | 'glide'
  | 'dive'
  | 'flare'
  | 'catch'
  | 'climb'
  | 'impact'
  | 'perch';

const TARGET_HEIGHT = 2.05;

/**
 * How far behind the shoulder joints the cape's collar sits, in metres.
 *
 * Local -Z is "off his back" — it becomes world-up once he is belly-down — so
 * this lifts the garment clear instead of letting it cut through his shoulder
 * blades. The arm bones already sit ~0.12 back of his centreline, so the collar
 * lands around -0.18 overall.
 */
const CAPE_BACK_CLEARANCE = 0.06;

interface PoseTargets {
  /** Wing spread: 0 furled cloak, 1 full glide, >1 flared. */
  spread: number;
  /** 0 upright, 1 belly-down glide posture. */
  prone: number;
  /** How strongly the procedural flight pose overrides the clip, 0..1. */
  flightPose: number;
  /** Arms swept back toward the body, 0 spread wide .. 1 tucked. */
  armTuck: number;
  /** Clip to run underneath, if any. */
  clip: BatmanClipRole | null;
}

const POSES: Record<BatmanState, PoseTargets> = {
  skydive: { spread: 0.34, prone: 1, flightPose: 0.35, armTuck: 0.55, clip: 'falling' },
  glide: { spread: 1, prone: 1, flightPose: 1, armTuck: 0, clip: null },
  dive: { spread: 0.22, prone: 1, flightPose: 1, armTuck: 1, clip: null },
  flare: { spread: 1.3, prone: 0.15, flightPose: 0.8, armTuck: -0.35, clip: null },
  // Catch and climb run no clip and no flight pose: the limbs belong to the IK
  // solver, and anything else writing those bones would fight it.
  catch: { spread: 0.2, prone: 0, flightPose: 0, armTuck: 0, clip: null },
  // Failed catch: limbs flung wide and the cape caught open, so the tumble
  // reads as lost control rather than a held pose.
  impact: { spread: 0.75, prone: 0.5, flightPose: 0.45, armTuck: -0.7, clip: null },
  climb: { spread: 0.12, prone: 0, flightPose: 0, armTuck: 0, clip: null },
  perch: { spread: 0.1, prone: 0, flightPose: 0, armTuck: 0, clip: 'crouch' },
};

/** Bone names in the skeleton Mint's rigging pass produces. */
export interface Rig {
  hips?: THREE.Bone;
  spine?: THREE.Bone;
  spine01?: THREE.Bone;
  spine02?: THREE.Bone;
  neck?: THREE.Bone;
  head?: THREE.Bone;
  leftArm?: THREE.Bone;
  rightArm?: THREE.Bone;
  leftForeArm?: THREE.Bone;
  rightForeArm?: THREE.Bone;
  leftHand?: THREE.Bone;
  rightHand?: THREE.Bone;
  leftUpLeg?: THREE.Bone;
  rightUpLeg?: THREE.Bone;
  leftLeg?: THREE.Bone;
  rightLeg?: THREE.Bone;
  leftFoot?: THREE.Bone;
  rightFoot?: THREE.Bone;
}

/**
 * The hero: a rigged, skinned character driven by Mint animation clips for
 * grounded beats (freefall, crouch) plus a procedural bone pose for flight,
 * because the motion catalog has no true glide clip.
 *
 * `group` is positioned/oriented by flight or cinematic code using a 'YXZ'
 * euler (y = heading, x = -pitch, z = roll).
 */
export class Batman {
  readonly group = new THREE.Group();
  readonly wing: CapeWing;

  private readonly pivot = new THREE.Group();
  private readonly modelRoot = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<BatmanClipRole, THREE.AnimationAction>();
  /** Exposed so the climb solver can drive the limbs directly. */
  readonly rig: Rig = {};
  private readonly bindRotations = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler();

  /**
   * Forces the prone blend instead of easing toward the pose target. The wall
   * beats need the torso upright by an exact moment, and damping toward it is
   * frame-rate dependent — at low frame rates he was still folded forward,
   * swinging his shoulders straight through the building.
   */
  proneOverride: number | null = null;

  private state: BatmanState = 'glide';
  private readonly pose: PoseTargets = { ...POSES.glide };
  private activeClip: BatmanClipRole | null = null;
  private impact = 0;
  private time = 0;

  constructor(
    model: THREE.Object3D,
    clips: Partial<Record<BatmanClipRole, THREE.AnimationClip>>,
    capeModel: THREE.Object3D,
  ) {
    this.group.rotation.order = 'YXZ';
    this.wing = new CapeWing(capeModel);

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = size.y > 0.001 ? TARGET_HEIGHT / size.y : 1;
    model.scale.setScalar(scale);
    bounds.setFromObject(model);
    model.position.y -= bounds.min.y;
    model.position.x -= (bounds.min.x + bounds.max.x) / 2;
    model.position.z -= (bounds.min.z + bounds.max.z) / 2;

    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
      const bone = object as THREE.Bone;
      if (bone.isBone) this.registerBone(bone);
    });

    this.modelRoot.add(model);
    this.pivot.add(this.modelRoot);
    this.group.add(this.pivot);
    // Parented to the body, so the cape can never drift or lag behind it.
    this.pivot.add(this.wing.group);
    this.anchorCapeToShoulders();

    const rim = new THREE.PointLight(0xb6d0ea, 95, 40, 2);
    rim.position.set(1.6, 7.5, 2.5);
    this.group.add(rim);

    const kicker = new THREE.PointLight(0xff4530, 9, 18, 2);
    kicker.position.set(-4.0, -2.6, -4.4);
    this.group.add(kicker);

    this.mixer = new THREE.AnimationMixer(model);
    for (const [role, clip] of Object.entries(clips) as Array<[BatmanClipRole, THREE.AnimationClip]>) {
      if (!clip) continue;
      this.actions.set(role, this.mixer.clipAction(clip));
    }
  }

  setState(state: BatmanState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === 'perch') this.impact = 1;

    const nextRole = POSES[state].clip;
    if (nextRole === this.activeClip) return;
    const previous = this.activeClip ? this.actions.get(this.activeClip) : null;
    previous?.fadeOut(0.35);
    const next = nextRole ? this.actions.get(nextRole) : null;
    if (next) {
      const loopOnce = nextRole === 'diveLand';
      next.reset().setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = loopOnce;
      next.fadeIn(0.35).play();
    }
    this.activeClip = nextRole;
  }

  get currentState(): BatmanState {
    return this.state;
  }

  update(delta: number, velocity: THREE.Vector3, turbulence: number, bank = 0): void {
    this.time += delta;

    const target = POSES[this.state];
    // Impact beats snap; cruising poses ease.
    const snap = this.state === 'flare' || this.state === 'perch'
      || this.state === 'catch' || this.state === 'climb';
    const lambda = snap ? 6.5 : 3.4;
    this.pose.spread = THREE.MathUtils.damp(this.pose.spread, target.spread, lambda, delta);
    this.pose.prone = this.proneOverride ?? THREE.MathUtils.damp(this.pose.prone, target.prone, lambda, delta);
    this.pose.flightPose = THREE.MathUtils.damp(this.pose.flightPose, target.flightPose, lambda, delta);
    this.pose.armTuck = THREE.MathUtils.damp(this.pose.armTuck, target.armTuck, lambda, delta);
    this.impact = Math.max(0, this.impact - delta * 3.4);

    // Clips write the skeleton first; the flight pose then blends over the top.
    this.mixer.update(delta);
    this.applyFlightPose(bank);

    const airborne = this.pose.prone;
    const bob = Math.sin(this.time * 1.9) * 0.05 * airborne;
    const impactDip = Math.sin(this.impact * Math.PI) * 0.22;
    this.pivot.rotation.x = this.pose.prone * THREE.MathUtils.degToRad(84);
    this.pivot.rotation.z = Math.sin(this.time * 1.3) * 0.03 * airborne;
    this.modelRoot.position.y = bob - impactDip;

    this.wing.spread = this.pose.spread;
    this.wing.bank = bank;
    this.wing.turbulence = turbulence;
    this.wing.airspeed = velocity.length();
    this.wing.update(delta);
  }

  /** Kept for phase transitions; the parented cape needs no re-seating. */
  resetWing(): void {}

  /**
   * Clasps the cape across the shoulder line, measured from the rig in its bind
   * pose rather than hardcoded.
   *
   * Beware the spine chain: this skeleton numbers it from the top down, so
   * `spine02` is the LOWEST of the three (just above the hips at y 1.26) and is
   * not a shoulder proxy. The arm bones are the shoulder joints; the neck is
   * the fallback, and failing both the cape keeps its own default.
   */
  private anchorCapeToShoulders(): void {
    const { leftArm, rightArm, neck } = this.rig;
    this.pivot.updateWorldMatrix(true, true);

    const anchor = new THREE.Vector3();
    if (leftArm && rightArm) {
      anchor
        .copy(leftArm.getWorldPosition(new THREE.Vector3()))
        .add(rightArm.getWorldPosition(new THREE.Vector3()))
        .multiplyScalar(0.5);
    } else if (neck) {
      neck.getWorldPosition(anchor);
    } else {
      return;
    }

    this.pivot.worldToLocal(anchor);
    anchor.z -= CAPE_BACK_CLEARANCE;
    this.wing.setAnchor(anchor);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.wing.dispose();
    disposeObject3D(this.group);
  }

  private registerBone(bone: THREE.Bone): void {
    this.bindRotations.set(bone, bone.quaternion.clone());
    const key = bone.name.toLowerCase();
    const rig = this.rig as Record<string, THREE.Bone | undefined>;
    const map: Record<string, string> = {
      hips: 'hips',
      spine: 'spine',
      spine01: 'spine01',
      spine02: 'spine02',
      neck: 'neck',
      head: 'head',
      leftarm: 'leftArm',
      rightarm: 'rightArm',
      leftforearm: 'leftForeArm',
      rightforearm: 'rightForeArm',
      lefthand: 'leftHand',
      righthand: 'rightHand',
      leftupleg: 'leftUpLeg',
      rightupleg: 'rightUpLeg',
      leftleg: 'leftLeg',
      rightleg: 'rightLeg',
      leftfoot: 'leftFoot',
      rightfoot: 'rightFoot',
    };
    const slot = map[key];
    if (slot && !rig[slot]) rig[slot] = bone;
  }

  /**
   * Blends a flight posture over whatever the mixer wrote. The catalog has no
   * glide clip, so the spread-wing pose, the dive tuck and the banking lean are
   * authored here as offsets from each bone's bind rotation.
   */
  private applyFlightPose(bank: number): void {
    const weight = this.pose.flightPose;
    if (weight <= 0.001) return;

    const tuck = this.pose.armTuck;
    const flutter = Math.sin(this.time * 2.6) * 0.05 * (1 - Math.abs(tuck));

    // Arms sweep from wide (glide) to pinned along the body (dive).
    const armSweep = THREE.MathUtils.lerp(0.12, 1.25, Math.max(0, tuck));
    const armFlare = tuck < 0 ? tuck * 0.5 : 0;
    this.poseBone(this.rig.leftArm, 0, -armSweep + armFlare, flutter, weight);
    this.poseBone(this.rig.rightArm, 0, armSweep - armFlare, -flutter, weight);
    this.poseBone(this.rig.leftForeArm, 0, -armSweep * 0.35, 0, weight);
    this.poseBone(this.rig.rightForeArm, 0, armSweep * 0.35, 0, weight);

    // Legs trail straight back, toes together, with a slow scissor.
    const legTrail = 0.22 + Math.max(0, tuck) * 0.1;
    const scissor = Math.sin(this.time * 1.7) * 0.04;
    this.poseBone(this.rig.leftUpLeg, -legTrail, 0, 0.06 + scissor, weight);
    this.poseBone(this.rig.rightUpLeg, -legTrail, 0, -0.06 - scissor, weight);
    this.poseBone(this.rig.leftLeg, 0.14, 0, 0, weight);
    this.poseBone(this.rig.rightLeg, 0.14, 0, 0, weight);

    // Spine arches; head lifts to look ahead down the flight line.
    this.poseBone(this.rig.spine, -0.12, bank * 0.1, 0, weight);
    this.poseBone(this.rig.spine02, -0.1, bank * 0.12, 0, weight);
    this.poseBone(this.rig.neck, -0.28, 0, 0, weight);
    this.poseBone(this.rig.head, -0.3, bank * 0.18, 0, weight);
  }

  /** Slerps one bone from its bind rotation toward a local euler offset. */
  private poseBone(
    bone: THREE.Bone | undefined,
    x: number,
    y: number,
    z: number,
    weight: number,
  ): void {
    if (!bone) return;
    const bind = this.bindRotations.get(bone);
    if (!bind) return;
    this.scratchEuler.set(x, y, z);
    this.scratchQuat.copy(bind).multiply(
      new THREE.Quaternion().setFromEuler(this.scratchEuler),
    );
    bone.quaternion.slerp(this.scratchQuat, weight);
  }
}
