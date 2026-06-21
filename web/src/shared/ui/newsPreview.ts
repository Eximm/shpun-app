export type PreviewEventLike = {
  type?: string;
  message?: string | null;
};

function normalizeType(t: any) {
  return String(t ?? "").trim().toLowerCase();
}

function smartTrim(text: string, limit: number) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= limit) return s;

  const cut = s.slice(0, limit + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > Math.floor(limit * 0.65) ? cut.slice(0, lastSpace) : cut.slice(0, limit);

  return safe.trim().replace(/[.,;:!?-]+$/g, "").trim() + "…";
}

function normalizeNewsFirstLine(text: string | null | undefined) {
  const line = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .find(Boolean) || "";

  return line
    .replace(/^\s*[-*>\u2022\u25cf\u25aa\u25e6\u2013\u2014]\s*/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanInlineText(text: string | null | undefined) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildNewsPreviewText(message: string | null | undefined, limit: number) {
  const cleaned = normalizeNewsFirstLine(message);
  if (!cleaned) return "";
  return smartTrim(cleaned, limit);
}

function buildForecastPreviewText(message: string | null | undefined) {
  const cleaned = cleanInlineText(message);
  if (!cleaned) return "";
  return smartTrim(cleaned, 120);
}

function buildGenericPreviewText(message: string | null | undefined, limit: number) {
  const cleaned = cleanInlineText(message);
  if (!cleaned) return "";
  return smartTrim(cleaned, limit);
}

export function isNewsEvent(e: PreviewEventLike) {
  const t = normalizeType(e.type);
  return t === "broadcast.news" || t.startsWith("broadcast.news.") || t.startsWith("broadcast.");
}

export function isForecastEvent(e: PreviewEventLike) {
  const t = normalizeType(e.type);
  return t === "service.forecast";
}

export function buildHomeNewsPreview(e: PreviewEventLike) {
  return isNewsEvent(e)
    ? buildNewsPreviewText(e.message, 96)
    : buildGenericPreviewText(e.message, 96);
}

export function buildFeedPreview(e: PreviewEventLike) {
  if (isNewsEvent(e)) return buildNewsPreviewText(e.message, 165);
  if (isForecastEvent(e)) return buildForecastPreviewText(e.message);
  return buildGenericPreviewText(e.message, 140);
}

export function shouldShowFeedMore(e: PreviewEventLike, preview: string) {
  if (isNewsEvent(e) || isForecastEvent(e)) return true;
  const full = cleanInlineText(e.message);
  return full.length > preview.length;
}
