import * as THREE from 'three';

/**
 * Direction of the moon disc in the generated equirect panorama, measured
 * from the texture's brightest region. Cinematic shots align against it.
 */
export const MOON_DIR = new THREE.Vector3(0.92, -0.36, -0.16).normalize();

/**
 * Where the amplified moon glow is drawn. Same azimuth as the panorama's moon
 * so they read as one body, but lifted to sit just above the horizon band —
 * the painted moon's own elevation is below the ocean line.
 */
const MOON_GLOW_DIR = new THREE.Vector3(MOON_DIR.x, 0.1, MOON_DIR.z).normalize();
const MOON_GLOW_DISTANCE = 7000;

/**
 * Storm-night sky: generated equirect panorama as background + environment,
 * plus the moon key light and a cool ambient fill.
 */
export class Sky {
  readonly moonLight: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  /** Extra directional used for lightning rim flashes, off by default. */
  readonly flashLight: THREE.DirectionalLight;

  private readonly texture: THREE.Texture;
  private readonly moonGroup = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene, skyTexture: THREE.Texture) {
    this.texture = skyTexture;
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTexture;
    scene.environment = skyTexture;
    scene.backgroundIntensity = 1.0;
    scene.environmentIntensity = 1.6;

    this.moonLight = new THREE.DirectionalLight(0xbcd2e8, 3.0);
    this.moonLight.position.copy(MOON_DIR).multiplyScalar(2000);
    this.moonLight.position.y = Math.max(this.moonLight.position.y, 600);
    scene.add(this.moonLight);

    this.ambient = new THREE.HemisphereLight(0x36455e, 0x0a0e16, 1.5);
    scene.add(this.ambient);

    this.flashLight = new THREE.DirectionalLight(0xdfeaff, 0);
    this.flashLight.position.set(-800, 900, 1200);
    scene.add(this.flashLight);

    // The panorama's moon is small and dim at 1456px wide; the reference's
    // moon dominates the frame. A core disc plus a wide halo, drawn additively
    // at the same bearing, turns it into the scene's anchor light source.
    const glowTexture = makeMoonGlowTexture();
    this.disposables.push(glowTexture);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.26,
      color: 0x9fb6d4,
    }));
    halo.scale.setScalar(3100);

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.85,
      color: 0xe8f0fa,
    }));
    core.scale.setScalar(1300);

    this.disposables.push(halo.material, core.material);
    this.moonGroup.add(halo, core);
    scene.add(this.moonGroup);
  }

  /** Keeps the moon glow at a fixed bearing from the viewer, like a real moon. */
  update(cameraPosition: THREE.Vector3): void {
    this.moonGroup.position
      .copy(cameraPosition)
      .addScaledVector(MOON_GLOW_DIR, MOON_GLOW_DISTANCE);
  }

  dispose(): void {
    this.texture.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}

/** Soft radial falloff with a hot centre — reads as a glowing moon disc. */
function makeMoonGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create moon glow texture context.');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(240,246,255,0.9)');
  gradient.addColorStop(0.34, 'rgba(190,208,232,0.32)');
  gradient.addColorStop(0.62, 'rgba(140,162,196,0.1)');
  gradient.addColorStop(1, 'rgba(110,130,170,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
