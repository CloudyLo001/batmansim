import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // Deliberately off. EffectComposer renders into its own non-MSAA target and
    // the only thing reaching the default framebuffer is one fullscreen
    // triangle, which has no interior edges to smooth — so MSAA here bought an
    // extra framebuffer and a per-frame resolve for no visible benefit.
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    // NOTE: logarithmicDepthBuffer is deliberately NOT enabled. It makes every
    // shader write gl_FragDepth, which disables early-Z rejection: looking down
    // a street, all six-to-twelve overlapping building fragments per pixel ran
    // the full 900-ALU PBR shader before being discarded, and city-facing
    // frames cost ~20x an ocean-facing one. The camera's near plane is raised
    // to 1.5 to buy back the depth precision. The custom ShaderMaterials
    // (ocean, bat-signal beam, blimp cones) never implemented the log-depth
    // chunks anyway, so their depth used to disagree with everything else.
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  maxDpr = 2,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  const needsResize = canvas.width !== bufferWidth || canvas.height !== bufferHeight;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}
