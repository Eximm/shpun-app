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
import { HelpArticleRenderer, type HelpRenderBlock } from "../shared/help/HelpArticleRenderer";

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

function formatDateValue(value: string, formatDate: (v: Date | number | string, o?: Intl.DateTimeFormatOptions) => string): string {
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
        <span>{t("help.updated", { date: formatDateValue(article.updatedAt, formatDateFn) })}</span>
      </span>
    </Link>
  );
}

export function HelpArticleView() {
  const { t } = useI18n();
  const { articleSlug = "" } = useParams();
  const [data, setData] = useState<{ article: HelpArticleSummary; category: HelpCategory | null; blocks: HelpRenderBlock[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    apiFetch<{ ok: true; article: HelpArticleSummary; category: HelpCategory | null; blocks: HelpRenderBlock[] }>(
      `/help/articles/${encodeURIComponent(articleSlug)}`,
      { method: "GET" },
    )
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [articleSlug]);

  return (
    <div className="section help-page">
      <div className="pageBackRow"><PageBackButton to="/help" /></div>
      {error ? <p className="p">{t("help.error")}</p> : null}
      {!data && !error ? <p className="p">{t("common.loading")}</p> : null}
      {data ? (
        <>
          <HelpArticleRenderer
            article={{ title: data.article.title, summary: data.article.summary, updatedAt: data.article.updatedAt, category: data.category }}
            blocks={data.blocks}
            categoryHref={data.category ? `/help/c/${data.category.slug}` : null}
          />
          <div className="card help-supportCta"><div className="card__body">
            <div className="help-supportCta__title">{t("help.not_helped")}</div>
            <p className="p">{t("help.not_helped_desc")}</p>
            <div className="actions actions--1">
              <Link className="btn btn--primary" to="/support">{t("help.create_ticket")}</Link>
            </div>
          </div></div>
        </>
      ) : null}
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
  const [category, setCategory] = useState<HelpCategory | null>(null);
  const [items, setItems] = useState<HelpArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch<{ ok: true; items: HelpCategory[] }>("/help/categories", { method: "GET" }),
      apiFetch<{ ok: true; items: HelpArticleSummary[] }>(`/help/articles?category=${encodeURIComponent(categorySlug)}`, { method: "GET" }),
    ])
      .then(([cats, list]) => {
        if (cancelled) return;
        setCategory((cats.items ?? []).find((c) => c.slug === categorySlug) ?? null);
        setItems(list.items ?? []);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categorySlug]);

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
