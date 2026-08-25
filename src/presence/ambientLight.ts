export type LightSample = { at: number; lux: number };

export function expectedLight(samples: LightSample[], at: number, windowMs: number) {
  const matches = samples.filter((sample) => Math.abs(sample.at - at) <= windowMs);
  if (matches.length === 0) return undefined;
  return matches.reduce((sum, sample) => sum + sample.lux, 0) / matches.length;
}

export function isLightSpike(currentLux: number, baselineLux: number, deltaLux: number, percent: number) {
  const delta = currentLux - baselineLux;
  const relative = baselineLux <= 0 ? (currentLux > 0 ? Infinity : 0) : (delta / baselineLux) * 100;
  return delta >= deltaLux && relative >= percent;
}

export function nearBaseline(currentLux: number, baselineLux: number, tolerance: number) {
  return Math.abs(currentLux - baselineLux) <= Math.max(0, baselineLux * tolerance);
}
