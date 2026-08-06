/**
 * Flight input, keyboard only. steerX/steerY are the steering axes in [-1, 1];
 * diveHeld is Shift.
 *
 * The mouse steers nothing: pointer position and mouse buttons have no effect
 * on flight at all. Clicks still drive the title screen, end card and pause
 * menu, but those are DOM buttons and never reach this controller.
 */
export class InputController {
  steerX = 0;
  steerY = 0;
  diveHeld = false;

  private keyX = 0;
  private keyY = 0;
  private keyDive = false;
  private readonly keys = new Set<string>();
  private restartHandlers: Array<() => void> = [];
  private skipHandlers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
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

    this.steerX = clamp(this.keyX, -1, 1);
    this.steerY = clamp(this.keyY, -1, 1);
    this.diveHeld = this.keyDive;
  }

  onRestart(handler: () => void): void {
    this.restartHandlers.push(handler);
  }

  onSkip(handler: () => void): void {
    this.skipHandlers.push(handler);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.restartHandlers = [];
    this.skipHandlers = [];
  }

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
