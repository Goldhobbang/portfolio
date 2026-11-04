import { CONFIG } from './config.js';
import * as T from '../../vendor/three-r180/three.module.js';
import { loadAbyssModels, loadAbyssTerrain, disposeAbyssAssets } from './loader.js';
import { createAnglerController } from './angler.js';
import { createFaunaController } from './fauna.js';
import { createTerrainCollisionField } from './terrain-collision.js';

const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const scene = new T.Scene();
scene.background = new T.Color(0x01060b);
scene.fog = new T.FogExp2(0x01060b, CONFIG.scene.fogDensity);

const camera = new T.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
const renderer = new T.WebGLRenderer({
  canvas: $('#gl'),
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, CONFIG.scene.pixelRatioLimit));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.scene.exposure;

// Subtle deep-water scatter; stays very dark when ROV lamp is OFF so bodies sink into abyssal silhouette
const hemiLight = new T.HemisphereLight(0x4b7488, 0x010306, 0.12);
scene.add(hemiLight);

// ROV spotlight offset slightly from camera lens so grazing angles reveal 3D normal/sculpt relief
const lamp = new T.SpotLight(0xcbeae5, 135, CONFIG.lighting.range, 0.52, 0.78, 1.22);
lamp.position.set(0.38, -0.24, 0.45);
scene.add(lamp, lamp.target);

// Secondary wide soft ROV scatter cone when lamp is active
const scatterFill = new T.PointLight(0x528294, 0, 26, 1.6);
scatterFill.position.set(-0.6, 0.4, 0.2);
scene.add(scatterFill);

// Environmental marine snow particles with depth parallax
const SNOW_COUNT = CONFIG.scene.snowCount;
const particles = new Float32Array(SNOW_COUNT * 3);
for (let i = 0; i < particles.length; i += 3) {
  particles[i] = (Math.random() - 0.5) * CONFIG.scene.particleSpan;
  particles[i + 1] = (Math.random() - 0.5) * CONFIG.scene.particleHeight;
  particles[i + 2] = (Math.random() - 0.5) * CONFIG.scene.particleSpan;
}
const particleBase = particles.slice();
const pg = new T.BufferGeometry();
pg.setAttribute('position', new T.BufferAttribute(particles, 3));

const snowCanvas = document.createElement('canvas');
snowCanvas.width = snowCanvas.height = 32;
const snowCtx = snowCanvas.getContext('2d');
const snowGrad = snowCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
snowGrad.addColorStop(0, 'rgba(255,255,255,1)');
snowGrad.addColorStop(0.25, 'rgba(225,242,246,0.78)');
snowGrad.addColorStop(1, 'rgba(255,255,255,0)');
snowCtx.fillStyle = snowGrad;
snowCtx.fillRect(0, 0, 32, 32);

const snowTex = new T.CanvasTexture(snowCanvas);
const snowMat = new T.PointsMaterial({
  color: 0xdce8ec,
  size: CONFIG.scene.snowSize,
  map: snowTex,
  transparent: true,
  opacity: 0.65,
  depthWrite: false
});
const dust = new T.Points(pg, snowMat);
scene.add(dust);

// Modular rigged creature controllers (zero procedural fish shapes!)
const initialBloom = CONFIG.lighting.bloom;
const anglerCtrl = createAnglerController(scene, initialBloom);
const faunaCtrl = createFaunaController(scene);

let modelsLoaded = false;
loadAbyssModels().then((assets) => {
  anglerCtrl.attachAsset(assets.anglerfish);
  faunaCtrl.attachAssets(assets);
  modelsLoaded = Boolean(assets.anglerfish || assets.shark || assets.megalodon);
  document.documentElement.dataset.models = modelsLoaded ? 'ready' : 'partial';
});

const TERRAIN_SCALE = 48;
const TERRAIN_CLEARANCE = 0.8;
const TERRAIN_INITIAL_LIFT = 70;
let terrainRoot = null;
let terrainTop = null;
let terrainBaseY = null;
let terrainBoundsMaxY = null;
let terrainTravelDepth = null;
let terrainField = null;
document.documentElement.dataset.terrain = 'loading';
loadAbyssTerrain().then((root) => {
  terrainRoot = root;
  terrainRoot.name = 'AbyssTrenchTerrain';
  terrainRoot.scale.setScalar(TERRAIN_SCALE);
  terrainRoot.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(terrainRoot);
  terrainTravelDepth = CONFIG.scene.maxDepth - TERRAIN_INITIAL_LIFT;
  terrainBaseY = -CONFIG.scene.maxDepth - TERRAIN_CLEARANCE - bounds.max.y + TERRAIN_INITIAL_LIFT;
  terrainBoundsMaxY = bounds.max.y;
  terrainRoot.position.set(0, terrainBaseY + descent, 0);
  terrainTop = terrainRoot.position.y + bounds.max.y;
  scene.add(terrainRoot);
  terrainField = createTerrainCollisionField(terrainRoot);
  document.documentElement.dataset.terrain = 'ready';
}).catch((error) => {
  console.error(error);
  document.documentElement.dataset.terrain = 'failed';
});

// HUD & Interaction State
let on = false;
let power = 0;
let yaw = -0.1;
let pitch = -0.68;
let drag = null;
let mx = 0;
let my = 0;
let descent = 0;
let time = 0;
let last = performance.now();
let count = 0;
let elapsed = 0;
let lastFps = 0;

const progressSpan = $('.page-progress span');
// Preserve the original page's text/link hit areas; gestures belong to empty background.
const contentSelector = 'a,button,input,textarea,select,nav,header,.section-top,p,h1,h2,h3,h4,h5,h6,li,small,code,.hero-title,[data-ui],.pg-intro';
const CLICK_MS = CONFIG.interaction.clickMaxMs;
const lampKeys = new Set();
let scareCount = 0;
let lastScared = 0;
function syncLamp() { on = lampKeys.size > 0; }
function endGesture() {
  drag = null;
  syncLamp();
}
function resetInput() {
  lampKeys.clear();
  endGesture();
}
addEventListener('keydown', (e) => {
  if (e.code !== CONFIG.interaction.lampKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  lampKeys.add(e.code);
  syncLamp();
});
addEventListener('keyup', (e) => {
  if (e.code !== CONFIG.interaction.lampKey) return;
  lampKeys.delete(e.code);
  syncLamp();
});
addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || e.button !== 0 || e.target.closest(contentSelector)) return;
  // Background mouse drags must not select text crossed along the way.
  if (e.pointerType === 'mouse') e.preventDefault();
  endGesture();
  mx = e.clientX / innerWidth * 2 - 1;
  my = 1 - e.clientY / innerHeight * 2;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, startedAt: performance.now() };
  syncLamp();
});
addEventListener('pointermove', (e) => {
  mx = e.clientX / innerWidth * 2 - 1;
  my = 1 - e.clientY / innerHeight * 2;
  if (!drag || e.pointerId !== drag.id) return;
  // Looking around remains available after a long hold.
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= CONFIG.interaction.dragThreshold) {
    drag.moved = true;
  }
  if (drag.moved) {
    yaw -= (e.clientX - drag.lastX) * CONFIG.interaction.lookSensitivity;
    pitch = T.MathUtils.clamp(pitch - (e.clientY - drag.lastY) * CONFIG.interaction.lookSensitivity, -Math.PI / 2 + CONFIG.interaction.verticalMargin, Math.PI / 2 - CONFIG.interaction.verticalMargin);
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
});
addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && performance.now() - drag.startedAt < CLICK_MS && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < CONFIG.interaction.dragThreshold) {
    const ndc = new T.Vector2(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2);
    const radius = Math.min(innerWidth, innerHeight) * CONFIG.interaction.scareRadius;
    camera.updateMatrixWorld();
    lastScared = anglerCtrl.scare(ndc, camera, radius) + faunaCtrl.scare(ndc, camera, radius);
    scareCount++;
  }
  endGesture();
});
addEventListener('pointercancel', endGesture);
addEventListener('blur', resetInput);
addEventListener('scroll', endGesture, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
addEventListener('pointerout', (e) => { if (!e.relatedTarget) endGesture(); });
addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const aim = new T.Vector3();
const lampOffset = new T.Vector3(0.38, -0.24, 0.45);
const fillOffset = new T.Vector3(-0.6, 0.4, 0.2);
const pointer = new T.Vector2();
const lampRay = new T.Raycaster();

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.max(0, (now - last) / 1000);
  const dt = Math.min(rawDt, 0.05);
  last = now;
  if (document.hidden) return;

  const simDt = dt * (reduced ? 0.2 : 1.0) * CONFIG.motion.timeScale;
  time += simDt;
  const t = time;

  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();

  power += (Number(on) - power) * (1 - Math.exp(-dt * CONFIG.lighting.response));
  const lampSetting = CONFIG.lighting.power;
  const beamSetting = CONFIG.lighting.beamWidth;
  const rateSetting = 0.40;

  lamp.intensity = lampSetting * 145 * power;
  lamp.angle = 0.22 + beamSetting * 0.56;
  hemiLight.intensity = CONFIG.lighting.ambientDark + CONFIG.lighting.ambientLit * power;
  scatterFill.intensity = lampSetting * 2.8 * power;
  snowMat.opacity = 0.26 + 0.44 * power;

  // The beam uses the same perspective ray as the pointer, in every bearing.
  lamp.position.copy(lampOffset).applyQuaternion(camera.quaternion).add(camera.position);
  scatterFill.position.copy(fillOffset).applyQuaternion(camera.quaternion).add(camera.position);
  pointer.set(mx, my);
  lampRay.setFromCamera(pointer, camera);
  lampRay.ray.at(CONFIG.lighting.aimDistance, aim);
  lamp.target.position.lerp(aim, 1 - Math.exp(-dt * CONFIG.lighting.aimResponse));

  // Single normalized vertical descent calculation (0m at top -> 34m at page bottom)
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const scrollProgress = T.MathUtils.clamp(scrollY / maxScroll, 0, 1);
  if (progressSpan) {
    progressSpan.style.transform = `scaleX(${scrollProgress.toFixed(4)})`;
  }
  // Bind depth directly to scroll position; no trailing interpolation.
  descent = scrollProgress * CONFIG.scene.maxDepth;
  if (terrainRoot) {
    terrainRoot.position.y = terrainBaseY + scrollProgress * terrainTravelDepth;
    terrainTop = terrainRoot.position.y + terrainBoundsMaxY;
  }

  const rate = 0.6 + rateSetting * 0.35;
  anglerCtrl.update(simDt, t, descent, rate, terrainField);
  faunaCtrl.update(simDt, t, descent, rate, terrainField);

  // Marine snow rises upward as observer descends deeper (`+descent * parallax`)
  const dp = pg.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const z = particleBase[i * 3 + 2];
    const parallax = 0.65 + 1.4 * (1 - Math.abs(z) / 55);
    dp.setY(i, T.MathUtils.euclideanModulo(particleBase[i * 3 + 1] + descent * parallax + t * CONFIG.scene.snowSpeed + CONFIG.scene.particleHeight / 2, CONFIG.scene.particleHeight) - CONFIG.scene.particleHeight / 2);
  }
  dp.needsUpdate = true;
  dust.rotation.y = Math.sin(t * 0.015) * 0.025;

  renderer.render(scene, camera);

  elapsed += rawDt;
  count++;
  if (elapsed > 0.5) {
    lastFps = Math.round(count / elapsed);
    if ($('[data-t="fps"]')) $('[data-t="fps"]').textContent = lastFps + ' fps';
    if ($('[data-t="a"]')) $('[data-t="a"]').textContent = (power * lampSetting).toFixed(2);
    if ($('[data-t="b"]')) $('[data-t="b"]').textContent = rateSetting.toFixed(2);
    if ($('[data-t="q"]')) $('[data-t="q"]').textContent = Math.round(renderer.getPixelRatio() * 100) + '%';
    count = 0;
    elapsed = 0;
  }

  window.__ABYSS_DEBUG__ = {
    modelsLoaded,
    settings: CONFIG,
    snowCount: SNOW_COUNT,
    lampIntensity: lamp.intensity,
    fogDensity: scene.fog.density,
    fishCount: anglerCtrl.population + faunaCtrl.population,
    sharks: faunaCtrl.swimming,
    anglers: anglerCtrl.swimming,
    fps: lastFps,
    descent: Number(descent.toFixed(3)),
    scrollProgress: Number(scrollProgress.toFixed(3)),
    lampOn: on,
    lampPower: Number(power.toFixed(3)),
    lampPosition: lamp.position.toArray(),
    lampTarget: lamp.target.position.toArray(),
    bloomOn: initialBloom,
    scareCount,
    lastScared,
    activeEscapes: anglerCtrl.activeEscapes + faunaCtrl.activeEscapes,
    terrainContacts: anglerCtrl.terrainContacts + faunaCtrl.terrainContacts,
    yaw: Number(yaw.toFixed(3)),
    pitch: Number(pitch.toFixed(3)),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    terrain: terrainRoot ? {
      scale: terrainRoot.scale.x,
      top: Number(terrainTop.toFixed(3)),
      initialLift: TERRAIN_INITIAL_LIFT
    } : null
  };
}

addEventListener('pagehide', () => {
  anglerCtrl.dispose();
  snowTex.dispose();
  snowMat.dispose();
  pg.dispose();
  disposeAbyssAssets();
  renderer.dispose();
});

// Dismiss boot immediately once WebGL initializes so page is usable while GLBs stream
document.documentElement.dataset.gl = 'ok';
$('#boot')?.classList.add('done');
requestAnimationFrame(frame);
