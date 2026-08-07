/** How long after the card appears before it will accept a dismissal. */
const ARM_DELAY_MS = 600;

/**
 * The win card. Owns only its DOM; the game decides what dismissing means.
 *
 * Its keydown listener runs in the CAPTURE phase and stops propagation, which
 * is load-bearing rather than defensive: dismissing calls back into the game,
 * which shows the title screen synchronously, and TitleScreen's own bubble-
 * phase listener would then fire for the SAME event and start a new run — the
 * card would flash and the glide would restart itself. InputController's R
 * binding has the same problem. Escape is deliberately left to pass through so
 * the pause menu still works.
 */
export class MissionComplete {
  private readonly root = this.getElement('#mission-complete');

  private visible = false;
  private armedAt = 0;

  constructor(private readonly onDismiss: () => void) {
    this.root.addEventListener('pointerdown', this.handleDismiss);
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.armedAt = performance.now();
    this.root.hidden = false;
    // Force a reflow so the opacity transition runs on a repeat visit.
    void this.root.offsetWidth;
    this.root.classList.add('visible');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('visible');
    window.setTimeout(() => {
      if (!this.visible) this.root.hidden = true;
    }, 1100);
  }

  dispose(): void {
    this.root.removeEventListener('pointerdown', this.handleDismiss);
    window.removeEventListener('keydown', this.handleKeyDown, true);
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (event.code === 'Escape') return; // pausing stays with the pause menu
    event.preventDefault();
    event.stopPropagation();
    this.handleDismiss();
  };

  private readonly handleDismiss = () => {
    if (!this.visible) return;
    // A key still held from the glide must not eat the card on frame one.
    if (performance.now() - this.armedAt < ARM_DELAY_MS) return;
    this.hide();
    this.onDismiss();
  };

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
