import * as THREE from 'three';

const PX_PER_DEGREE = 7;
const CARDINALS: Array<[number, string]> = [
  [0, 'N'],
  [45, 'NE'],
  [90, 'E'],
  [135, 'SE'],
  [180, 'S'],
  [225, 'SW'],
  [270, 'W'],
  [315, 'NW'],
];

/**
 * Diegetic Arkham-style DOM HUD: compass strip, a screen-projected objective
 * marker with its range to the landing pad, center prompts, and the bat-emblem
 * loading screen.
 */
export class Hud {
  private readonly root = this.getElement('#hud');
  private readonly compassStrip = this.getElement('#compass-strip');
  private readonly compassWindow = this.getElement('#compass-window');
  private readonly objectiveMarker = this.getElement('#objective-marker');
  private readonly objectiveDistance = this.getElement('#objective-distance');
  private readonly surveillanceTag = this.getElement('#surveillance-tag');
  private readonly surveillanceRange = this.getElement('#surveillance-range');
  private readonly centerPrompt = this.getElement('#center-prompt');
  private readonly controlHint = this.getElement('#control-hint');
  private readonly loading = this.getElement('#loading');
  private readonly loadingFill = this.getElement('#loading-fill');
  private readonly loadingStatus = this.getElement('#loading-status');

  private readonly projected = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly toObjective = new THREE.Vector3();

  constructor() {
    this.buildCompass();
  }

  // ----- Loading screen -----

  setLoadingProgress(fraction: number, label: string): void {
    this.loadingFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.loadingStatus.classList.remove('error');
    this.loadingStatus.textContent = label;
  }

  setLoadingError(message: string): void {
    this.loadingStatus.classList.add('error');
    this.loadingStatus.textContent = message;
  }

  finishLoading(): void {
    this.loading.classList.add('done');
  }

  // ----- Visibility & prompts -----

  setHudVisible(visible: boolean): void {
    this.root.classList.toggle('hud-hidden', !visible);
  }

  setControlHintVisible(visible: boolean): void {
    this.controlHint.classList.toggle('visible', visible);
  }

  showPrompt(text: string): void {
    this.centerPrompt.textContent = text;
    this.centerPrompt.classList.add('visible');
  }

  hidePrompt(): void {
    this.centerPrompt.classList.remove('visible');
  }

  // ----- Per-frame update -----

  update(
    heading: number,
    objectiveWorld: THREE.Vector3,
    objectiveDistanceMeters: number,
    camera: THREE.PerspectiveCamera,
  ): void {
    // Compass: heading PI (facing -Z) reads as north.
    const compassDeg = THREE.MathUtils.euclideanModulo(
      -THREE.MathUtils.radToDeg(heading) + 180,
      360,
    );
    const windowWidth = this.compassWindow.clientWidth;
    const offset = -(compassDeg + 360) * PX_PER_DEGREE + windowWidth / 2;
    this.compassStrip.style.transform = `translateX(${offset}px)`;

    // Objective diamond. `project()` MIRRORS x/y for points behind the eye, so
    // testing its z would draw the marker on the wrong side of the screen mid
    // turn; the view-direction dot is unambiguous.
    camera.getWorldDirection(this.forward);
    this.toObjective.copy(objectiveWorld).sub(camera.position);
    if (this.toObjective.dot(this.forward) <= 0) {
      this.objectiveMarker.style.opacity = '0';
    } else {
      this.projected.copy(objectiveWorld).project(camera);
      const x = THREE.MathUtils.clamp((this.projected.x * 0.5 + 0.5) * 100, 4, 96);
      const y = THREE.MathUtils.clamp((-this.projected.y * 0.5 + 0.5) * 100, 6, 90);
      this.objectiveMarker.style.opacity = '1';
      this.objectiveMarker.style.left = `${x}%`;
      this.objectiveMarker.style.top = `${y}%`;
    }
    this.objectiveDistance.textContent = `${Math.max(0, Math.round(objectiveDistanceMeters))}m`;

    // The range panel is always live, which is what keeps the pad findable in
    // the frames the diamond is legitimately hidden behind the player.
    this.surveillanceTag.classList.add('active');
    this.surveillanceRange.textContent = String(Math.round(objectiveDistanceMeters));
  }

  private buildCompass(): void {
    // Three wraps of 360 degrees so the strip never shows an edge.
    const fragment = document.createDocumentFragment();
    for (let wrapIndex = 0; wrapIndex < 3; wrapIndex += 1) {
      for (let degree = 0; degree < 360; degree += 15) {
        const absolute = (wrapIndex * 360 + degree) * PX_PER_DEGREE;
        const tick = document.createElement('div');
        const major = degree % 45 === 0;
        tick.className = major ? 'compass-tick major' : 'compass-tick';
        tick.style.left = `${absolute}px`;
        fragment.appendChild(tick);
        if (major) {
          const cardinal = CARDINALS.find(([value]) => value === degree);
          if (cardinal) {
            const label = document.createElement('div');
            label.className = 'compass-label';
            label.style.left = `${absolute}px`;
            label.textContent = cardinal[1];
            fragment.appendChild(label);
          }
        }
      }
    }
    this.compassStrip.appendChild(fragment);
    this.compassStrip.style.width = `${360 * 3 * PX_PER_DEGREE}px`;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
