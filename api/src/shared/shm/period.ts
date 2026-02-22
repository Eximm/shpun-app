// api/src/shared/shm/period.ts

export type ShmPeriodParts = {
  raw: string
  months: number
  days: number
  hours: number
  human: string // нейтрально: "1 мес 5 дн 12 ч", "7 дн", "12 ч", "—"
}

/**
 * SHM period format (из админки): M.DDHH
 * - M  = months (целая часть)
 * - DD = days   (первые 2 цифры дробной части)
 * - HH = hours  (следующие 2 цифры дробной части)
 *
 * Примеры:
 *  1        -> 1 мес
 *  0.0700   -> 7 дн
 *  0.0012   -> 12 ч
 *  1.0512   -> 1 мес 5 дн 12 ч
 */
export function parseShmPeriod(input: number | string | null | undefined): ShmPeriodParts {
  // 1) normalize to string
  let raw = input === null || input === undefined ? "" : String(input).trim()
  if (!raw) {
    return { raw: "", months: 0, days: 0, hours: 0, human: "—" }
  }

  // support comma decimal separator
  raw = raw.replace(",", ".")

  // keep only digits and dots (defensive)
  // (не режем минус — период не должен быть отрицательным)
  raw = raw.replace(/[^\d.]/g, "")

  // handle weird cases like "." or "..."
  if (!raw || raw.replace(/\./g, "") === "") {
    return { raw, months: 0, days: 0, hours: 0, human: "—" }
  }

  const parts = raw.split(".")
  const mStr = parts[0] ?? "0"
  const fracStr = (parts[1] ?? "").replace(/[^\d]/g, "") // only digits

  const months = toIntSafe(mStr)

  // дробная часть — это DDHH, дополняем справа нулями до 4
  const ddhh = (fracStr + "0000").slice(0, 4)

  let days = toIntSafe(ddhh.slice(0, 2))
  let hours = toIntSafe(ddhh.slice(2, 4))

  // Нормализация на всякий случай:
  // если вдруг прилетит 27 часов → +1 день 3 часа
  if (hours >= 24) {
    days += Math.floor(hours / 24)
    hours = hours % 24
  }

  const human = formatPeriodNeutral({ months, days, hours })
  return { raw, months, days, hours, human }
}

export function formatPeriodNeutral(p: { months: number; days: number; hours: number }): string {
  const months = clampNonNegInt(p.months)
  const days = clampNonNegInt(p.days)
  const hours = clampNonNegInt(p.hours)

  const out: string[] = []
  if (months > 0) out.push(`${months} мес`)
  if (days > 0) out.push(`${days} дн`)
  if (hours > 0) out.push(`${hours} ч`)

  return out.length ? out.join(" ") : "—"
}

function toIntSafe(s: string): number {
  const n = parseInt(String(s || "0"), 10)
  return Number.isFinite(n) ? n : 0
}

function clampNonNegInt(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}

/**
 * Быстрые примеры для самопроверки (можно удалить):
 *
 * parseShmPeriod(1).human           -> "1 мес"
 * parseShmPeriod("0.07").human      -> "7 дн"
 * parseShmPeriod("0.0012").human    -> "12 ч"
 * parseShmPeriod("1.0512").human    -> "1 мес 5 дн 12 ч"
 * parseShmPeriod("0,0700").human    -> "7 дн"
 */