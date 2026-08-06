/**
 * Menu overlay shown while the hero hangs in the air. Owns only its DOM; the
 * game decides what starting means by reacting to the callback.
 */
export class TitleScreen {
  private readonly root = this.getElement('#title-screen');
  private readonly startButton = this.getElement('#start-button');

  private visible = false;
  private starting = false;

  constructor(private readonly onStart: () => void) {
    this.startButton.addEventListener('click', this.handleStart);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.starting = false;
    this.visible = true;
    this.root.hidden = false;
    this.root.classList.remove('leaving');
    // Restart the entry animations on a repeat visit.
    void this.root.offsetWidth;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('leaving');
    window.setTimeout(() => {
      if (!this.visible) this.root.hidden = true;
    }, 800);
  }

  dispose(): void {
    this.startButton.removeEventListener('click', this.handleStart);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private readonly handleStart = () => {
    if (!this.visible || this.starting) return;
    this.starting = true;
    this.hide();
    this.onStart();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.visible) return;
    if (event.code !== 'Enter' && event.code !== 'NumpadEnter' && event.code !== 'Space') return;
    event.preventDefault();
    this.handleStart();
  };

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
