import * as THREE from 'three';

/** Soft round glow sprite shared by every emissive light point in the world. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create glow texture context.');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

let sharedGlowTexture: THREE.CanvasTexture | null = null;

/**
 * An additive point-sprite material. `size` is in world metres because
 * sizeAttenuation is on, so it grows as you approach — keep it small for
 * anything the player can fly close to.
 */
export function makeGlowMaterial(color: number, size: number): THREE.PointsMaterial {
  sharedGlowTexture ??= makeGlowTexture();
  return new THREE.PointsMaterial({
    color,
    size,
    map: sharedGlowTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
}

export function makeGlowPoints(
  positions: number[],
  material: THREE.PointsMaterial,
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
