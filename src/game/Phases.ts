export enum Phase {
  Loading = 'loading',
  /** Menu state: the hero hangs in the air behind the title and Start control. */
  Title = 'title',
  Glide = 'glide',
  /** He touched the pad: a scripted flare-and-settle onto the deck. */
  Landing = 'landing',
  /** Held on the perch behind the MISSION COMPLETE card, waiting for input. */
  Complete = 'complete',
  /** Contact with the world: a held frame, a quick fade, then back to the title. */
  Crash = 'crash',
}

/** Seconds the screen takes to black out after a contact, before the reset. */
export const CRASH_FADE_DURATION = 0.6;

/** Seconds of scripted flare and settle before the card appears. */
export const LANDING_DURATION = 3.4;

/**
 * How far above a surface the hero's centre counts as contact.
 *
 * The city's height field is a coarse stamp of each building's footprint rather
 * than its true silhouette, so this stays small: a generous radius would clip
 * him on gaps between towers that visibly look flyable.
 */
export const CONTACT_CLEARANCE = 3;

/**
 * How far below the landing deck's plane still counts as touching it.
 *
 * `Loop` clamps delta to 50ms and `FlightModel` caps speed at 118 m/s, so the
 * hero moves at most 5.9m in a frame. Nine metres below the deck plus
 * `CONTACT_CLEARANCE` above gives a 12m band he cannot step over, which is what
 * lets a landing be detected without a swept test.
 */
export const PAD_TOUCH_DEPTH = 9;

/**
 * Blimps are 170 m long and `nearestDistance` measures to their centre, so this
 * is a forgiving sphere around the envelope rather than a tight hull.
 */
export const BLIMP_CONTACT_RADIUS = 60;
