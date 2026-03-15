import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
import { useI18n } from "../shared/i18n";
import { PageStatusCard } from "../shared/ui/PageStatusCard";

import { toast } from "../shared/ui/toast";
import { toastApiError } from "../shared/ui/toast/toastApiError";
import { getMood } from "../shared/payments-mood";
import { normalizeError } from "../shared/api/errorText";

type PaySystem = {
  name?: string;
  shm_url?: string;
  recurring?: string | number;
  amount?: number;
};

type PaysystemsResp = { ok: true; items: PaySystem[]; raw?: any };
type ForecastResp = { ok: true; raw: any };

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
  raw?: any;
};

function fmtMoney(n: number, cur = "RUB") {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${cur}`;
  }
}

function isStars(ps: PaySystem) {
  const name = String(ps?.name || "").toLowerCase();
  const url = String(ps?.shm_url || "").toLowerCase();
  return name.includes("stars") || url.includes("telegram_stars");
}

function safeOpen(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function copyText(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d]/g, "");
}

function formatCardPretty(card?: string) {
  const d = digitsOnly(card || "");
  if (!d) return "";
  return d.replace(/(.{4})/g, "$1 ").trim();
}

export function Payments() {
  const { t } = useI18n();

  const [page, setPage] = useState<"main" | "card">("main");
  const [loading, setLoading] = useState(true);

  // IMPORTANT: keep raw error, never store "shm_error" as UI string
  const [err, setErr] = useState<unknown>(null);

  const [amount, setAmount] = useState<string>("");
  const [paySystems, setPaySystems] = useState<PaySystem[]>([]);
  const [forecast, setForecast] = useState<any>(null);

  // card requisites
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState<unknown>(null);
  const [requisites, setRequisites] = useState<RequisitesResp["requisites"] | null>(null);

  // overlay
  const [overlay, setOverlay] = useState<{
    open: boolean;
    title: string;
    text: string;
  } | null>(null);

  // receipt upload
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const amountNumber = useMemo(() => {
    const v = Math.round(parseFloat(String(amount || "").replace(",", ".")));
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [amount]);

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const ps = (await apiFetch("/payments/paysystems", { method: "GET" })) as PaysystemsResp;
      const rawItems = ps?.items || [];

      // фильтр старых Stars из miniapp
      const filtered = rawItems.filter((x) => {
        const n = String(x?.name || "");
        if (n === "Telegram Stars Rescue") return false;
        if (n === "Telegram Stars Karlson") return false;
        return true;
      });

      setPaySystems(filtered);

      // forecast (dev only)
      try {
        const fc = (await apiFetch("/payments/forecast", { method: "GET" })) as ForecastResp;
        setForecast(fc?.raw ?? null);
      } catch {
        setForecast(null);
      }

      if (!amount) {
        const fallback = filtered.find((x) => Number(x?.amount || 0) > 0)?.amount;
        if (fallback) setAmount(String(Math.round(Number(fallback))));
      }
    } catch (e: unknown) {
      setErr(e);
      toastApiError(e, { title: t("payments.toast.load_failed", "Не удалось открыть оплату") });
    } finally {
      setLoading(false);
    }
  }

  async function loadRequisites() {
    setReqLoading(true);
    setReqError(null);

    try {
      const r = (await apiFetch("/payments/requisites", { method: "GET" })) as RequisitesResp;
      if (!r?.ok) throw r;
      setRequisites(r.requisites ?? null);
    } catch (e: unknown) {
      setRequisites(null);
      setReqError(e);
      toastApiError(e, { title: t("payments.toast.requisites_unavailable", "Реквизиты сейчас недоступны") });
    } finally {
      setReqLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page === "card") loadRequisites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function openOverlayForExternalPay(seed: string) {
    setOverlay({
      open: true,
      title: t("payments.overlay.title", "Страница оплаты открыта ✅"),
      text:
        t(
          "payments.overlay.text",
          "Если страница оплаты открылась в новой вкладке, завершите оплату там и вернитесь сюда.\nПосле оплаты нажмите «Проверить оплату».",
        ),
    });

    toast.info(t("payments.toast.payment_opened", "Страница оплаты открыта"), {
      description:
        getMood("payment_checking", { seed }) ??
        t("payments.toast.payment_opened.desc", "После оплаты нажмите «Проверить оплату»."),
    });
  }

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) {
      toast.error(t("payments.toast.method_unavailable", "Этот способ оплаты сейчас недоступен"), {
        description: t("payments.toast.method_unavailable.desc", "Для него не настроена ссылка на оплату."),
      });
      return;
    }

    if (!amountNumber || amountNumber < 1) {
      setUploadMsg(t("payments.validation.amount_invalid", "Введите корректную сумму."));
      toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
        description: t("payments.toast.enter_amount.desc", "Сумма должна быть больше 0."),
      });
      return;
    }

    const seed = `${ps.shm_url}|${amountNumber}`;
    const fullUrl = `${ps.shm_url}${amountNumber}`;

    safeOpen(fullUrl);
    openOverlayForExternalPay(seed);
  }

  async function removeAutopayment() {
    const ok = window.confirm(t("payments.autopay.confirm_remove", "Отвязать сохранённый способ оплаты?"));
    if (!ok) return;

    try {
      await apiFetch("/payments/autopayment", { method: "DELETE" });
      setUploadMsg(t("payments.autopay.removed", "Автоплатёж отключён."));
      toast.success(t("payments.toast.done", "Готово"), {
        description: t("payments.autopay.removed", "Автоплатёж отключён."),
      });
    } catch (e: unknown) {
      const n = normalizeError(e, { title: t("payments.autopay.remove_failed", "Не удалось отключить автоплатёж") });
      setUploadMsg(n.description || t("payments.autopay.remove_failed_desc", "Не удалось отключить автоплатёж."));
      toastApiError(e, { title: t("payments.autopay.remove_failed", "Не удалось отключить автоплатёж") });
    }
  }

  async function uploadReceipt(file: File) {
    if (!amountNumber || amountNumber < 1) {
      setUploadMsg(t("payments.receipt.amount_first", "Сначала укажите сумму в рублях."));
      toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
        description: t("payments.receipt.amount_first.desc", "Перед отправкой квитанции нужно указать сумму."),
      });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadMsg(t("payments.receipt.file_too_large", "Файл слишком большой. Максимум — 2 MB."));
      toast.error(t("payments.receipt.file_too_large.title", "Файл слишком большой"), {
        description: t("payments.receipt.file_too_large.desc", "Загрузите файл размером до 2 MB."),
      });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    toast.info(t("payments.receipt.uploading", "Отправляем квитанцию"), {
      description: t("payments.receipt.uploading.desc", "Это займёт пару секунд."),
    });

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("amount", String(amountNumber));

      const res = await fetch("/api/payments/receipt", {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}

      if (!res.ok || !json?.ok) {
        throw json ?? { status: res.status, message: `Upload failed (${res.status})` };
      }

      setUploadMsg(t("payments.receipt.sent_msg", "✅ Квитанция отправлена на проверку."));
      toast.success(t("payments.receipt.sent", "Квитанция отправлена"), {
        description: t("payments.receipt.sent.desc", "Мы получили её и проверим вручную."),
      });

      setTimeout(() => setUploadMsg(null), 5000);
    } catch (e: unknown) {
      const n = normalizeError(e, { title: t("payments.receipt.send_failed", "Не удалось отправить квитанцию") });
      setUploadMsg(n.description || t("payments.receipt.send_failed_desc", "Не удалось отправить квитанцию."));
      toastApiError(e, { title: t("payments.receipt.send_failed", "Не удалось отправить квитанцию") });
    } finally {
      setUploading(false);
    }
  }

  const quickAmounts = [100, 300, 500, 1000, 2000];

  if (loading) {
    return (
      <div className="section">
        <div className="page-status">
          <PageStatusCard
            title={t("payments.page.title", "Оплата")}
            text={t("payments.loading", "Загрузка…")}
          />
        </div>
      </div>
    );
  }

  if (err) {
    const n = normalizeError(err, { title: t("payments.page.title", "Оплата") });

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">{t("payments.page.title", "Оплата")}</div>

            <div className="p payments__mt6">
              {n.description ?? t("payments.error.text", "Не удалось загрузить способы оплаты. Попробуйте ещё раз.")}
            </div>

            <div className="actions actions--2 payments__mt12">
              <button className="btn btn--primary" onClick={load}>
                {t("payments.error.retry", "Повторить")}
              </button>
              <Link className="btn" to="/">
                {t("payments.error.home", "На главную")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section payments">
      {overlay?.open ? (
        <div className="overlay" onClick={() => setOverlay(null)}>
          <div className="overlay__card card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div className="payments__overlayTitle">{overlay.title}</div>
              <div className="p payments__mt8 payments__preLine">{overlay.text}</div>

              <div className="actions actions--2 payments__mt12">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    setOverlay(null);
                    toast.info(t("payments.toast.checking_status", "Проверяем оплату"), {
                      description: t("payments.toast.checking_status.desc", "Обновляем данные…"),
                    });
                    load();
                  }}
                >
                  {t("payments.overlay.refresh", "Проверить оплату")}
                </button>
                <button className="btn" onClick={() => setOverlay(null)}>
                  {t("payments.overlay.close", "Закрыть")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">{t("payments.page.title", "Оплата")}</div>
              <div className="p payments__mt6">
                {t(
                  "payments.page.sub",
                  "Укажите сумму и выберите удобный способ оплаты. После успешной оплаты баланс пополнится автоматически.",
                )}
              </div>
            </div>
          </div>

          {(import.meta as any)?.env?.DEV && forecast ? (
            <div className="pre payments__mt12">
              <b>{t("payments.dev.forecast", "Forecast (dev only):")}</b>
              <div className="payments__sp8" />
              {JSON.stringify(forecast, null, 2)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 payments__h18">{t("payments.amount.title", "Сумма")}</div>
            <div className="p payments__mt6">
              {t("payments.amount.sub", "Если сумма не подставилась автоматически, укажите её вручную.")}
            </div>

            <input
              className="input payments__amountInput"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("payments.amount.placeholder", "Сумма (₽)")}
              inputMode="numeric"
              autoComplete="off"
            />

            <div className="row payments__mt10 payments__gap8">
              {quickAmounts.map((x) => (
                <button
                  key={x}
                  className="btn payments__quickBtn"
                  onClick={() => setAmount(String(x))}
                  title={fmtMoney(x, "RUB")}
                >
                  {fmtMoney(x, "RUB")}
                </button>
              ))}
            </div>

            {uploadMsg ? <div className="pre payments__mt12">{uploadMsg}</div> : null}
          </div>
        </div>
      </div>

      {page === "main" ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1 payments__h18">{t("payments.methods.title", "Способы оплаты")}</div>
              <div className="p payments__mt6">
                {t("payments.methods.sub", "Внешняя оплата откроется в новой вкладке.")}
              </div>

              <div className="actions actions--1 payments__mt12">
                <button
                  className="btn payments__w100"
                  onClick={() => {
                    if (!amountNumber) {
                      setUploadMsg(t("payments.validation.enter_amount", "Введите сумму."));
                      toast.error(t("payments.toast.enter_amount", "Введите сумму"), {
                        description: t("payments.card_transfer.need_amount", "Для перевода по реквизитам нужно указать сумму."),
                      });
                      return;
                    }
                    setPage("card");
                  }}
                >
                  {t("payments.methods.card_transfer", "Перевод по карте 💳")}
                </button>
              </div>

              <div className="payments__mt12" />

              {paySystems.length === 0 ? (
                <div className="pre">{t("payments.methods.empty", "Способы оплаты пока недоступны.")}</div>
              ) : (
                <div className="kv">
                  {paySystems.map((ps, idx) => (
                    <div className="kv__item" key={ps.shm_url || idx}>
                      <div className="row payments__rowBetween">
                        <div className="kv__k">
                          {ps.recurring
                            ? t("payments.methods.type.autopay", "Автоплатёж")
                            : isStars(ps)
                              ? t("payments.methods.type.stars", "Оплата через Telegram Stars")
                              : t("payments.methods.type.external", "Внешняя оплата")}
                        </div>
                        <span className="badge">
                          {ps.recurring
                            ? t("payments.methods.badge.recurring", "recurring")
                            : t("payments.methods.badge.one_time", "one-time")}
                        </span>
                      </div>

                      <div className="kv__v payments__mt6">
                        {ps.name || t("payments.methods.name_fallback", "Способ оплаты")}
                      </div>

                      <div className="actions actions--1 payments__mt10">
                        <button className="btn btn--primary payments__w100" onClick={() => handlePay(ps)}>
                          {t("payments.methods.pay", "Оплатить")}
                          {amountNumber ? ` · ${fmtMoney(amountNumber, "RUB")}` : ""}
                        </button>
                      </div>

                      {ps.recurring ? (
                        <div className="actions actions--1 payments__mt10">
                          <button
                            className="btn btn--danger payments__w100"
                            onClick={removeAutopayment}
                            title={t("payments.autopay.remove", "Отключить автоплатёж")}
                          >
                            {t("payments.autopay.remove_short", "Отключить")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <div className="p payments__mt12 payments__finePrint">
                {t(
                  "payments.methods.note",
                  "Даже если Telegram недоступен, оплата и отправка квитанции продолжат работать через приложение.",
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="home-block-head">
                <div>
                  <div className="h1">{t("payments.card_page.title", "Перевод по карте")}</div>
                  <div className="p payments__mt6">
                    {t("payments.card_page.sub", "Сделайте перевод и отправьте квитанцию. Мы проверим её вручную.")}
                  </div>
                </div>
              </div>

              <div className="kv payments__mt12">
                <div className="kv__item">
                  <div className="kv__k">{t("payments.card_page.amount_label", "Сумма перевода")}</div>
                  <div className="kv__v payments__amountBig">
                    {amountNumber ? fmtMoney(amountNumber, "RUB") : "—"}
                  </div>
                </div>
              </div>

              <div className="card payments__warnCard">
                <div className="card__body payments__warnBody">
                  <div className="payments__bold">{t("payments.card_page.important", "Важно")}</div>
                  <div className="p payments__mt6 payments__opacity95">
                    {t(
                      "payments.card_page.important_text",
                      "После перевода обязательно отправьте квитанцию. Без неё мы не сможем проверить и зачислить платёж.",
                    )}
                  </div>
                </div>
              </div>

              <div className="card payments__flatCard">
                <div className="card__body">
                  <div className="h1 payments__h18">{t("payments.requisites.title", "Реквизиты")}</div>

                  {reqLoading ? (
                    <div className="p payments__mt6">{t("payments.requisites.loading", "Загружаем реквизиты…")}</div>
                  ) : reqError ? (
                    <div className="pre payments__mt12">
                      {normalizeError(reqError, { title: t("payments.requisites.title", "Реквизиты") }).description ??
                        t("payments.requisites.error", "Реквизиты пока недоступны. Попробуйте немного позже.")}
                    </div>
                  ) : !requisites ? (
                    <div className="pre payments__mt12">{t("payments.requisites.empty", "Реквизиты пока не добавлены.")}</div>
                  ) : (
                    (() => {
                      const holder = String(requisites.holder ?? "").trim();
                      const cardRaw = String(requisites.card ?? "").trim();
                      const cardPretty = formatCardPretty(cardRaw) || cardRaw;

                      return (
                        <>
                          <div className="kv payments__mt12">
                            {holder ? (
                              <div className="kv__item">
                                <div className="kv__k">{t("payments.requisites.holder", "Получатель")}</div>
                                <div className="kv__v payments__bold">{holder}</div>
                              </div>
                            ) : null}

                            {cardPretty ? (
                              <div className="kv__item">
                                <div className="kv__k">{t("payments.requisites.card", "Номер карты")}</div>
                                <div className="kv__v payments__cardNumber">{cardPretty}</div>
                                <div className="row payments__mt8 payments__gap8 payments__alignCenter">
                                  <span className="badge">{t("payments.requisites.card_badge", "МИР")}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="actions actions--2 payments__mt12">
                            <button
                              className="btn btn--primary"
                              onClick={() => {
                                if (cardRaw) {
                                  copyText(cardRaw);
                                  toast.success(t("payments.requisites.copied", "Скопировано"), {
                                    description: t(
                                      "payments.requisites.copied.desc",
                                      "Номер карты скопирован в буфер обмена.",
                                    ),
                                  });
                                }
                              }}
                              disabled={!cardRaw}
                            >
                              {t("payments.requisites.copy_card", "Скопировать номер карты")}
                            </button>

                            <label className="btn payments__fileBtn">
                              {uploading
                                ? t("payments.receipt.uploading_short", "⏳ Отправляем…")
                                : t("payments.receipt.upload_btn", "🧾 Отправить квитанцию")}
                              <input
                                type="file"
                                accept=".jpg,.jpeg,.png,.pdf"
                                className="payments__fileInput"
                                disabled={uploading}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  uploadReceipt(f);
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>

                          {uploadMsg ? <div className="pre payments__mt12">{uploadMsg}</div> : null}

                          <div className="p payments__mt10 payments__finePrint">
                            {t("payments.receipt.supported", "Поддерживаются JPG, PNG и PDF до 2 MB.")}
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </div>

              <div className="actions actions--1 payments__mt12">
                <button className="btn payments__w100" onClick={() => setPage("main")}>
                  {t("payments.card_page.back", "⇦ Назад к способам оплаты")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 payments__h18">{t("payments.history.title", "История")}</div>
            <div className="p payments__mt6">
              {t(
                "payments.history.sub",
                "Здесь можно посмотреть прошлые операции и отправленные квитанции.",
              )}
            </div>
            <div className="actions actions--2 payments__mt12">
              <Link className="btn" to="/payments/history">
                {t("payments.history.operations", "История операций")}
              </Link>
              <Link className="btn" to="/payments/receipts">
                {t("payments.history.receipts", "Квитанции")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}