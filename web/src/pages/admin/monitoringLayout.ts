// web/src/pages/admin/monitoringLayout.ts
//
// Pure layout model for the operator Monitoring overview. Keeps the sort
// concept intentionally small: infrastructure type -> operator order ->
// problems. No per-metric sort modes.
//
// Persistence lives here too, but every reader is defensive: a corrupted
// localStorage value must never break the UI (safe fallback).

export type SortMode = "manual" | "type" | "problems";
export type HealthTier = "critical" | "warning" | "healthy";

export const SORT_MODES: SortMode[] = ["manual", "type", "problems"];

export const TYPE_ORDER_KEY = "monitoring.typeOrder.v1";
export const NODE_ORDER_KEY = "monitoring.nodeOrder.v1";
export const NODE_SORT_KEY = "monitoring.nodeSort.v1";
export const SELECTED_NODE_KEY = "monitoring.selectedNode.v1";
export const COLLAPSED_TYPES_KEY = "monitoring.collapsedTypes.v1";

/** Default operator order: gateways first, then cabinet/infra, then VPN. */
export const DEFAULT_TYPE_ORDER = ["gateway", "infra", "vpn"];

export function isSortMode(value: unknown): value is SortMode {
  return value === "manual" || value === "type" || value === "problems";
}

/* ── Safe persistence ─────────────────────────────────────────────────────── */

export function readLayoutJson<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function writeLayoutJson(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled — layout still works in memory */
  }
}

/* ── Sanitizers (corruption-safe) ─────────────────────────────────────────── */

export function sanitizeTypeOrder(value: unknown, fallback: string[] = DEFAULT_TYPE_ORDER.slice()): string[] {
  if (!Array.isArray(value)) return fallback.slice();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const s = String(entry ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : fallback.slice();
}

export function sanitizeNodeOrder(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of list) {
      const s = String(id ?? "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      ids.push(s);
    }
    if (ids.length) out[kind] = ids;
  }
  return out;
}

export function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

export function sanitizeSelectedNode(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Drop manual entries for servers that no longer exist (stale localStorage). */
export function pruneNodeOrder(nodeOrder: Record<string, string[]>, presentIds: Iterable<string>): Record<string, string[]> {
  const present = new Set(Array.from(presentIds, (id) => String(id)));
  const next: Record<string, string[]> = {};
  for (const [kind, ids] of Object.entries(nodeOrder)) {
    const kept = ids.filter((id) => present.has(String(id)));
    if (kept.length) next[kind] = kept;
  }
  return next;
}

/* ── Type order ───────────────────────────────────────────────────────────── */

/**
 * Keep the saved order for kinds that still exist, append any new/unknown
 * kind at the end (never drop a live group), and ignore stale kinds.
 */
export function normalizeTypeOrder(saved: unknown, presentKinds: string[]): string[] {
  const present = new Set(presentKinds.map((k) => String(k)));
  const ordered = sanitizeTypeOrder(saved).filter((k) => present.has(k));
  const missing = presentKinds.map((k) => String(k)).filter((k) => !ordered.includes(k));
  return [...ordered, ...missing];
}

export function compareByTypeOrder(a: string, b: string, typeOrder: string[]): number {
  const ia = typeOrder.indexOf(a);
  const ib = typeOrder.indexOf(b);
  const ra = ia === -1 ? typeOrder.length : ia;
  const rb = ib === -1 ? typeOrder.length : ib;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

/* ── Health / problems ────────────────────────────────────────────────────── */

export function healthRank(tier: HealthTier): number {
  return tier === "critical" ? 0 : tier === "warning" ? 1 : 2;
}

/**
 * Coarse health tier for ordering only. Detailed formulas stay in the backend;
 * this is a display-side classification of the current snapshot state.
 */
export function healthTier(input: { state?: string | null; active?: number | boolean | null }): HealthTier {
  if (input.active === 0 || input.active === false) return "warning";
  if (input.state === "offline") return "critical";
  if (input.state === "stale" || input.state === "no_data") return "warning";
  return "healthy";
}

/* ── Manual node order ────────────────────────────────────────────────────── */

export type OrderableNode = { id: number; title: string; health: HealthTier };

/**
 * Deterministic order inside one type group.
 * - manual: operator order, otherwise backend order/alpha fallback.
 * - type:   alphabetical (readable grouping).
 * - problems: worst health first, then operator order.
 */
export function orderNodesWithinType<T extends OrderableNode>(
  nodes: T[],
  mode: SortMode,
  manualOrder: string[],
  locale?: string,
): T[] {
  const rank = new Map(manualOrder.map((id, i) => [String(id), i]));
  const manualRank = (node: T) => (rank.has(String(node.id)) ? rank.get(String(node.id))! : Number.MAX_SAFE_INTEGER);
  const byManual = (a: T, b: T) => manualRank(a) - manualRank(b) || a.title.localeCompare(b.title, locale);
  const byName = (a: T, b: T) => a.title.localeCompare(b.title, locale);

  if (mode === "type") return [...nodes].sort(byName);
  if (mode === "problems") {
    return [...nodes].sort((a, b) => healthRank(a.health) - healthRank(b.health) || byManual(a, b));
  }
  return [...nodes].sort(byManual);
}

/** Worst tier of a group — used to float problematic groups in "problems" mode. */
export function worstHealthTier(tiers: HealthTier[]): HealthTier {
  let worst: HealthTier = "healthy";
  for (const tier of tiers) if (healthRank(tier) < healthRank(worst)) worst = tier;
  return worst;
}

/**
 * Order type groups for the active mode. In "problems" mode impaired groups
 * float to the top while the operator type order is preserved within a tier.
 */
export function orderGroups(
  groups: { kind: string; nodes: OrderableNode[] }[],
  mode: SortMode,
  typeOrder: string[],
): { kind: string; nodes: OrderableNode[] }[] {
  const sorted = [...groups].sort((a, b) => compareByTypeOrder(a.kind, b.kind, typeOrder));
  if (mode !== "problems") return sorted;
  return sorted.sort(
    (a, b) =>
      healthRank(worstHealthTier(a.nodes.map((n) => n.health))) -
      healthRank(worstHealthTier(b.nodes.map((n) => n.health))),
  );
}

/* ── Reordering helpers (buttons + drag share these) ──────────────────────── */

export type ReorderAction = "up" | "down" | "start" | "end";

export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice();
  const next = list.slice();
  const clamped = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

export function reorderById(list: string[], id: string, action: ReorderAction): string[] {
  if (!list.includes(id)) return reorderById([...list, id], id, action);
  const from = list.indexOf(id);
  const to = action === "up" ? from - 1 : action === "down" ? from + 1 : action === "start" ? 0 : list.length - 1;
  return moveInList(list, from, to);
}

/**
 * Reorder one node inside its own type. `visibleIds` is the full set of ids
 * currently in the group so an unseen node can never be lost.
 */
export function reorderWithinType(
  nodeOrder: Record<string, string[]>,
  kind: string,
  visibleIds: string[],
  id: string,
  action: ReorderAction,
): Record<string, string[]> {
  const current = nodeOrder[kind] ?? [];
  const merged = [...current.filter((x) => visibleIds.includes(x)), ...visibleIds.filter((x) => !current.includes(x))];
  return { ...nodeOrder, [kind]: reorderById(merged, id, action) };
}

/** Same-type guard for drag & drop: a node's backend type never changes in UI. */
export function canReorderAcrossKinds(sourceKind: string, targetKind: string): boolean {
  return String(sourceKind) === String(targetKind);
}

/**
 * Place a dragged node before a drop target inside one type.
 * Returns the unchanged map when the move is illegal.
 */
export function dropWithinType(
  nodeOrder: Record<string, string[]>,
  sourceKind: string,
  targetKind: string,
  visibleIds: string[],
  sourceId: string,
  targetId: string,
): Record<string, string[]> {
  if (!canReorderAcrossKinds(sourceKind, targetKind) || sourceId === targetId) return nodeOrder;
  const current = nodeOrder[sourceKind] ?? [];
  const merged = [...current.filter((x) => visibleIds.includes(x)), ...visibleIds.filter((x) => !current.includes(x))];
  const without = merged.filter((x) => x !== sourceId);
  const at = without.indexOf(targetId);
  const next = at === -1 ? [...without, sourceId] : [...without.slice(0, at), sourceId, ...without.slice(at)];
  return { ...nodeOrder, [sourceKind]: next };
}
