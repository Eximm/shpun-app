// web/src/shared/help/HelpArticleRenderer.tsx
//
// Single article renderer used by BOTH the public Help page and the Admin
// preview, so what the editor previews is exactly what users will see.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export type HelpRenderMedia = {
  url: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
};

export type HelpRenderBlock = {
  id?: number;
  type: string;
  payload: Record<string, any>;
  media?: HelpRenderMedia | null;
};

export type HelpRenderArticle = {
  title: string;
  summary?: string;
  updatedAt?: string;
  category?: { title: string; slug?: string; icon?: string | null } | null;
};

function formatDate(value: string | undefined, formatDate: (v: Date | number | string, o?: Intl.DateTimeFormatOptions) => string): string {
  if (!value) return "—";
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formatDate(d, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Resolve image/video blocks to a concrete media URL from a media list. */
export function resolvePreviewBlocks(
  blocks: Array<{ type: string; payload: Record<string, any> }>,
  media: Array<{ id: number; url: string; mimeType: string; width?: number | null; height?: number | null }>,
): HelpRenderBlock[] {
  return blocks.map((block) => {
    if (block.type !== "image" && block.type !== "video") return { type: block.type, payload: block.payload };
    const found = media.find((m) => m.id === Number(block.payload?.mediaId));
    return {
      type: block.type,
      payload: block.payload,
      media: found ? { url: found.url, mimeType: found.mimeType, width: found.width, height: found.height } : null,
    };
  });
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

function BlockView({ block, onImage }: { block: HelpRenderBlock; onImage: (url: string, alt: string) => void }) {
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

export function HelpArticleRenderer({
  article,
  blocks,
  categoryHref,
  showMissingMedia,
}: {
  article: HelpRenderArticle;
  blocks: HelpRenderBlock[];
  /** Where the category chip links (public route). Omit for preview. */
  categoryHref?: string | null;
  /** Preview: show a placeholder instead of hiding image/video blocks without media. */
  showMissingMedia?: boolean;
}) {
  const { t, formatDate: formatDateFn } = useI18n();
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  return (
    <div className="help-articleRender">
      <header className="card help-hero"><div className="card__body">
        {article.category ? (
          categoryHref
            ? <Link className="help-hero__eyebrow" to={categoryHref}>{article.category.icon} {article.category.title}</Link>
            : <span className="help-hero__eyebrow">{article.category.icon} {article.category.title}</span>
        ) : null}
        <h1 className="h1">{article.title}</h1>
        {article.summary ? <p className="p help-hero__summary">{article.summary}</p> : null}
        <div className="help-meta">{t("help.updated", { date: formatDate(article.updatedAt, formatDateFn) })}</div>
      </div></header>
      <article className="card help-article"><div className="card__body">
        {blocks.map((block, index) => {
          const missing = (block.type === "image" || block.type === "video") && !block.media;
          if (missing && showMissingMedia) {
            return <div className="help-mediaMissing" key={block.id ?? index}>{t(block.type === "video" ? "help.media.video_missing" : "help.media.image_missing")}</div>;
          }
          return <BlockView key={block.id ?? index} block={block} onImage={(url, alt) => setLightbox({ url, alt })} />;
        })}
      </div></article>
      {lightbox ? <ImageLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

export default HelpArticleRenderer;
