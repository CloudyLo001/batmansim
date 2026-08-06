import * as THREE from 'three';

const BASE_FOV = 42;
const DIVE_FOV = 62;

/**
 * Chase camera with positional lag for the glide, plus a direct "cinematic"
 * mode where phase timelines drive the camera transform explicitly.
 */
export class CameraRig {
  cinematic = false;

  private readonly currentOffset = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedLookOffset = new THREE.Vector3();
  private shake = 0;
  private shakeTime = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snapBehind(position: THREE.Vector3, heading: number, pitch: number): void {
    this.computeChase(position, heading, pitch, 0, this.desired, this.lookTarget);
    this.currentOffset.copy(this.desired).sub(position);
    this.smoothedLookOffset.copy(this.lookTarget).sub(position);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.lookTarget);
    this.setFov(BASE_FOV);
  }

  updateChase(
    delta: number,
    position: THREE.Vector3,
    heading: number,
    pitch: number,
    roll: number,
    diveAmount: number,
  ): void {
    if (this.cinematic) return;
    this.computeChase(position, heading, pitch, diveAmount, this.desired, this.lookTarget);

    // Damp the offset RELATIVE to the hero, not the world position. Damping in
    // world space makes the camera trail by speed/lambda metres, which at glide
    // speed silently doubles the chase distance and shrinks the hero on screen.
    this.desired.sub(position);
    this.lookTarget.sub(position);

    const lambda = 5.5 + diveAmount * 2.5;
    this.currentOffset.x = THREE.MathUtils.damp(this.currentOffset.x, this.desired.x, lambda, delta);
    this.currentOffset.y = THREE.MathUtils.damp(this.currentOffset.y, this.desired.y, lambda, delta);
    this.currentOffset.z = THREE.MathUtils.damp(this.currentOffset.z, this.desired.z, lambda, delta);
    this.smoothedLookOffset.x = THREE.MathUtils.damp(this.smoothedLookOffset.x, this.lookTarget.x, 8, delta);
    this.smoothedLookOffset.y = THREE.MathUtils.damp(this.smoothedLookOffset.y, this.lookTarget.y, 8, delta);
    this.smoothedLookOffset.z = THREE.MathUtils.damp(this.smoothedLookOffset.z, this.lookTarget.z, 8, delta);

    this.camera.position.copy(position).add(this.currentOffset);
    this.applyShake(delta, diveAmount);
    this.lookTarget.copy(position).add(this.smoothedLookOffset);
    this.camera.lookAt(this.lookTarget);
    // A slice of the body roll leans the horizon into turns. NEGATED because
    // camera Z points back at the viewer, so rolling the camera by +roll spins
    // the world the wrong way: the horizon dropped on the outside of the turn
    // while the body leaned into it, and that mixed signal read as inverted
    // steering far more strongly than the body pose did.
    this.camera.rotateZ(-roll * 0.3);

    const targetFov = THREE.MathUtils.lerp(BASE_FOV, DIVE_FOV, diveAmount);
    this.setFov(THREE.MathUtils.damp(this.camera.fov, targetFov, 4, delta));
  }

  /** Direct control for cinematics. */
  setCinematicFrame(position: THREE.Vector3, lookAt: THREE.Vector3, fov = BASE_FOV): void {
    this.camera.position.copy(position);
    this.camera.lookAt(lookAt);
    this.setFov(fov);
  }

  addImpulse(strength: number): void {
    this.shake = Math.max(this.shake, strength);
  }

  private applyShake(delta: number, diveAmount: number): void {
    this.shakeTime += delta;
    this.shake = Math.max(0, this.shake - delta * 1.8);
    const magnitude = this.shake + diveAmount * 0.16;
    if (magnitude <= 0.001) return;
    this.camera.position.x += Math.sin(this.shakeTime * 41) * 0.05 * magnitude;
    this.camera.position.y += Math.cos(this.shakeTime * 37) * 0.04 * magnitude;
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private computeChase(
    position: THREE.Vector3,
    heading: number,
    pitch: number,
    diveAmount: number,
    outPosition: THREE.Vector3,
    outLook: THREE.Vector3,
  ): void {
    // The membrane trails ~2.4 m behind the hero, so the camera has to sit well
    // clear of it and look down, or the wing swallows the lens. This distance
    // also frames the ~5.7 m span across roughly half the screen.
    const back = 9.5 + diveAmount * 2.4;
    // ~20 degrees of depression: enough to show the membrane's area (it lies
    // horizontal, so a level camera sees it edge-on as a thin blade) while
    // still keeping the horizon and moon behind the hero.
    const up = 3.5 - diveAmount * 1.2;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    outPosition.set(
      position.x - forwardX * back,
      position.y + up - Math.sin(pitch) * back * 0.5,
      position.z - forwardZ * back,
    );
    // Aim slightly above the hero so he sits just under centre with the storm
    // and moon filling the frame above him.
    const lead = 7;
    outLook.set(
      position.x + forwardX * lead,
      position.y + Math.sin(pitch) * lead + 0.5,
      position.z + forwardZ * lead,
    );
  }
}
