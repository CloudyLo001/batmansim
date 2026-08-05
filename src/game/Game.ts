import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Batman } from '../entities/Batman';
import { BatSignal } from '../systems/BatSignal';
import { Blimps } from '../systems/Blimps';
import { CameraRig } from '../systems/CameraRig';
import { City, HORIZON_COLOR } from '../systems/City';
import { FlightModel } from '../systems/FlightModel';
import { Hud } from '../systems/Hud';
import { Lightning } from '../systems/Lightning';
import { PauseMenu } from '../systems/PauseMenu';
import { PostFX } from '../systems/PostFX';
import { Rain } from '../systems/Rain';
import { MOON_DIR, Sky } from '../systems/Sky';
import { createSeededRandom } from '../utils/random';
import { loadAssets, type LoadedAssets } from './Assets';
import { INTRO_DURATION, LANDING_DURATION, LANDING_TRIGGER_DISTANCE, Phase } from './Phases';
import { WORLD } from './World';

const MAX_DPR = 1.75;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.6, 9000);
  private readonly input: InputController;
  private readonly hud = new Hud();
  private readonly rig = new CameraRig(this.camera);
  private readonly flight = new FlightModel();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly pauseMenu = new PauseMenu(
    (paused) => this.handlePauseChange(paused),
    () => this.restart(),
  );

  private rng = createSeededRandom(7);
  private paused = false;
  private phase: Phase = Phase.Loading;
  private phaseTime = 0;
  private frame = 0;
  private lastDelta = 1 / 60;
  private elapsed = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private promptTimer = 0;

  // Populated once loading succeeds.
  private batman: Batman | null = null;
  private batwing: THREE.Object3D | null = null;
  private city: City | null = null;
  private sky: Sky | null = null;
  private rain: Rain | null = null;
  private lightning: Lightning | null = null;
  private blimps: Blimps | null = null;
  private batSignal: BatSignal | null = null;
  private postFx: PostFX | null = null;

  private readonly perchPoint = new THREE.Vector3();
  /** Horizontal direction from the tower axis out to the perch ledge. */
  private readonly perchOutward = new THREE.Vector3(0, 0, 1);
  /** Horizontal distance from the tower axis to the perch. */
  private perchRadial = 20;
  private readonly introFrom = new THREE.Vector3();
  private readonly landingFrom = new THREE.Vector3();
  private landingFromHeading = 0;
  private readonly cameraVelocity = new THREE.Vector3();
  private readonly previousCameraPosition = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMappingExposure = 1.18;
    // Fog tinted to the sky's own horizon so distant geometry dissolves into
    // the skybox instead of ending on a hard fogged edge. Density tuned so the
    // far city melts into glowing haze like the reference footage.
    this.scene.fog = new THREE.FogExp2(HORIZON_COLOR, 0.00015);

    this.input = new InputController(canvas);
    this.input.onRestart(() => {
      if (this.phase === Phase.Perched || this.phase === Phase.Glide) this.restart();
    });
    this.input.onSkip(() => {
      if (this.phase === Phase.Intro) this.beginGlide();
    });

    resizeRenderer(this.renderer, this.camera, MAX_DPR);
    this.installTestHooks();
  }

  start(): void {
    this.loop.start();
    void this.initialize();
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.input.dispose();
    this.pauseMenu.dispose();
    this.postFx?.dispose();
    this.batman?.dispose();
    this.city?.dispose();
    this.sky?.dispose();
    this.rain?.dispose();
    this.blimps?.dispose();
    this.batSignal?.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private async initialize(): Promise<void> {
    this.hud.setLoadingProgress(0, 'INITIALIZING');
    let assets: LoadedAssets;
    try {
      assets = await loadAssets((fraction, label) => {
        this.hud.setLoadingProgress(fraction, label);
      });
    } catch (error) {
      this.hud.setLoadingError(
        `SIGNAL LOST — ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (this.disposed) return;
    this.buildWorld(assets);
    this.hud.setLoadingProgress(1, 'AIRBORNE');
    this.hud.finishLoading();
    this.pauseMenu.setEnabled(true);
    this.beginIntro();
  }

  private buildWorld(assets: LoadedAssets): void {
    this.sky = new Sky(this.scene, assets.skybox);
    this.city = new City(
      {
        spire: assets.city.spire,
        slab: assets.city.slab,
        twin: assets.city.twin,
        neonBlock: assets.city.neonBlock,
        industrial: assets.city.industrial,
        bridge: assets.city.bridge,
        ferrisWheel: assets.city.ferrisWheel,
        signalTower: assets.signalTower,
      },
      this.rng,
    );
    this.scene.add(this.city.group);

    this.perchPoint.copy(this.city.perchPoint);
    // Cinematic cameras must sit outboard of the tower axis or they end up
    // inside the crown stonework, which fully occludes the hero.
    this.perchOutward
      .set(this.perchPoint.x - WORLD.towerPosition.x, 0, this.perchPoint.z - WORLD.towerPosition.z);
    this.perchRadial = Math.max(this.perchOutward.length(), 1);
    this.perchOutward.normalize();

    this.batman = new Batman(assets.batmanModel, assets.batmanClips, assets.cape);
    this.scene.add(this.batman.group);

    // fitLength recenters the model on its own transform, so flight placement
    // goes on a parent group instead of overwriting that normalization.
    fitLength(assets.batwing, 26);
    this.batwing = new THREE.Group();
    this.batwing.add(assets.batwing);
    this.scene.add(this.batwing);

    this.rain = new Rain(this.rng);
    this.scene.add(this.rain.lines);

    this.lightning = new Lightning(this.sky.flashLight, this.rng);

    this.blimps = new Blimps(assets.blimp, this.rng);
    this.scene.add(this.blimps.group);

    this.batSignal = new BatSignal(this.city.spireTopY);
    this.scene.add(this.batSignal.group);

    this.postFx = new PostFX(this.renderer, this.scene, this.camera);
    this.syncPostFxSize();

    if (import.meta.env.DEV) {
      // Dev-only handle for QA scene inspection; never referenced by gameplay.
      (window as unknown as Record<string, unknown>).__KNIGHTFALL_DEBUG__ = {
        scene: this.scene,
        camera: this.camera,
        batman: this.batman,
        city: this.city,
        flight: this.flight,
        input: this.input,
        perchPoint: this.perchPoint,
        THREE,
      };
    }
  }

  // ----- Phase transitions -----

  private beginIntro(): void {
    if (!this.batman) return;
    this.phase = Phase.Intro;
    this.phaseTime = 0;
    this.rig.cinematic = true;
    this.hud.setHudVisible(false);
    this.hud.hidePrompt();
    this.hud.setControlHintVisible(false);
    this.introFrom.copy(WORLD.jumpPosition);
    this.batman.setState('skydive');
    this.batman.resetWing();
  }

  private beginGlide(): void {
    if (!this.batman) return;
    this.phase = Phase.Glide;
    this.phaseTime = 0;
    this.rig.cinematic = false;
    this.flight.reset(
      this.scratch.copy(WORLD.jumpPosition).add(this.scratchB.set(0, -320, -420)),
      Math.PI,
      52,
    );
    this.batman.setState('glide');
    this.batman.group.position.copy(this.flight.position);
    this.batman.group.rotation.set(-this.flight.pitch, this.flight.heading, 0);
    this.batman.resetWing();
    this.rig.snapBehind(this.flight.position, this.flight.heading, this.flight.pitch);
    this.hud.setHudVisible(true);
    this.hud.setControlHintVisible(true);
    this.hud.showPrompt('TAKE FLIGHT');
    this.promptTimer = 2.4;
  }

  private beginLanding(): void {
    if (!this.batman) return;
    this.phase = Phase.Landing;
    this.phaseTime = 0;
    this.rig.cinematic = true;
    this.hud.setHudVisible(false);
    this.hud.hidePrompt();
    this.hud.setControlHintVisible(false);
    this.landingFrom.copy(this.flight.position);
    this.landingFromHeading = this.flight.heading;
    this.batman.setState('flare');
    this.lightning?.forceStrike();
  }

  private beginPerched(): void {
    if (!this.batman) return;
    this.phase = Phase.Perched;
    this.phaseTime = 0;
    this.batman.setState('perch');
    this.rig.addImpulse(0.9);
    this.hud.setHudVisible(true);
    this.hud.showPrompt('PRESS R TO DROP AGAIN');
  }

  private restart(): void {
    this.beginIntro();
  }

  /**
   * Pausing freezes simulation but not rendering, so the menu overlays a live
   * frame. Steering input is cleared so the hero does not lurch on resume.
   */
  private handlePauseChange(paused: boolean): void {
    this.paused = paused;
    this.hud.setHudVisible(!paused && this.phase !== Phase.Intro && this.phase !== Phase.Landing);
    if (paused) this.input.releaseAll();
  }

  // ----- Frame update -----

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.lastDelta = delta;
    // Keep rendering the current frame while paused so the menu sits over a
    // live image rather than a black canvas.
    if (this.pausedForScreenshot || this.paused) {
      this.publishDiagnostics();
      return;
    }
    const animDelta = this.reducedMotion ? 0 : delta;
    this.elapsed = elapsed;

    if (resizeRenderer(this.renderer, this.camera, MAX_DPR)) {
      this.syncPostFxSize();
    }

    switch (this.phase) {
      case Phase.Loading:
        break;
      case Phase.Intro:
        this.updateIntro(animDelta);
        break;
      case Phase.Glide:
        this.updateGlide(animDelta);
        break;
      case Phase.Landing:
        this.updateLanding(animDelta);
        break;
      case Phase.Perched:
        this.updatePerched(animDelta);
        break;
    }

    this.updateShared(animDelta, elapsed);
    this.publishDiagnostics();
  }

  private updateIntro(delta: number): void {
    const batman = this.batman;
    const batwing = this.batwing;
    if (!batman || !batwing) return;
    this.phaseTime += delta;
    const t = this.phaseTime;

    // Batwing crosses the moon high above the drop point.
    const wingProgress = Math.min(1, t / 6);
    batwing.position.set(
      THREE.MathUtils.lerp(260, -340, wingProgress),
      this.introFrom.y + 65,
      this.introFrom.z - 120,
    );
    batwing.rotation.set(0, -Math.PI / 2, 0.04 * Math.sin(t * 2));
    batwing.visible = t < 7.5;

    const previous = this.scratchB.copy(batman.group.position);

    if (t < 2.8) {
      // Riding the wing: hero attached beneath the aircraft.
      batman.group.position.copy(batwing.position).add(this.scratch.set(0, -3.2, 0));
      batman.group.rotation.set(0, Math.PI, 0);
      batman.setState('perch');
    } else if (t < 6.2) {
      // Freefall: head-first dive, accelerating.
      const fall = t - 2.8;
      batman.group.position.set(
        THREE.MathUtils.lerp(720, -900, Math.min(1, 2.8 / 6)) * 0 + this.introFrom.x,
        this.introFrom.y + 65 - 3.2 - fall * fall * 14,
        this.introFrom.z - 120 - fall * 26,
      );
      batman.group.rotation.order = 'YXZ';
      batman.group.rotation.set(THREE.MathUtils.degToRad(70), Math.PI, Math.sin(t * 3) * 0.06);
      batman.setState('skydive');
    } else {
      // Cape snap: pull out of the dive into the glide line.
      const pull = THREE.MathUtils.clamp((t - 6.2) / 2.2, 0, 1);
      const eased = 1 - Math.pow(1 - pull, 3);
      const fallEnd = 3.4;
      const yAtPull = this.introFrom.y + 65 - 3.2 - fallEnd * fallEnd * 14;
      const zAtPull = this.introFrom.z - 120 - fallEnd * 26;
      batman.group.position.set(
        this.introFrom.x,
        yAtPull - (1 - eased) * 60 * (1 - pull) - eased * 40 * pull,
        zAtPull - eased * 150 * pull - (t - 6.2) * 40,
      );
      batman.group.rotation.set(
        THREE.MathUtils.lerp(THREE.MathUtils.degToRad(70), THREE.MathUtils.degToRad(10), eased),
        Math.PI,
        0,
      );
      // The wing cracks open out of the freefall tuck.
      if (pull > 0.05) batman.setState('glide');
      if (pull > 0.02 && pull < 0.2) this.rig.addImpulse(0.7);
    }

    // Airflow from the scripted motion drives the membrane.
    const velocity = delta > 0
      ? this.scratch.copy(batman.group.position).sub(previous).divideScalar(delta)
      : this.scratch.set(0, 0, 0);
    const flutter = t > 6.2 && t < 7.4 ? 1.8 : t > 2.8 ? 1.0 : 0.3;
    batman.update(delta, velocity, flutter);

    this.updateIntroCamera(t, batman, batwing);

    if (t >= INTRO_DURATION) this.beginGlide();
  }

  private updateIntroCamera(t: number, batman: Batman, batwing: THREE.Object3D): void {
    if (t < 2.8) {
      // Close tracking shot: camera sits opposite the moon bearing so the
      // wing crosses silhouetted against it.
      this.scratch.copy(batwing.position).addScaledVector(MOON_DIR, -95);
      this.scratch.y = batwing.position.y + 8;
      this.rig.setCinematicFrame(this.scratch, batwing.position, 44);
    } else if (t < 6.2) {
      // Whip down with the freefall, staying clear of the trailing membrane.
      const fall = THREE.MathUtils.clamp((t - 2.8) / 3.4, 0, 1);
      this.scratch.set(
        batman.group.position.x + THREE.MathUtils.lerp(16, 8, fall),
        batman.group.position.y + THREE.MathUtils.lerp(9, 4, fall),
        batman.group.position.z + THREE.MathUtils.lerp(20, -2, fall),
      );
      this.rig.setCinematicFrame(this.scratch, batman.group.position, THREE.MathUtils.lerp(50, 62, fall));
    } else {
      // Settle behind for the handoff.
      const settle = THREE.MathUtils.clamp((t - 6.2) / 3.0, 0, 1);
      const eased = settle * settle * (3 - 2 * settle);
      this.scratch.set(
        batman.group.position.x + THREE.MathUtils.lerp(8, 0, eased),
        batman.group.position.y + THREE.MathUtils.lerp(4, 4.2, eased),
        batman.group.position.z + THREE.MathUtils.lerp(-2, 10.6, eased),
      );
      this.scratchB.copy(batman.group.position);
      this.scratchB.z -= eased * 7;
      this.rig.setCinematicFrame(this.scratch, this.scratchB, THREE.MathUtils.lerp(62, 55, eased));
    }
  }

  private updateGlide(delta: number): void {
    const batman = this.batman;
    const city = this.city;
    if (!batman || !city) return;
    this.phaseTime += delta;

    this.input.update(delta);
    this.flight.update(delta, this.input, city);

    batman.group.position.copy(this.flight.position);
    batman.group.rotation.order = 'YXZ';
    batman.group.rotation.y = this.flight.heading;
    batman.group.rotation.x = -this.flight.pitch * 0.9;
    batman.group.rotation.z = this.flight.roll;
    batman.setState(this.flight.diveAmount > 0.5 ? 'dive' : 'glide');
    // Roll normalized to the model's max bank feeds the wing's twist.
    const bank = THREE.MathUtils.clamp(this.flight.roll / THREE.MathUtils.degToRad(58), -1, 1);
    batman.update(
      delta,
      this.flight.velocity,
      0.35 + this.flight.diveAmount * 1.5,
      bank,
    );

    this.rig.updateChase(
      delta,
      this.flight.position,
      this.flight.heading,
      this.flight.pitch,
      this.flight.roll,
      this.flight.diveAmount,
    );

    if (this.promptTimer > 0) {
      this.promptTimer -= delta;
      if (this.promptTimer <= 0) this.hud.hidePrompt();
    }

    const objectiveDistance = this.flight.position.distanceTo(this.perchPoint);
    this.hud.update(
      this.flight.heading,
      this.flight.position.y,
      this.perchPoint,
      objectiveDistance,
      this.camera,
      this.blimps ? this.blimps.nearestDistance(this.flight.position) : Infinity,
    );

    // Trigger on horizontal proximity: the altitude floor keeps the player
    // above the tower, so a spherical trigger would be unreachable.
    const horizontal = Math.hypot(
      this.flight.position.x - this.perchPoint.x,
      this.flight.position.z - this.perchPoint.z,
    );
    const heightAbovePerch = this.flight.position.y - this.perchPoint.y;
    if (horizontal < LANDING_TRIGGER_DISTANCE && heightAbovePerch > -60 && heightAbovePerch < 280) {
      this.beginLanding();
    }
  }

  private updateLanding(delta: number): void {
    const batman = this.batman;
    if (!batman) return;
    this.phaseTime += delta;
    const t = this.phaseTime;
    const approach = LANDING_DURATION * 0.6;
    const progress = THREE.MathUtils.clamp(t / approach, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    const previous = this.scratchB.copy(batman.group.position);

    // Three beats: swoop in flared, touch down, then furl into the perch.
    batman.group.position.lerpVectors(this.landingFrom, this.perchPoint, eased);
    // Rise over the approach so he drops onto the ledge rather than sliding in.
    batman.group.position.y += Math.sin(eased * Math.PI) * 30 * (1 - eased * 0.55);
    batman.group.rotation.order = 'YXZ';
    batman.group.rotation.y = this.landingFromHeading;
    // Nose lifts hard through the flare, then levels as he sets down.
    batman.group.rotation.x = Math.sin(eased * Math.PI) * -0.5;
    batman.group.rotation.z = THREE.MathUtils.lerp(batman.group.rotation.z, 0, Math.min(1, eased * 2));

    if (progress >= 1) {
      batman.setState('perch');
    } else if (progress > 0.35) {
      batman.setState('flare');
    }

    const velocity = delta > 0
      ? this.scratch.copy(batman.group.position).sub(previous).divideScalar(delta)
      : this.scratch.set(0, 0, 0);
    // The membrane thrashes hardest at the moment of the flare.
    batman.update(delta, velocity, 0.4 + Math.sin(eased * Math.PI) * 1.7);

    // Orbit the tower axis rather than the hero: at a radius beyond the crown
    // the camera never enters stonework, and the hero still tracks in frame.
    const settle = Math.min(1, t / LANDING_DURATION);
    const baseAngle = Math.atan2(this.perchOutward.x, this.perchOutward.z);
    const orbitAngle = baseAngle - 0.75 + settle * 0.75;
    const radius = this.perchRadial + THREE.MathUtils.lerp(48, 17, settle);
    this.scratch.set(
      WORLD.towerPosition.x + Math.sin(orbitAngle) * radius,
      Math.max(
        batman.group.position.y + THREE.MathUtils.lerp(16, 3.4, settle),
        this.perchPoint.y + 3.4,
      ),
      WORLD.towerPosition.z + Math.cos(orbitAngle) * radius,
    );
    this.scratchB.copy(batman.group.position);
    this.scratchB.y += 1.4;
    this.rig.setCinematicFrame(this.scratch, this.scratchB, 46);

    if (t >= LANDING_DURATION) this.beginPerched();
  }

  private updatePerched(delta: number): void {
    const batman = this.batman;
    if (!batman) return;
    this.phaseTime += delta;
    // Residual gusts keep the furled cloak alive on the ledge.
    batman.update(delta, this.scratch.set(0, 0, 0), 0.3);

    // Hold with a slow drift: hero on the gargoyle with the tower crown,
    // signal beam, and storm behind him.
    const baseAngle = Math.atan2(this.perchOutward.x, this.perchOutward.z);
    const angle = baseAngle + Math.sin(this.phaseTime * 0.12) * 0.16;
    const radius = this.perchRadial + 15;
    this.scratch.set(
      WORLD.towerPosition.x + Math.sin(angle) * radius,
      this.perchPoint.y + 3.2,
      WORLD.towerPosition.z + Math.cos(angle) * radius,
    );
    this.scratchB.set(this.perchPoint.x, this.perchPoint.y + 1.2, this.perchPoint.z);
    this.rig.setCinematicFrame(this.scratch, this.scratchB, 44);

    // Only the prompt + compass strip stay on; objective marker hides itself
    // because the perch is behind the camera framing.
    this.hud.update(this.landingFromHeading, this.perchPoint.y, this.perchPoint, 0, this.camera, Infinity);
  }

  private updateShared(delta: number, elapsed: number): void {
    this.cameraVelocity
      .copy(this.camera.position)
      .sub(this.previousCameraPosition)
      .divideScalar(Math.max(delta, 1 / 240));
    this.previousCameraPosition.copy(this.camera.position);

    this.rain?.update(elapsed, this.camera.position, this.cameraVelocity);
    this.blimps?.update(delta, elapsed);
    this.city?.update(elapsed);
    this.sky?.update(this.camera.position);
    this.batSignal?.update(elapsed);
    const heroPosition = this.batman ? this.batman.group.position : this.camera.position;
    this.lightning?.update(delta, elapsed, heroPosition);
  }

  private render(): void {
    if (this.postFx) {
      this.postFx.render(
        this.lastDelta,
        this.elapsed,
        this.phase === Phase.Glide ? this.flight.diveAmount : 0,
        this.lightning?.flashAmount ?? 0,
      );
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private syncPostFxSize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.postFx?.setSize(width, height, dpr);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') this.beginGlide();
        else if (name === 'near-tower') {
          // QA: drop into the glide 300m out from the perch on approach.
          this.beginGlide();
          this.flight.reset(
            this.scratch.copy(this.perchPoint).add(this.scratchB.set(0, 55, 300)),
            Math.PI,
            56,
          );
          this.rig.snapBehind(this.flight.position, this.flight.heading, this.flight.pitch);
        }
        else if (name === 'complete') {
          this.landingFromHeading = Math.PI;
          this.landingFrom.copy(this.perchPoint).add(new THREE.Vector3(0, 30, 90));
          if (this.batman) {
            this.batman.group.position.copy(this.perchPoint);
            this.batman.group.rotation.set(0, Math.PI, 0);
            this.batman.setState('perch');
            this.batman.resetWing();
          }
          this.hud.setControlHintVisible(false);
          this.beginPerched();
        } else console.warn(`Unknown test state: ${name}`);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: () => {},
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.phase === Phase.Perched ? 1 : 0,
      targetScore: 1,
      complete: this.phase === Phase.Perched,
      player: {
        position: {
          x: this.flight.position.x,
          y: this.flight.position.y,
          z: this.flight.position.z,
        },
        speed: this.flight.speed,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
      },
      phase: this.phase,
    };
  }
}

function fitLength(model: THREE.Object3D, targetLength: number): void {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z) || 1;
  model.scale.multiplyScalar(targetLength / length);
  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.sub(center);
}
