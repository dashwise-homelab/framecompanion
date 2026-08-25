export type ClipMetadata = { id: string; createdAt: number; endedAt?: number; trigger: string; size?: number; path: string };

export function retentionCutoff(now: number, value: number, unit: 'hours' | 'days') {
  const durationMs = value * (unit === 'days' ? 24 : 1) * 60 * 60 * 1_000;
  return now - durationMs;
}

export function isExpired(createdAt: number, now: number, value: number, unit: 'hours' | 'days') {
  return createdAt < retentionCutoff(now, value, unit);
}
