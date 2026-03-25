export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatDateTime(tsSec?: number | null) {
  if (!tsSec || !Number.isFinite(tsSec)) return "—";
  const d = new Date(tsSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`;
}

export function truncateText(text: string | null | undefined, limit: number) {
  const source = String(text || "").trim();
  if (!source) return "";
  if (source.length <= limit) return source;
  return source.slice(0, limit).trimEnd() + "…";
}

export function shortDeviceToken(token?: string | null) {
  const s = String(token || "").trim();
  if (!s) return "—";
  if (s.length <= 18) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

export function parseMetaJson(metaJson?: string | null): Record<string, any> | null {
  const raw = String(metaJson || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function copyText(text: string) {
  if (!text) return;
  void navigator.clipboard?.writeText(text);
}