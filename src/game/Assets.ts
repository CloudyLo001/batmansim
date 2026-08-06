import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createMintGltfLoader } from '../assets/gltf-runtime';
import type { BatmanClipRole } from '../entities/Batman';

/**
 * Resolves a public-directory path against the deployment base.
 *
 * These must NOT be root-absolute. GitHub Pages serves the site from
 * /batmansim/, so "/assets/..." would look outside the project and 404 every
 * model. `import.meta.env.BASE_URL` is "/" under the dev server and carries a
 * trailing slash in both cases.
 */
const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

/**
 * Browser URLs for the synchronized Mint artifacts recorded in
 * mint-assets.json (Vite public root: public/assets/mint/... -> assets/mint/...).
 */
export const ASSET_URLS = {
  // Skinned character produced by Mint's rigging pass, plus its clips.
  batmanModel: asset('assets/mint/batman-hero/rigged_character_glb.glb'),
  batmanClips: {
    falling: asset('assets/mint/batman-hero/clip_falling.glb'),
    diveLand: asset('assets/mint/batman-hero/clip_dive_land.glb'),
    crouch: asset('assets/mint/batman-hero/clip_crouch.glb'),
  },
  // The optimized re-encode: the original GLB stalls GLTFLoader's parse.
  cape: asset('assets/mint/cloak/optimized_glb.glb'),
  blimp: asset('assets/mint/blimp/original_glb.glb'),
  signalTower: asset('assets/mint/signal-tower/original_glb.glb'),
  city: {
    spire: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-0-ks75vafmeth6gkc7xts3r11t558bv2nj.glb'),
    slab: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-1-ks70je1p7kv2gb733rm7mb13v98bvgjc.glb'),
    twin: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-2-ks7bpcz4m42vj9kwp1mn29r6wx8btjpn.glb'),
    neonBlock: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-3-ks7cdm7zx2wd8kb8msn57q05618btatf.glb'),
    industrial: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-4-ks7eq04kmtsmz6ekgphkm6ksv58bvpb7.glb'),
    bridge: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-5-ks7cx9w8pmkremjraxkr26e5jx8bvdy3.glb'),
    ferrisWheel: asset('assets/mint/city-pack/asset_pack_item_glb-vd7cxkype8hjmjh2dz3cd04pa58btdj9-6-ks7em6e2ktwsg4qhs0ahm7ezfs8bt8dq.glb'),
  },
  skybox: asset('assets/mint/storm-sky/image_file.png'),
};

export interface LoadedAssets {
  batmanModel: THREE.Object3D;
  /** Clips keyed by role, retargeted onto the rigged character's skeleton. */
  batmanClips: Partial<Record<BatmanClipRole, THREE.AnimationClip>>;
  /** Generated bat-wing membrane mesh used as the hero's cape. */
  cape: THREE.Object3D;
  blimp: THREE.Object3D;
  signalTower: THREE.Object3D;
  city: {
    spire: THREE.Object3D;
    slab: THREE.Object3D;
    twin: THREE.Object3D;
    neonBlock: THREE.Object3D;
    industrial: THREE.Object3D;
    bridge: THREE.Object3D;
    ferrisWheel: THREE.Object3D;
  };
  skybox: THREE.Texture;
}

/**
 * Preloads every asset before Phase 1. Required assets reject on first
 * failure; animation clips degrade gracefully (the entity falls back to the
 * glide clip) so a missing motion never blanks the whole experience.
 */
export async function loadAssets(
  onProgress: (fraction: number, label: string) => void,
): Promise<LoadedAssets> {
  const manager = new THREE.LoadingManager();
  let fatal: Error | null = null;
  manager.onProgress = (_url, loaded, total) => {
    if (fatal) return;
    onProgress(total > 0 ? loaded / total : 0, 'STREAMING GOTHAM');
  };

  const gltfLoader = createMintGltfLoader({ manager });
  const textureLoader = new THREE.TextureLoader(manager);

  const loadModel = async (url: string): Promise<GLTF> => {
    try {
      return await gltfLoader.loadAsync(url);
    } catch (error) {
      // Latch the first fatal error so later progress cannot mask it.
      if (!fatal) fatal = new Error(`Failed to load ${url}: ${describe(error)}`);
      throw fatal;
    }
  };

  const clipRoles = Object.entries(ASSET_URLS.batmanClips) as Array<[BatmanClipRole, string]>;
  // A missing motion should cost that one pose, not the whole experience.
  const loadClip = async ([role, clipUrl]: [BatmanClipRole, string]) => {
    try {
      const gltf = await gltfLoader.loadAsync(clipUrl);
      return gltf.animations[0] ? ([role, gltf.animations[0]] as const) : null;
    } catch {
      console.warn(`Animation clip "${role}" unavailable; using the rest pose.`);
      return null;
    }
  };

  const [batmanGltf, capeGltf, blimpGltf, towerGltf, spire, slab, twin, neon, industrial, bridge, ferris, skybox, ...clips] =
    await Promise.all([
      loadModel(ASSET_URLS.batmanModel),
      loadModel(ASSET_URLS.cape),
      loadModel(ASSET_URLS.blimp),
      loadModel(ASSET_URLS.signalTower),
      loadModel(ASSET_URLS.city.spire),
      loadModel(ASSET_URLS.city.slab),
      loadModel(ASSET_URLS.city.twin),
      loadModel(ASSET_URLS.city.neonBlock),
      loadModel(ASSET_URLS.city.industrial),
      loadModel(ASSET_URLS.city.bridge),
      loadModel(ASSET_URLS.city.ferrisWheel),
      textureLoader.loadAsync(ASSET_URLS.skybox),
      ...clipRoles.map(loadClip),
    ]);

  const batmanClips: Partial<Record<BatmanClipRole, THREE.AnimationClip>> = {};
  for (const entry of clips) {
    if (entry) batmanClips[entry[0]] = entry[1];
  }

  return {
    batmanModel: batmanGltf.scene,
    batmanClips,
    cape: capeGltf.scene,
    blimp: blimpGltf.scene,
    signalTower: towerGltf.scene,
    city: {
      spire: spire.scene,
      slab: slab.scene,
      twin: twin.scene,
      neonBlock: neon.scene,
      industrial: industrial.scene,
      bridge: bridge.scene,
      ferrisWheel: ferris.scene,
    },
    skybox,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
