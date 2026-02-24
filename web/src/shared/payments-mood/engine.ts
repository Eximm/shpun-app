import { paymentsMoodDict } from "./dict.ru";

export type PaymentsMoodCtx = keyof typeof paymentsMoodDict;

type AmountTier = "tiny" | "small" | "mid" | "big" | "huge";

function tier(amount?: number): AmountTier {
  if (amount == null) return "small";
  if (amount < 100) return "tiny";
  if (amount < 500) return "small";
  if (amount < 2000) return "mid";
  if (amount < 10000) return "big";
  return "huge";
}

// детерминированный выбор (чтобы при одном и том же orderId фраза не “прыгала”)
function pick(list: readonly string[], seed?: string) {
  if (!list.length) return null;
  if (!seed) return list[Math.floor(Math.random() * list.length)] ?? null;

  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[Math.abs(h) % list.length] ?? null;
}

export function getMood(ctx: PaymentsMoodCtx, opts: { amount?: number; seed?: string } = {}) {
  const entry = paymentsMoodDict[ctx];

  if ("any" in entry) return pick(entry.any, opts.seed);

  // success/topup по tier
  const t = tier(opts.amount);
  // @ts-expect-error: entry is tiered dictionary
  return pick(entry[t] ?? [], opts.seed);
}