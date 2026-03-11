import React, { createContext, useContext, useMemo, useState } from "react";
import type { Dict, Lang } from "./dict";
import { RU, EN } from "./dict";

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

const LANG_STORAGE_KEY = "lang";

function normalizeLang(v: unknown): Lang | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "ru") return "ru";
  if (s === "en") return "en";
  return null;
}

function detectBrowserLang(): Lang {
  try {
    const raw =
      navigator.language ||
      (Array.isArray(navigator.languages) ? navigator.languages[0] : "") ||
      "";

    const lang = String(raw).trim().toLowerCase();

    if (lang.startsWith("ru")) return "ru";
    return "en";
  } catch {
    return "en";
  }
}

function getInitialLang(): Lang {
  try {
    const saved = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // ignore
  }

  return detectBrowserLang();
}

function dictFor(lang: Lang): Dict {
  return lang === "en" ? EN : RU;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang());

  const api = useMemo<I18nCtx>(() => {
    const dict = dictFor(lang);

    return {
      lang,
      setLang: (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem(LANG_STORAGE_KEY, l);
        } catch {
          // ignore
        }
      },
      t: (key: string, fallback?: string) => dict[key] ?? fallback ?? key,
    };
  }, [lang]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}