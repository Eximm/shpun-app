// web/src/pages/admin/helpEditorModel.ts
//
// Pure (React-free) editor logic: article payload assembly, upload validation,
// dirty detection and local draft persistence. Kept separate so the data-loss
// and autosave rules are unit-testable without a DOM.

export type HelpEditorStatus = "draft" | "published" | "hidden";

export type HelpEditorForm = {
  title: string;
  slug: string;
  summary: string;
  categoryId: string;
  status: HelpEditorStatus;
  isFeatured: boolean;
  searchKeywords: string;
};

export type HelpEditorBlock = {
  type: string;
  payload: Record<string, unknown>;
};

export type HelpArticlePayload = {
  title: string;
  slug: string;
  summary: string;
  categoryId: number | null;
  status: HelpEditorStatus;
  isFeatured: boolean;
  searchKeywords: string;
  blocks: Array<{ type: string; payload: Record<string, unknown> }>;
};

/**
 * Build a COMPLETE article payload from the whole editor state. Media upload
 * failures must never be able to shrink this: `blocks` is always the full
 * current list (an empty image/video block is kept as an unfinished draft).
 */
export function buildArticlePayload(
  form: HelpEditorForm,
  blocks: HelpEditorBlock[],
  statusOverride?: HelpEditorStatus,
): HelpArticlePayload {
  return {
    title: String(form.title ?? ""),
    slug: String(form.slug ?? ""),
    summary: String(form.summary ?? ""),
    categoryId: form.categoryId === "" || form.categoryId == null ? null : Number(form.categoryId),
    status: statusOverride ?? form.status,
    isFeatured: Boolean(form.isFeatured),
    searchKeywords: String(form.searchKeywords ?? ""),
    blocks: (Array.isArray(blocks) ? blocks : []).map((block) => ({
      type: String(block.type),
      payload: { ...(block.payload ?? {}) },
    })),
  };
}

/** Guard against sending a partially hydrated payload to the API. */
export function canSavePayload(payload: HelpArticlePayload): boolean {
  return typeof payload.title === "string" && payload.title.trim().length > 0 && Array.isArray(payload.blocks);
}

/* ── Upload size + error normalization ───────────────────────────────────── */

export const HELP_IMAGE_MAX_MB = 10;
export const HELP_VIDEO_MAX_MB = 100;

export type UploadErrorCode = "image_too_large" | "video_too_large" | "upload_too_large" | "upload_failed";
export type UploadErrorInfo = { code: UploadErrorCode; maxMb: number };

export function validateFileSize(bytes: number, kind: "image" | "video"): UploadErrorInfo | null {
  const maxMb = kind === "video" ? HELP_VIDEO_MAX_MB : HELP_IMAGE_MAX_MB;
  if (Number.isFinite(bytes) && bytes > maxMb * 1024 * 1024) {
    return { code: kind === "video" ? "video_too_large" : "image_too_large", maxMb };
  }
  return null;
}

/**
 * Normalize an upload failure into a user-facing code. May be called with a
 * network error (status 0). Never returns raw proxy/proxy HTML.
 */
export function normalizeUploadError(status: number, kind: "image" | "video"): UploadErrorInfo {
  const maxMb = kind === "video" ? HELP_VIDEO_MAX_MB : HELP_IMAGE_MAX_MB;
  if (status === 413) return { code: "upload_too_large", maxMb };
  return { code: "upload_failed", maxMb };
}

/* ── Dirty state ─────────────────────────────────────────────────────────── */

export function editorSnapshot(form: HelpEditorForm, blocks: HelpEditorBlock[]): string {
  return JSON.stringify({ form, blocks });
}

export function isEditorDirty(snapshot: string, saved: string | null): boolean {
  return saved == null || snapshot !== saved;
}

/* ── Autosave decision ───────────────────────────────────────────────────── */

/**
 * Autosave only existing articles. A brand-new article is created by the first
 * explicit Save (safest), and is protected by the local draft meanwhile.
 */
export function shouldAutosave(input: {
  dirty: boolean;
  saving: boolean;
  articleId: number | null;
  title: string;
}): boolean {
  return Boolean(input.articleId) && input.dirty && !input.saving && input.title.trim().length > 0;
}

/* ── Local draft recovery ────────────────────────────────────────────────── */

export type HelpLocalDraft = { form: HelpEditorForm; blocks: HelpEditorBlock[]; ts: number };

export function helpDraftKey(articleId: number | null): string {
  return `help-editor-draft:${articleId ?? "new"}`;
}

export function saveLocalDraft(articleId: number | null, form: HelpEditorForm, blocks: HelpEditorBlock[]): void {
  try {
    const draft: HelpLocalDraft = { form, blocks, ts: Date.now() };
    localStorage.setItem(helpDraftKey(articleId), JSON.stringify(draft));
  } catch {
    /* storage may be unavailable — best effort */
  }
}

export function loadLocalDraft(articleId: number | null): HelpLocalDraft | null {
  try {
    const raw = localStorage.getItem(helpDraftKey(articleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HelpLocalDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.form || !Array.isArray(parsed.blocks) || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalDraft(articleId: number | null): void {
  try {
    localStorage.removeItem(helpDraftKey(articleId));
  } catch {
    /* ignore */
  }
}

/** True when a local draft was captured after the server's last update. */
export function isDraftNewerThanServer(draftTs: number, serverUpdatedAt: string | null | undefined): boolean {
  const raw = String(serverUpdatedAt ?? "").trim();
  if (!raw) return true;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const serverMs = new Date(iso).getTime();
  if (!Number.isFinite(serverMs)) return true;
  return draftTs > serverMs;
}
