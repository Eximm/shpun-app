// Runtime (non-React) part of the i18n layer.
//
// Kept separate from I18nProvider so the provider file only exports the
// component/hook (react-refresh friendly) and so pure error/text mappers can
// translate without a React context.

import type { Dict, Lang } from "./dict";
import { RU, EN } from "./dict";

export type TParams = Record<string, string | number>;

export function localeFor(lang: Lang): string {
  return lang === "en" ? "en-US" : "ru-RU";
}

export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match
  );
}

/** Russian/English plural suffix used by dict keys: `key.one/.few/.many/.other`. */
export function pluralSuffix(lang: Lang, count: number): "one" | "few" | "many" | "other" {
  try {
    const rule = new Intl.PluralRules(localeFor(lang)).select(count);
    if (rule === "one" || rule === "few" || rule === "many" || rule === "other") return rule;
  } catch {
    // ignore
  }
  return count === 1 ? "one" : "other";
}

export type RuntimeT = (key: string, fallbackOrParams?: string | TParams, params?: TParams) => string;
export type RuntimeTp = (key: string, count: number, params?: TParams) => string;

type Runtime = { lang: Lang; t: RuntimeT; tp: RuntimeTp };

function resolve(dict: Dict, key: string, fallbackOrParams?: string | TParams, params?: TParams): string {
  const fallback = typeof fallbackOrParams === "string" ? fallbackOrParams : undefined;
  const p = typeof fallbackOrParams === "object" ? fallbackOrParams : params;
  const value = dict[key] ?? fallback ?? key;
  return interpolate(value, p);
}

// Defaults are Russian so error mapping never shows a raw key before the
// provider mounts. The provider overwrites this on mount / language change.
let runtime: Runtime = {
  lang: "ru",
  t: (key, fallbackOrParams, params) => resolve(RU, key, fallbackOrParams, params),
  tp: (key, count, params) => {
    const suffix = pluralSuffix("ru", count);
    const value = RU[`${key}.${suffix}`] ?? RU[`${key}.other`] ?? key;
    return interpolate(value, { count, ...params });
  },
};

export function setI18nRuntime(next: Runtime) {
  runtime = next;
}

/** Translate from outside React (used by shared error/text mappers). */
export function tGlobal(key: string, fallbackOrParams?: string | TParams, params?: TParams): string {
  return runtime.t(key, fallbackOrParams, params);
}

export function tpGlobal(key: string, count: number, params?: TParams): string {
  return runtime.tp(key, count, params);
}

export function getRuntimeLocale(): string {
  return localeFor(runtime.lang);
}

export function resolveFrom(dict: Dict, key: string, fallbackOrParams?: string | TParams, params?: TParams): string {
  return resolve(dict, key, fallbackOrParams, params);
}

export { EN, RU };
export type { Dict, Lang };