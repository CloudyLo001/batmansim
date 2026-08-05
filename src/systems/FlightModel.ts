import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { WORLD } from '../game/World';

export interface FlightSample {
  /** Highest obstruction height near a point, used as a soft floor. */
  groundHeightAt(x: number, z: number): number;
}

/**
 * Arcade glide model. Mouse X banks (roll drives yaw), mouse Y trims pitch,
 * holding LMB dives for speed which converts to a swoop on release.
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

  update(delta: number, input: InputController, sampler: FlightSample): void {
    const dive = input.diveHeld;

    // --- Banking: mouse X sets a target roll; roll drives the turn rate so
    // turns feel weighty instead of twitchy.
    const steerCurve = Math.sign(input.steerX) * Math.pow(Math.abs(input.steerX), 1.35);
    // Negative roll drops the right wing (roll turns about the forward axis),
    // so steering right banks right.
    const targetRoll = -steerCurve * THREE.MathUtils.degToRad(58);
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 3.2, delta);
    // Forward is (sin h, 0, cos h), which puts the pilot's right at -cos h,
    // sin h — so a right turn DECREASES heading. The bank and the turn have to
    // share a sign or steering inverts against the visible lean.
    const yawRate = this.roll * 1.05;
    this.heading += yawRate * delta;

    // --- Pitch: gentle trim from mouse Y, overridden by the dive tuck.
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

    // --- Soft altitude floor above rooftops and the ocean.
    const floor = Math.max(
      sampleFloor(sampler, this.position.x, this.position.z, this.velocity),
      WORLD.oceanLevel + 40,
    );
    if (this.position.y < floor) {
      const push = Math.min(1, (floor - this.position.y) / 30);
      this.position.y += push * 26 * delta;
      if (this.pitch < 0) this.pitch += push * delta * 1.4;
    }
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

function sampleFloor(sampler: FlightSample, x: number, z: number, velocity: THREE.Vector3): number {
  // Look slightly ahead so the pull-up starts before the rooftop, not on it.
  const aheadX = x + velocity.x * 1.2;
  const aheadZ = z + velocity.z * 1.2;
  const here = sampler.groundHeightAt(x, z);
  const ahead = sampler.groundHeightAt(aheadX, aheadZ);
  return Math.max(here, ahead) + WORLD.minGlideAltitude;
}

function wrapAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}
