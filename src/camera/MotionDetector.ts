export type MotionResult = { changedAreaPercent: number; motion: boolean };

export function changedAreaPercent(previous: Uint8Array, current: Uint8Array, threshold = 18) {
  if (previous.length !== current.length || previous.length === 0) return 0;
  let changed = 0;
  for (let index = 0; index < previous.length; index += 1) {
    if (Math.abs(previous[index] - current[index]) >= threshold) changed += 1;
  }
  return (changed / previous.length) * 100;
}

export function detectMotion(previous: Uint8Array, current: Uint8Array, sensitivity: number): MotionResult {
  const changed = changedAreaPercent(previous, current);
  return { changedAreaPercent: changed, motion: changed >= sensitivity };
}
