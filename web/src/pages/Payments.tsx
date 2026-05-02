// FILE: web/src/pages/Payments.tsx

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { toast } from "../shared/ui/toast";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { getMood } from "../shared/payments-mood";
import { normalizeError } from "../shared/api/errorText";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type PaySystem = {
  name?: string;
  shm_url?: string;
  recurring?: string | number;
  amount?: number;
};

type PaysystemsResp = { ok: true; items: PaySystem[]; raw?: any };
type ForecastResp   = { ok: true; raw: any };

type RequisitesResp = {
  ok: boolean;
  requisites?: {
    title?: string; holder?: string; bank?: string;
    card?: string; comment?: string; updated_at?: string;
  };
};

type ReceiptUploadResp = {
  ok?: boolean; message?: string; error?: string;
  cooldown_sec?: number; [k: string]: any;
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */

function fmtMoney(n: number, cur = "RUB") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: cur, maximumFractionDigits: 0,
    }).format(Number(n || 0));
  } catch { return `${n} ${cur}`; }
}

function digitsOnly(s: string) { return String(s || "").replace(/[^\d]/g, ""); }

function formatCardPretty(card?: string) {
  const d = digitsOnly(card || "");
  return d ? d.replace(/(.{4})/g, "$1 ").trim() : "";
}

function isStars(ps: PaySystem) {
  const n = String(ps?.name || "").toLowerCase();
  const u = String(ps?.shm_url || "").toLowerCase();
  return n.includes("stars") || u.includes("telegram_stars");
}

function isCard(ps: PaySystem) {
  const n = String(ps?.name || "").toLowerCase();
  const u = String(ps?.shm_url || "").toLowerCase();
  return n.includes("карт") || n.includes("card") || n.includes("перевод") || u.includes("card");
}

function safeOpen(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function copyText(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

function parseForecast(raw: any): { amount: number | null; date: string | null } {
  if (!raw || typeof raw !== "object") return { amount: null, date: null };
  const data0 = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;
  const amount = typeof data0?.total === "number" && Number.isFinite(data0.total) ? data0.total : null;
  const date   = typeof raw.date === "string" && raw.date ? raw.date : null;
  return { amount, date };
}

function fmtForecastDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

/* ─── Method accent — левая полоса и цвет суммы ─────────────────────────── */

function methodAccent(ps: PaySystem): { stripe: string; amountColor: string; hintColor: string; icon: string; hint: string } {
  const name = String(ps?.name || "").toLowerCase();

  if (name.includes("сбп") || name.includes("sbp") || name.includes("быстр")) {
    return { stripe: "#2be38f", amountColor: "#2be38f", hintColor: "rgba(43,227,143,0.80)", icon: "⚡", hint: "Мгновенно · рекомендуем" };
  }
  if (isStars(ps)) {
    return { stripe: "#f59e0b", amountColor: "rgba(255,255,255,0.80)", hintColor: "rgba(255,255,255,0.38)", icon: "⭐", hint: "Telegram Stars" };
  }
  if (name.includes("юмани") || name.includes("yoomoney") || name.includes("юмoney") || name.includes("юmon")) {
    return { stripe: "#a78bff", amountColor: "rgba(255,255,255,0.80)", hintColor: "rgba(255,255,255,0.38)", icon: "💜", hint: "Внешняя оплата" };
  }
  if (name.includes("crypto") || name.includes("крипт")) {
    return { stripe: "#4dd7ff", amountColor: "rgba(255,255,255,0.80)", hintColor: "rgba(255,255,255,0.38)", icon: "🔶", hint: "Криптовалюта" };
  }
  if (isCard(ps)) {
    return { stripe: "rgba(255,255,255,0.18)", amountColor: "rgba(255,255,255,0.35)", hintColor: "rgba(255,255,255,0.28)", icon: "💳", hint: "Ручная проверка · до 1 ч" };
  }
  return { stripe: "rgba(124,92,255,0.60)", amountColor: "rgba(255,255,255,0.80)", hintColor: "rgba(255,255,255,0.38)", icon: "💳", hint: "Внешняя оплата" };
}

/* ─── Modals ─────────────────────────────────────────────────────────────── */

function PaymentErrorModal({ open, onClose, onRetry }: {
  open: boolean; onClose: () => void; onRetry: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" onMouseDown={onClose}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div className="card__body">
          <div style={{ fontSize: 52, marginBottom: 8 }}>❌</div>
          <div className="h1" style={{ fontSize: 20, marginBottom: 8 }}>Оплата не прошла</div>
          <p className="p" style={{ opacity: 0.75 }}>
            Платёж был отменён или произошла ошибка. Попробуйте ещё раз или выберите другой способ оплаты.
          </p>
          <div className="actions actions--2" style={{ marginTop: 20 }}>
            <button className="btn" type="button" onClick={onClose}>Закрыть</button>
            <button className="btn btn--primary" type="button" onClick={onRetry}>Попробовать снова</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReceiptSuccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" onMouseDown={onClose}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
        <div className="card__body">
          <div style={{ fontSize: 52, marginBottom: 8 }}>📬</div>
          <div className="h1" style={{ fontSize: 20, marginBottom: 8 }}>Квитанция получена</div>
          <p className="p" style={{ opacity: 0.78, lineHeight: 1.6 }}>
            Мы получили чек и отправили его на ручную проверку.
            Баланс будет зачислен после подтверждения оплаты. Обычно это занимает до одного часа в рабочее время.
          </p>
          <p className="p" style={{ marginTop: 10, opacity: 0.5, fontSize: 13 }}>
            Повторно отправлять эту же квитанцию не нужно.
          </p>
          <div className="actions actions--1" style={{ marginTop: 20 }}>
            <button className="btn btn--primary" type="button" onClick={onClose}>Хорошо</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Receipt duplicate protection ──────────────────────────────────────── */

const COOLDOWN_SEC = 120;
const RECEIPT_HASHES_STORAGE_KEY = "shpun_sent_receipt_hashes";

async function fileHash(file: File): Promise<string> {
  try {
    const buf    = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return `${file.name}-${file.size}-${file.lastModified}`; }
}

function loadStoredReceiptHashes(): Set<string> {
  try {
    const raw = sessionStorage.getItem(RECEIPT_HASHES_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x || "").trim()).filter(Boolean));
  } catch { return new Set(); }
}

function saveStoredReceiptHashes(set: Set<string>) {
  try {
    const arr = Array.from(set).filter(Boolean).slice(-80);
    sessionStorage.setItem(RECEIPT_HASHES_STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

/* ─── RequisitesModal ───────────────────────────────────────────────────── */

function RequisitesModal({ open, onClose, amountNumber, onSuccess }: {
  open: boolean; onClose: () => void; amountNumber: number | null; onSuccess: () => void;
}) {
  const { t } = useI18n();

  const [reqLoading, setReqLoading] = useState(false);
  const [reqError,   setReqError]   = useState<unknown>(null);
  const [requisites, setRequisites] = useState<RequisitesResp["requisites"] | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [uploadMsg,  setUploadMsg]  = useState<string | null>(null);
  const [cooldown,   setCooldown]   = useState(0);

  const inFlightRef   = useRef(false);
  const cooldownRef   = useRef<number | null>(null);
  const sentHashesRef = useRef<Set<string>>(new Set());

  useEffect(() => { sentHashesRef.current = loadStoredReceiptHashes(); }, []);

  useEffect(() => {
    if (!open) { setUploadMsg(null); return; }
    void loadRequisites();
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    cooldownRef.current = window.setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) { if (cooldownRef.current) { window.clearInterval(cooldownRef.current); cooldownRef.current = null; } return 0; }
        return v - 1;
      });
    }, 1000);
    return () => { if (cooldownRef.current) { window.clearInterval(cooldownRef.current); cooldownRef.current = null; } };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function rememberReceiptHash(hash: string) {
    if (!hash) return;
    sentHashesRef.current.add(hash);
    saveStoredReceiptHashes(sentHashesRef.current);
  }

  async function loadRequisites() {
    setReqLoading(true); setReqError(null);
    try {
      const r = (await apiFetch("/payments/requisites", { method: "GET" })) as RequisitesResp;
      if (!r?.ok) throw r;
      setRequisites(r.requisites ?? null);
    } catch (e) { setRequisites(null); setReqError(e); }
    finally { setReqLoading(false); }
  }

  async function uploadReceipt(file: File) {
    if (inFlightRef.current || uploading) {
      toast.error("⏳ Уже отправляем", { description: "Дождитесь завершения текущей отправки." }); return;
    }
    if (!amountNumber || amountNumber < 1) {
      toast.error("💸 Введите сумму", { description: "Сначала укажите сколько платите — потом чек." }); return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("📎 Файл великоват", { description: "Максимум 2 МБ. Сожмите или обрежьте скриншот." }); return;
    }
    if (cooldown > 0) {
      toast.error("⏳ Подождите", { description: `Следующий чек можно отправить через ${cooldown} сек.` }); return;
    }
    inFlightRef.current = true; setUploading(true); setUploadMsg(null);
    try {
      const hash = await fileHash(file);
      if (sentHashesRef.current.has(hash)) {
        setUploadMsg("duplicate");
        toast.error("🙅 Такой чек уже отправлен", { description: "Это тот же файл. Мы уже его получили и проверяем." });
        window.setTimeout(() => setUploadMsg(null), 20_000); return;
      }
      const fd = new FormData();
      fd.append("file", file); fd.append("amount", String(amountNumber)); fd.append("receipt_hash", hash);
      const json = (await apiFetch("/payments/receipt", { method: "POST", body: fd })) as ReceiptUploadResp;
      if (!json?.ok) {
        if (json?.error === "duplicate_receipt") {
          rememberReceiptHash(hash); setCooldown(COOLDOWN_SEC); setUploadMsg("duplicate");
          toast.error("🙅 Такой чек уже есть", { description: "Повторно отправлять его не нужно — он уже на проверке." });
          window.setTimeout(() => setUploadMsg(null), 20_000); return;
        }
        if (json?.error === "receipt_rate_limited") {
          const nextCooldown = Number.isFinite(Number(json.cooldown_sec)) && Number(json.cooldown_sec) > 0
            ? Math.ceil(Number(json.cooldown_sec)) : COOLDOWN_SEC;
          setCooldown(nextCooldown);
          toast.error("⏳ Слишком часто", { description: `Следующий чек можно отправить через ${nextCooldown} сек.` }); return;
        }
        throw json ?? { message: "receipt_upload_failed" };
      }
      rememberReceiptHash(hash); setCooldown(COOLDOWN_SEC);
      toast.success("📬 Чек получен!", { description: "Проверим вручную и зачислим. Повторно отправлять не нужно." });
      onSuccess();
    } catch (e) { toastApiError(e, { title: "😬 Не отправилось" }); }
    finally { inFlightRef.current = false; setUploading(false); }
  }

  if (!open) return null;
  const cardRaw    = String(requisites?.card ?? "").trim();
  const cardPretty = formatCardPretty(cardRaw) || cardRaw;
  const holder     = String(requisites?.holder ?? "").trim();

  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" onMouseDown={onClose}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{t("payments.card_page.title")}</div>
            <button className="btn modal__close" onClick={onClose} aria-label={t("common.close")} type="button">✕</button>
          </div>
          <div className="modal__content">
            <div style={{ background: "rgba(255,77,109,0.09)", border: "1px solid rgba(255,77,109,0.28)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>⚠️ {t("payments.card_page.receipt_required")}</div>
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>{t("payments.card_page.receipt_required_text")}</div>
            </div>
            {reqLoading ? (
              <p className="p">{t("payments.requisites.loading")}</p>
            ) : reqError ? (
              <div className="pre">{t("payments.requisites.error")}</div>
            ) : !requisites ? (
              <div className="pre">{t("payments.requisites.empty")}</div>
            ) : (
              <div className="kv">
                <div className="kv__item">
                  <div className="kv__k">{t("payments.card_page.amount_label")}</div>
                  <div className="kv__v" style={{ fontSize: 22, fontWeight: 900 }}>{amountNumber ? fmtMoney(amountNumber) : "—"}</div>
                </div>
                {holder && <div className="kv__item"><div className="kv__k">{t("payments.requisites.holder")}</div><div className="kv__v">{holder}</div></div>}
                {cardPretty && (
                  <div className="kv__item">
                    <div className="kv__k">{t("payments.requisites.card")}</div>
                    <div className="kv__v" style={{ fontFamily: "monospace", fontSize: 20, letterSpacing: 2 }}>{cardPretty}</div>
                  </div>
                )}
              </div>
            )}
            <div className="pre" style={{ marginTop: 12 }}>
              <div>1. {t("payments.card_page.step_1")}</div>
              <div>2. {t("payments.card_page.step_2")}</div>
              <div>3. {t("payments.card_page.step_3")}</div>
            </div>
            <div className="actions actions--1" style={{ marginTop: 16 }}>
              <label className={`btn${!uploading && cooldown === 0 ? " btn--primary" : ""}`}
                style={{ cursor: uploading || cooldown > 0 ? "not-allowed" : "pointer", opacity: uploading || cooldown > 0 ? 0.65 : 1 }}>
                {uploading ? "⏳ Отправляем…" : cooldown > 0 ? `⏳ Повтор через ${cooldown} сек.` : "📎 Прикрепить квитанцию"}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: "none" }}
                  disabled={uploading || cooldown > 0}
                  onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (!f) return; void uploadReceipt(f); }} />
              </label>
              {cardRaw && (
                <button className="btn" type="button" onClick={() => {
                  copyText(cardRaw);
                  toast.success(getMood("copied") ?? "📋 Номер скопирован", { description: "Вставляйте в приложение банка." });
                }}>
                  📋 {t("payments.requisites.copy_card")}
                </button>
              )}
            </div>
            {uploadMsg === "duplicate" && (
              <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 14, background: "rgba(255,184,77,0.08)", border: "1px solid rgba(255,184,77,0.28)" }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: "rgba(255,184,77,0.95)", marginBottom: 6 }}>🙅 Эта квитанция уже отправлена</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>
                  Повторно загружать тот же файл не нужно. Если платёж был отправлен, он уже находится на ручной проверке.
                </div>
              </div>
            )}
            <p className="p" style={{ marginTop: 10, opacity: 0.45, fontSize: 12 }}>Форматы: JPG, PNG, PDF · Максимум 2 МБ</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Payments ──────────────────────────────────────────────────────────── */

export function Payments() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading,            setLoading]            = useState(true);
  const [err,                setErr]                = useState<unknown>(null);
  const [amount,             setAmount]             = useState<string>("");
  const [paySystems,         setPaySystems]         = useState<PaySystem[]>([]);
  const [forecast,           setForecast]           = useState<any>(null);
  const [reqModal,           setReqModal]           = useState(false);
  const [checkingPay,        setCheckingPay]        = useState(false);
  const [showOverlay,        setShowOverlay]        = useState(false);
  const [receiptSuccessOpen, setReceiptSuccessOpen] = useState(false);

  const [payErrorOpen, setPayErrorOpen] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get("payment") === "error"; } catch { return false; }
  });

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get("payment") === "error") {
      sp.delete("payment");
      const next = sp.toString();
      navigate(location.pathname + (next ? `?${next}` : ""), { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const amountNumber = useMemo(() => {
    const v = Math.round(parseFloat(String(amount || "").replace(",", ".")));
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [amount]);

  const { amount: forecastAmount, date: forecastDate } = useMemo(() => parseForecast(forecast), [forecast]);

  const recurringSystem = paySystems.find((x) => x.recurring);
  const oneSystems      = paySystems.filter((x) => !x.recurring);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const ps = (await apiFetch("/payments/paysystems", { method: "GET" })) as PaysystemsResp;
      const rawItems = (ps?.items || []).filter((x) => {
        const n = String(x?.name || "");
        return n !== "Telegram Stars Rescue" && n !== "Telegram Stars Karlson";
      });
      setPaySystems(rawItems);
      try {
        const fc = (await apiFetch("/payments/forecast", { method: "GET" })) as ForecastResp;
        setForecast(fc?.raw ?? null);
        if (!amount) {
          const { amount: fa } = parseForecast(fc?.raw ?? null);
          if (fa && fa > 0) { setAmount(String(Math.round(fa))); }
          else { const fallback = rawItems.find((x) => Number(x?.amount || 0) > 0)?.amount; if (fallback) setAmount(String(Math.round(Number(fallback)))); }
        }
      } catch { setForecast(null); }
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) { toast.error("😬 Метод недоступен", { description: "Выберите другой способ оплаты." }); return; }
    if (!amountNumber || amountNumber < 1) { toast.error("💸 Укажите сумму", { description: "Без суммы платёж не откроется." }); return; }
    const fullUrl = `${ps.shm_url}${amountNumber}`;
    safeOpen(fullUrl);
    setShowOverlay(true);
    toast.info("🚀 Открываем оплату", { description: getMood("payment_checking", { seed: `${ps.shm_url}|${amountNumber}` }) ?? "Завершите платёж и вернитесь." });
  }

  async function removeAutopayment() {
    if (!window.confirm(t("payments.autopay.confirm_remove"))) return;
    try {
      await apiFetch("/payments/autopayment", { method: "DELETE" });
      toast.success("✅ Автоплатёж отключён", { description: "Теперь платите когда сами захотите." });
      void load();
    } catch (e) { toastApiError(e, { title: t("payments.autopay.remove_failed") }); }
  }

  const quickAmounts = [100, 300, 500, 1000, 2000];

  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow"><div className="app-loader__mark" /><div className="app-loader__title">Shpun App</div></div>
          <div className="app-loader__text">{t("payments.loading")}</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="section">
        <div className="card"><div className="card__body">
          <div className="h1">{t("payments.page.title")}</div>
          <p className="p" style={{ marginTop: 8 }}>{normalizeError(err).description ?? t("payments.error.text")}</p>
          <div className="actions actions--2" style={{ marginTop: 16 }}>
            <button className="btn btn--primary" onClick={() => void load()} type="button">{t("payments.error.retry")}</button>
            <Link className="btn" to="/">{t("payments.error.home")}</Link>
          </div>
        </div></div>
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div className="section">

      <PaymentErrorModal
        open={payErrorOpen}
        onClose={() => setPayErrorOpen(false)}
        onRetry={() => {
          setPayErrorOpen(false);
          window.setTimeout(() => { document.querySelector(".kv")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);
        }}
      />

      <ReceiptSuccessModal open={receiptSuccessOpen} onClose={() => setReceiptSuccessOpen(false)} />

      {showOverlay && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onMouseDown={() => setShowOverlay(false)}>
          <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="modal__head">
                <div className="modal__title">{t("payments.overlay.title")}</div>
                <button className="btn modal__close" type="button" onClick={() => setShowOverlay(false)} aria-label={t("common.close")}>✕</button>
              </div>
              <div className="modal__content">
                <p className="p">{t("payments.overlay.text")}</p>
                <div className="actions actions--2" style={{ marginTop: 16 }}>
                  <button className="btn btn--primary" disabled={checkingPay} type="button" onClick={async () => {
                    setCheckingPay(true); setShowOverlay(false);
                    toast.info("🔍 Проверяем статус", { description: getMood("payment_checking") ?? "Сверяемся с платёжкой..." });
                    await load(); setCheckingPay(false);
                  }}>
                    {checkingPay ? "…" : t("payments.overlay.refresh")}
                  </button>
                  <button className="btn" onClick={() => setShowOverlay(false)} type="button">{t("payments.overlay.close")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Автоплатёж ── */}
      {recurringSystem && (
        <div className="card">
          <div className="card__body" style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
              🔄 {t("payments.autopay.title")}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                {recurringSystem.name || t("payments.autopay.name_fallback")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => void handlePay(recurringSystem)}
                  style={{ padding: "6px 11px", borderRadius: 8, fontSize: 11, fontWeight: 800, background: "linear-gradient(135deg,#7c5cff,#4dd7ff)", border: "none", color: "#050a14", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {t("payments.autopay.pay_now")}{amountNumber ? ` · ${fmtMoney(amountNumber)}` : ""}
                </button>
                <button type="button" onClick={() => void removeAutopayment()}
                  style={{ padding: "6px 11px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(255,77,109,0.12)", border: "0.5px solid rgba(255,77,109,0.28)", color: "#ff4d6d", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {t("payments.autopay.remove_short")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Сумма ── */}
      <div className="card">
        <div className="card__body" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
            {t("payments.amount.title")}
          </div>
          {forecastAmount && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", marginBottom: 8 }}>
              {t("payments.forecast.hint")}: <strong style={{ color: "rgba(255,255,255,0.72)" }}>{fmtMoney(forecastAmount)}</strong>
              {forecastDate ? ` · ${fmtForecastDate(forecastDate)}` : ""}
            </div>
          )}
          <input
            className="input"
            style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("payments.amount.placeholder")}
            inputMode="numeric"
            autoComplete="off"
          />
          <div style={{ display: "flex", gap: 5 }}>
            {quickAmounts.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setAmount(String(x))}
                style={{
                  flex: "1 1 0", minWidth: 0, padding: "6px 4px",
                  borderRadius: 8, fontSize: 12, fontWeight: 700, textAlign: "center",
                  background: amountNumber === x ? "linear-gradient(135deg,#7c5cff,#4dd7ff)" : "rgba(255,255,255,0.06)",
                  border: amountNumber === x ? "none" : "0.5px solid rgba(255,255,255,0.12)",
                  color: amountNumber === x ? "#050a14" : "rgba(255,255,255,0.72)",
                  cursor: "pointer",
                }}
              >
                {fmtMoney(x)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Способы оплаты — вариант Б: левая полоса ── */}
      <div className="card">
        <div className="card__body" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>
            {t("payments.methods.title")}
          </div>

          {oneSystems.length === 0 && (
            <p className="p">{t("payments.methods.empty")}</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {oneSystems.map((ps, idx) => {
              const cardMethod = isCard(ps);
              const accent     = methodAccent(ps);

              return (
                <button
                  key={ps.shm_url || idx}
                  type="button"
                  onClick={() => {
                    if (cardMethod) {
                      if (!amountNumber) { toast.error("💸 Сначала сумму", { description: "Укажите сколько переводите — и тогда реквизиты." }); return; }
                      setReqModal(true);
                    } else {
                      void handlePay(ps);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 14px", borderRadius: 11, width: "100%", textAlign: "left",
                    background: "rgba(255,255,255,0.06)",
                    border: "0.5px solid rgba(255,255,255,0.10)",
                    borderLeft: `3px solid ${accent.stripe}`,
                    cursor: "pointer",
                    opacity: cardMethod && !amountNumber ? 0.7 : 1,
                  }}
                >
                  {/* Иконка */}
                  <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{accent.icon}</span>

                  {/* Название + подсказка */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 800,
                      color: cardMethod ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.92)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {ps.name || t("payments.methods.name_fallback")}
                    </div>
                    <div style={{ fontSize: 10, color: accent.hintColor, marginTop: 2 }}>
                      {accent.hint}
                    </div>
                  </div>

                  {/* Сумма / текст справа */}
                  <div style={{
                    fontSize: cardMethod ? 12 : 14,
                    fontWeight: cardMethod ? 700 : 900,
                    color: accent.amountColor,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}>
                    {cardMethod
                      ? t("payments.methods.card_open")
                      : amountNumber ? fmtMoney(amountNumber) : t("payments.methods.pay")}
                  </div>

                  {/* Стрелка */}
                  <span style={{ fontSize: 14, color: accent.stripe, opacity: cardMethod ? 0.4 : 0.7, flexShrink: 0 }}>→</span>
                </button>
              );
            })}

            {/* Карта — зашита в приложение, не от биллинга */}
            <button
              type="button"
              onClick={() => {
                if (!amountNumber) {
                  toast.error("💸 Сначала сумму", { description: "Укажите сколько переводите — и тогда реквизиты." });
                  return;
                }
                setReqModal(true);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px", borderRadius: 11, width: "100%", textAlign: "left",
                background: "rgba(255,255,255,0.06)",
                border: "0.5px solid rgba(255,255,255,0.10)",
                borderLeft: "3px solid rgba(255,255,255,0.40)",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>💳</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.92)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t("payments.methods.card_transfer")}
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>
                  {t("payments.methods.type.card")} · до 1 ч
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,0.80)", flexShrink: 0, whiteSpace: "nowrap" }}>
                {t("payments.methods.card_open")}
              </div>
              <span style={{ fontSize: 14, color: "rgba(255,255,255,0.40)", flexShrink: 0 }}>→</span>
            </button>

            {/* Примечание */}
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", lineHeight: 1.4, marginTop: 4 }}>
              {t("payments.methods.note")}
            </p>
          </div>
        </div>
      </div>

      {/* ── История ── */}
      <div className="card">
        <div className="card__body" style={{ padding: "10px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Link className="btn" to="/payments/history" style={{ justifyContent: "center", fontSize: 12, minHeight: 36 }}>
              📋 {t("payments.history.operations")}
            </Link>
            <Link className="btn" to="/payments/receipts" style={{ justifyContent: "center", fontSize: 12, minHeight: 36 }}>
              🧾 {t("payments.history.receipts")}
            </Link>
          </div>
        </div>
      </div>

      <RequisitesModal
        open={reqModal}
        onClose={() => setReqModal(false)}
        amountNumber={amountNumber}
        onSuccess={() => { setReqModal(false); setReceiptSuccessOpen(true); }}
      />
    </div>
  );
}

export default Payments;