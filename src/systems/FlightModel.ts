import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { WORLD } from '../game/World';

/**
 * How far the body leans at full steer, and how hard that lean pulls the nose
 * around. The two SIGNS are separate on purpose.
 *
 * `roll` is applied about the model's own forward axis while `heading` turns
 * about world Y, and those two conventions run opposite to each other here. So
 * a single "flip the sign to swap A and D" edit mirrors BOTH and lands on
 * "turns right, leans left" — wrong in a new way. Each sign below was fixed
 * against what the camera actually shows (scripts/qa-steering.mjs projects the
 * hero through the real camera and asserts on screen-space coordinates); do not
 * re-derive either one from the world axes.
 */
const ROLL_AT_FULL_STEER = THREE.MathUtils.degToRad(58);
const YAW_RATE_PER_ROLL = -1.05;

/**
 * Arcade glide model. A/D bank (roll drives yaw), W/S trim pitch, holding
 * Shift dives for speed which converts to a swoop on release. Keyboard only —
 * the mouse does not steer.
 */
export class FlightModel {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  heading = Math.PI; // yaw, facing -Z at start
  pitch = -0.14;
  roll = 0;
  speed = 40;
  /** 0..1 blend of how deep into a dive we are; drives FOV, FX, animation. */
  diveAmount = 0;

  private readonly forward = new THREE.Vector3();

  reset(position: THREE.Vector3, heading: number, speed: number): void {
    this.position.copy(position);
    this.heading = heading;
    this.pitch = -0.14;
    this.roll = 0;
    this.speed = speed;
    this.diveAmount = 0;
    this.updateVelocity();
  }

  update(delta: number, input: InputController): void {
    const dive = input.diveHeld;

    // --- Banking: D sets a target roll; roll drives the turn rate so turns
    // feel weighty instead of twitchy.
    const steerCurve = Math.sign(input.steerX) * Math.pow(Math.abs(input.steerX), 1.35);
    // D (steerX > 0) leans the body right on screen.
    const targetRoll = steerCurve * ROLL_AT_FULL_STEER;
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 3.2, delta);
    // ...and a right lean has to swing the nose right on screen, which is a
    // DECREASING heading. See the sign note on YAW_RATE_PER_ROLL above.
    const yawRate = this.roll * YAW_RATE_PER_ROLL;
    this.heading += yawRate * delta;

    // --- Pitch: gentle trim from W/S, overridden by the dive tuck.
    const trimPitch = THREE.MathUtils.degToRad(-8) - input.steerY * THREE.MathUtils.degToRad(14);
    const targetPitch = dive ? THREE.MathUtils.degToRad(-56) : trimPitch;
    const pitchLambda = dive ? 2.6 : 2.0;
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, pitchLambda, delta);

    this.diveAmount = THREE.MathUtils.damp(this.diveAmount, dive ? 1 : 0, dive ? 3.0 : 1.6, delta);

    // --- Energy: descending trades altitude for speed, climbing bleeds it.
    const gravityGain = -Math.sin(this.pitch) * 26;
    const cruiseSpeed = 42;
    const drag = (this.speed - cruiseSpeed) * 0.55;
    this.speed += (gravityGain - drag) * delta;
    this.speed = THREE.MathUtils.clamp(this.speed, 24, 118);

    // --- Swoop: releasing a dive with excess speed pitches the nose up.
    if (!dive && this.speed > 62 && this.pitch < THREE.MathUtils.degToRad(6)) {
      this.pitch += THREE.MathUtils.degToRad(20) * delta * ((this.speed - 62) / 40);
    }

    // --- Soft bounds: invisible pressure steering back toward the island.
    const radial = Math.hypot(this.position.x, this.position.z);
    if (radial > WORLD.softBoundRadius) {
      const toCenter = Math.atan2(-this.position.x, -this.position.z);
      const diff = wrapAngle(toCenter - this.heading);
      const strength = Math.min(1, (radial - WORLD.softBoundRadius) / 500);
      this.heading += diff * strength * delta * 0.9;
    }

    this.updateVelocity();
    this.position.addScaledVector(this.velocity, delta);

    // No altitude floor: the world is solid, and flying into it is the fail
    // state. Contact is detected by the game, which owns the city and blimps.
    if (this.position.y > 1750) {
      this.position.y = 1750;
      if (this.pitch > 0) this.pitch = 0;
    }
  }

  private updateVelocity(): void {
    this.forward.set(
      Math.sin(this.heading) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.heading) * Math.cos(this.pitch),
    );
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
  }
}

function wrapAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}
