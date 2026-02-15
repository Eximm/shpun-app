import React, { createContext, useContext, useMemo, useState } from "react";
import type { Dict, Lang } from "./dict";
import { RU, EN } from "./dict";

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function getInitialLang(): Lang {
  const saved = (localStorage.getItem("lang") || "").toLowerCase();
  if (saved === "en" || saved === "ru") return saved;
  return "ru";
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
        localStorage.setItem("lang", l);
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
