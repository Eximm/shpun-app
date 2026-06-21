import type { ReactNode } from "react";

const FLAG_PAIR_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
const REGIONAL_INDICATOR_A = 0x1F1E6;
const ASCII_A = 65;
const FLAG_CDN_BASE = "https://flagcdn.com/24x18";

function flagToCode(flag: string) {
  const chars = Array.from(flag);
  if (chars.length !== 2) return "";
  const code = chars
    .map((ch) => String.fromCharCode(ch.codePointAt(0)! - REGIONAL_INDICATOR_A + ASCII_A))
    .join("");
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function flagImageUrl(code: string) {
  return `${FLAG_CDN_BASE}/${code.toLowerCase()}.png`;
}

export function renderNewsText(text: string | null | undefined): ReactNode {
  const value = String(text || "");
  if (!value) return null;

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(FLAG_PAIR_RE)) {
    const flag = match[0];
    const index = match.index ?? 0;
    const code = flagToCode(flag);

    if (!code) continue;
    if (index > lastIndex) parts.push(value.slice(lastIndex, index));
    parts.push(
      <span className="news-flagBadge" title={code} aria-label={code} key={`${index}-${code}`}>
        <img
          className="news-flagBadge__img"
          src={flagImageUrl(code)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            event.currentTarget.parentElement?.classList.add("is-fallback");
          }}
        />
        <span className="news-flagBadge__code">{code}</span>
      </span>,
    );
    lastIndex = index + flag.length;
  }

  if (!parts.length) return value;
  if (lastIndex < value.length) parts.push(value.slice(lastIndex));

  return <span className="news-richText">{parts}</span>;
}
