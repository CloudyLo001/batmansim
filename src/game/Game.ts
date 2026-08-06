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
import { Sky } from '../systems/Sky';
import { ScreenFade } from '../systems/ScreenFade';
import { TitleScreen } from '../systems/TitleScreen';
import { createSeededRandom } from '../utils/random';
import { loadAssets, type LoadedAssets } from './Assets';
import {
  BLIMP_CONTACT_RADIUS,
  CONTACT_CLEARANCE,
  CRASH_FADE_DURATION,
  Phase,
} from './Phases';
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

  private readonly titleScreen = new TitleScreen(() => this.beginGlide());
  private readonly screenFade = new ScreenFade();

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
  private city: City | null = null;
  private sky: Sky | null = null;
  private rain: Rain | null = null;
  private lightning: Lightning | null = null;
  private blimps: Blimps | null = null;
  private batSignal: BatSignal | null = null;
  private postFx: PostFX | null = null;

  private readonly titleAnchor = new THREE.Vector3();
  private readonly cameraVelocity = new THREE.Vector3();
  private readonly previousCameraPosition = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
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
      if (this.phase === Phase.Glide) this.restart();
    });
    this.input.onSkip(() => {
      if (this.phase === Phase.Title) this.beginGlide();
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
    this.titleScreen.dispose();
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
    this.beginTitle();
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

    this.batman = new Batman(assets.batmanModel, assets.batmanClips, assets.cape);
    this.scene.add(this.batman.group);

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
        blimps: this.blimps,
        flight: this.flight,
        input: this.input,
        // Lets QA frame the hero with the real chase camera, so steering can be
        // asserted in screen space instead of re-derived from the world axes.
        rig: this.rig,
        THREE,
      };
    }
  }

  // ----- Phase transitions -----

  /** Menu state: he simply hangs in the air, wings spread, behind the title. */
  private beginTitle(): void {
    if (!this.batman) return;
    this.phase = Phase.Title;
    this.phaseTime = 0;
    this.rig.cinematic = true;
    this.hud.setHudVisible(false);
    this.hud.hidePrompt();
    this.hud.setControlHintVisible(false);
    this.titleAnchor.copy(WORLD.jumpPosition).add(this.scratch.set(0, -360, -520));
    this.batman.setState('glide');
    this.batman.proneOverride = null;
    this.batman.group.position.copy(this.titleAnchor);
    this.batman.group.rotation.set(0, Math.PI, 0);
    this.batman.resetWing();
    this.titleScreen.show();
  }

  private beginGlide(): void {
    if (!this.batman) return;
    this.phase = Phase.Glide;
    this.phaseTime = 0;
    this.rig.cinematic = false;
    this.titleScreen.hide();
    // Departs from exactly where he hovered, so there is no cut on start.
    this.flight.reset(this.titleAnchor, Math.PI, 46);
    this.batman.setState('glide');
    this.batman.proneOverride = null;
    this.batman.group.position.copy(this.flight.position);
    this.batman.group.rotation.set(-this.flight.pitch, this.flight.heading, 0);
    this.batman.resetWing();
    this.rig.snapBehind(this.flight.position, this.flight.heading, this.flight.pitch);
    this.hud.setHudVisible(true);
    this.hud.setControlHintVisible(true);
    this.hud.showPrompt('TAKE FLIGHT');
    this.promptTimer = 2.4;
  }

  /**
   * He hit something. The frame holds where it stopped and fades straight to
   * black — no tumble and no fail card, so a retry is a couple of beats away.
   */
  private beginCrash(): void {
    if (!this.batman) return;
    this.phase = Phase.Crash;
    this.phaseTime = 0;
    this.hud.setHudVisible(false);
    this.hud.hidePrompt();
    this.hud.setControlHintVisible(false);
    this.lightning?.forceStrike();
    this.rig.addImpulse(1.4);
    this.screenFade.setOpaque(true);
  }

  private restart(): void {
    this.screenFade.setOpaque(false);
    this.beginTitle();
  }

  /** A point just off the target tower's climbable face, for staging QA runs. */
  private towerFace(out: THREE.Vector3, wall: City['targetWall']): THREE.Vector3 {
    return out
      .copy(wall.origin)
      .setY(wall.topY - 15)
      .addScaledVector(wall.normal, 6);
  }

  /**
   * Pausing freezes simulation but not rendering, so the menu overlays a live
   * frame. Steering input is cleared so the hero does not lurch on resume.
   */
  private handlePauseChange(paused: boolean): void {
    this.paused = paused;
    this.hud.setHudVisible(!paused && this.phase === Phase.Glide);
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
      case Phase.Title:
        this.updateTitle(animDelta);
        break;
      case Phase.Glide:
        this.updateGlide(animDelta);
        break;
      case Phase.Crash:
        this.updateCrash(animDelta);
        break;
    }

    this.updateShared(animDelta, elapsed);
    this.publishDiagnostics();
  }

  /**
   * Menu state. He hovers with a slow bob while the camera drifts a long slow
   * arc around him, so the title sits over a living shot rather than a freeze.
   */
  private updateTitle(delta: number): void {
    const batman = this.batman;
    if (!batman) return;
    this.phaseTime += delta;
    const t = this.phaseTime;

    const previous = this.scratchB.copy(batman.group.position);
    batman.group.position.copy(this.titleAnchor);
    batman.group.position.y += Math.sin(t * 0.5) * 1.6;
    batman.group.rotation.set(
      THREE.MathUtils.degToRad(6) + Math.sin(t * 0.37) * 0.04,
      Math.PI + Math.sin(t * 0.23) * 0.09,
      Math.sin(t * 0.31) * 0.05,
    );

    const velocity = delta > 0
      ? this.scratch.copy(batman.group.position).sub(previous).divideScalar(delta)
      : this.scratch.set(0, 0, 0);
    batman.update(delta, velocity, 0.55);

    // Slow orbit. The look target sits below him so he rides high in frame,
    // clear of the title above and the Start control beneath.
    const angle = Math.PI + t * 0.055;
    const radius = 13;
    this.scratch.set(
      batman.group.position.x + Math.sin(angle) * radius,
      batman.group.position.y + 1.2 + Math.sin(t * 0.29) * 0.5,
      batman.group.position.z + Math.cos(angle) * radius,
    );
    this.scratchB.copy(batman.group.position).add(this.tmpLook.set(0, -0.7, 0));
    this.rig.setCinematicFrame(this.scratch, this.scratchB, 40);
  }

  private updateGlide(delta: number): void {
    const batman = this.batman;
    const city = this.city;
    if (!batman || !city) return;
    this.phaseTime += delta;

    this.input.update(delta);
    this.flight.update(delta, this.input);

    // Contact ends the run. Checked before the pose is applied so the held
    // frame shows him at the surface rather than a step past it.
    if (this.hasContact(city)) {
      batman.group.position.copy(this.flight.position);
      this.beginCrash();
      return;
    }

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

    this.hud.update(this.flight.heading);
  }

  /**
   * Has he touched the world? Buildings, streets and the island base all live
   * in the city's height field, and the ocean sits at the same level the field
   * reports off the island, so one comparison covers all three.
   */
  private hasContact(city: City): boolean {
    const { x, y, z } = this.flight.position;
    const surface = Math.max(city.groundHeightAt(x, z), WORLD.oceanLevel);
    if (y <= surface + CONTACT_CLEARANCE) return true;
    const blimp = this.blimps?.nearestDistance(this.flight.position) ?? Infinity;
    return blimp < BLIMP_CONTACT_RADIUS;
  }

  /**
   * The crash beat. Everything is already frozen — the hero is not simulated
   * and the camera only rides out its impact shake — so this just waits for the
   * fade to finish and resets.
   */
  private updateCrash(delta: number): void {
    const batman = this.batman;
    if (!batman) return;
    this.phaseTime += delta;
    this.rig.updateChase(
      delta,
      batman.group.position,
      this.flight.heading,
      this.flight.pitch,
      this.flight.roll,
      0,
    );
    if (this.phaseTime >= CRASH_FADE_DURATION) this.restart();
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
        // Jumping straight into a phase must clear the menu overlay too.
        if (name !== 'title') this.titleScreen.hide();
        if (name === 'active-play') this.beginGlide();
        else if (name === 'near-tower' || name === 'crash') {
          // Nothing on the HUD points at the tower any more, but it is still
          // the most distinctive landmark to stage QA shots against.
          const wall = this.city?.targetWall;
          if (!wall) return;
          this.towerFace(this.scratch, wall);
          if (name === 'near-tower') {
            // QA: drop into the glide 300m out from the tower on approach.
            this.beginGlide();
            this.flight.reset(this.scratch.add(this.scratchB.set(0, 40, 300)), Math.PI, 56);
            this.rig.snapBehind(this.flight.position, this.flight.heading, this.flight.pitch);
          } else {
            // QA: fly him into the tower's face from close range.
            this.flight.reset(this.scratch.add(this.scratchB.set(0, 0, 40)), Math.PI, 50);
            if (this.batman) this.batman.group.position.copy(this.flight.position);
            this.beginCrash();
          }
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
      // There is no win state: the run ends by crashing, so it never completes.
      score: 0,
      targetScore: 1,
      complete: false,
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
