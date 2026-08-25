export function vibrationPresent(level: number, baseline: number, tolerance: number) {
  return level > baseline + tolerance;
}

export function vibrationEnergy(acceleration: Array<{ x: number; y: number; z: number }>) {
  if (acceleration.length === 0) return 0;
  const magnitudes = acceleration.map((sample) => Math.hypot(sample.x, sample.y, sample.z));
  const mean = magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
  return Math.sqrt(magnitudes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / magnitudes.length);
}
