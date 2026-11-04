import * as T from '../../vendor/three-r180/three.module.js';

const GRID_SIZE = 256;

export function createTerrainCollisionField(root) {
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(root);
  const width = bounds.max.x - bounds.min.x;
  const depth = bounds.max.z - bounds.min.z;
  const heights = new Float32Array(GRID_SIZE * GRID_SIZE);
  heights.fill(-Infinity);
  const point = new T.Vector3();
  const builtAtY = root.position.y;

  root.traverse((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const x = Math.round((point.x - bounds.min.x) / width * (GRID_SIZE - 1));
      const z = Math.round((point.z - bounds.min.z) / depth * (GRID_SIZE - 1));
      const index = z * GRID_SIZE + x;
      heights[index] = Math.max(heights[index], point.y);
    }
  });

  const sample = (x, z) => {
    if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) return null;
    const gx = Math.round((x - bounds.min.x) / width * (GRID_SIZE - 1));
    const gz = Math.round((z - bounds.min.z) / depth * (GRID_SIZE - 1));
    for (let radius = 0; radius <= 2; radius++) {
      let highest = -Infinity;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const sx = gx + dx;
          const sz = gz + dz;
          if (sx < 0 || sx >= GRID_SIZE || sz < 0 || sz >= GRID_SIZE) continue;
          highest = Math.max(highest, heights[sz * GRID_SIZE + sx]);
        }
      }
      if (Number.isFinite(highest)) return highest + root.position.y - builtAtY;
    }
    return null;
  };

  return {
    heightAt: sample,
    resolve(position, radius) {
      const height = sample(position.x, position.z);
      if (height === null || position.y >= height + radius) return false;
      position.y = height + radius;
      return true;
    }
  };
}
