export enum Phase {
  Loading = 'loading',
  Intro = 'intro',
  Glide = 'glide',
  Landing = 'landing',
  Perched = 'perched',
}

/** Duration of the scripted plane-jump cinematic in seconds. */
export const INTRO_DURATION = 9.5;

/** Duration of the landing flare + perch cinematic in seconds. */
export const LANDING_DURATION = 5.2;

/** Horizontal distance from the perch that triggers the landing cinematic. */
export const LANDING_TRIGGER_DISTANCE = 130;
