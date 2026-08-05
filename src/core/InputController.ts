/**
 * Flight input from mouse and keyboard combined. steerX/steerY are the blended
 * steering axes in [-1, 1]; diveHeld is the left mouse button or Shift.
 *
 * Keyboard is additive on top of the pointer rather than exclusive, so holding
 * A while the mouse rests off-centre steers harder instead of fighting it.
 */
export class InputController {
  steerX = 0;
  steerY = 0;
  diveHeld = false;

  private pointerX = 0;
  private pointerY = 0;
  private keyX = 0;
  private keyY = 0;
  private mouseDive = false;
  private keyDive = false;
  private readonly keys = new Set<string>();
  private restartHandlers: Array<() => void> = [];
  private skipHandlers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Call once per frame: eases keyboard axes and folds them into steering. */
  update(delta: number): void {
    const wantX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const wantY = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    // Ease so tapping a key banks smoothly instead of snapping to full lock.
    const rate = Math.min(1, delta * 6);
    this.keyX += (wantX - this.keyX) * rate;
    this.keyY += (wantY - this.keyY) * rate;

    this.steerX = clamp(this.pointerX + this.keyX, -1, 1);
    this.steerY = clamp(this.pointerY + this.keyY, -1, 1);
    this.diveHeld = this.mouseDive || this.keyDive;
  }

  onRestart(handler: () => void): void {
    this.restartHandlers.push(handler);
  }

  onSkip(handler: () => void): void {
    this.skipHandlers.push(handler);
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.restartHandlers = [];
    this.skipHandlers = [];
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.pointerX = clamp((event.clientX / width) * 2 - 1, -1, 1);
    this.pointerY = clamp((event.clientY / height) * 2 - 1, -1, 1);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) this.mouseDive = true;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.button === 0) this.mouseDive = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return;
    this.keys.add(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.keyDive = true;
    if (event.code === 'KeyR') {
      for (const handler of this.restartHandlers) handler();
    } else if (event.code === 'Space' || event.code === 'Enter') {
      for (const handler of this.skipHandlers) handler();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.keyDive = false;
  };

  /** Drops every held input, e.g. when the pause menu opens. */
  releaseAll(): void {
    this.onBlur();
  }

  private readonly onBlur = () => {
    this.keys.clear();
    this.mouseDive = false;
    this.keyDive = false;
    this.diveHeld = false;
    this.keyX = 0;
    this.keyY = 0;
    this.steerX = 0;
    this.steerY = 0;
  };

  private readonly onContextMenu = (event: Event) => {
    event.preventDefault();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
