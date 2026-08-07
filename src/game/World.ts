import * as THREE from 'three';

/** All gameplay distances are meters. The city is an island in a dark ocean. */
export const WORLD = {
  cityRadius: 1650,
  softBoundRadius: 2600,
  oceanLevel: 0,
  /** Where the intro cinematic starts: high above the near edge of the city. */
  jumpPosition: new THREE.Vector3(0, 1500, 2350),
  /** The signal tower on the far side of the island. */
  towerPosition: new THREE.Vector3(-140, 0, -1280),
  /**
   * The lit landing tower the player is flying to. Its roof deck is the only
   * landable surface in the world; everything else ends the run.
   */
  targetTowerPosition: new THREE.Vector3(260, 0, -1020),
  /** Height of the gargoyle perch above the tower base. */
  towerPerchHeight: 342,
};

export function towerPerchPoint(): THREE.Vector3 {
  return new THREE.Vector3(
    WORLD.towerPosition.x,
    WORLD.towerPerchHeight,
    WORLD.towerPosition.z,
  );
}
