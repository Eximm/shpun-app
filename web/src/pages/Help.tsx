// web/src/pages/Help.tsx
//
// Public Help Center / knowledge base. Data comes entirely from the API, so new
// instructions can be added from Admin without a redeploy.
//
// Routes:
//   /help              -> home (search + featured + categories)
//   /help/c/:slug      -> category
//   /help/a/:slug      -> article
//   /help/search?q=    -> search results

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "../shared/i18n";
import { apiFetch } from "../shared/api/client";
import { PageBackButton } from "../shared/ui/PageBackButton";
import { createPortal } from "react-dom";

type HelpCategory = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
};

type HelpArticleSummary = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  categoryTitle: string | null;
  categorySlug: string | null;
  isFeatured: boolean;
  updatedAt: string;
};

type HelpMediaRef = { id: number; kind: string; mimeType: string; width: number | null; height: number | null; url: string };

type HelpBlock = {
  id: number;
  type: string;
  sortOrder: number;
  payload: Record<string, any>;
  media: HelpMediaRef | null;
};

type HelpArticleDetail = {
  article: HelpArticleSummary;
  category: HelpCategory | null;
  blocks: HelpBlock[];
};

function formatDate(value: string, formatDate: (v: Date | number | string, o?: Intl.DateTimeFormatOptions) => string): string {
  const iso = value ? (value.includes("T") ? value : value.replace(" ", "T") + "Z") : "";
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

function ArticleCard({ article, t, formatDateFn }: { article: HelpArticleSummary; t: any; formatDateFn: any }) {
  return (
    <Link className="help-articleCard" to={`/help/a/${article.slug}`}>
      <span className="help-articleCard__title">{article.title}</span>
      {article.summary ? <span className="help-articleCard__summary">{article.summary}</span> : null}
      <span className="help-articleCard__meta">
        {article.categoryTitle ? <span className="chip chip--soft">{article.categoryTitle}</span> : null}
        <span>{t("help.updated", { date: formatDate(article.updatedAt, formatDateFn) })}</span>
      </span>
    </Link>
  );
}

function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal help-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img className="help-lightbox__img" src={url} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

function HelpBlockView({ block, onImage }: { block: HelpBlock; onImage: (url: string, alt: string) => void }) {
  const p = block.payload || {};
  switch (block.type) {
    case "heading":
      return <h3 className="help-h3">{String(p.text ?? "")}</h3>;
    case "paragraph":
      return <p className="help-p">{String(p.text ?? "")}</p>;
    case "bullet_list":
      return <ul className="help-list">{(p.items ?? []).map((it: string, i: number) => <li key={i}>{it}</li>)}</ul>;
    case "numbered_list":
      return <ol className="help-list help-list--ordered">{(p.items ?? []).map((it: string, i: number) => <li key={i}>{it}</li>)}</ol>;
    case "steps":
      return (
        <ol className="help-steps">
          {(p.items ?? []).map((it: string, i: number) => (
            <li className="help-step" key={i}>
              <span className="help-step__num">{i + 1}</span>
              <span className="help-step__text">{it}</span>
            </li>
          ))}
        </ol>
      );
    case "callout":
      return <div className={`help-callout help-callout--${p.tone === "warning" ? "warning" : p.tone === "success" ? "success" : "info"}`}>{String(p.text ?? "")}</div>;
    case "divider":
      return <hr className="help-divider" />;
    case "button":
      return (
        <div className="help-buttonRow">
          <a className="btn btn--primary" href={String(p.url ?? "#")} target="_blank" rel="noopener noreferrer">{String(p.label ?? "")}</a>
        </div>
      );
    case "faq":
      return (
        <div className="help-faq">
          {(p.items ?? []).map((item: any, i: number) => (
            <div className="help-faq__item" key={i}>
              <div className="help-faq__q">{item.q}</div>
              <div className="help-faq__a">{item.a}</div>
            </div>
          ))}
        </div>
      );
    case "image":
      return block.media ? (
        <figure className="help-media">
          <button type="button" className="help-media__btn" onClick={() => onImage(block.media!.url, String(p.alt ?? ""))}>
            <img src={block.media.url} alt={String(p.alt ?? "")} loading="lazy" />
          </button>
          {p.caption ? <figcaption className="help-media__caption">{String(p.caption)}</figcaption> : null}
        </figure>
      ) : null;
    case "video":
      return block.media ? (
        <figure className="help-media">
          <video
            className="help-video"
            src={block.media.url}
            controls
            playsInline
            preload="metadata"
            poster={String(p.posterUrl ?? "") || undefined}
          />
          {p.caption ? <figcaption className="help-media__caption">{String(p.caption)}</figcaption> : null}
        </figure>
      ) : null;
    default:
      return null;
  }
}

export function HelpArticleView() {
  const { t, formatDate: formatDateFn } = useI18n();
  const { articleSlug = "" } = useParams();
  const slug = articleSlug;
  const [data, setData] = useState<HelpArticleDetail | null>(null);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    apiFetch<{ ok: true } & HelpArticleDetail>(`/help/articles/${encodeURIComponent(slug)}`, { method: "GET" })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="section help-page">
      <div className="pageBackRow"><PageBackButton to="/help" /></div>
      {error ? <p className="p">{t("help.error")}</p> : null}
      {!data && !error ? <p className="p">{t("common.loading")}</p> : null}
      {data ? (
        <>
          <header className="card help-hero"><div className="card__body">
            {data.category ? <Link className="help-hero__eyebrow" to={`/help/c/${data.category.slug}`}>{data.category.icon} {data.category.title}</Link> : null}
            <h1 className="h1">{data.article.title}</h1>
            {data.article.summary ? <p className="p help-hero__summary">{data.article.summary}</p> : null}
            <div className="help-meta">{t("help.updated", { date: formatDate(data.article.updatedAt, formatDateFn) })}</div>
          </div></header>
          <article className="card help-article"><div className="card__body">
            {data.blocks.map((block) => (
              <HelpBlockView key={block.id} block={block} onImage={(url, alt) => setLightbox({ url, alt })} />
            ))}
          </div></article>
          <div className="card help-supportCta"><div className="card__body">
            <div className="help-supportCta__title">{t("help.not_helped")}</div>
            <p className="p">{t("help.not_helped_desc")}</p>
            <div className="actions actions--1">
              <Link className="btn btn--primary" to="/support">{t("help.create_ticket")}</Link>
            </div>
          </div></div>
        </>
      ) : null}
      {lightbox ? <ImageLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

export function HelpSearchView() {
  const { t, formatDate: formatDateFn } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [items, setItems] = useState<HelpArticleSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ ok: true; items: HelpArticleSummary[] }>(`/help/search?q=${encodeURIComponent(q)}`, { method: "GET" })
      .then((res) => { if (!cancelled) setItems(res.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <div className="section help-page">
      <div className="pageBackRow"><PageBackButton to="/help" /></div>
      <h1 className="h1">{t("help.search.title", { q })}</h1>
      {loading ? <p className="p">{t("common.loading")}</p> : null}
      {!loading && items.length === 0 ? <p className="p">{t("help.search.empty")}</p> : null}
      <div className="help-list-grid">
        {items.map((a) => <ArticleCard key={a.id} article={a} t={t} formatDateFn={formatDateFn} />)}
      </div>
    </div>
  );
}

export function HelpCategoryView() {
  const { t, formatDate: formatDateFn } = useI18n();
  const { categorySlug = "" } = useParams();
  const slug = categorySlug;
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const [items, setItems] = useState<HelpArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch<{ ok: true; items: HelpCategory[] }>("/help/categories", { method: "GET" }),
      apiFetch<{ ok: true; items: HelpArticleSummary[] }>(`/help/articles?category=${encodeURIComponent(slug)}`, { method: "GET" }),
    ])
      .then(([cats, list]) => {
        if (cancelled) return;
        setCategory((cats.items ?? []).find((c) => c.slug === slug) ?? null);
        setItems(list.items ?? []);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="section help-page">
      <div className="pageBackRow"><PageBackButton to="/help" /></div>
      <h1 className="h1">{category ? `${category.icon ?? ""} ${category.title}`.trim() : t("help.title")}</h1>
      {category?.description ? <p className="p">{category.description}</p> : null}
      {loading ? <p className="p">{t("common.loading")}</p> : null}
      {!loading && items.length === 0 ? <p className="p">{t("help.category.empty")}</p> : null}
      <div className="help-list-grid">
        {items.map((a) => <ArticleCard key={a.id} article={a} t={t} formatDateFn={formatDateFn} />)}
      </div>
    </div>
  );
}

export function HelpHome() {
  const { t, formatDate: formatDateFn } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<HelpCategory[]>([]);
  const [articles, setArticles] = useState<HelpArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ ok: true; items: HelpCategory[] }>("/help/categories", { method: "GET" }),
      apiFetch<{ ok: true; items: HelpArticleSummary[] }>("/help/articles", { method: "GET" }),
    ])
      .then(([cats, list]) => {
        if (cancelled) return;
        setCategories(cats.items ?? []);
        setArticles(list.items ?? []);
      })
      .catch(() => { /* keep the page usable */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const featured = useMemo(() => articles.filter((a) => a.isFeatured), [articles]);
  const recent = useMemo(() => articles.slice(0, 6), [articles]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/help/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="section help-page">
      <div className="pageBackRow"><PageBackButton to="/profile" /></div>

      <header className="card help-hero help-hero--home"><div className="card__body">
        <div className="help-hero__mark" aria-hidden="true">📚</div>
        <h1 className="h1">{t("help.title")}</h1>
        <p className="p help-hero__summary">{t("help.subtitle")}</p>
        <form className="help-search" onSubmit={submit} role="search">
          <input
            className="input help-search__input"
            type="search"
            value={query}
            placeholder={t("help.search.placeholder")}
            aria-label={t("help.search.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn--primary help-search__btn" type="submit">{t("help.search.action")}</button>
        </form>
      </div></header>

      {featured.length > 0 ? (
        <section className="help-section">
          <h2 className="h2">{t("help.featured")}</h2>
          <div className="help-list-grid">
            {featured.map((a) => <ArticleCard key={a.id} article={a} t={t} formatDateFn={formatDateFn} />)}
          </div>
        </section>
      ) : null}

      <section className="help-section">
        <h2 className="h2">{t("help.categories")}</h2>
        {loading ? <p className="p">{t("common.loading")}</p> : null}
        <div className="help-categoryGrid">
          {categories.map((c) => (
            <Link className="help-categoryCard" to={`/help/c/${c.slug}`} key={c.id}>
              <span className="help-categoryCard__icon" aria-hidden="true">{c.icon ?? "📄"}</span>
              <span className="help-categoryCard__title">{c.title}</span>
              {c.description ? <span className="help-categoryCard__desc">{c.description}</span> : null}
            </Link>
          ))}
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="help-section">
          <h2 className="h2">{t("help.popular")}</h2>
          <div className="help-list-grid">
            {recent.map((a) => <ArticleCard key={a.id} article={a} t={t} formatDateFn={formatDateFn} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default HelpHome;
