export type RssiState = { smoothed?: number; lastSeenAt?: number };

export function smoothRssi(previous: number | undefined, next: number, strength = 0.35) {
  if (previous === undefined) return next;
  const alpha = Math.min(1, Math.max(0.01, strength));
  return previous + alpha * (next - previous);
}

export function isBluetoothPresent(state: RssiState, minimumRssi: number, lostTimeoutMs: number, now: number) {
  return state.lastSeenAt !== undefined && now - state.lastSeenAt <= lostTimeoutMs && (state.smoothed ?? -Infinity) >= minimumRssi;
}
