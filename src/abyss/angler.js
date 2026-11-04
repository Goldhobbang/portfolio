import { CONFIG } from './config.js';
import * as T from '../../vendor/three-r180/three.module.js';
import { cloneRiggedAsset } from './loader.js';
import { createEscape } from './escape.js';

function createEscaHaloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(155, 255, 228, 0.88)');
  grad.addColorStop(0.24, 'rgba(72, 235, 192, 0.34)');
  grad.addColorStop(0.62, 'rgba(18, 130, 108, 0.08)');
  grad.addColorStop(1.0, 'rgba(0, 80, 65, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(canvas);
}

export function createAnglerController(scene, initialBloomVisible = true) {
  const haloTexture = createEscaHaloTexture();
  const instances = [];
  let bloomVisible = initialBloomVisible;

  const lookDummy = new T.Object3D();
  const desiredQuat = new T.Quaternion();
  const forwardTarget = new T.Vector3();
  const separation = new T.Vector3();
  let randomSeed = 0x6d2b79f5;
  const random = () => {
    randomSeed = (randomSeed + 0x6d2b79f5) | 0;
    let value = randomSeed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const configs = Array.from({ length: CONFIG.population.anglers }, (_, index) => {
    const depth = CONFIG.scene.maxDepth * (index + random()) / CONFIG.population.anglers;
    return {
      baseX: (random() - 0.5) * 12,
      baseY: -depth,
      baseZ: -5 - random() * 12,
      driftX: 0.8 + random() * 0.9,
      driftY: 0.25 + random() * 0.2,
      driftZ: 0.7 + random() * 0.8,
      freq: 0.09 + random() * 0.025,
      phase: random() * Math.PI * 2,
      scale: 1.5 + random() * 0.2,
      tint: random() < 0.5 ? null : 0xdce8eb,
      layer: index
    };
  });

  function attachAsset(anglerAsset) {
    if (!anglerAsset) return;
    for (let i = 0; i < CONFIG.population.anglers; i++) {
      const cfg = configs[i];
      const { root, bones, mixer, actions } = cloneRiggedAsset(anglerAsset, cfg.tint);
      root.scale.setScalar(cfg.scale);
      scene.add(root);

      const hoverAction = actions.Hover || Object.values(actions)[0] || null;
      const swimAction = actions.SwimSlow || hoverAction;
      if (hoverAction) {
        hoverAction.reset().setEffectiveWeight(0.8).play();
      }
      if (swimAction && swimAction !== hoverAction) {
        swimAction.reset().setEffectiveWeight(0.2).play();
      }
      mixer.update(cfg.phase * 1.3);

      // Attach localized Esca PointLight + toggleable bloom Sprite directly to the rigged EscaTip bone
      const escaAnchor = bones.EscaTip || bones.Illicium_02 || root;
      const escaLight = new T.PointLight(0x64ffd2, 1.55, 2.5 * cfg.scale, 2.0);
      escaLight.position.set(0.0, 0.11, 0.04);
      escaAnchor.add(escaLight);

      const haloMat = new T.SpriteMaterial({
        map: haloTexture,
        transparent: true,
        opacity: 0.85,
        blending: T.AdditiveBlending,
        depthWrite: false
      });
      const halo = new T.Sprite(haloMat);
      halo.position.set(0.0, 0.095, 0.01);
      halo.scale.setScalar(0.52);
      halo.visible = bloomVisible;
      escaAnchor.add(halo);

      let emissiveMat = null;
      root.traverse((obj) => {
        if (obj.isMesh && obj.material && obj.material.emissiveMap) {
          emissiveMat = obj.material;
        }
      });

      instances.push({
        cfg,
        escape: createEscape(root, bones),
        root,
        bones,
        mixer,
        hoverAction,
        swimAction,
        escaLight,
        halo,
        haloMat,
        emissiveMat,
        prevPos: new T.Vector3(cfg.baseX, cfg.baseY, cfg.baseZ),
        vel: new T.Vector3(),
        lagX: 0,
        lagZ: 0,
        collisionRadius: cfg.scale * 0.9,
        collisionOffset: new T.Vector3(),
        initialized: false
      });
    }
  }

  function resolveFishCollisions(terrainField) {
    for (let iteration = 0; iteration < 3; iteration++) {
      for (let i = 0; i < instances.length; i++) {
        const a = instances[i];
        for (let j = i + 1; j < instances.length; j++) {
          const b = instances[j];
          separation.subVectors(a.root.position, b.root.position);
          const minDistance = a.collisionRadius + b.collisionRadius;
          const distanceSq = separation.lengthSq();
          if (distanceSq >= minDistance * minDistance) continue;
          if (distanceSq < 1e-8) separation.set(i % 2 ? 1 : -1, 0, 0);
          else separation.multiplyScalar(1 / Math.sqrt(distanceSq));
          const correction = (minDistance - Math.sqrt(Math.max(distanceSq, 1e-8))) * 0.51;
          a.root.position.addScaledVector(separation, correction);
          b.root.position.addScaledVector(separation, -correction);
          a.collisionOffset.addScaledVector(separation, correction);
          b.collisionOffset.addScaledVector(separation, -correction);
        }
      }
    }

    for (const inst of instances) {
      const beforeY = inst.root.position.y;
      if (terrainField?.resolve(inst.root.position, inst.collisionRadius)) {
        inst.collisionOffset.y += inst.root.position.y - beforeY;
        terrainContacts++;
      }
    }
  }

  function setBloom(visible) {
    bloomVisible = visible;
    for (const inst of instances) {
      inst.halo.visible = visible;
    }
  }

  let terrainContacts = 0;
  function update(dt, t, descent, rate, terrainField = null) {
    terrainContacts = 0;
    for (const inst of instances) {
      const { cfg, root, bones, mixer, hoverAction, swimAction, escaLight, haloMat, emissiveMat } = inst;
      const s = t * cfg.freq * rate * CONFIG.motion.anglerSwimSpeed + cfg.phase;

      // Decoupled heavy abyssal buoyancy drift trajectory
      const px = cfg.baseX + Math.sin(s) * cfg.driftX + Math.sin(s * 0.47 + 1.2) * 0.55;
      let pyLocal = cfg.baseY + Math.sin(t * 0.37 + cfg.phase) * cfg.driftY;
      const pz = cfg.baseZ + Math.cos(s * 0.82) * cfg.driftZ;

      let worldY = pyLocal + descent;
      inst.collisionOffset.multiplyScalar(Math.exp(-dt * 1.4));
      if (!inst.initialized) {
        inst.prevPos.set(px, pyLocal, pz);
        root.position.set(px, worldY, pz);
        inst.initialized = true;
      }

      const invDt = dt > 1e-4 ? 1.0 / dt : 0.0;
      const vx = (px - inst.prevPos.x) * invDt;
      const vy = (pyLocal - inst.prevPos.y) * invDt;
      const vz = (pz - inst.prevPos.z) * invDt;
      inst.prevPos.set(px, pyLocal, pz);
      inst.vel.set(vx, vy, vz);
      root.position.set(px, worldY, pz).add(inst.collisionOffset);
      // Terrain projection must not rewrite this analytic patrol path.
      const beforeTerrainY = root.position.y;
      if (terrainField?.resolve(root.position, inst.collisionRadius)) {
        worldY = root.position.y;
        inst.collisionOffset.y += root.position.y - beforeTerrainY;
        terrainContacts++;
      }

      // Orient toward swimming tangent biased slightly toward ROV foreground (+Z) so anatomy reads in 3D
      forwardTarget.set(
        px + vx * 2.4 + 1.15 * Math.cos(s),
        worldY + vy * 1.6 + 0.08 * Math.sin(t * 0.31 + cfg.phase),
        pz + vz * 2.4 + 2.35
      );
      const response = inst.escape.update(dt, forwardTarget);
      lookDummy.position.copy(root.position);
      lookDummy.lookAt(forwardTarget);
      desiredQuat.copy(lookDummy.quaternion);
      root.quaternion.slerp(desiredQuat, 1.0 - Math.exp(-dt * (1.85 + response * 22)));

      // Blend Hover vs SwimSlow based on drift surge speed without rigid 1:1 locking
      const speed = Math.hypot(vx, vz);
      const swimBlend = T.MathUtils.clamp((speed - 0.12) * 1.4 + response, 0.12, 1);
      if (hoverAction && swimAction && hoverAction !== swimAction) {
        hoverAction.setEffectiveWeight(1.0 - swimBlend);
        swimAction.setEffectiveWeight(swimBlend);
        swimAction.timeScale = 0.78 + swimBlend * 0.45;
      }
      inst.escape.restorePose();
      mixer.update(dt * (0.85 + 0.25 * rate) * (1 + response * 3.8));
      inst.escape.applyPose();

      // Secondary spring-lag on Illicium stalk bones so body moves first and lure follows behind
      const targetLagX = T.MathUtils.clamp(-vy * 0.28, -0.18, 0.18);
      const targetLagZ = T.MathUtils.clamp(-vx * 0.24, -0.22, 0.22);
      const damp = 1.0 - Math.exp(-dt * 2.6);
      inst.lagX += (targetLagX - inst.lagX) * damp;
      inst.lagZ += (targetLagZ - inst.lagZ) * damp;

      if (bones.Illicium_01) {
        bones.Illicium_01.rotation.x += inst.lagX * 0.55;
        bones.Illicium_01.rotation.z += inst.lagZ * 0.55;
      }
      if (bones.Illicium_02) {
        bones.Illicium_02.rotation.x += inst.lagX * 0.85;
        bones.Illicium_02.rotation.z += inst.lagZ * 0.85;
      }
      if (bones.EscaTip) {
        bones.EscaTip.rotation.x += inst.lagX * 0.95;
        bones.EscaTip.rotation.z += inst.lagZ * 0.95;
      }

      // Organic bioluminescent pulse (persists even when ROV flashlight is OFF!)
      const pulse = 0.88 + 0.16 * Math.sin(t * 1.35 + cfg.phase) + 0.06 * Math.sin(t * 3.1);
      escaLight.intensity = 1.55 * pulse;
      haloMat.opacity = 0.78 * pulse;
      if (emissiveMat) {
        emissiveMat.emissiveIntensity = 2.35 * pulse;
      }
    }
    resolveFishCollisions(terrainField);
  }

  function dispose() {
    haloTexture.dispose();
    for (const inst of instances) {
      inst.haloMat.dispose();
    }
  }

  function scare(ndc, camera, radius) {
    return instances.reduce((n, c) => n + Number(c.escape.start(ndc, camera, radius)), 0);
  }

  return {
    attachAsset, setBloom, update, dispose, scare,
    get population() { return instances.length; },
    get activeEscapes() { return instances.filter(c => c.escape.active).length; },
    get terrainContacts() { return terrainContacts; },
    get swimming() {
      return instances.map(inst => ({
        layer: inst.cfg.layer,
        baseY: inst.cfg.baseY,
        collisionRadius: inst.collisionRadius,
        position: inst.root.position.toArray()
      }));
    }
  };
}
