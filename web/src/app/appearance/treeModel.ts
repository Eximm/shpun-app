export type Ornament = { id: number; x: number; y: number; color: number; kind?: string };
export function restoreTree(raw: string): Ornament[] {
  try {
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    const ids = new Set<number>();
    return saved.filter((item) => {
      if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id) || !Number.isFinite(item.x) || !Number.isFinite(item.y)
        || item.x < 10 || item.x > 90 || item.y < 15 || item.y > 88 || ![0, 65, 180, 280].includes(item.color)) return false;
      ids.add(item.id); return true;
    }).slice(0, 24).map(({ id, x, y, color, kind }) => ({ id, x, y, color,
      ...(["bauble", "bell", "ribbon", "snowflake", "star", "candy", "gift", "snowman"].includes(kind) ? { kind } : {}) }));
  } catch { return []; }
}
