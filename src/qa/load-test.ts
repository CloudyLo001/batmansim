import * as THREE from 'three';
import { createMintGltfLoader } from '../assets/gltf-runtime';
import { ASSET_URLS } from '../game/Assets';

/**
 * Dev-only diagnostic: replicates Assets.loadAssets item-for-item, but tracks
 * which individual promise fails to settle so a wedged load can be named.
 */
export async function runLoadTest(timeoutMs = 30000): Promise<Record<string, string>> {
  const manager = new THREE.LoadingManager();
  const gltfLoader = createMintGltfLoader({ manager });
  const textureLoader = new THREE.TextureLoader(manager);

  const status: Record<string, string> = {};
  const track = (name: string, promise: Promise<unknown>) => {
    status[name] = 'pending';
    promise.then(
      () => { status[name] = 'ok'; },
      (error) => { status[name] = `error: ${error instanceof Error ? error.message : error}`; },
    );
  };

  track('batman', gltfLoader.loadAsync(ASSET_URLS.batmanModel));
  track('cape', gltfLoader.loadAsync(ASSET_URLS.cape));
  track('batwing', gltfLoader.loadAsync(ASSET_URLS.batwing));
  track('blimp', gltfLoader.loadAsync(ASSET_URLS.blimp));
  track('tower', gltfLoader.loadAsync(ASSET_URLS.signalTower));
  for (const [key, url] of Object.entries(ASSET_URLS.city)) {
    track(`city:${key}`, gltfLoader.loadAsync(url));
  }
  track('skybox', textureLoader.loadAsync(ASSET_URLS.skybox));
  for (const [key, url] of Object.entries(ASSET_URLS.batmanClips)) {
    track(`clip:${key}`, gltfLoader.loadAsync(url));
  }

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return status;
}
