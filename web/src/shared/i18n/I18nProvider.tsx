import React, { createContext, useContext, useMemo, useState } from "react";
import type { Lang } from "./dict";
import {
  EN,
  RU,
  interpolate,
  localeFor,
  pluralSuffix,
  resolveFrom,
  setI18nRuntime,
  type RuntimeT,
  type RuntimeTp,
} from "./runtime";

type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a key. `fallback` keeps the legacy two-arg call signature. */
  t: RuntimeT;
  /** Plural-aware translate: looks up `<key>.<pluralForm>` (one/few/many/other). */
  tp: RuntimeTp;
  locale: string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatBytes: (bytes: number) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

const LANG_STORAGE_KEY = "lang";

function normalizeLang(v: unknown): Lang | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "ru") return "ru";
  if (s === "en") return "en";
  return null;
}

function getInitialLang(): Lang {
  try {
    const saved = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // ignore
  }

  // Browser language is frequently English even for Shpun's Russian-speaking
  // audience. Keep English only when the user selected and saved it explicitly.
  return "ru";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang());

  const api = useMemo<I18nCtx>(() => {
    const dict = lang === "en" ? EN : RU;
    const locale = localeFor(lang);

    const t: RuntimeT = (key, fallbackOrParams, params) => {
      const fallback = typeof fallbackOrParams === "string" ? fallbackOrParams : undefined;
      const p = typeof fallbackOrParams === "object" ? fallbackOrParams : params;
      if (dict[key] !== undefined) return resolveFrom(dict, key, fallbackOrParams, params);
      if (fallback !== undefined) return interpolate(fallback, p);
      if (import.meta.env.DEV) {
        // Missing keys are obvious during development, without breaking prod.
        console.warn(`[i18n] missing key: ${key}`);
        return `⟦${key}⟧`;
      }
      return key;
    };

    const tp: RuntimeTp = (key, count, params) => {
      const suffix = pluralSuffix(lang, count);
      const value = dict[`${key}.${suffix}`] ?? dict[`${key}.other`];
      if (value !== undefined) return interpolate(value, { count, ...params });
      if (import.meta.env.DEV) {
        console.warn(`[i18n] missing plural key: ${key}.${suffix}`);
        return `⟦${key}.${suffix}⟧`;
      }
      return t(key, undefined, { count, ...params });
    };

    const formatDate: I18nCtx["formatDate"] = (value, options) => {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value ?? "");
      return new Intl.DateTimeFormat(locale, options).format(date);
    };

    const formatNumber: I18nCtx["formatNumber"] = (value, options) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value ?? "");
      return new Intl.NumberFormat(locale, options).format(n);
    };

    const formatCurrency: I18nCtx["formatCurrency"] = (value, currency = "RUB") => {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value ?? "");
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(n);
    };

    const formatBytes: I18nCtx["formatBytes"] = (bytes) => {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${formatNumber(n, { maximumFractionDigits: 0 })} B`;
      if (n < 1024 * 1024) return `${formatNumber(n / 1024, { maximumFractionDigits: 0 })} KB`;
      return `${formatNumber(n / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
    };

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
      t,
      tp,
      locale,
      formatDate,
      formatNumber,
      formatCurrency,
      formatBytes,
    };
  }, [lang]);

  // Publish the translator for non-React modules synchronously during render so
  // `normalizeError`/`statusLabel` already see the new language in the same
  // render pass after a language switch. The write is idempotent.
  setI18nRuntime({ lang: api.lang, t: api.t, tp: api.tp });

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}