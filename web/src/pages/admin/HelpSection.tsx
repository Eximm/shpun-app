// web/src/pages/admin/HelpSection.tsx
//
// Admin -> База знаний. CMS-style editor with autosave, dirty-state indicator,
// live preview (same renderer as the public page), leave-page guard and local
// draft recovery.
//
// Reliability rule: a failed media upload only changes that block's upload
// state. It never touches the form or the other blocks, so Save/autosave can
// never shrink the article.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, ADMIN_SECTION_ICON, ModalShell } from "./shared";
import { ActionMenu } from "./ActionMenu";
import { HelpArticleRenderer, resolvePreviewBlocks } from "../../shared/help/HelpArticleRenderer";
import { setHelpEditorDirty } from "./helpEditorGuard";
import {
  buildArticlePayload,
  canSavePayload,
  clearLocalDraft,
  editorSnapshot,
  isDraftNewerThanServer,
  isEditorDirty,
  loadLocalDraft,
  normalizeUploadError,
  saveLocalDraft,
  shouldAutosave,
  validateFileSize,
  type HelpEditorBlock,
  type HelpEditorForm,
  type HelpEditorStatus,
} from "./helpEditorModel";

type HelpCategory = { id: number; slug: string; title: string; description: string | null; icon: string | null; sortOrder: number; isActive: boolean };
type HelpArticleRow = { id: number; slug: string; title: string; summary: string; categoryId: number | null; categoryTitle: string | null; status: HelpEditorStatus; isFeatured: boolean; updatedAt: string; blocksCount?: number };
type HelpBlock = HelpEditorBlock & { id?: number };
type HelpMedia = { id: number; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; url: string; usedBy: number };

type View = "list" | "editor" | "categories" | "media";
type SaveState = "saved" | "dirty" | "saving" | "error";
type BlockUpload = { status: "uploading" } | { status: "error"; text: string; lastFile?: File | null };

const AUTOSAVE_MS = 4000;
const DRAFT_MS = 800;

function emptyForm(): HelpEditorForm {
  return { title: "", slug: "", summary: "", categoryId: "", status: "draft", isFeatured: false, searchKeywords: "" };
}

function blockDefaults(type: string): HelpBlock {
  switch (type) {
    case "heading": return { type, payload: { text: "" } };
    case "bullet_list":
    case "numbered_list":
    case "steps": return { type, payload: { items: [""] } };
    case "callout": return { type, payload: { tone: "info", text: "" } };
    case "image": return { type, payload: { mediaId: 0, alt: "", caption: "" } };
    case "video": return { type, payload: { mediaId: 0, caption: "" } };
    case "button": return { type, payload: { label: "", url: "" } };
    case "faq": return { type, payload: { items: [{ q: "", a: "" }] } };
    case "divider": return { type, payload: {} };
    default: return { type, payload: { text: "" } };
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseSqliteDate(v: string): Date | null {
  if (!v) return null;
  const iso = v.includes("T") ? v : v.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function HelpSection() {
  const { t, formatDate } = useI18n();
  const [view, setView] = useState<View>("list");
  const [categories, setCategories] = useState<HelpCategory[]>([]);
  const [media, setMedia] = useState<HelpMedia[]>([]);
  const [articles, setArticles] = useState<HelpArticleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | HelpEditorStatus>("all");

  // Editor state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<HelpEditorForm>(emptyForm);
  const [blocks, setBlocks] = useState<HelpBlock[]>([blockDefaults("paragraph")]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [uploadState, setUploadState] = useState<Record<number, BlockUpload>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blockMenu, setBlockMenu] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<{ form: HelpEditorForm; blocks: HelpBlock[] } | null>(null);

  const saveSeqRef = useRef(0);
  const savingRef = useRef(false);

  const snapshot = editorSnapshot(form, blocks);
  const dirty = view === "editor" && isEditorDirty(snapshot, savedSnapshot);

  async function loadList() {
    setLoading(true);
    try {
      const [cats, arts] = await Promise.all([
        apiFetch<{ ok: true; items: HelpCategory[] }>("/admin/help/categories", { method: "GET" }),
        apiFetch<{ ok: true; items: HelpArticleRow[] }>("/admin/help/articles", { method: "GET" }),
      ]);
      setCategories(cats.items ?? []);
      setArticles(arts.items ?? []);
    } catch { setMessage(t("admin.help.err.load")); }
    finally { setLoading(false); }
  }

  async function loadMedia() {
    try {
      const res = await apiFetch<{ ok: true; items: HelpMedia[] }>("/admin/help/media", { method: "GET" });
      setMedia(res.items ?? []);
    } catch { /* ignore */ }
  }

  useEffect(() => { void loadList(); void loadMedia(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      return `${a.title} ${a.slug} ${a.categoryTitle ?? ""}`.toLowerCase().includes(q);
    });
  }, [articles, query, statusFilter]);

  function enterEditor(next: { id: number | null; form: HelpEditorForm; blocks: HelpBlock[] }) {
    setEditingId(next.id);
    setForm(next.form);
    setBlocks(next.blocks);
    setSavedSnapshot(editorSnapshot(next.form, next.blocks));
    setSaveState("saved");
    setSaveError("");
    setUploadState({});
    setAdvancedOpen(false);
    setMessage("");
    setHydrated(true);
    setView("editor");
  }

  function openCreate() {
    const draft = loadLocalDraft(null);
    enterEditor({ id: null, form: emptyForm(), blocks: [blockDefaults("paragraph")] });
    if (draft) setDraftPrompt({ form: draft.form, blocks: draft.blocks });
  }

  async function openEdit(id: number) {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: true; article: any; blocks: HelpBlock[] }>(`/admin/help/articles/${id}`, { method: "GET" });
      const serverForm: HelpEditorForm = {
        title: res.article.title,
        slug: res.article.slug,
        summary: res.article.summary ?? "",
        categoryId: res.article.categoryId == null ? "" : String(res.article.categoryId),
        status: res.article.status,
        isFeatured: Boolean(res.article.isFeatured),
        searchKeywords: res.article.searchKeywords ?? "",
      };
      const serverBlocks = (res.blocks ?? []).map((b) => ({ id: b.id, type: b.type, payload: b.payload ?? {} }));
      enterEditor({ id, form: serverForm, blocks: serverBlocks });

      const draft = loadLocalDraft(id);
      if (draft && isDraftNewerThanServer(draft.ts, res.article.updatedAt)) {
        setDraftPrompt({ form: draft.form, blocks: draft.blocks });
      }
    } catch { setMessage(t("admin.help.err.load")); setHydrated(false); }
    finally { setLoading(false); }
  }

  /** Core save. Always snapshots the WHOLE editor state (title/summary/blocks). */
  async function persist(statusOverride?: HelpEditorStatus, opts?: { silent?: boolean }): Promise<boolean> {
    if (!hydrated) return false;
    const payload = buildArticlePayload(form, blocks, statusOverride);
    if (!canSavePayload(payload)) {
      setSaveState("error");
      setSaveError(t("admin.help.err.save"));
      return false;
    }
    const seq = ++saveSeqRef.current;
    savingRef.current = true;
    setSaveState("saving");
    setSaveError("");
    const snapshotAtSave = editorSnapshot(form, blocks);

    try {
      let articleId = editingId;
      if (articleId) {
        await apiFetch(`/admin/help/articles/${articleId}`, { method: "PUT", body: payload });
      } else {
        const res = await apiFetch<{ ok: true; article: { id: number } }>("/admin/help/articles", { method: "POST", body: payload });
        articleId = res.article.id;
      }
      // A newer save started while this one was in flight: keep its state.
      if (seq !== saveSeqRef.current) return true;

      setEditingId(articleId);
      setSavedSnapshot(snapshotAtSave);
      clearLocalDraft(articleId);
      clearLocalDraft(null);
      setSaveState("saved");
      if (!opts?.silent) {
        await loadList();
        setMessage(t("admin.help.msg.saved"));
        setView("list");
      }
      return true;
    } catch (e: any) {
      if (seq !== saveSeqRef.current) return false;
      setSaveState("error");
      setSaveError(e?.message || t("admin.help.err.save"));
      if (!opts?.silent) setMessage(e?.message || t("admin.help.err.save"));
      return false;
    } finally {
      if (seq === saveSeqRef.current) savingRef.current = false;
    }
  }

  // Autosave: existing articles only, 4s after the last edit, never changes status.
  useEffect(() => {
    if (view !== "editor") return;
    if (!shouldAutosave({ dirty, saving: saveState === "saving", articleId: editingId, title: form.title })) return;
    const timer = window.setTimeout(() => { void persist(undefined, { silent: true }); }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, view, editingId, saveState]);

  // Local draft fallback (browser/WebView crash before autosave completes).
  useEffect(() => {
    if (view !== "editor" || !dirty) return;
    const timer = window.setTimeout(() => saveLocalDraft(editingId, form, blocks), DRAFT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, view, editingId, dirty]);

  // Leave-page protection (tab close / reload).
  useEffect(() => {
    if (view !== "editor" || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [view, dirty]);

  // Expose dirty state to the admin shell so switching sections warns too.
  useEffect(() => {
    setHelpEditorDirty(view === "editor" && dirty);
    return () => setHelpEditorDirty(false);
  }, [view, dirty]);

  function requestClose() {
    if (view === "editor" && dirty && saveState !== "saving") {
      if (!window.confirm(t("admin.help.unsaved_confirm"))) return;
    }
    setHydrated(false);
    setView("list");
  }

  async function removeArticle(id: number) {
    if (!window.confirm(t("admin.help.confirm.delete"))) return;
    await apiFetch(`/admin/help/articles/${id}`, { method: "DELETE" });
    await loadList();
  }

  async function setStatus(article: HelpArticleRow, status: HelpEditorStatus) {
    await apiFetch(`/admin/help/articles/${article.id}`, { method: "PUT", body: { title: article.title, slug: article.slug, status } });
    await loadList();
  }

  /* ── Blocks ─────────────────────────────────────────────────────────────── */

  function updateBlock(index: number, payload: Record<string, any>) {
    setBlocks((cur) => cur.map((b, i) => (i === index ? { ...b, payload } : b)));
  }
  function moveBlock(index: number, dir: -1 | 1) {
    setBlocks((cur) => {
      const next = [...cur];
      const target = index + dir;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function duplicateBlock(index: number) {
    setBlocks((cur) => {
      const next = [...cur];
      next.splice(index + 1, 0, { type: cur[index].type, payload: { ...cur[index].payload } });
      return next;
    });
  }
  function removeBlock(index: number) {
    setBlocks((cur) => cur.filter((_, i) => i !== index));
    setUploadState((cur) => {
      const next: Record<number, BlockUpload> = {};
      for (const [k, v] of Object.entries(cur)) {
        const i = Number(k);
        if (i !== index) next[i > index ? i - 1 : i] = v;
      }
      return next;
    });
  }
  function addBlock(type: string) {
    setBlocks((cur) => [...cur, blockDefaults(type)]);
  }

  function uploadErrorText(kind: "image" | "video", info: { code: string; maxMb: number }): string {
    if (info.code === "upload_too_large") {
      return kind === "video"
        ? t("admin.help.upload.too_large_video", { max: info.maxMb })
        : t("admin.help.upload.too_large_image", { max: info.maxMb });
    }
    if (info.code === "video_too_large") return t("admin.help.upload.too_large_video", { max: info.maxMb });
    if (info.code === "image_too_large") return t("admin.help.upload.too_large_image", { max: info.maxMb });
    return t("admin.help.upload.failed");
  }

  /**
   * Upload a file and attach it to a single block. Never mutates the form or
   * other blocks; `blockIndex < 0` means the media library view.
   */
  async function uploadMedia(file: File, blockIndex: number, kind: "image" | "video") {
    const sizeErr = validateFileSize(file.size, kind);
    if (sizeErr) {
      const text = uploadErrorText(kind, sizeErr);
      if (blockIndex < 0) setMessage(text);
      else setUploadState((s) => ({ ...s, [blockIndex]: { status: "error", text, lastFile: file } }));
      return;
    }
    if (blockIndex >= 0) setUploadState((s) => ({ ...s, [blockIndex]: { status: "uploading" } }));
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const res = await apiFetch<{ ok: true; item: HelpMedia }>("/admin/help/media", { method: "POST", body: fd });
      await loadMedia();
      setBlocks((cur) => cur.map((b, i) => (i === blockIndex
        ? { ...b, type: res.item.kind === "video" ? "video" : "image", payload: { ...b.payload, mediaId: res.item.id } }
        : b)));
      if (blockIndex >= 0) {
        setUploadState((s) => { const next = { ...s }; delete next[blockIndex]; return next; });
      } else {
        setMessage("");
      }
    } catch (e: any) {
      const info = normalizeUploadError(Number(e?.status ?? 0), kind);
      const text = uploadErrorText(kind, info);
      if (blockIndex < 0) setMessage(text);
      else setUploadState((s) => ({ ...s, [blockIndex]: { status: "error", text, lastFile: file } }));
    }
  }

  async function deleteMedia(id: number) {
    if (!window.confirm(t("admin.help.media.confirm_delete"))) return;
    try {
      await apiFetch(`/admin/help/media/${id}`, { method: "DELETE" });
      await loadMedia();
    } catch (e: any) {
      setMessage(e?.message === "media_in_use" ? t("admin.help.media.in_use") : t("admin.help.err.save"));
    }
  }

  /* ── Categories ─────────────────────────────────────────────────────────── */

  const [catForm, setCatForm] = useState({ id: 0, title: "", icon: "", description: "" });
  async function saveCategory() {
    setMessage("");
    const body = { title: catForm.title, icon: catForm.icon, description: catForm.description };
    try {
      if (catForm.id) await apiFetch(`/admin/help/categories/${catForm.id}`, { method: "PUT", body });
      else await apiFetch("/admin/help/categories", { method: "POST", body });
      setCatForm({ id: 0, title: "", icon: "", description: "" });
      await loadList();
    } catch { setMessage(t("admin.help.err.save")); }
  }
  async function removeCategory(id: number) {
    if (!window.confirm(t("admin.help.cat.confirm_delete"))) return;
    await apiFetch(`/admin/help/categories/${id}`, { method: "DELETE" });
    await loadList();
  }

  const dateLabel = (v: string) => { const d = parseSqliteDate(v); return d ? formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"; };

  const previewBlocks = useMemo(() => resolvePreviewBlocks(blocks, media), [blocks, media]);
  const previewCategory = useMemo(
    () => categories.find((c) => String(c.id) === form.categoryId) ?? null,
    [categories, form.categoryId],
  );

  const saveLabel = saveState === "saving"
    ? t("admin.help.save.saving")
    : saveState === "error"
      ? t("admin.help.save.error")
      : dirty
        ? t("admin.help.save.dirty")
        : t("admin.help.save.saved");

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <div className="card"><div className="card__body">
      <AdminSectionHeader
        icon={ADMIN_SECTION_ICON.help}
        kicker={t("admin.tab.help")}
        title={t("admin.help.title")}
        subtitle={t("admin.help.subtitle")}
        actions={
          view === "list" ? (
            <>
              <button className="btn btn--primary" type="button" onClick={openCreate}>{t("admin.help.action.new")}</button>
              <button className="btn btn--soft" type="button" onClick={() => { setView("categories"); setCatForm({ id: 0, title: "", icon: "", description: "" }); }}>{t("admin.help.action.categories")}</button>
              <button className="btn btn--soft" type="button" onClick={() => setView("media")}>{t("admin.help.action.media")}</button>
            </>
          ) : (
            <button className="btn btn--soft" type="button" onClick={requestClose}>{t("admin.help.action.back")}</button>
          )
        }
      />
      {message ? <div className="refPartnerNotice">{message}</div> : null}

      {view === "list" ? (
        <>
          <div className="refToolbar admin-gap-top-md">
            <input className="input refToolbar__search" type="search" value={query} placeholder={t("admin.help.search_ph")} aria-label={t("admin.help.search_ph")} onChange={(e) => setQuery(e.target.value)} />
            <div className="refToolbar__group" role="group">
              {(["all", "published", "draft", "hidden"] as const).map((s) => (
                <button key={s} type="button" className={`chip ${statusFilter === s ? "chip--ok" : "chip--soft"}`} aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {t(`admin.help.status.${s}`)}
                </button>
              ))}
            </div>
          </div>
          {loading ? <p className="p admin-gap-top-md">{t("common.loading")}</p> : null}
          {!loading && visible.length === 0 ? <p className="p admin-gap-top-md">{t("admin.help.empty")}</p> : null}
          <div className="admin-help-list admin-gap-top-md">
            {visible.map((a) => (
              <article className="admin-help-row" key={a.id}>
                <div className="admin-help-row__main">
                  <div className="admin-help-row__title">{a.title}</div>
                  <div className="admin-help-row__meta">
                    {a.categoryTitle ? <span className="chip chip--soft">{a.categoryTitle}</span> : null}
                    <span className={`chip ${a.status === "published" ? "chip--ok" : "chip--soft"}`}>{t(`admin.help.status.${a.status}`)}</span>
                    {a.isFeatured ? <span className="chip chip--ok">{t("admin.help.featured")}</span> : null}
                    <span>{t("admin.help.updated", { date: dateLabel(a.updatedAt) })}</span>
                  </div>
                </div>
                <div className="admin-help-row__actions">
                  <button className="btn btn--soft" type="button" onClick={() => void openEdit(a.id)}>{t("common.edit")}</button>
                  <button className="btn btn--soft" type="button" onClick={() => void setStatus(a, a.status === "published" ? "draft" : "published")}>
                    {a.status === "published" ? t("admin.help.action.unpublish") : t("admin.help.action.publish")}
                  </button>
                  <button className="btn refPartnerCard__delete" type="button" onClick={() => void removeArticle(a.id)}>{t("common.delete")}</button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {view === "categories" ? (
        <div className="admin-help-categories admin-gap-top-md">
          <div className="grid2">
            <label className="field"><span className="field__label">{t("admin.help.cat.title")}</span><input className="input" value={catForm.title} onChange={(e) => setCatForm({ ...catForm, title: e.target.value })} /></label>
            <label className="field"><span className="field__label">{t("admin.help.cat.icon")}</span><input className="input" value={catForm.icon} placeholder="🍎" onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} /></label>
          </div>
          <label className="field admin-gap-top-md"><span className="field__label">{t("admin.help.cat.description")}</span><input className="input" value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} /></label>
          <div className="row admin-gap-top-md">
            <button className="btn btn--primary" type="button" onClick={() => void saveCategory()}>{catForm.id ? t("common.save") : t("admin.help.cat.add")}</button>
            {catForm.id ? <button className="btn btn--soft" type="button" onClick={() => setCatForm({ id: 0, title: "", icon: "", description: "" })}>{t("common.cancel")}</button> : null}
          </div>
          <div className="admin-help-list admin-gap-top-md">
            {categories.map((c) => (
              <div className="admin-help-row" key={c.id}>
                <div className="admin-help-row__main"><div className="admin-help-row__title">{c.icon} {c.title}</div><div className="admin-help-row__meta"><span className="chip chip--soft">/{c.slug}</span></div></div>
                <div className="admin-help-row__actions">
                  <button className="btn btn--soft" type="button" onClick={() => setCatForm({ id: c.id, title: c.title, icon: c.icon ?? "", description: c.description ?? "" })}>{t("common.edit")}</button>
                  <button className="btn refPartnerCard__delete" type="button" onClick={() => void removeCategory(c.id)}>{t("common.delete")}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "media" ? (
        <div className="admin-gap-top-md">
          <div className="row">
            <label className="btn btn--primary">
              {t("admin.help.media.upload")}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { void uploadMedia(f, -1, f.type.startsWith("video/") ? "video" : "image"); e.target.value = ""; } }} />
            </label>
          </div>
          <div className="admin-help-mediaGrid admin-gap-top-md">
            {media.map((m) => (
              <div className="admin-help-media" key={m.id}>
                <div className="admin-help-media__preview">
                  {m.kind === "video"
                    ? <video src={m.url} controls playsInline preload="metadata" />
                    : <img src={m.url} alt={m.originalName} loading="lazy" />}
                </div>
                <div className="admin-help-media__name">{m.originalName}</div>
                <div className="admin-help-media__meta">{m.kind} · {fmtSize(m.sizeBytes)} · {m.usedBy > 0 ? t("admin.help.media.used", { n: m.usedBy }) : t("admin.help.media.unused")}</div>
                <button className="btn refPartnerCard__delete" type="button" disabled={m.usedBy > 0} onClick={() => void deleteMedia(m.id)}>{t("common.delete")}</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "editor" ? (
        <div className="helpEditor admin-gap-top-md">
          <div className="helpEditor__statusRow">
            <span className={`helpEditor__status helpEditor__status--${saveState}${dirty && saveState !== "saving" && saveState !== "error" ? " is-dirty" : ""}`}>
              {saveLabel}
            </span>
            {saveState === "error" ? (
              <button className="btn btn--soft helpEditor__retry" type="button" onClick={() => void persist()}>{t("admin.help.upload.retry")}</button>
            ) : null}
          </div>
          {saveError ? <p className="p helpEditor__saveError">{saveError}</p> : null}

          <div className="helpEditor__basics admin-gap-top-md">
            <label className="field"><span className="field__label">{t("admin.help.field.title")}</span><input className="input helpEditor__title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <div className="grid2 admin-gap-top-md">
              <label className="field"><span className="field__label">{t("admin.help.field.category")}</span>
                <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">{t("admin.help.field.no_category")}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <label className="field"><span className="field__label">{t("admin.help.field.status")}</span>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HelpEditorStatus })}>
                  {(["draft", "published", "hidden"] as const).map((s) => <option key={s} value={s}>{t(`admin.help.status.${s}`)}</option>)}
                </select>
              </label>
            </div>
            <label className="field admin-gap-top-md"><span className="field__label">{t("admin.help.field.summary")}</span><input className="input" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
          </div>

          <details className="helpEditor__advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t("admin.help.advanced")}</summary>
            <div className="grid2 admin-gap-top-md">
              <label className="field"><span className="field__label">{t("admin.help.field.slug")}</span><input className="input" value={form.slug} placeholder={t("admin.help.field.slug_ph")} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
              <label className="field"><span className="field__label">{t("admin.help.field.keywords")}</span><input className="input" value={form.searchKeywords} onChange={(e) => setForm({ ...form, searchKeywords: e.target.value })} /></label>
            </div>
            <label className="checkRow admin-gap-top-md"><input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /><span>{t("admin.help.field.featured")}</span></label>
          </details>

          <h3 className="h2 admin-gap-top-lg">{t("admin.help.content")}</h3>

          <div className="helpEditor__toolbar" role="toolbar" aria-label={t("admin.help.content")}>
            <button className="btn btn--soft" type="button" onClick={() => addBlock("paragraph")}>+ {t("admin.help.block.paragraph")}</button>
            <button className="btn btn--soft" type="button" onClick={() => addBlock("heading")}>+ {t("admin.help.block.heading")}</button>
            <button className="btn btn--soft" type="button" onClick={() => addBlock("image")}>+ {t("admin.help.block.image")}</button>
            <button className="btn btn--soft" type="button" onClick={() => addBlock("video")}>+ {t("admin.help.block.video")}</button>
            <button className="btn btn--soft" type="button" onClick={() => addBlock("callout")}>+ {t("admin.help.callout.warning")}</button>
            <button className="btn btn--soft helpEditor__moreBtn" type="button" aria-haspopup="menu" aria-label={t("admin.help.block.more")} onClick={(e) => setMoreAnchor(e.currentTarget)}>{"\u22EE"}</button>
          </div>

          <div className="helpEditor__blocks">
            {blocks.map((block, index) => (
              <div className="helpBlock" key={index}>
                <button className="helpBlock__menuBtn" type="button" aria-haspopup="menu" aria-label={t("admin.help.block.menu")} onClick={(e) => setBlockMenu({ index, anchor: e.currentTarget })}>{"\u22EE"}</button>
                <BlockBody
                  block={block}
                  media={media}
                  t={t}
                  upload={uploadState[index]}
                  onChange={(payload) => updateBlock(index, payload)}
                  onUpload={(file, kind) => void uploadMedia(file, index, kind)}
                />
              </div>
            ))}
          </div>

          <div className="helpEditor__footer">
            <button className="btn btn--primary" type="button" disabled={!hydrated || form.title.trim() === ""} onClick={() => void persist()}>{t("common.save")}</button>
            <button className="btn btn--soft" type="button" disabled={!hydrated || form.title.trim() === "" || saveState === "saving"} onClick={async () => { const ok = await persist("published"); if (ok) setView("list"); }}>{t("admin.help.action.publish")}</button>
            <button className="btn btn--soft" type="button" onClick={() => setPreviewOpen(true)}>{t("admin.help.preview")}</button>
            <button className="btn btn--soft" type="button" onClick={requestClose}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}

      <ActionMenu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)} items={[
        { label: t("admin.help.block.bullet_list"), onClick: () => addBlock("bullet_list") },
        { label: t("admin.help.block.numbered_list"), onClick: () => addBlock("numbered_list") },
        { label: t("admin.help.block.steps"), onClick: () => addBlock("steps") },
        { label: t("admin.help.block.faq"), onClick: () => addBlock("faq") },
        { label: t("admin.help.block.button"), onClick: () => addBlock("button") },
        { label: t("admin.help.block.divider"), onClick: () => addBlock("divider") },
      ]} />

      <ActionMenu anchorEl={blockMenu?.anchor ?? null} open={Boolean(blockMenu)} onClose={() => setBlockMenu(null)} items={blockMenu ? [
        { label: t("admin.help.block.move_up"), onClick: () => moveBlock(blockMenu.index, -1) },
        { label: t("admin.help.block.move_down"), onClick: () => moveBlock(blockMenu.index, 1) },
        { label: t("admin.help.block.duplicate"), onClick: () => duplicateBlock(blockMenu.index) },
        { label: t("common.delete"), danger: true, onClick: () => removeBlock(blockMenu.index) },
      ] : []} />

      {previewOpen ? (
        <ModalShell
          title={t("admin.help.preview")}
          kicker={form.status === "published" ? t("admin.help.status.published") : t("admin.help.status.draft")}
          onClose={() => setPreviewOpen(false)}
        >
          <div className="helpEditor__preview">
            <HelpArticleRenderer
              article={{
                title: form.title || t("admin.help.preview.untitled"),
                summary: form.summary,
                updatedAt: new Date().toISOString(),
                category: previewCategory,
              }}
              blocks={previewBlocks}
              showMissingMedia
            />
          </div>
        </ModalShell>
      ) : null}

      {draftPrompt ? (
        <ModalShell title={t("admin.help.draft.found")} onClose={() => setDraftPrompt(null)}>
          <p className="p">{t("admin.help.draft.found_desc")}</p>
          <div className="actions actions--2 admin-gap-top-md">
            <button className="btn btn--primary" type="button" onClick={() => {
              setForm(draftPrompt.form);
              setBlocks(draftPrompt.blocks);
              setDraftPrompt(null);
            }}>{t("admin.help.draft.restore")}</button>
            <button className="btn btn--soft" type="button" onClick={() => { clearLocalDraft(editingId); setDraftPrompt(null); }}>{t("admin.help.draft.ignore")}</button>
          </div>
        </ModalShell>
      ) : null}
    </div></div>
  );
}

/* ── Block bodies (render like real content) ──────────────────────────────── */

function BlockBody({
  block, media, t, upload, onChange, onUpload,
}: {
  block: HelpBlock;
  media: HelpMedia[];
  t: any;
  upload?: BlockUpload;
  onChange: (payload: Record<string, any>) => void;
  onUpload: (file: File, kind: "image" | "video") => void;
}) {
  const p = block.payload || {};

  if (block.type === "divider") return <hr className="helpEditor__divider" />;

  if (block.type === "paragraph") {
    return (
      <textarea
        className="input helpEditor__textarea"
        rows={3}
        value={String(p.text ?? "")}
        placeholder={t("admin.help.block.paragraph_ph")}
        onChange={(e) => onChange({ ...p, text: e.target.value })}
      />
    );
  }

  if (block.type === "heading") {
    return (
      <input
        className="input helpEditor__headingInput"
        value={String(p.text ?? "")}
        placeholder={t("admin.help.block.heading")}
        onChange={(e) => onChange({ ...p, text: e.target.value })}
      />
    );
  }

  if (block.type === "callout") {
    const tone = String(p.tone ?? "info");
    return (
      <div className={`helpEditor__callout helpEditor__callout--${tone}`}>
        <select className="input helpEditor__calloutTone" value={tone} onChange={(e) => onChange({ ...p, tone: e.target.value })} aria-label={t("admin.help.block.callout")}>
          {(["info", "warning", "success"] as const).map((v) => <option key={v} value={v}>{t(`admin.help.callout.${v}`)}</option>)}
        </select>
        <textarea className="input helpEditor__textarea" rows={2} value={String(p.text ?? "")} placeholder={t("admin.help.block.callout_ph")} onChange={(e) => onChange({ ...p, text: e.target.value })} />
      </div>
    );
  }

  if (["bullet_list", "numbered_list", "steps"].includes(block.type)) {
    const items: string[] = Array.isArray(p.items) ? p.items : [];
    const isSteps = block.type === "steps";
    return (
      <div className="helpEditor__items">
        {items.map((it, i) => (
          <div className="helpEditor__item" key={i}>
            <span className="helpEditor__itemMark" aria-hidden="true">{isSteps ? i + 1 : (block.type === "numbered_list" ? i + 1 : "•")}</span>
            <input className="input" value={it} placeholder={isSteps ? t("admin.help.block.step_ph") : t("admin.help.block.item_ph")} onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange({ ...p, items: next }); }} />
            <button className="helpEditor__itemRemove" type="button" aria-label={t("common.delete")} onClick={() => onChange({ ...p, items: items.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn btn--soft" type="button" onClick={() => onChange({ ...p, items: [...items, ""] })}>{t("admin.help.block.add_item")}</button>
      </div>
    );
  }

  if (block.type === "button") {
    return (
      <div className="helpEditor__stack">
        <input className="input" value={String(p.label ?? "")} onChange={(e) => onChange({ ...p, label: e.target.value })} placeholder={t("admin.help.block.label")} />
        <input className="input" value={String(p.url ?? "")} onChange={(e) => onChange({ ...p, url: e.target.value })} placeholder={t("admin.help.block.url_ph")} />
      </div>
    );
  }

  if (block.type === "faq") {
    const items: Array<{ q: string; a: string }> = Array.isArray(p.items) ? p.items : [];
    return (
      <div className="helpEditor__items">
        {items.map((it, i) => (
          <div className="helpEditor__faqRow" key={i}>
            <input className="input" value={it.q} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], q: e.target.value }; onChange({ ...p, items: next }); }} placeholder={t("admin.help.block.q")} />
            <input className="input" value={it.a} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], a: e.target.value }; onChange({ ...p, items: next }); }} placeholder={t("admin.help.block.a")} />
            <button className="helpEditor__itemRemove" type="button" aria-label={t("common.delete")} onClick={() => onChange({ ...p, items: items.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn btn--soft" type="button" onClick={() => onChange({ ...p, items: [...items, { q: "", a: "" }] })}>{t("admin.help.block.add_item")}</button>
      </div>
    );
  }

  if (block.type === "image" || block.type === "video") {
    return <MediaBlock block={block} media={media} t={t} upload={upload} onChange={onChange} onUpload={onUpload} />;
  }

  return null;
}

function MediaBlock({
  block, media, t, upload, onChange, onUpload,
}: {
  block: HelpBlock;
  media: HelpMedia[];
  t: any;
  upload?: BlockUpload;
  onChange: (payload: Record<string, any>) => void;
  onUpload: (file: File, kind: "image" | "video") => void;
}) {
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const p = block.payload || {};
  const isVideo = block.type === "video";
  const kind: "image" | "video" = isVideo ? "video" : "image";
  const options = media.filter((m) => m.kind === (isVideo ? "video" : "image"));
  const selected = options.find((m) => m.id === Number(p.mediaId));
  const uploading = upload?.status === "uploading";

  return (
    <div className="helpEditor__media">
      {selected ? (
        <>
          <div className="helpEditor__mediaHead">{isVideo ? "🎬" : "🖼"} {t(isVideo ? "admin.help.block.video" : "admin.help.block.image")}</div>
          <div className="helpEditor__mediaPreview">
            {isVideo ? <video src={selected.url} controls playsInline preload="metadata" /> : <img src={selected.url} alt={String(p.alt ?? "")} />}
          </div>
          <input className="input" value={String(p.caption ?? "")} onChange={(e) => onChange({ ...p, caption: e.target.value })} placeholder={t("admin.help.block.caption")} />
          {!isVideo ? <input className="input" value={String(p.alt ?? "")} onChange={(e) => onChange({ ...p, alt: e.target.value })} placeholder={t("admin.help.block.alt")} /> : null}
          <div className="helpEditor__mediaActions">
            <button className="btn btn--soft" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>{t("admin.help.media.replace")}</button>
            <button className="btn btn--soft" type="button" onClick={() => setPicking((v) => !v)}>{t("admin.help.media.choose")}</button>
          </div>
        </>
      ) : (
        <div className="helpEditor__mediaEmpty">
          <span className="helpEditor__mediaHead">{isVideo ? "🎬" : "🖼"} {t(isVideo ? "admin.help.block.video" : "admin.help.block.image")}</span>
          <div className="helpEditor__mediaActions">
            <button className="btn btn--primary" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>{t("admin.help.media.upload")}</button>
            {options.length > 0 ? <button className="btn btn--soft" type="button" onClick={() => setPicking(true)}>{t("admin.help.media.choose")}</button> : null}
          </div>
        </div>
      )}

      {uploading ? <div className="helpEditor__uploadInfo">{t("admin.help.upload.uploading")}</div> : null}
      {upload?.status === "error" ? (
        <div className="helpEditor__uploadError">
          <span>{upload.text}</span>
          <button className="btn btn--soft" type="button" onClick={() => { const f = upload?.lastFile; if (f) onUpload(f, kind); else inputRef.current?.click(); }}>{t("admin.help.upload.retry")}</button>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        hidden
        accept={isVideo ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp,image/gif"}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUpload(f, kind); e.target.value = ""; } }}
      />

      {picking && options.length > 0 ? (
        <select className="input helpEditor__mediaSelect" value={String(p.mediaId ?? 0)} onChange={(e) => { onChange({ ...p, mediaId: Number(e.target.value) }); setPicking(false); }} aria-label={t("admin.help.media.choose")}>
          <option value="0">{t("admin.help.media.pick")}</option>
          {options.map((m) => <option key={m.id} value={m.id}>{m.originalName}</option>)}
        </select>
      ) : null}
    </div>
  );
}

export default HelpSection;
