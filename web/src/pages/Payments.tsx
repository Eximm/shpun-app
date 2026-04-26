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
    title?: string;
    holder?: string;
    bank?: string;
    card?: string;
    comment?: string;
    updated_at?: string;
  };
};

type ReceiptUploadResp = {
  ok?: boolean;
  message?: string;
  error?: string;
  [k: string]: any;
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

function safeOpen(url: string) { window.open(url, "_blank", "noopener,noreferrer"); }

function copyText(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

function parseForecast(raw: any): { amount: number | null; date: string | null } {
  if (!raw || typeof raw !== "object") return { amount: null, date: null };
  const data0  = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;
  const amount = typeof data0?.total === "number" && Number.isFinite(data0.total) ? data0.total : null;
  const date   = typeof raw.date === "string" && raw.date ? raw.date : null;
  return { amount, date };
}

function fmtForecastDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

/* ─── PaymentErrorModal ──────────────────────────────────────────────────── */

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
    document.body
  );
}

/* ─── RequisitesModal ────────────────────────────────────────────────────── */

/* ─── Хэш файла для защиты от дублей ─────────────────────────────────────── */

async function fileHash(file: File): Promise<string> {
  try {
    const buf    = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    // Fallback если crypto недоступен — по имени + размеру + времени изменения
    return `${file.name}-${file.size}-${file.lastModified}`;
  }
}

const COOLDOWN_SEC = 120; // 2 минуты блокировки после отправки

function RequisitesModal({ open, onClose, amountNumber }: {
  open: boolean; onClose: () => void; amountNumber: number | null;
}) {
  const { t } = useI18n();

  const [reqLoading,   setReqLoading]   = useState(false);
  const [reqError,     setReqError]     = useState<unknown>(null);
  const [requisites,   setRequisites]   = useState<RequisitesResp["requisites"] | null>(null);
  const [uploading,    setUploading]    = useState(false);
  const [uploadMsg,    setUploadMsg]    = useState<string | null>(null);
  const [cooldown,     setCooldown]     = useState(0);       // секунды до разблокировки
  const [sentHashes,   setSentHashes]   = useState<Set<string>>(new Set());
  const cooldownRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) { setUploadMsg(null); return; }
    void loadRequisites();
  }, [open]);

  // Таймер обратного отсчёта
  useEffect(() => {
    if (cooldown <= 0) return;
    cooldownRef.current = window.setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); return 0; }
        return v - 1;
      });
    }, 1000);
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRequisites() {
    setReqLoading(true); setReqError(null);
    try {
      const r = await apiFetch("/payments/requisites", { method: "GET" }) as RequisitesResp;
      if (!r?.ok) throw r;
      setRequisites(r.requisites ?? null);
    } catch (e) { setRequisites(null); setReqError(e); }
    finally { setReqLoading(false); }
  }

  async function uploadReceipt(file: File) {
    if (!amountNumber || amountNumber < 1) {
      toast.error("💸 Введите сумму", { description: "Сначала укажите сколько платите — потом чек." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("📎 Файл великоват", { description: "Максимум 2 МБ. Сожмите или обрежьте скриншот." });
      return;
    }
    if (cooldown > 0) {
      toast.error("⏳ Подождите", { description: `Следующий чек можно отправить через ${cooldown} сек.` });
      return;
    }

    // Защита от дубля — проверяем хэш файла
    const hash = await fileHash(file);
    if (sentHashes.has(hash)) {
      toast.error("🙅 Такой чек уже отправлен", { description: "Это тот же файл. Мы уже его получили и проверяем." });
      return;
    }

    setUploading(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("amount", String(amountNumber));
      const json = await apiFetch("/payments/receipt", { method: "POST", body: fd }) as ReceiptUploadResp;
      if (!json?.ok) throw json ?? { message: "receipt_upload_failed" };

      // Запоминаем хэш и запускаем кулдаун
      setSentHashes((prev) => new Set([...prev, hash]));
      setCooldown(COOLDOWN_SEC);

      setUploadMsg("sent");
      toast.success("📬 Чек получен!", { description: "Проверим вручную и зачислим. Обычно до 15 минут." });
      setTimeout(() => setUploadMsg(null), 30_000);
    } catch (e) {
      toastApiError(e, { title: "😬 Не отправилось" });
    } finally { setUploading(false); }
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
            {/* Предупреждение */}
            <div style={{
              background: "rgba(255,77,109,0.09)",
              border: "1px solid rgba(255,77,109,0.28)",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 16,
            }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
                ⚠️ {t("payments.card_page.receipt_required")}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                {t("payments.card_page.receipt_required_text")}
              </div>
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
                  <div className="kv__v" style={{ fontSize: 22, fontWeight: 900 }}>
                    {amountNumber ? fmtMoney(amountNumber) : "—"}
                  </div>
                </div>
                {holder && (
                  <div className="kv__item">
                    <div className="kv__k">{t("payments.requisites.holder")}</div>
                    <div className="kv__v">{holder}</div>
                  </div>
                )}
                {cardPretty && (
                  <div className="kv__item">
                    <div className="kv__k">{t("payments.requisites.card")}</div>
                    <div className="kv__v" style={{ fontFamily: "monospace", fontSize: 20, letterSpacing: 2 }}>
                      {cardPretty}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pre" style={{ marginTop: 12 }}>
              <div>1. {t("payments.card_page.step_1")}</div>
              <div>2. {t("payments.card_page.step_2")}</div>
              <div>3. {t("payments.card_page.step_3")}</div>
            </div>

            {/* Кнопка отправки с кулдауном + защита от дублей */}
            <div className="actions actions--1" style={{ marginTop: 16 }}>
              <label
                className={`btn${!uploading && cooldown === 0 ? " btn--primary" : ""}`}
                style={{
                  cursor: uploading || cooldown > 0 ? "not-allowed" : "pointer",
                  opacity: uploading || cooldown > 0 ? 0.65 : 1,
                }}
              >
                {uploading
                  ? "⏳ Отправляем…"
                  : cooldown > 0
                    ? `⏳ Повтор через ${cooldown} сек.`
                    : "📎 Прикрепить квитанцию"}
                <input
                  type="file" accept=".jpg,.jpeg,.png,.pdf"
                  style={{ display: "none" }}
                  disabled={uploading || cooldown > 0}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void uploadReceipt(f);
                    e.currentTarget.value = "";
                  }}
                />
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

            {/* Статус после отправки */}
            {uploadMsg === "sent" && (
              <div style={{
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: 14,
                background: "rgba(43,227,143,0.07)",
                border: "1px solid rgba(43,227,143,0.28)",
              }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: "rgba(43,227,143,0.9)", marginBottom: 6 }}>
                  📬 Квитанция получена!
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.82)" }}>
                  Мы проверим платёж вручную и зачислим баланс.
                  Обычно это занимает <b>до одного часа</b> в рабочее время.
                  Повторно отправлять не нужно — мы уже всё получили. 🙌
                </div>
                {cooldown > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                    Новую квитанцию можно прислать через {cooldown} сек.
                  </div>
                )}
              </div>
            )}

            <p className="p" style={{ marginTop: 10, opacity: 0.45, fontSize: 12 }}>
              Форматы: JPG, PNG, PDF · Максимум 2 МБ
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Payments ───────────────────────────────────────────────────────────── */

export function Payments() {
  const { t }    = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState<unknown>(null);
  const [amount,      setAmount]      = useState<string>("");
  const [paySystems,  setPaySystems]  = useState<PaySystem[]>([]);
  const [forecast,    setForecast]    = useState<any>(null);
  const [reqModal,    setReqModal]    = useState(false);
  const [checkingPay, setCheckingPay] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const [payErrorOpen, setPayErrorOpen] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get("payment") === "error"; }
    catch { return false; }
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
      const ps = await apiFetch("/payments/paysystems", { method: "GET" }) as PaysystemsResp;
      const rawItems = (ps?.items || []).filter((x) => {
        const n = String(x?.name || "");
        return n !== "Telegram Stars Rescue" && n !== "Telegram Stars Karlson";
      });
      setPaySystems(rawItems);
      try {
        const fc = await apiFetch("/payments/forecast", { method: "GET" }) as ForecastResp;
        setForecast(fc?.raw ?? null);
        if (!amount) {
          const { amount: fa } = parseForecast(fc?.raw ?? null);
          if (fa && fa > 0) setAmount(String(Math.round(fa)));
          else {
            const fallback = rawItems.find((x) => Number(x?.amount || 0) > 0)?.amount;
            if (fallback) setAmount(String(Math.round(Number(fallback))));
          }
        }
      } catch { setForecast(null); }
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) { toast.error("😬 Метод недоступен", { description: "Выберите другой способ оплаты." }); return; }
    if (!amountNumber || amountNumber < 1) {
      toast.error("💸 Укажите сумму", { description: "Без суммы платёж не откроется." });
      return;
    }
    const seed    = `${ps.shm_url}|${amountNumber}`;
    const fullUrl = `${ps.shm_url}${amountNumber}`;
    safeOpen(fullUrl);
    setShowOverlay(true);
    toast.info("🚀 Открываем оплату", { description: getMood("payment_checking", { seed }) ?? "Завершите платёж и вернитесь." });
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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app-loader" style={{ opacity: 1, transition: "opacity 180ms ease", pointerEvents: "auto" }}>
        <div className="app-loader__card">
          <div className="app-loader__shine" />
          <div className="app-loader__brandRow">
            <div className="app-loader__mark" />
            <div className="app-loader__title">Shpun App</div>
          </div>
          <div className="app-loader__text">{t("payments.loading")}</div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (err) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">{t("payments.page.title")}</div>
            <p className="p" style={{ marginTop: 8 }}>
              {normalizeError(err).description ?? t("payments.error.text")}
            </p>
            <div className="actions actions--2" style={{ marginTop: 16 }}>
              <button className="btn btn--primary" onClick={() => void load()} type="button">{t("payments.error.retry")}</button>
              <Link className="btn" to="/">{t("payments.error.home")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="section">

      <PaymentErrorModal
        open={payErrorOpen}
        onClose={() => setPayErrorOpen(false)}
        onRetry={() => {
          setPayErrorOpen(false);
          window.setTimeout(() => {
            document.querySelector(".kv")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }}
      />

      {/* Overlay после открытия оплаты */}
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
                  <button
                    className="btn btn--primary" disabled={checkingPay} type="button"
                    onClick={async () => {
                      setCheckingPay(true); setShowOverlay(false);
                      toast.info("🔍 Проверяем статус", { description: getMood("payment_checking") ?? "Сверяемся с платёжкой..." });
                      await load();
                      setCheckingPay(false);
                    }}
                  >
                    {checkingPay ? "…" : t("payments.overlay.refresh")}
                  </button>
                  <button className="btn" onClick={() => setShowOverlay(false)} type="button">
                    {t("payments.overlay.close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Заголовок */}
      <div className="card">
        <div className="card__body">
          <div className="h1">{t("payments.page.title")}</div>
          <p className="p" style={{ marginTop: 4 }}>{t("payments.page.sub")}</p>
        </div>
      </div>

      {/* Автоплатёж */}
      {recurringSystem && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__body">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔄</span>
              <div className="h2">{t("payments.autopay.title")}</div>
            </div>
            <p className="p" style={{ marginTop: 4 }}>
              {recurringSystem.name || t("payments.autopay.name_fallback")}
            </p>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" onClick={() => void handlePay(recurringSystem)} type="button">
                {t("payments.autopay.pay_now")}{amountNumber ? ` · ${fmtMoney(amountNumber)}` : ""}
              </button>
              <button className="btn btn--danger" onClick={() => void removeAutopayment()} type="button">
                {t("payments.autopay.remove_short")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Сумма */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>💰</span>
            <div className="h2">{t("payments.amount.title")}</div>
          </div>
          {forecastAmount && (
            <p className="p" style={{ marginTop: 4, opacity: 0.78 }}>
              {t("payments.forecast.hint")}{": "}
              <strong>{fmtMoney(forecastAmount)}</strong>
              {forecastDate ? ` · ${fmtForecastDate(forecastDate)}` : ""}
            </p>
          )}
          <input
            className="input"
            style={{ marginTop: 12, fontSize: 20, fontWeight: 800 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("payments.amount.placeholder")}
            inputMode="numeric"
            autoComplete="off"
          />
          {/* Быстрые суммы */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {quickAmounts.map((x) => (
              <button
                key={x}
                className={`btn${amountNumber === x ? " btn--primary" : ""}`}
                onClick={() => setAmount(String(x))}
                type="button"
                style={{ minWidth: 0, flex: "1 1 auto" }}
              >
                {fmtMoney(x)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Способы оплаты */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div className="h2">{t("payments.methods.title")}</div>
          </div>

          {oneSystems.length === 0 ? (
            <p className="p" style={{ marginTop: 8 }}>{t("payments.methods.empty")}</p>
          ) : (
            <div className="kv" style={{ marginTop: 12 }}>
              {oneSystems.map((ps, idx) => {
                const starsMethod = isStars(ps);
                const typeLabel   = starsMethod ? t("payments.methods.type.stars") : t("payments.methods.type.external");
                const badge       = starsMethod ? t("payments.methods.badge.stars") : t("payments.methods.badge.fast");
                return (
                  <div className="kv__item" key={ps.shm_url || idx}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span className="muted" style={{ fontSize: 12 }}>{typeLabel}</span>
                      <span className="chip chip--accent">{badge}</span>
                    </div>
                    <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 15 }}>
                      {ps.name || t("payments.methods.name_fallback")}
                    </div>
                    <button
                      className="btn btn--primary"
                      style={{ width: "100%", minHeight: 48, fontSize: 15, fontWeight: 900 }}
                      onClick={() => void handlePay(ps)}
                      type="button"
                    >
                      {t("payments.methods.pay")}{amountNumber ? ` · ${fmtMoney(amountNumber)}` : ""}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Перевод по карте */}
          <div className="kv__item" style={{ marginTop: oneSystems.length > 0 ? 4 : 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>{t("payments.methods.type.card")}</span>
              <span className="chip">{t("payments.methods.badge.manual")}</span>
            </div>
            <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 15 }}>
              {t("payments.methods.card_transfer")}
            </div>
            <button
              className="btn"
              style={{ width: "100%", minHeight: 44 }}
              type="button"
              onClick={() => {
                if (!amountNumber) {
                  toast.error("💸 Сначала сумму", { description: "Укажите сколько переводите — и тогда реквизиты." });
                  return;
                }
                setReqModal(true);
              }}
            >
              💳 {t("payments.methods.card_open")}
            </button>
          </div>

          <p className="p" style={{ marginTop: 12, opacity: 0.48, fontSize: 12 }}>{t("payments.methods.note")}</p>
        </div>
      </div>

      {/* История */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>🧾</span>
            <div className="h2">{t("payments.history.title")}</div>
          </div>
          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <Link className="btn" to="/payments/history">{t("payments.history.operations")}</Link>
            <Link className="btn" to="/payments/receipts">{t("payments.history.receipts")}</Link>
          </div>
        </div>
      </div>

      <RequisitesModal open={reqModal} onClose={() => setReqModal(false)} amountNumber={amountNumber} />
    </div>
  );
}

export default Payments;