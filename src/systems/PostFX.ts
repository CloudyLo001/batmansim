import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.045 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uFlash;
    uniform float uVignette;
    uniform float uGrain;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float radius = length(centered);

      // Chromatic aberration scales with dive intensity, strongest at edges.
      vec2 shift = centered * uAberration * radius * 0.9;
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - shift).b;

      // Steel-blue grade: cool the shadows, keep warm neon highlights.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 cool = color * vec3(0.9, 1.0, 1.16);
      color = mix(cool, color, smoothstep(0.35, 0.85, luma));

      // Lightning flash lifts the whole frame toward pale blue.
      color += vec3(0.82, 0.88, 1.0) * uFlash * 0.55;

      // Vignette.
      color *= 1.0 - smoothstep(0.42, 0.92, radius) * uVignette;

      // Animated film grain.
      float grain = (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 43.0) - 0.5) * uGrain;
      color += grain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/** Filmic composite: bloom + grade (vignette/grain/aberration/flash). */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Strength/threshold tuned against the reference footage: city lights and
    // the moon should bloom into soft pools, not stay as hard points.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.75, 0.72);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(delta: number, elapsed: number, diveAmount: number, flashAmount: number): void {
    void delta;
    this.grade.uniforms.uTime.value = elapsed;
    this.grade.uniforms.uAberration.value = diveAmount * 0.012;
    this.grade.uniforms.uFlash.value = flashAmount;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
