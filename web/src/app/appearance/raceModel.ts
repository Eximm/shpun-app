export type RoadItem = { id: number; x: number; lane: number; kind: "star" | "barrier" };
export type RaceState = { elapsed: number; spawnAt: number; nextId: number; lane: number; stars: number; lives: number; items: RoadItem[]; finished: boolean };
export function newRace(): RaceState { return { elapsed: 0, spawnAt: 0, nextId: 1, lane: 1, stars: 0, lives: 3, items: [], finished: false }; }
export function steerRace(state: RaceState, direction: number): RaceState {
  return { ...state, lane: Math.max(0, Math.min(2, state.lane + direction)) };
}
export function advanceRace(state: RaceState, delta: number, random: () => number = Math.random): RaceState {
  if (state.finished) return state;
  const dt = Math.max(0, Math.min(delta, .1));
  const next = { ...state, elapsed: state.elapsed + dt, items: state.items.map((item) => ({ ...item, x: item.x - dt * 32 })) };
  if (next.elapsed >= next.spawnAt) {
    next.items.push({ id: next.nextId++, x: 108, lane: Math.min(2, Math.floor(random() * 3)), kind: random() < .72 ? "star" : "barrier" });
    next.spawnAt = next.elapsed + .95;
  }
  next.items = next.items.filter((item) => {
    if (item.x <= 28 && item.x >= 14 && item.lane === next.lane) {
      if (item.kind === "star") next.stars++; else next.lives--;
      return false;
    }
    return item.x > -5;
  });
  next.finished = next.elapsed >= 30 || next.lives <= 0;
  return next;
}
