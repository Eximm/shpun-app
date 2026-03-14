export type PreviewEventLike = {
  type?: string;
  message?: string | null;
};

function normalizeType(t: any) {
  return String(t ?? "").trim().toLowerCase();
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
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

function normalizeNewsText(text: string | null | undefined) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[•●▪◦]/g, "•")
    .replace(/^\s*[-–—*•]\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
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
  const cleaned = normalizeNewsText(message);
  if (!cleaned) return "";

  const sentences = splitSentences(cleaned);

  if (sentences.length >= 2) {
    return smartTrim(`${sentences[0]} ${sentences[1]}`.trim(), limit);
  }

  return smartTrim(cleaned, limit);
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

export function buildHomeNewsPreview(e: PreviewEventLike) {
  return isNewsEvent(e)
    ? buildNewsPreviewText(e.message, 96)
    : buildGenericPreviewText(e.message, 96);
}

export function buildFeedPreview(e: PreviewEventLike) {
  return isNewsEvent(e)
    ? buildNewsPreviewText(e.message, 165)
    : buildGenericPreviewText(e.message, 140);
}

export function shouldShowFeedMore(e: PreviewEventLike, preview: string) {
  if (isNewsEvent(e)) return true;
  const full = cleanInlineText(e.message);
  return full.length > preview.length;
}