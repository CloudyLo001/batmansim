export enum Phase {
  Loading = 'loading',
  /** Menu state: the hero hangs in the air behind the title and Start control. */
  Title = 'title',
  Glide = 'glide',
  /** Contact with the world: a held frame, a quick fade, then back to the title. */
  Crash = 'crash',
}

/** Seconds the screen takes to black out after a contact, before the reset. */
export const CRASH_FADE_DURATION = 0.6;

/**
 * How far above a surface the hero's centre counts as contact.
 *
 * The city's height field is a coarse stamp of each building's footprint rather
 * than its true silhouette, so this stays small: a generous radius would clip
 * him on gaps between towers that visibly look flyable.
 */
export const CONTACT_CLEARANCE = 3;

/**
 * Blimps are 170 m long and `nearestDistance` measures to their centre, so this
 * is a forgiving sphere around the envelope rather than a tight hull.
 */
export const BLIMP_CONTACT_RADIUS = 60;
