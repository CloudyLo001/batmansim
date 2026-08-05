import * as THREE from 'three';
import { WORLD } from '../game/World';

const CLOUD_HEIGHT = 1550;

/**
 * The objective: a flickering volumetric-looking beam from the signal tower
 * up to a glowing bat-shaped spot on the cloud deck.
 */
export class BatSignal {
  readonly group = new THREE.Group();

  private readonly beamMaterial: THREE.ShaderMaterial;
  private readonly spot: THREE.Sprite;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(towerTopY: number) {
    const beamLength = CLOUD_HEIGHT - towerTopY;
    const geometry = new THREE.CylinderGeometry(4, 11, beamLength, 20, 1, true);
    geometry.translate(0, beamLength / 2, 0);

    this.beamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uFlicker: { value: 1 } },
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNormalView;
        void main() {
          vAlong = uv.y;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNormalView;
        uniform float uFlicker;
        void main() {
          float edge = pow(abs(vNormalView.z), 1.6);
          float fade = mix(0.4, 1.0, vAlong);
          gl_FragColor = vec4(0.82, 0.9, 1.0, edge * fade * 0.055 * uFlicker);
        }
      `,
    });
    this.disposables.push(geometry, this.beamMaterial);

    const beam = new THREE.Mesh(geometry, this.beamMaterial);
    beam.frustumCulled = false;
    // Beam leans slightly so the cloud spot sits offset from the tower.
    beam.rotation.z = 0.06;
    beam.rotation.x = -0.05;

    const spotTexture = makeBatSpotTexture();
    const spotMaterial = new THREE.SpriteMaterial({
      map: spotTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    });
    this.disposables.push(spotTexture, spotMaterial);
    this.spot = new THREE.Sprite(spotMaterial);
    this.spot.scale.set(420, 260, 1);
    this.spot.position.set(
      Math.sin(0.06) * beamLength * -1,
      beamLength + 40,
      Math.sin(0.05) * beamLength,
    );

    const glow = new THREE.PointLight(0xaecbe8, 3200, 900, 1.8);
    glow.position.y = 10;

    this.group.add(beam, this.spot, glow);
    this.group.position.set(WORLD.towerPosition.x, towerTopY, WORLD.towerPosition.z);
  }

  update(elapsed: number): void {
    const flicker = 0.9 + Math.sin(elapsed * 17) * 0.04 + Math.sin(elapsed * 41) * 0.03;
    this.beamMaterial.uniforms.uFlicker.value = flicker;
    (this.spot.material as THREE.SpriteMaterial).opacity = 0.72 + flicker * 0.16;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

/** Soft glow disc with a bat-silhouette cutout, drawn once to a canvas. */
function makeBatSpotTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create bat-signal texture context.');

  const gradient = context.createRadialGradient(256, 256, 40, 256, 256, 250);
  gradient.addColorStop(0, 'rgba(215, 232, 250, 0.95)');
  gradient.addColorStop(0.55, 'rgba(150, 180, 215, 0.45)');
  gradient.addColorStop(1, 'rgba(120, 150, 190, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  // Bat silhouette cut out of the glow.
  context.globalCompositeOperation = 'destination-out';
  context.translate(256, 262);
  context.scale(1.5, 1.5);
  context.beginPath();
  context.moveTo(0, -34);
  context.bezierCurveTo(6, -26, 18, -30, 30, -22);
  context.bezierCurveTo(22, -14, 24, -4, 36, 2);
  context.bezierCurveTo(56, -2, 74, 6, 86, 22);
  context.bezierCurveTo(64, 20, 46, 26, 34, 38);
  context.bezierCurveTo(22, 48, 8, 54, 0, 62);
  context.bezierCurveTo(-8, 54, -22, 48, -34, 38);
  context.bezierCurveTo(-46, 26, -64, 20, -86, 22);
  context.bezierCurveTo(-74, 6, -56, -2, -36, 2);
  context.bezierCurveTo(-24, -4, -22, -14, -30, -22);
  context.bezierCurveTo(-18, -30, -6, -26, 0, -34);
  context.closePath();
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
