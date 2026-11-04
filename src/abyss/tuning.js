// Advanced HTML values are the baseline at intensity=1.
// Sublinear density/turning and restrained amplitude keep faster swimming
// readable instead of increasing every setting by the same factor.
export function deriveSettings(base) {
  const settings = structuredClone(base);
  const intensity = settings.intensity ?? 1;
  if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0.25 || intensity > 3) {
    throw new Error('intensity는 0.25~3 사이 숫자로 설정하세요. 1이 현재 기본 강도입니다.');
  }
  settings.intensity = intensity;
  const scale = (group, keys, factor) => {
    for (const key of keys) settings[group][key] *= factor;
  };
  const density = intensity ** 0.45;
  const depthDensity = Math.sqrt(Math.max(1, settings.scene.maxDepth / 34));
  settings.population.sharks = Math.round(base.population.sharks * density * depthDensity);
  settings.population.anglers = base.population.anglers;
  scale('motion', ['sharkCruiseSpeed', 'anglerSwimSpeed'], intensity ** 0.8);
  scale('motion', ['sharkEscapeBoost', 'anglerEscapeSpeed'], intensity ** 1.1);
  scale('motion', ['sharkTurnSpeed', 'sharkEscapeTurnSpeed'], intensity ** 0.4);
  scale('motion', ['sharkVerticalMotion', 'sharkVerticalWeave'], intensity ** 0.3);
  scale('motion', ['sharkBurstDelay', 'sharkEscapeDuration'], intensity ** -0.1);
  scale('motion', ['sharkBurstDecay', 'sharkEscapeResponseDecay', 'anglerEscapeDecay'], intensity ** 0.1);
  settings.motion.sharkPitchLimit = Math.min(0.48, base.motion.sharkPitchLimit * intensity ** 0.15);
  settings.motion.sharkBankLimit = Math.min(0.45, base.motion.sharkBankLimit * intensity ** 0.15);
  // Speed already drives tail beats in the swimmer; only a small extra lift is needed.
  scale('swim', ['frequencyMultiplier'], intensity ** 0.18);
  scale('swim', ['amplitudeMultiplier'], Math.min(1.15, intensity ** 0.12));
  settings.interaction.scareRadius = Math.min(0.95, base.interaction.scareRadius * intensity ** 0.2);
  scale('lighting', ['power'], intensity ** 0.12);
  settings.scene.snowCount = Math.round(base.scene.snowCount * intensity ** 0.35);
  scale('scene', ['snowSpeed'], intensity ** 0.5);
  return settings;
}
