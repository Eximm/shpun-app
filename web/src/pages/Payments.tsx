// web/src/pages/Payments.tsx

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  } catch {
    return `${n} ${cur}`;
  }
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d]/g, "");
}

function formatCardPretty(card?: string) {
  const d = digitsOnly(card || "");
  return d ? d.replace(/(.{4})/g, "$1 ").trim() : "";
}

function isStars(ps: PaySystem) {
  const n = String(ps?.name || "").toLowerCase();
  const u = String(ps?.shm_url || "").toLowerCase();
  return n.includes("stars") || u.includes("telegram_stars");
}

function safeOpen(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function copyText(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

/**
 * Парсим forecast.raw — биллинг возвращает данные в разных форматах.
 * Возвращаем { amount, date } если удалось распарсить.
 */
function parseForecast(raw: any): { amount: number | null; date: string | null } {
  if (!raw || typeof raw !== "object") return { amount: null, date: null };

  const data0 = Array.isArray(raw.data) && raw.data.length ? raw.data[0] : null;
  const amount = typeof data0?.total === "number" && Number.isFinite(data0.total)
    ? data0.total : null;
  const date = typeof raw.date === "string" && raw.date ? raw.date : null;

  return { amount, date };
}

function fmtForecastDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

/* ─── Requisites Modal ───────────────────────────────────────────────────── */

function RequisitesModal({
  open,
  onClose,
  amountNumber,
}: {
  open: boolean;
  onClose: () => void;
  amountNumber: number | null;
}) {
  const { t } = useI18n();

  const [reqLoading,  setReqLoading]  = useState(false);
  const [reqError,    setReqError]    = useState<unknown>(null);
  const [requisites,  setRequisites]  = useState<RequisitesResp["requisites"] | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [uploadMsg,   setUploadMsg]   = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUploadMsg(null);
      return;
    }
    void loadRequisites();
  }, [open]);

  async function loadRequisites() {
    setReqLoading(true);
    setReqError(null);
    try {
      const r = await apiFetch("/payments/requisites", { method: "GET" }) as RequisitesResp;
      if (!r?.ok) throw r;
      setRequisites(r.requisites ?? null);
    } catch (e) {
      setRequisites(null);
      setReqError(e);
    } finally {
      setReqLoading(false);
    }
  }

  async function uploadReceipt(file: File) {
    if (!amountNumber || amountNumber < 1) {
      toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
        description: t("payments.receipt.amount_first.desc", "Перед отправкой квитанции нужно указать сумму."),
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("payments.receipt.file_too_large.title", "Файл слишком большой"), {
        description: t("payments.receipt.file_too_large.desc", "Загрузите файл размером до 2 MB."),
      });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("amount", String(amountNumber));

      const json = await apiFetch("/payments/receipt", { method: "POST", body: fd }) as ReceiptUploadResp;

      if (!json?.ok) throw json ?? { message: "receipt_upload_failed" };

      setUploadMsg(t("payments.receipt.sent_msg", "✅ Квитанция отправлена на проверку."));
      toast.success(t("payments.receipt.sent", "Квитанция отправлена"), {
        description: t("payments.receipt.sent.desc", "Мы получили её и проверим вручную."),
      });

      setTimeout(() => setUploadMsg(null), 5000);
    } catch (e) {
      toastApiError(e, { title: t("payments.receipt.send_failed", "Не удалось отправить квитанцию") });
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;

  const cardRaw    = String(requisites?.card   ?? "").trim();
  const cardPretty = formatCardPretty(cardRaw) || cardRaw;
  const holder     = String(requisites?.holder ?? "").trim();

  return createPortal(
    <div role="dialog" aria-modal="true" className="modal" onMouseDown={onClose}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__head">
            <div className="modal__title">{t("payments.card_page.title", "Перевод по карте")}</div>
            <button className="btn modal__close" onClick={onClose} aria-label={t("common.close", "Закрыть")} type="button">✕</button>
          </div>

          <div className="modal__content">

            {/* Критическое предупреждение — сразу бросается в глаза */}
            <div style={{
              background: "rgba(255,80,80,0.12)",
              border: "1px solid rgba(255,80,80,0.35)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 16,
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                ⚠️ {t("payments.card_page.receipt_required", "Без квитанции платёж не зачислится")}
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                {t("payments.card_page.receipt_required_text",
                  "После перевода обязательно отправьте квитанцию — иначе мы не сможем определить платёж и зачислить его на баланс."
                )}
              </div>
            </div>

            {/* Реквизиты */}
            {reqLoading ? (
              <p className="p">{t("payments.requisites.loading", "Загружаем реквизиты…")}</p>
            ) : reqError ? (
              <div className="pre">
                {t("payments.requisites.error", "Реквизиты сейчас недоступны. Попробуйте позже.")}
              </div>
            ) : !requisites ? (
              <div className="pre">{t("payments.requisites.empty", "Реквизиты не добавлены.")}</div>
            ) : (
              <div className="kv">
                <div className="kv__item">
                  <div className="kv__k">{t("payments.card_page.amount_label", "Сумма перевода")}</div>
                  <div className="kv__v" style={{ fontSize: 20, fontWeight: 700 }}>
                    {amountNumber ? fmtMoney(amountNumber) : "—"}
                  </div>
                </div>

                {holder ? (
                  <div className="kv__item">
                    <div className="kv__k">{t("payments.requisites.holder", "Получатель")}</div>
                    <div className="kv__v" style={{ fontWeight: 600 }}>{holder}</div>
                  </div>
                ) : null}

                {cardPretty ? (
                  <div className="kv__item">
                    <div className="kv__k">{t("payments.requisites.card", "Номер карты")}</div>
                    <div className="kv__v" style={{ fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }}>
                      {cardPretty}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Шаги */}
            <div className="pre" style={{ marginTop: 12 }}>
              <div>1. {t("payments.card_page.step_1", "Скопируйте номер карты и сделайте перевод на указанную сумму.")}</div>
              <div>2. {t("payments.card_page.step_2", "Сразу после перевода нажмите «Отправить квитанцию».")}</div>
              <div>3. {t("payments.card_page.step_3", "Дождитесь проверки — баланс пополнится в течение часа.")}</div>
            </div>

            {/* Действия — квитанция главная, копирование вторично */}
            <div className="actions actions--1" style={{ marginTop: 16 }}>
              <label className="btn btn--primary" style={{ cursor: "pointer", textAlign: "center" }}>
                <span>
                  {uploading
                    ? t("payments.receipt.uploading_short", "⏳ Отправляем…")
                    : t("payments.receipt.upload_btn", "🧾 Я перевёл — отправить квитанцию")}
                </span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  style={{ display: "none" }}
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void uploadReceipt(f);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {cardRaw ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    copyText(cardRaw);
                    toast.success(t("payments.requisites.copied", "Номер карты скопирован"), {
                      description: t("payments.requisites.copied.desc", "Сделайте перевод и не забудьте отправить квитанцию."),
                    });
                  }}
                >
                  📋 {t("payments.requisites.copy_card", "Скопировать номер карты")}
                </button>
              ) : null}
            </div>

            {uploadMsg ? <div className="pre" style={{ marginTop: 12 }}>{uploadMsg}</div> : null}

            <p className="p" style={{ marginTop: 10, opacity: 0.5, fontSize: 12 }}>
              {t("payments.receipt.supported", "JPG, PNG или PDF · до 2 MB")}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export function Payments() {
  const { t } = useI18n();

  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState<unknown>(null);
  const [amount,      setAmount]      = useState<string>("");
  const [paySystems,  setPaySystems]  = useState<PaySystem[]>([]);
  const [forecast,    setForecast]    = useState<any>(null);
  const [reqModal,    setReqModal]    = useState(false);
  const [checkingPay, setCheckingPay] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  

  const amountNumber = useMemo(() => {
    const v = Math.round(parseFloat(String(amount || "").replace(",", ".")));
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [amount]);

  const { amount: forecastAmount, date: forecastDate } = useMemo(
    () => parseForecast(forecast),
    [forecast]
  );

  // Разделяем способы: recurring отдельно, остальные в основной список
  const recurringSystem = paySystems.find((x) => x.recurring);
  const oneSystems      = paySystems.filter((x) => !x.recurring);

  async function load() {
    setLoading(true);
    setErr(null);
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

        // Подставляем сумму из прогноза если поле ещё пустое
        if (!amount) {
          const { amount: fa } = parseForecast(fc?.raw ?? null);
          if (fa && fa > 0) setAmount(String(Math.round(fa)));
          else {
            const fallback = rawItems.find((x) => Number(x?.amount || 0) > 0)?.amount;
            if (fallback) setAmount(String(Math.round(Number(fallback))));
          }
        }
      } catch {
        setForecast(null);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) {
      toast.error(t("payments.toast.method_unavailable", "Способ оплаты недоступен"));
      return;
    }
    if (!amountNumber || amountNumber < 1) {
      toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
        description: t("payments.toast.enter_amount.desc", "Сумма должна быть больше 0."),
      });
      return;
    }

    const seed    = `${ps.shm_url}|${amountNumber}`;
    const fullUrl = `${ps.shm_url}${amountNumber}`;

    safeOpen(fullUrl);
    setShowOverlay(true);

    toast.info(t("payments.toast.payment_opened", "Страница оплаты открыта"), {
      description: getMood("payment_checking", { seed }) ??
        t("payments.toast.payment_opened.desc", "После оплаты нажмите «Проверить оплату»."),
    });
  }

  async function removeAutopayment() {
    if (!window.confirm(t("payments.autopay.confirm_remove", "Отвязать сохранённый способ оплаты?"))) return;
    try {
      await apiFetch("/payments/autopayment", { method: "DELETE" });
      toast.success(t("payments.toast.done", "Готово"), {
        description: t("payments.autopay.removed", "Автоплатёж отключён."),
      });
      void load();
    } catch (e) {
      toastApiError(e, { title: t("payments.autopay.remove_failed", "Не удалось отключить автоплатёж") });
    }
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
          <div className="app-loader__text">{t("payments.loading", "Загружаем оплату…")}</div>
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
            <div className="h1">{t("payments.page.title", "Оплата")}</div>
            <p className="p" style={{ marginTop: 8 }}>
              {normalizeError(err).description ?? t("payments.error.text", "Не удалось загрузить способы оплаты.")}
            </p>
            <div className="actions actions--2" style={{ marginTop: 16 }}>
              <button className="btn btn--primary" onClick={() => void load()} type="button">
                {t("payments.error.retry", "Повторить")}
              </button>
              <Link className="btn" to="/">{t("payments.error.home", "На главную")}</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="section">

      {/* Overlay после открытия внешней оплаты */}
      {showOverlay ? (
        <div className="overlay" onClick={() => setShowOverlay(false)}>
          <div className="overlay__card card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="payments__overlayTitle">
                {t("payments.overlay.title", "Страница оплаты открыта ✅")}
              </div>
              <p className="p" style={{ marginTop: 8 }}>
                {t("payments.overlay.text", "Завершите оплату в открывшейся вкладке и вернитесь сюда.")}
              </p>
              <div className="actions actions--2" style={{ marginTop: 16 }}>
                <button
                  className="btn btn--primary"
                  disabled={checkingPay}
                  onClick={async () => {
                    setCheckingPay(true);
                    setShowOverlay(false);
                    toast.info(t("payments.toast.checking_status", "Проверяем оплату"), {
                      description: t("payments.toast.checking_status.desc", "Обновляем данные…"),
                    });
                    await load();
                    setCheckingPay(false);
                  }}
                  type="button"
                >
                  {checkingPay ? "…" : t("payments.overlay.refresh", "Проверить оплату")}
                </button>
                <button className="btn" onClick={() => setShowOverlay(false)} type="button">
                  {t("payments.overlay.close", "Закрыть")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Заголовок */}
      <div className="card">
        <div className="card__body">
          <div className="h1">{t("payments.page.title", "Оплата")}</div>
          <p className="p" style={{ marginTop: 4 }}>
            {t("payments.page.sub", "Выберите удобный способ — баланс пополнится автоматически.")}
          </p>
        </div>
      </div>

      {/* Автоплатёж */}
      {recurringSystem ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__body">
            <div className="h1" style={{ fontSize: 16 }}>
              {t("payments.autopay.title", "Автоплатёж")}
            </div>
            <p className="p" style={{ marginTop: 4 }}>
              {recurringSystem.name || t("payments.autopay.name_fallback", "Сохранённый способ")}
            </p>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
              <button
                className="btn btn--primary"
                onClick={() => void handlePay(recurringSystem)}
                type="button"
              >
                {t("payments.autopay.pay_now", "Пополнить сейчас")}
                {amountNumber ? ` · ${fmtMoney(amountNumber)}` : ""}
              </button>
              <button
                className="btn btn--danger"
                onClick={() => void removeAutopayment()}
                type="button"
              >
                {t("payments.autopay.remove_short", "Отключить")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Сумма */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="h1" style={{ fontSize: 16 }}>{t("payments.amount.title", "Сумма пополнения")}</div>

          {/* Прогноз */}
          {forecastAmount ? (
            <p className="p" style={{ marginTop: 4, opacity: 0.75 }}>
              {t("payments.forecast.hint", "Следующая оплата")}
              {": "}
              <strong>{fmtMoney(forecastAmount)}</strong>
              {forecastDate ? ` · ${fmtForecastDate(forecastDate)}` : ""}
            </p>
          ) : null}

          <input
            className="input"
            style={{ marginTop: 10 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("payments.amount.placeholder", "Введите сумму (₽)")}
            inputMode="numeric"
            autoComplete="off"
          />

          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            {quickAmounts.map((x) => (
              <button
                key={x}
                className={`btn ${amountNumber === x ? "btn--primary" : ""}`}
                onClick={() => setAmount(String(x))}
                type="button"
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
          <div className="h1" style={{ fontSize: 16 }}>{t("payments.methods.title", "Способы оплаты")}</div>

          {oneSystems.length === 0 ? (
            <p className="p" style={{ marginTop: 8 }}>
              {t("payments.methods.empty", "Способы оплаты пока недоступны.")}
            </p>
          ) : (
            <div className="kv" style={{ marginTop: 12 }}>
              {oneSystems.map((ps, idx) => {
                const isStarsMethod = isStars(ps);
                const typeLabel = isStarsMethod
                  ? t("payments.methods.type.stars", "Telegram Stars")
                  : t("payments.methods.type.external", "Внешняя оплата");
                const badge = isStarsMethod
                  ? t("payments.methods.badge.stars", "⭐ Stars")
                  : t("payments.methods.badge.fast", "Быстро");

                return (
                  <div className="kv__item" key={ps.shm_url || idx}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span className="p" style={{ opacity: 0.6, fontSize: 12 }}>{typeLabel}</span>
                      <span className="chip chip--soft">{badge}</span>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                      {ps.name || t("payments.methods.name_fallback", "Оплатить")}
                    </div>
                    <button
                      className="btn btn--primary"
                      style={{ width: "100%" }}
                      onClick={() => void handlePay(ps)}
                      type="button"
                    >
                      {t("payments.methods.pay", "Оплатить")}
                      {amountNumber ? ` · ${fmtMoney(amountNumber)}` : ""}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Перевод по карте — вторичный вариант */}
          <div className="kv__item" style={{ marginTop: oneSystems.length > 0 ? 4 : 0 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="p" style={{ opacity: 0.6, fontSize: 12 }}>
                {t("payments.methods.type.card", "Банковский перевод")}
              </span>
              <span className="chip">{t("payments.methods.badge.manual", "Вручную")}</span>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {t("payments.methods.card_transfer", "Перевод по карте")}
            </div>
            <button
              className="btn"
              style={{ width: "100%" }}
              onClick={() => {
                if (!amountNumber) {
                  toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
                    description: t("payments.card_transfer.need_amount", "Для перевода нужно указать сумму."),
                  });
                  return;
                }
                setReqModal(true);
              }}
              type="button"
            >
              💳 {t("payments.methods.card_open", "Показать реквизиты")}
            </button>
          </div>

          <p className="p" style={{ marginTop: 12, opacity: 0.5, fontSize: 12 }}>
            {t("payments.methods.note", "Даже если Telegram недоступен, оплата продолжит работать через приложение.")}
          </p>
        </div>
      </div>

      {/* История */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <div className="h1" style={{ fontSize: 16 }}>{t("payments.history.title", "История")}</div>
          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <Link className="btn" to="/payments/history">
              {t("payments.history.operations", "Операции")}
            </Link>
            <Link className="btn" to="/payments/receipts">
              {t("payments.history.receipts", "Квитанции")}
            </Link>
          </div>
        </div>
      </div>

      {/* Модалка реквизитов */}
      <RequisitesModal
        open={reqModal}
        onClose={() => setReqModal(false)}
        amountNumber={amountNumber}
      />
    </div>
  );
}

export default Payments;