export type Snowfall = "off" | "light" | "steady" | "flurry";
export const SNOWFALL = { off: { count: 0, rate: 0 }, light: { count: 26, rate: .055 }, steady: { count: 65, rate: .16 }, flurry: { count: 125, rate: .38 } };
export type SnowBank = { heights: number[]; seed: number };
export function createBank(seed = .5): SnowBank { return { heights: Array(48).fill(0), seed }; }
export function bankCeiling(bank: SnowBank, i: number, maximum = 17) {
  const x = i / (bank.heights.length - 1);
  return maximum * Math.pow(Math.sin(x * Math.PI), .45) * (.3 + .7 * Math.pow(.5 + .5 * Math.sin(x * 12 + bank.seed * 8), 2));
}
export function growBank(bank: SnowBank, seconds: number, intensity: Snowfall) {
  const dt = Math.max(0, Math.min(seconds, .1));
  const rate = SNOWFALL[intensity].rate;
  for (let i = 0; i < bank.heights.length; i++) {
    const x = i / (bank.heights.length - 1);
    const edge = Math.pow(Math.sin(x * Math.PI), .45);
    const shape = .25 + 1.5 * Math.pow(Math.max(0, Math.sin(x * 9 + bank.seed * 8)), 2) + .4 * Math.pow(Math.max(0, Math.cos(x * 21 + bank.seed * 5)), 3);
    bank.heights[i] = Math.min(bankCeiling(bank, i), bank.heights[i] + dt * rate * shape * edge);
  }
}
export function depositFlake(bank: SnowBank, x: number, amount = .35) {
  if (!Number.isFinite(x) || x < 0 || x > 1) return;
  const center = x * (bank.heights.length - 1);
  for (let i = 1; i < bank.heights.length - 1; i++) {
    const weight = Math.max(0, 1 - Math.abs(i - center) / 3);
    bank.heights[i] = Math.min(bankCeiling(bank, i), bank.heights[i] + weight * amount);
  }
}
export function brushBank(bank: SnowBank, x: number, radius = .14): number {
  let removed = 0;
  for (let i = 0; i < bank.heights.length; i++) {
    const weight = Math.max(0, 1 - Math.abs(i / (bank.heights.length - 1) - x) / radius);
    const take = bank.heights[i] * weight;
    bank.heights[i] -= take; removed += take;
  }
  return removed;
}
export function bankPath(bank: SnowBank, width: number): string {
  const n = bank.heights.length;
  let path = "M 0 22";
  for (let i = 1; i < n; i++) {
    const x = i / (n - 1) * width, y = 22 - bank.heights[i];
    const beforeX = (i - 1) / (n - 1) * width, beforeY = 22 - bank.heights[i - 1];
    path += ` Q ${beforeX.toFixed(1)} ${beforeY.toFixed(2)} ${((beforeX + x) / 2).toFixed(1)} ${((beforeY + y) / 2).toFixed(2)}`;
  }
  return path + ` T ${width} 22 L ${width} 23 Q ${width / 2} 24 0 23 Z`;
}
export const SNOWMAN_COSTS = [15, 25, 35] as const;
