import * as T from '../../vendor/three-r180/three.module.js';
import { GLTFLoader } from '../../vendor/three-r180/loaders/GLTFLoader.js';
import * as SkeletonUtils from '../../vendor/three-r180/utils/SkeletonUtils.js';

const MODEL_PATHS = {
  anglerfish: new URL('../../assets/abyss/anglerfish.glb', import.meta.url).href,
  shark: new URL('../../assets/abyss/shark.glb', import.meta.url).href,
  megalodon: new URL('../../assets/abyss/megalodon-shark.glb', import.meta.url).href,
  terrain: new URL('../../assets/abyss/trench-floor.glb', import.meta.url).href
};

const trackedMaterials = new Set();
const trackedGeometries = new Set();
const trackedTextures = new Set();

function prepareTemplateScene(gltfScene, options = {}) {
  gltfScene.traverse((obj) => {
    if (!obj.isMesh) return;

    const geo = obj.geometry;
    if (geo) {
      trackedGeometries.add(geo);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      // Expand bounding sphere slightly to account for skeletal swimming undulation without premature culling
      if (geo.boundingSphere) {
        geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius * 1.35, 1.6);
      }
    }
    obj.frustumCulled = true;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      trackedMaterials.add(m);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (m[key]) {
          trackedTextures.add(m[key]);
          m[key].anisotropy = 4;
        }
      }
      if (m.roughnessMap && !m.aoMap) {
        m.aoMap = m.roughnessMap;
      }
      if (m.aoMap) {
        m.aoMapIntensity = options.aoIntensity ?? 0.85;
      }
      if (m.normalMap) {
        m.normalScale = new T.Vector2(options.normalScale ?? 1.0, options.normalScale ?? 1.0);
      }
      if (options.isAnglerfish && m.emissiveMap) {
        m.emissive = new T.Color(0xffffff);
        m.emissiveIntensity = 2.4;
      }
      m.envMapIntensity = 0.35;
      m.needsUpdate = true;
    }
  });
}

export function cloneRiggedAsset(asset, tintHex = null) {
  const root = SkeletonUtils.clone(asset.scene);
  if (tintHex !== null) {
    const tint = new T.Color(tintHex);
    root.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const clonedMat = obj.material.clone();
        clonedMat.color.multiply(tint);
        trackedMaterials.add(clonedMat);
        obj.material = clonedMat;
      }
    });
  }
  const bones = {};
  root.traverse((obj) => {
    if (obj.isBone) bones[obj.name] = obj;
  });
  const mixer = new T.AnimationMixer(root);
  const actions = {};
  for (const clip of asset.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  return { root, bones, mixer, actions, animations: asset.animations };
}

export async function loadAbyssModels(onEachLoaded = null) {
  const loader = new GLTFLoader();
  const loadSingle = (key, url, opts) =>
    new Promise((resolve) => {
      loader.load(
        url,
        (gltf) => {
          prepareTemplateScene(gltf.scene, opts);
          const entry = { key, scene: gltf.scene, animations: gltf.animations || [] };
          if (onEachLoaded) onEachLoaded(key, entry);
          resolve(entry);
        },
        undefined,
        (err) => {
          console.error(`[AbyssLoader] Failed to load ${key} (${url}):`, err);
          resolve(null);
        }
      );
    });

  const [anglerfish, shark, megalodon] = await Promise.all([
    loadSingle('anglerfish', MODEL_PATHS.anglerfish, { isAnglerfish: true, aoIntensity: 0.9, normalScale: 1.05 }),
    loadSingle('shark', MODEL_PATHS.shark, { aoIntensity: 0.85, normalScale: 1.0 }),
    loadSingle('megalodon', MODEL_PATHS.megalodon, { aoIntensity: 0.85, normalScale: 1.0 })
  ]);

  return { anglerfish, shark, megalodon };
}

export function loadAbyssTerrain() {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      MODEL_PATHS.terrain,
      (gltf) => {
        prepareTemplateScene(gltf.scene, { aoIntensity: 0.85, normalScale: 1.0 });
        gltf.scene.traverse((obj) => {
          if (!obj.isMesh) return;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const material of materials) {
            if (!material) continue;
            material.emissiveMap = null;
            material.emissive.set(0x000000);
            material.emissiveIntensity = 0;
            material.needsUpdate = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      (err) => reject(new Error(`[AbyssLoader] Failed to load trench terrain (${MODEL_PATHS.terrain}).`, { cause: err }))
    );
  });
}

export function disposeAbyssAssets() {
  for (const g of trackedGeometries) g.dispose();
  for (const m of trackedMaterials) m.dispose();
  for (const tex of trackedTextures) tex.dispose();
  trackedGeometries.clear();
  trackedMaterials.clear();
  trackedTextures.clear();
}
