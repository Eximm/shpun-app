import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../shared/api/client";
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
      // user-friendly toast
      toastApiError(e, { title: "Не удалось загрузить оплату" });
    } finally {
      setLoading(false);
    }
  }

  async function loadRequisites() {
    setReqLoading(true);
    setReqError(null);

    try {
      const r = (await apiFetch("/payments/requisites", { method: "GET" })) as RequisitesResp;
      if (!r?.ok) throw r; // keep raw payload if backend returned it
      setRequisites(r.requisites ?? null);
    } catch (e: unknown) {
      setRequisites(null);
      setReqError(e);
      toastApiError(e, { title: "Реквизиты недоступны" });
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
      title: "Окно оплаты открыто ✅",
      text:
        "Если оплата открылась в новой вкладке — завершите её там и вернитесь сюда.\n" +
        "После оплаты можно закрыть вкладку и нажать “Обновить статус”.",
    });

    toast.info("Окно оплаты открыто", {
      description: getMood("payment_checking", { seed }) ?? "После оплаты нажмите “Обновить статус”.",
    });
  }

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) {
      toast.error("Оплата недоступна", { description: "У этого способа оплаты нет ссылки." });
      return;
    }

    if (!amountNumber || amountNumber < 1) {
      setUploadMsg("Введите корректную сумму.");
      toast.error("Введите сумму", { description: "Нужна сумма больше 0." });
      return;
    }

    const seed = `${ps.shm_url}|${amountNumber}`;
    const fullUrl = `${ps.shm_url}${amountNumber}`;

    safeOpen(fullUrl);
    openOverlayForExternalPay(seed);
  }

  async function removeAutopayment() {
    const ok = window.confirm("Отвязать сохраненный способ оплаты?");
    if (!ok) return;

    try {
      await apiFetch("/payments/autopayment", { method: "DELETE" });
      setUploadMsg("Автоплатёж удалён.");
      toast.success("Готово", { description: "Автоплатёж удалён." });
    } catch (e: unknown) {
      const n = normalizeError(e, { title: "Не удалось отвязать" });
      setUploadMsg(n.description || "Не удалось удалить автоплатёж");
      toastApiError(e, { title: "Не удалось отвязать" });
    }
  }

  async function uploadReceipt(file: File) {
    if (!amountNumber || amountNumber < 1) {
      setUploadMsg("Сначала введите сумму (в рублях).");
      toast.error("Введите сумму", { description: "Перед отправкой квитанции нужна сумма." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadMsg("Файл слишком большой. Максимум 2MB.");
      toast.error("Файл слишком большой", { description: "Максимум 2MB." });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    toast.info("Отправляем квитанцию", { description: "Пара секунд…" });

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
        // Keep raw error payload if present, so normalizeError can map code/message.
        throw json ?? { status: res.status, message: `Upload failed (${res.status})` };
      }

      setUploadMsg("✅ Квитанция отправлена на проверку.");
      toast.success("Квитанция отправлена", {
        description: "Принято. Проверка — вручную.",
      });

      setTimeout(() => setUploadMsg(null), 5000);
    } catch (e: unknown) {
      const n = normalizeError(e, { title: "Не удалось отправить" });
      setUploadMsg(n.description || "Ошибка при отправке квитанции");
      toastApiError(e, { title: "Не удалось отправить" });
    } finally {
      setUploading(false);
    }
  }

  const quickAmounts = [100, 300, 500, 1000, 2000];

  if (loading) {
    return (
      <div className="section">
        <div className="page-status">
          <PageStatusCard title="Оплата" text="Загрузка..." />
        </div>
      </div>
    );
  }

  if (err) {
    const n = normalizeError(err, { title: "Оплата" });

    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Оплата</div>

            <div className="p payments__mt6">
              {n.description ?? "Не удалось загрузить оплату. Попробуйте ещё раз."}
            </div>

            <div className="actions actions--2 payments__mt12">
              <button className="btn btn--primary" onClick={load}>
                Повторить
              </button>
              <Link className="btn" to="/">
                На главную
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section payments">
      {/* Overlay */}
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
                    toast.info("Обновляем статус", { description: "Проверяем данные…" });
                    load();
                  }}
                >
                  Обновить статус
                </button>
                <button className="btn" onClick={() => setOverlay(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="card">
        <div className="card__body">
          <div className="home-block-head">
            <div>
              <div className="h1">Оплата</div>
              <div className="p payments__mt6">
                Введите сумму и выберите способ — пополнение баланса происходит автоматически после успешной оплаты.
              </div>
            </div>
          </div>

          {(import.meta as any)?.env?.DEV && forecast ? (
            <div className="pre payments__mt12">
              <b>Forecast (dev only):</b>
              <div className="payments__sp8" />
              {JSON.stringify(forecast, null, 2)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Amount */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 payments__h18">Сумма</div>
            <div className="p payments__mt6">Если сумма не подставилась автоматически — впишите вручную.</div>

            <input
              className="input payments__amountInput"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Сумма (₽)"
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

      {/* Pay methods */}
      {page === "main" ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1 payments__h18">Способы оплаты</div>
              <div className="p payments__mt6">Внешние оплаты откроются в новой вкладке.</div>

              <div className="actions actions--1 payments__mt12">
                <button
                  className="btn payments__w100"
                  onClick={() => {
                    if (!amountNumber) {
                      setUploadMsg("Введите сумму.");
                      toast.error("Введите сумму", { description: "Нужна сумма для перевода по реквизитам." });
                      return;
                    }
                    setPage("card");
                  }}
                >
                  Перевод по реквизитам 💳
                </button>
              </div>

              <div className="payments__mt12" />

              {paySystems.length === 0 ? (
                <div className="pre">Платёжные способы не найдены.</div>
              ) : (
                <div className="kv">
                  {paySystems.map((ps, idx) => (
                    <div className="kv__item" key={ps.shm_url || idx}>
                      <div className="row payments__rowBetween">
                        <div className="kv__k">{ps.recurring ? "Автоплатёж" : isStars(ps) ? "Stars / внешняя" : "Внешняя оплата"}</div>
                        <span className="badge">{ps.recurring ? "recurring" : "one-time"}</span>
                      </div>

                      <div className="kv__v payments__mt6">{ps.name || "Payment method"}</div>

                      <div className="actions actions--1 payments__mt10">
                        <button className="btn btn--primary payments__w100" onClick={() => handlePay(ps)}>
                          Оплатить {amountNumber ? `· ${fmtMoney(amountNumber, "RUB")}` : ""}
                        </button>
                      </div>

                      {ps.recurring ? (
                        <div className="actions actions--1 payments__mt10">
                          <button
                            className="btn btn--danger payments__w100"
                            onClick={removeAutopayment}
                            title="Отвязать автоплатёж"
                          >
                            Отвязать
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <div className="p payments__mt12 payments__finePrint">
                Если Telegram у пользователя заблокирован — это не мешает оплате и отправке квитанции: всё идёт через наш
                сервер.
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Card transfer page — clean */
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="home-block-head">
                <div>
                  <div className="h1">Перевод по реквизитам</div>
                  <div className="p payments__mt6">Сделайте перевод и отправьте квитанцию. Проверка — вручную.</div>
                </div>
              </div>

              {/* Amount */}
              <div className="kv payments__mt12">
                <div className="kv__item">
                  <div className="kv__k">Сумма к переводу</div>
                  <div className="kv__v payments__amountBig">{amountNumber ? fmtMoney(amountNumber, "RUB") : "—"}</div>
                </div>
              </div>

              {/* IMPORTANT */}
              <div className="card payments__warnCard">
                <div className="card__body payments__warnBody">
                  <div className="payments__bold">Важно</div>
                  <div className="p payments__mt6 payments__opacity95">
                    Квитанция обязательна. Без квитанции перевод не будет зачислен — это ручная проверка.
                  </div>
                </div>
              </div>

              {/* Requisites */}
              <div className="card payments__flatCard">
                <div className="card__body">
                  <div className="h1 payments__h18">Реквизиты</div>

                  {reqLoading ? (
                    <div className="p payments__mt6">Загрузка реквизитов…</div>
                  ) : reqError ? (
                    <div className="pre payments__mt12">
                      {normalizeError(reqError, { title: "Реквизиты" }).description ?? "Реквизиты пока недоступны. Попробуйте позже."}
                    </div>
                  ) : !requisites ? (
                    <div className="pre payments__mt12">Реквизиты не заполнены.</div>
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
                                <div className="kv__k">Получатель</div>
                                <div className="kv__v payments__bold">{holder}</div>
                              </div>
                            ) : null}

                            {cardPretty ? (
                              <div className="kv__item">
                                <div className="kv__k">Номер карты</div>
                                <div className="kv__v payments__cardNumber">{cardPretty}</div>
                                <div className="row payments__mt8 payments__gap8 payments__alignCenter">
                                  <span className="badge">МИР</span>
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
                                  toast.success("Скопировано", { description: "Номер карты в буфере обмена." });
                                }
                              }}
                              disabled={!cardRaw}
                            >
                              Скопировать карту
                            </button>

                            <label className="btn payments__fileBtn">
                              {uploading ? "⏳ Отправляем…" : "🧾 Отправить квитанцию"}
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

                          <div className="p payments__mt10 payments__finePrint">Поддерживаются JPG/PNG/PDF до 2MB.</div>
                        </>
                      );
                    })()
                  )}
                </div>
              </div>

              <div className="actions actions--1 payments__mt12">
                <button className="btn payments__w100" onClick={() => setPage("main")}>
                  ⇦ Назад к способам оплаты
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Secondary navigation — bottom */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1 payments__h18">История</div>
            <div className="p payments__mt6">
              Если нужно проверить операции или посмотреть отправленные квитанции — откройте разделы ниже.
            </div>
            <div className="actions actions--2 payments__mt12">
              <Link className="btn" to="/payments/history">
                История операций
              </Link>
              <Link className="btn" to="/payments/receipts">
                Квитанции
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}