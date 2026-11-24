export type Snowfall = "off" | "light" | "steady" | "flurry";
export const SNOWFALL = { off: { count: 0, rate: 0, speed: 0, drift: 0 }, light: { count: 44, rate: .055, speed: .7, drift: .6 }, steady: { count: 100, rate: .16, speed: 1, drift: 1 }, flurry: { count: 190, rate: .38, speed: 1.5, drift: 2.2 } };
export function snowfallCount(intensity: Snowfall, width: number, height: number) {
  return Math.min(240, Math.round(SNOWFALL[intensity].count * Math.max(.65, Math.min(1.25, width / 900)) * Math.max(.85, Math.min(1.3, height / 900))));
}
export type SnowBank = { heights: number[]; seed: number };
export function createBank(seed = .5): SnowBank { return { heights: Array(48).fill(0), seed }; }
export function createDustedBank(seed = .5): SnowBank {
  const bank = createBank(seed);
  bank.heights = bank.heights.map((_, i) => bankCeiling(bank, i) * .09);
  return bank;
}
export function snowOpacity(bank: SnowBank): number {
  return Math.min(1, Math.max(0, Math.max(...bank.heights) / 3));
}
export function restoreBanks(raw: string | null): Map<string, SnowBank> {
  const banks = new Map<string, SnowBank>();
  try {
    const saved = JSON.parse(raw || "null");
    if (saved?.version !== 1 || !Array.isArray(saved.banks)) return banks;
    for (const entry of saved.banks.slice(-64)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry;
      if (typeof key !== "string" || !key.startsWith("/") || key.length > 200 || !value || !Number.isFinite(value.seed)
        || value.seed < 0 || value.seed > 1 || !Array.isArray(value.heights) || value.heights.length !== 48
        || !value.heights.every((h: unknown) => typeof h === "number" && Number.isFinite(h) && h >= 0 && h <= 17)) continue;
      banks.set(key, { seed: value.seed, heights: value.heights.slice() });
    }
  } catch { /* stale/corrupt cosmetic data is optional */ }
  return banks;
}
export function serializeBanks(banks: Map<string, SnowBank>): string {
  return JSON.stringify({ version: 1, banks: [...banks].slice(-64).map(([key, bank]) => [key,
    { seed: bank.seed, heights: bank.heights.map((height) => Math.round(height * 1000) / 1000) }]) });
}
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
  // Close on the tile edge itself. An empty bank has zero painted area;
  // it must never leave a constant white underline across the whole card.
  return path + ` T ${width} 22 L 0 22 Z`;
}
export const SNOWMAN_COSTS = [15, 25, 35] as const;
