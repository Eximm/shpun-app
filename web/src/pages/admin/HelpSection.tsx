// web/src/pages/admin/HelpSection.tsx
//
// Admin -> База знаний. Manage help categories, block-based articles and media
// without touching React code or redeploying.

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/api/client";
import { useI18n } from "../../shared/i18n";
import { AdminSectionHeader, ADMIN_SECTION_ICON } from "./shared";

type HelpCategory = { id: number; slug: string; title: string; description: string | null; icon: string | null; sortOrder: number; isActive: boolean };
type HelpArticleStatus = "draft" | "published" | "hidden";
type HelpArticleRow = { id: number; slug: string; title: string; summary: string; categoryId: number | null; categoryTitle: string | null; status: HelpArticleStatus; isFeatured: boolean; updatedAt: string; blocksCount?: number };
type HelpBlock = { id?: number; type: string; payload: Record<string, any> };
type HelpMedia = { id: number; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; url: string; usedBy: number };

type View = "list" | "editor" | "categories" | "media";

const BLOCK_TYPES = ["paragraph", "heading", "bullet_list", "numbered_list", "steps", "callout", "image", "video", "button", "faq", "divider"] as const;

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
  const [statusFilter, setStatusFilter] = useState<"all" | HelpArticleStatus>("all");

  // Editor state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", slug: "", summary: "", categoryId: "" as string, status: "draft" as HelpArticleStatus, isFeatured: false, searchKeywords: "" });
  const [blocks, setBlocks] = useState<HelpBlock[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function openCreate() {
    setEditingId(null);
    setForm({ title: "", slug: "", summary: "", categoryId: "", status: "draft", isFeatured: false, searchKeywords: "" });
    setBlocks([blockDefaults("paragraph")]);
    setMessage("");
    setView("editor");
  }

  async function openEdit(id: number) {
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: true; article: any; blocks: HelpBlock[] }>(`/admin/help/articles/${id}`, { method: "GET" });
      setEditingId(id);
      setForm({
        title: res.article.title,
        slug: res.article.slug,
        summary: res.article.summary ?? "",
        categoryId: res.article.categoryId == null ? "" : String(res.article.categoryId),
        status: res.article.status,
        isFeatured: Boolean(res.article.isFeatured),
        searchKeywords: res.article.searchKeywords ?? "",
      });
      setBlocks((res.blocks ?? []).map((b) => ({ type: b.type, payload: b.payload ?? {} })));
      setMessage("");
      setView("editor");
    } catch { setMessage(t("admin.help.err.load")); }
    finally { setLoading(false); }
  }

  async function saveArticle() {
    setMessage("");
    const body = {
      title: form.title,
      slug: form.slug,
      summary: form.summary,
      categoryId: form.categoryId === "" ? null : Number(form.categoryId),
      status: form.status,
      isFeatured: form.isFeatured,
      searchKeywords: form.searchKeywords,
      blocks: blocks.map((b) => ({ type: b.type, payload: b.payload })),
    };
    try {
      if (editingId) await apiFetch(`/admin/help/articles/${editingId}`, { method: "PUT", body });
      else await apiFetch("/admin/help/articles", { method: "POST", body });
      await loadList();
      setMessage(t("admin.help.msg.saved"));
      setView("list");
    } catch (e: any) {
      setMessage(e?.message || t("admin.help.err.save"));
    }
  }

  async function removeArticle(id: number) {
    if (!window.confirm(t("admin.help.confirm.delete"))) return;
    await apiFetch(`/admin/help/articles/${id}`, { method: "DELETE" });
    await loadList();
  }

  async function setStatus(article: HelpArticleRow, status: HelpArticleStatus) {
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
  function removeBlock(index: number) {
    setBlocks((cur) => cur.filter((_, i) => i !== index));
  }
  function addBlock(type: string) {
    setBlocks((cur) => [...cur, blockDefaults(type)]);
  }

  async function uploadMedia(file: File, blockIndex: number) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    setMessage("");
    try {
      const res = await apiFetch<{ ok: true; item: HelpMedia }>("/admin/help/media", { method: "POST", body: fd });
      await loadMedia();
      const kind = res.item.kind;
      setBlocks((cur) => cur.map((b, i) => (i === blockIndex ? { ...b, type: kind === "video" ? "video" : "image", payload: { ...b.payload, mediaId: res.item.id } } : b)));
    } catch (e: any) {
      setMessage(e?.message || t("admin.help.err.upload"));
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
            <button className="btn btn--soft" type="button" onClick={() => setView("list")}>{t("admin.help.action.back")}</button>
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
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { void uploadMedia(f, -1); e.target.value = ""; } }} />
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
        <div className="admin-help-editor admin-gap-top-md">
          <div className="grid2">
            <label className="field"><span className="field__label">{t("admin.help.field.title")}</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field"><span className="field__label">{t("admin.help.field.slug")}</span><input className="input" value={form.slug} placeholder={t("admin.help.field.slug_ph")} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
            <label className="field"><span className="field__label">{t("admin.help.field.category")}</span>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t("admin.help.field.no_category")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="field"><span className="field__label">{t("admin.help.field.status")}</span>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HelpArticleStatus })}>
                {(["draft", "published", "hidden"] as const).map((s) => <option key={s} value={s}>{t(`admin.help.status.${s}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="field admin-gap-top-md"><span className="field__label">{t("admin.help.field.summary")}</span><input className="input" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
          <label className="field admin-gap-top-md"><span className="field__label">{t("admin.help.field.keywords")}</span><input className="input" value={form.searchKeywords} onChange={(e) => setForm({ ...form, searchKeywords: e.target.value })} /></label>
          <label className="checkRow admin-gap-top-md"><input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /><span>{t("admin.help.field.featured")}</span></label>

          <h3 className="h2 admin-gap-top-lg">{t("admin.help.content")}</h3>
          <div className="admin-help-blocks">
            {blocks.map((block, index) => (
              <div className="admin-help-block" key={index}>
                <div className="admin-help-block__head">
                  <span className="chip chip--soft">{t(`admin.help.block.${block.type}`)}</span>
                  <div className="admin-help-block__btns">
                    <button className="btn btn--soft" type="button" onClick={() => moveBlock(index, -1)} aria-label={t("admin.help.block.up")}>↑</button>
                    <button className="btn btn--soft" type="button" onClick={() => moveBlock(index, 1)} aria-label={t("admin.help.block.down")}>↓</button>
                    <button className="btn refPartnerCard__delete" type="button" onClick={() => removeBlock(index)}>{t("common.delete")}</button>
                  </div>
                </div>
                <HelpBlockFields
                  block={block}
                  media={media}
                  t={t}
                  onChange={(payload) => updateBlock(index, payload)}
                  onUpload={(file) => void uploadMedia(file, index)}
                />
              </div>
            ))}
          </div>
          <div className="admin-help-addBlock admin-gap-top-md">
            <select className="input" defaultValue="" onChange={(e) => { if (e.target.value) { addBlock(e.target.value); e.target.value = ""; } }}>
              <option value="">{t("admin.help.block.add")}</option>
              {BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{t(`admin.help.block.${bt}`)}</option>)}
            </select>
          </div>

          <div className="row admin-gap-top-lg">
            <button className="btn btn--primary" type="button" onClick={() => void saveArticle()}>{t("common.save")}</button>
            <button className="btn btn--soft" type="button" onClick={() => setView("list")}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}
    </div></div>
  );
}

/* ── Block fields ─────────────────────────────────────────────────────────── */

function HelpBlockFields({
  block, media, t, onChange, onUpload,
}: {
  block: HelpBlock;
  media: HelpMedia[];
  t: any;
  onChange: (payload: Record<string, any>) => void;
  onUpload: (file: File) => void;
}) {
  const p = block.payload || {};
  const inputRef = useRef<HTMLInputElement | null>(null);
  const kind = block.type === "video" ? "video" : "image";
  const options = media.filter((m) => m.kind === kind);

  if (block.type === "divider") return <div className="admin-help-divider">—</div>;
  if (["paragraph", "heading", "callout"].includes(block.type)) {
    return (
      <div className="admin-help-field">
        {block.type === "callout" ? (
          <select className="input" value={String(p.tone ?? "info")} onChange={(e) => onChange({ ...p, tone: e.target.value })}>
            {["info", "warning", "success"].map((tone) => <option key={tone} value={tone}>{t(`admin.help.callout.${tone}`)}</option>)}
          </select>
        ) : null}
        <input className="input" value={String(p.text ?? "")} onChange={(e) => onChange({ ...p, text: e.target.value })} placeholder={t("admin.help.block.text")} />
      </div>
    );
  }
  if (["bullet_list", "numbered_list", "steps"].includes(block.type)) {
    const items: string[] = Array.isArray(p.items) ? p.items : [];
    return (
      <div className="admin-help-field">
        {items.map((it, i) => (
          <div className="admin-help-inline" key={i}>
            <input className="input" value={it} onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange({ ...p, items: next }); }} />
            <button className="btn refPartnerCard__delete" type="button" onClick={() => onChange({ ...p, items: items.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn btn--soft" type="button" onClick={() => onChange({ ...p, items: [...items, ""] })}>{t("admin.help.block.add_item")}</button>
      </div>
    );
  }
  if (block.type === "button") {
    return (
      <div className="admin-help-field">
        <input className="input" value={String(p.label ?? "")} onChange={(e) => onChange({ ...p, label: e.target.value })} placeholder={t("admin.help.block.label")} />
        <input className="input" value={String(p.url ?? "")} onChange={(e) => onChange({ ...p, url: e.target.value })} placeholder={t("admin.help.block.url_ph")} />
      </div>
    );
  }
  if (block.type === "faq") {
    const items: Array<{ q: string; a: string }> = Array.isArray(p.items) ? p.items : [];
    return (
      <div className="admin-help-field">
        {items.map((it, i) => (
          <div className="admin-help-inline" key={i}>
            <input className="input" value={it.q} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], q: e.target.value }; onChange({ ...p, items: next }); }} placeholder={t("admin.help.block.q")} />
            <input className="input" value={it.a} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], a: e.target.value }; onChange({ ...p, items: next }); }} placeholder={t("admin.help.block.a")} />
            <button className="btn refPartnerCard__delete" type="button" onClick={() => onChange({ ...p, items: items.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="btn btn--soft" type="button" onClick={() => onChange({ ...p, items: [...items, { q: "", a: "" }] })}>{t("admin.help.block.add_item")}</button>
      </div>
    );
  }
  if (kind === "image" || kind === "video") {
    const selected = options.find((m) => m.id === Number(p.mediaId));
    return (
      <div className="admin-help-field">
        <select className="input" value={String(p.mediaId ?? 0)} onChange={(e) => onChange({ ...p, mediaId: Number(e.target.value) })}>
          <option value="0">{t("admin.help.media.pick")}</option>
          {options.map((m) => <option key={m.id} value={m.id}>{m.originalName} ({fmtSize(m.sizeBytes)})</option>)}
        </select>
        <button className="btn btn--soft" type="button" onClick={() => inputRef.current?.click()}>{t("admin.help.media.upload_new")}</button>
        <input ref={inputRef} type="file" hidden accept={kind === "video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp,image/gif"} onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUpload(f); e.target.value = ""; } }} />
        {block.type === "image" ? <input className="input" value={String(p.alt ?? "")} onChange={(e) => onChange({ ...p, alt: e.target.value })} placeholder={t("admin.help.block.alt")} /> : null}
        <input className="input" value={String(p.caption ?? "")} onChange={(e) => onChange({ ...p, caption: e.target.value })} placeholder={t("admin.help.block.caption")} />
        {selected ? <div className="admin-help-mediaHint">{selected.kind} · {selected.originalName}</div> : null}
      </div>
    );
  }
  return null;
}

export default HelpSection;
