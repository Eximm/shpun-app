import voice from "./voice.json" with { type: "json" };

/** Stable for the same persisted turn: retries never change the wording. */
export function chooseSupportVoice(group: keyof typeof voice.groups, ticketId: number, messageId: number, turn: number): string {
  const seed = `${group}:${ticketId}:${messageId}:${turn}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const variants = voice.groups[group];
  return variants[hash % variants.length]!;
}

export function chooseScenarioVoice(scenario: string, fallback: string, ticketId: number, messageId: number, turn: number) {
  const group = `scenario_${scenario}`;
  return group in voice.groups ? chooseSupportVoice(group as keyof typeof voice.groups, ticketId, messageId, turn) : fallback;
}
