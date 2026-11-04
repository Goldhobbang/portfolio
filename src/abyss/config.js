import { deriveSettings } from './tuning.js';

// One source of truth: the editable constants in abyss.html.
// The standalone studio reads the same block without executing the page.
let element = document.getElementById('abyss-config');
if (!element) {
  const response = await fetch(new URL('../../abyss.html', import.meta.url));
  if (!response.ok) throw new Error(`Abyss settings: HTTP ${response.status}`);
  element = new DOMParser().parseFromString(await response.text(), 'text/html').getElementById('abyss-config');
}
if (!element) throw new Error('abyss.html에 abyss-config 설정 블록이 없습니다.');
const settings = deriveSettings(JSON.parse(element.textContent));

function freeze(value) {
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') freeze(entry);
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('설정에는 유한한 숫자만 사용할 수 있습니다.');
  }
  return Object.freeze(value);
}

for (const key of ['sharks', 'anglers', 'bearings']) {
  const count = settings.population[key];
  if (!Number.isInteger(count) || count < 0 || (key === 'bearings' && count < 1)) {
    throw new Error(`population.${key}: ${key === 'bearings' ? '1 이상의' : '0 이상의'} 정수를 입력하세요.`);
  }
}
if (!Number.isInteger(settings.scene.snowCount) || settings.scene.snowCount < 0) {
  throw new Error('scene.snowCount: 0 이상의 정수를 입력하세요.');
}
if (settings.scene.pixelRatioLimit <= 0 || settings.scene.particleHeight <= 0 || settings.scene.particleSpan <= 0) {
  throw new Error('화질 배율과 입자 공간의 크기는 0보다 커야 합니다.');
}

export const CONFIG = freeze(settings);
