export type ClapAction = 'single_clap' | 'double_clap' | 'triple_clap';

export function classifyClaps(times: number[], windowMs = 900): ClapAction | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const grouped = sorted.filter((time, index) => index === 0 || time - sorted[index - 1] <= windowMs);
  if (grouped.length < 1 || grouped.length > 3 || sorted[sorted.length - 1] - sorted[0] > windowMs) return null;
  return grouped.length === 1 ? 'single_clap' : grouped.length === 2 ? 'double_clap' : 'triple_clap';
}
