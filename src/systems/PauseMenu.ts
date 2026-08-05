/**
 * Escape / gear-button pause menu. Owns only its DOM; the game decides what
 * pausing means by reacting to the change callback.
 */
export class PauseMenu {
  private readonly overlay = this.getElement('#pause-overlay');
  private readonly settingsButton = this.getElement('#settings-button');
  private readonly resumeButton = this.getElement('#resume-button');
  private readonly restartButton = this.getElement('#restart-button');

  private paused = false;
  /** Guards Escape until the experience is actually interactive. */
  private enabled = false;
  private lastFocused: HTMLElement | null = null;

  constructor(
    private readonly onChange: (paused: boolean) => void,
    private readonly onRestart: () => void,
  ) {
    this.settingsButton.addEventListener('click', this.handleOpen);
    this.resumeButton.addEventListener('click', this.handleResume);
    this.restartButton.addEventListener('click', this.handleRestart);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Enable once loading finishes so Escape cannot open over the loader. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.settingsButton.classList.toggle('visible', enabled);
    if (!enabled && this.paused) this.setPaused(false);
  }

  dispose(): void {
    this.settingsButton.removeEventListener('click', this.handleOpen);
    this.resumeButton.removeEventListener('click', this.handleResume);
    this.restartButton.removeEventListener('click', this.handleRestart);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.overlay.hidden = !paused;

    if (paused) {
      this.lastFocused = document.activeElement as HTMLElement | null;
      this.resumeButton.focus();
    } else {
      // Returning focus to the canvas keeps flight keys working immediately.
      this.lastFocused?.focus?.();
      this.lastFocused = null;
    }

    this.onChange(paused);
  }

  private readonly handleOpen = () => {
    if (this.enabled) this.setPaused(true);
  };

  private readonly handleResume = () => {
    this.setPaused(false);
  };

  private readonly handleRestart = () => {
    this.setPaused(false);
    this.onRestart();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Escape' || !this.enabled) return;
    event.preventDefault();
    this.setPaused(!this.paused);
  };

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
