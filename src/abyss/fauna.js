import { CONFIG } from './config.js';
import * as T from '../../vendor/three-r180/three.module.js';
import { cloneRiggedAsset } from './loader.js';
import { createSharkSwimmer } from './shark-swim.js';

// Stratified patrol configurations spanning the full 0m .. -34.5m abyssal water column:
// Ensures Hero (0m), Stack/Work (-6..-16m), Playground (-18..-25m), and Index/About (-27..-35m)
// all contain smoothly swimming rigged sharks without any popping or wrap-around teleportation.
const MEGALODON_STRATA = [
  {
    centerX: -1.2,
    baseY: -8.6,
    centerZ: -13.2,
    rx: 7.8,
    rz: 3.4,
    ry: 0.55,
    speed: 0.072,
    phase: 0.6,
    scale: 2.75,
    figure8: false,
    tint: null
  },
  {
    centerX: 0.8,
    baseY: -28.8,
    centerZ: -12.8,
    rx: 8.2,
    rz: 3.6,
    ry: 0.60,
    speed: 0.066,
    phase: 3.7,
    scale: 2.95,
    figure8: false,
    tint: 0xd8e4ea
  }
];

const PELAGIC_SHARK_STRATA = [
  // Upper abyss / Hero backdrop
  { centerX: -2.4, baseY: 1.35,  centerZ: -12.8, rx: 7.4, rz: 2.9, ry: 0.40, speed: 0.095, phase: 1.9, scale: 1.75, figure8: true,  tint: null },
  { centerX:  2.6, baseY: -3.6,  centerZ: -15.2, rx: 8.6, rz: 3.2, ry: 0.45, speed: 0.084, phase: 4.4, scale: 1.55, figure8: false, tint: 0xd5e2e8 },
  // Mid-upper abyss / Stack & Work
  { centerX:  1.4, baseY: -12.8, centerZ: -11.4, rx: 7.0, rz: 2.8, ry: 0.42, speed: 0.092, phase: 2.5, scale: 1.90, figure8: true,  tint: null },
  { centerX: -2.2, baseY: -16.4, centerZ: -16.2, rx: 9.0, rz: 3.5, ry: 0.50, speed: 0.078, phase: 5.2, scale: 1.45, figure8: false, tint: 0xc8d8e0 },
  // Playground stratum
  { centerX: -1.8, baseY: -23.4, centerZ: -12.2, rx: 7.6, rz: 3.1, ry: 0.45, speed: 0.088, phase: 0.9, scale: 1.85, figure8: true,  tint: null },
  // Additional patrols fill gaps in the water column (11 total fish -> 14).
  { centerX: 2.0, baseY: -7.0, centerZ: -14.0, rx: 7.9, rz: 3.0, ry: 0.43, speed: 0.087, phase: 5.0, scale: 1.65, figure8: false, tint: 0xd5e2e8 },
  { centerX: -2.5, baseY: -19.5, centerZ: -15.0, rx: 8.1, rz: 3.3, ry: 0.48, speed: 0.082, phase: 2.0, scale: 1.70, figure8: true, tint: null },
  { centerX: 1.0, baseY: -28.5, centerZ: -13.4, rx: 7.5, rz: 2.9, ry: 0.41, speed: 0.094, phase: 4.0, scale: 1.80, figure8: true, tint: 0xcfdde4 },
  // Deepest abyss / Index, About & Footer
  { centerX:  1.6, baseY: -32.4, centerZ: -11.2, rx: 7.2, rz: 2.8, ry: 0.42, speed: 0.090, phase: 2.9, scale: 1.95, figure8: false, tint: null },
  { centerX: -1.5, baseY: -34.6, centerZ: -14.8, rx: 8.4, rz: 3.2, ry: 0.46, speed: 0.080, phase: 5.7, scale: 1.60, figure8: true,  tint: 0xcfdde4 }
];

// Reuse shared meshes in four bearings; rotate both patrol centers and paths.
const around = strata => Array.from({ length: CONFIG.population.bearings }, (_, sector) => sector).flatMap(sector => strata.map(cfg => ({
...cfg, baseY: cfg.baseY * DEPTH_SPAN_SCALE,
bearing: sector * Math.PI * 2 / CONFIG.population.bearings,
phase: cfg.phase + sector * 0.37
})));
const CANOPY_STRATA = (CONFIG.population.canopy ? [10, -44] : []).flatMap(baseY => Array.from({ length: CONFIG.population.bearings }, (_, sector) => sector).map(sector => ({
  centerX: 0, baseY, centerZ: -7.5, rx: 3.2, rz: 2.0, ry: 1.2,
  speed: 0.12, phase: 0.8 + sector * 0.5, scale: 1.5,
  figure8: false, tint: null, bearing: sector * Math.PI * 2 / CONFIG.population.bearings
})));
const DEPTH_SPAN_SCALE = Math.max(1, CONFIG.scene.maxDepth / 44);

export function createFaunaController(scene) {
  const cruisers = [];
  let terrainContacts = 0;
  const lookDummy = new T.Object3D();
  const bankQuat = new T.Quaternion();
  const zAxis = new T.Vector3(0, 0, 1);
  const desired = new T.Vector3();
  const projected = new T.Vector3();
  const view = new T.Vector3();
  const threat = new T.Vector3();
  const viewForward = new T.Vector3();

  function evalOrbit(cfg, u, out = new T.Vector3()) {
    const x = cfg.centerX + Math.sin(u) * cfg.rx;
    const z = cfg.centerZ + (cfg.figure8 ? Math.sin(u * 2) : Math.cos(u)) * cfg.rz;
    const angle = cfg.bearing || 0;
    return out.set(
      x * Math.cos(angle) + z * Math.sin(angle),
      cfg.baseY + Math.sin(u * 1.3 + cfg.phase) * cfg.ry * CONFIG.motion.sharkVerticalMotion + Math.sin(u * 2.1 + cfg.phase) * CONFIG.motion.sharkVerticalWeave,
      z * Math.cos(angle) - x * Math.sin(angle)
    );
  }

  function spawnGroup(asset, strataList, large) {
    if (!asset) return;
    for (const cfg of strataList) {
      const { root, bones } = cloneRiggedAsset(asset, cfg.tint);
      root.scale.setScalar(cfg.scale);
      scene.add(root);
      const swimmer = createSharkSwimmer(root, bones, { phase: cfg.phase, large });
      const position = evalOrbit(cfg, cfg.phase);
      const tangent = evalOrbit(cfg, cfg.phase + 0.01).sub(position).normalize();
      root.position.copy(position);
      lookDummy.position.copy(position);
      lookDummy.lookAt(desired.copy(position).add(tangent));
      root.quaternion.copy(lookDummy.quaternion);
      cruisers.push({
        cfg, root, swimmer, position, u: cfg.phase,
        forward: tangent, flee: new T.Vector3(),
        speed: cfg.speed * cfg.rx, bank: 0, turn: 0, age: 10,
        side: 1, strength: 1, pitch: 0, collisionRadius: cfg.scale * (large ? 0.55 : 0.42),
        previousHeading: Math.atan2(tangent.x, tangent.z)
      });
    }
  }

  function attachAssets({ shark, megalodon }) {
    const pool = [
      ...around(MEGALODON_STRATA).map(cfg => ({ cfg, large: true })),
      ...[...around(PELAGIC_SHARK_STRATA), ...CANOPY_STRATA.map(cfg => ({ ...cfg, baseY: cfg.baseY * DEPTH_SPAN_SCALE }))].map(cfg => ({ cfg, large: false }))
    ];
    const repeats = new Map();
    for (let i = 0; i < CONFIG.population.sharks; i++) {
      const index = Math.floor(i * pool.length / CONFIG.population.sharks);
      const { cfg, large } = pool[index];
      const repeat = repeats.get(index) || 0;
      repeats.set(index, repeat + 1);
      // Exact editable count, with staggered phases for additional instances.
      const placement = { ...cfg, phase: cfg.phase + repeat * 2.399, baseY: cfg.baseY + repeat * 0.25 };
      spawnGroup(large ? megalodon : shark, [placement], large);
    }
  }

  function update(dt, t, descent, rate, terrainField = null) {
    terrainContacts = 0;
    const rateScale = 0.72 + 0.28 * rate;
    for (const c of cruisers) {
      const { cfg, root, position } = c;
      c.age += dt;
      const active = c.age >= 0 && c.age < CONFIG.motion.sharkEscapeDuration;
      const response = active ? Math.exp(-Math.max(0, c.age - 0.65) * CONFIG.motion.sharkEscapeResponseDecay) : 0;
      const burst = active && c.age > CONFIG.motion.sharkBurstDelay
        ? (1 - Math.exp(-(c.age - CONFIG.motion.sharkBurstDelay) * 28)) * Math.exp(-(c.age - CONFIG.motion.sharkBurstDelay) * CONFIG.motion.sharkBurstDecay) : 0;
      const glide = response > 0 ? 0 : T.MathUtils.smoothstep(Math.sin(t * 0.38 + cfg.phase), 0.72, 0.97);
      const surge = 0.95 + Math.sin(t * 0.65 + cfg.phase) * 0.25 + Math.sin(t * 1.3 + cfg.phase) * 0.10;
      const orbitRate = cfg.speed * rateScale * surge * CONFIG.motion.sharkCruiseSpeed;
      c.u += dt * orbitRate;
      // Follow a point ahead on the patrol, integrating forward movement.
      // Escaping changes velocity; returning to patrol never snaps position.
      evalOrbit(cfg, c.u + 0.38, desired).sub(position).normalize();
      if (response > 0) desired.lerp(c.flee, response).normalize();
      const horizontal = Math.hypot(desired.x, desired.z);
      const targetPitch = T.MathUtils.clamp(Math.atan2(desired.y, horizontal), -CONFIG.motion.sharkPitchLimit, CONFIG.motion.sharkPitchLimit);
      c.pitch += (targetPitch - c.pitch) * (1 - Math.exp(-dt * 4.5));
      const heading = Math.atan2(desired.x, desired.z);
      desired.set(Math.sin(heading) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(heading) * Math.cos(c.pitch));
      lookDummy.position.copy(position);
      lookDummy.lookAt(view.copy(position).add(desired));
      bankQuat.setFromAxisAngle(zAxis, c.bank);
      lookDummy.quaternion.multiply(bankQuat);
      const angle = root.quaternion.angleTo(lookDummy.quaternion);
      root.quaternion.rotateTowards(lookDummy.quaternion, Math.min(angle * (1 - Math.exp(-dt * 7)), dt * (CONFIG.motion.sharkTurnSpeed + response * CONFIG.motion.sharkEscapeTurnSpeed)));
      c.forward.set(0, 0, 1).applyQuaternion(root.quaternion);
      const actualHeading = Math.atan2(c.forward.x, c.forward.z);
      const dHeading = Math.atan2(Math.sin(actualHeading - c.previousHeading), Math.cos(actualHeading - c.previousHeading));
      c.previousHeading = actualHeading;
      const smooth = 1 - Math.exp(-dt * 3);
      c.turn += (T.MathUtils.clamp(dt > 0 ? dHeading / dt : 0, -2.2, 2.2) - c.turn) * smooth;
      c.bank += (T.MathUtils.clamp(-c.turn * 0.26, -CONFIG.motion.sharkBankLimit, CONFIG.motion.sharkBankLimit) - c.bank) * smooth;
      // Analytic orbit tangent length gives a speed in world units / second.
      const tangentSpeed = Math.hypot(Math.cos(c.u) * cfg.rx, Math.cos(c.u * 1.3 + cfg.phase) * cfg.ry * CONFIG.motion.sharkVerticalMotion * 1.3 + Math.cos(c.u * 2.1 + cfg.phase) * CONFIG.motion.sharkVerticalWeave * 2.1,
        cfg.figure8 ? Math.cos(c.u * 2) * cfg.rz * 2 : -Math.sin(c.u) * cfg.rz) * orbitRate;
      const targetSpeed = tangentSpeed * (1 - glide * 0.12) + burst * CONFIG.motion.sharkEscapeBoost * c.strength;
      // Exact filtered-speed integral prevents large time steps adding extra thrust.
      const damping = Math.exp(-dt * 9);
      const distance = targetSpeed * dt + (c.speed - targetSpeed) * (1 - damping) / 9;
      c.speed = targetSpeed + (c.speed - targetSpeed) * damping;
      position.addScaledVector(c.forward, distance);
      root.position.copy(position);
      root.position.y += descent;
      // Keep terrain projection out of the patrol state so deep strata can enter view during descent.
      if (terrainField?.resolve(root.position, c.collisionRadius)) {
        view.copy(c.forward);
        view.y = Math.abs(view.y) + 0.12;
        view.normalize();
        lookDummy.position.copy(root.position);
        lookDummy.lookAt(desired.copy(root.position).add(view));
        root.quaternion.rotateTowards(lookDummy.quaternion, Math.min(dt * CONFIG.motion.sharkTurnSpeed, root.quaternion.angleTo(lookDummy.quaternion)));
        c.forward.set(0, 0, 1).applyQuaternion(root.quaternion);
        terrainContacts++;
        c.pitch = Math.max(c.pitch, 0.08);
      }
      const bend = active && c.age < CONFIG.motion.sharkBurstDelay ? Math.sin(c.age / CONFIG.motion.sharkBurstDelay * Math.PI) * c.side * 0.24 : 0;
      c.swimmer.update(dt, {
        speed: c.speed / (2 * cfg.scale), turnRate: c.turn, pitch: c.pitch,
        glideAmount: glide, escape: response, bend
      });
    }
  }

  function scare(ndc, camera, radius) {
    let count = 0;
    camera.getWorldDirection(viewForward);
    for (const c of cruisers) {
      view.copy(c.root.position).applyMatrix4(camera.matrixWorldInverse);
      projected.copy(c.root.position).project(camera);
      if (view.z >= -0.1 || Math.abs(projected.z) > 1) continue;
      const distance = Math.hypot((projected.x - ndc.x) * innerWidth / 2, (projected.y - ndc.y) * innerHeight / 2);
      if (distance > radius) continue;
      threat.set(ndc.x, ndc.y, projected.z).unproject(camera);
      c.flee.copy(c.root.position).sub(threat);
      c.flee.addScaledVector(viewForward, 0.7);
      c.flee.normalize();
      c.strength = 0.65 + 0.35 * (1 - distance / radius);
      c.side = Math.sign(c.forward.z * c.flee.x - c.forward.x * c.flee.z) || 1;
      c.age = -0.015 - Math.random() * 0.04;
      count++;
    }
    return count;
  }

  return {
    attachAssets, update, scare,
    get population() { return cruisers.length; },
    get terrainContacts() { return terrainContacts; },
    get activeEscapes() { return cruisers.filter(c => c.age < CONFIG.motion.sharkEscapeDuration).length; },
    get swimming() {
      return cruisers.map(c => ({ ...c.swimmer.stats, speed: c.speed, turnRate: c.turn, bank: c.bank, pitch: c.pitch, position: c.root.position.toArray() }));
    }
  };
}
