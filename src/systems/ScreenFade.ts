/**
 * The full-screen blackout. A crash holds the frame and fades through this on
 * its way back to the title, so the cut is never abrupt.
 */
export class ScreenFade {
  private readonly element: HTMLElement;

  constructor() {
    const element = document.querySelector<HTMLElement>('#screen-fade');
    if (!element) throw new Error('Missing element: #screen-fade');
    this.element = element;
  }

  setOpaque(opaque: boolean): void {
    this.element.classList.toggle('opaque', opaque);
  }
}
