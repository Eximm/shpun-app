import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../shared/api/client'

type PaySystem = {
  name?: string
  shm_url?: string
  recurring?: string | number
  amount?: number
}

type PaysystemsResp = { ok: true; items: PaySystem[]; raw?: any }
type ForecastResp = { ok: true; raw: any }

type RequisitesResp = {
  ok: boolean
  requisites?: {
    title?: string
    holder?: string
    bank?: string
    card?: string
    comment?: string
    updated_at?: string
  }
  raw?: any
}

function fmtMoney(n: number, cur = 'RUB') {
  const v = Number(n || 0)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    }).format(v)
  } catch {
    return `${v} ${cur}`
  }
}

function isStars(ps: PaySystem) {
  const name = String(ps?.name || '').toLowerCase()
  const url = String(ps?.shm_url || '').toLowerCase()
  return name.includes('stars') || url.includes('telegram_stars')
}

function safeOpen(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function copyText(text: string) {
  if (!text) return
  navigator.clipboard?.writeText(text).catch(() => {})
}

function digitsOnly(s: string) {
  return String(s || '').replace(/[^\d]/g, '')
}

function formatCardPretty(card?: string) {
  const d = digitsOnly(card || '')
  if (!d) return ''
  return d.replace(/(.{4})/g, '$1 ').trim()
}

export function Payments() {
  const [page, setPage] = useState<'main' | 'card'>('main')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [amount, setAmount] = useState<string>('')
  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [forecast, setForecast] = useState<any>(null)

  // card requisites
  const [reqLoading, setReqLoading] = useState(false)
  const [reqError, setReqError] = useState<string | null>(null)
  const [requisites, setRequisites] = useState<RequisitesResp['requisites'] | null>(null)

  // overlay
  const [overlay, setOverlay] = useState<{
    open: boolean
    title: string
    text: string
  } | null>(null)

  // receipt upload
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  const amountNumber = useMemo(() => {
    const v = Math.round(parseFloat(String(amount || '').replace(',', '.')))
    return Number.isFinite(v) && v > 0 ? v : null
  }, [amount])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const ps = (await apiFetch('/payments/paysystems', { method: 'GET' })) as PaysystemsResp
      const rawItems = ps?.items || []

      // фильтр старых Stars из miniapp
      const filtered = rawItems.filter((x) => {
        const n = String(x?.name || '')
        if (n === 'Telegram Stars Rescue') return false
        if (n === 'Telegram Stars Karlson') return false
        return true
      })

      setPaySystems(filtered)

      // forecast (dev only)
      try {
        const fc = (await apiFetch('/payments/forecast', { method: 'GET' })) as ForecastResp
        setForecast(fc?.raw ?? null)
      } catch {
        setForecast(null)
      }

      if (!amount) {
        const fallback = filtered.find((x) => Number(x?.amount || 0) > 0)?.amount
        if (fallback) setAmount(String(Math.round(Number(fallback))))
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }

  async function loadRequisites() {
    setReqLoading(true)
    setReqError(null)
    try {
      const r = (await apiFetch('/payments/requisites', { method: 'GET' })) as RequisitesResp
      if (!r?.ok) throw new Error('Не удалось загрузить реквизиты')
      setRequisites(r.requisites ?? null)
    } catch (e: any) {
      setRequisites(null)
      setReqError(e?.message || 'Не удалось загрузить реквизиты')
    } finally {
      setReqLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (page === 'card') loadRequisites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  function openOverlayForExternalPay() {
    setOverlay({
      open: true,
      title: 'Окно оплаты открыто ✅',
      text:
        'Если оплата открылась в новой вкладке — завершите её там и вернитесь сюда.\n' +
        'После оплаты можно закрыть вкладку и нажать “Обновить статус”.',
    })
  }

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) return
    if (!amountNumber || amountNumber < 1) {
      setUploadMsg('Введите корректную сумму.')
      return
    }
    const fullUrl = `${ps.shm_url}${amountNumber}`
    safeOpen(fullUrl)
    openOverlayForExternalPay()
  }

  async function removeAutopayment() {
    const ok = window.confirm('Отвязать сохраненный способ оплаты?')
    if (!ok) return
    try {
      await apiFetch('/payments/autopayment', { method: 'DELETE' })
      setUploadMsg('Автоплатёж удалён.')
    } catch (e: any) {
      setUploadMsg(e?.message || 'Не удалось удалить автоплатёж')
    }
  }

  async function uploadReceipt(file: File) {
    if (!amountNumber || amountNumber < 1) {
      setUploadMsg('Сначала введите сумму (в рублях).')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadMsg('Файл слишком большой. Максимум 2MB.')
      return
    }

    setUploading(true)
    setUploadMsg(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('amount', String(amountNumber))

      const res = await fetch('/api/payments/receipt', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })

      const text = await res.text()
      let json: any = null
      try {
        json = JSON.parse(text)
      } catch {}

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Upload failed (${res.status})`)
      }

      setUploadMsg('✅ Квитанция отправлена на проверку.')
      setTimeout(() => setUploadMsg(null), 5000)
    } catch (e: any) {
      setUploadMsg(e?.message || 'Ошибка при отправке квитанции')
    } finally {
      setUploading(false)
    }
  }

  const quickAmounts = [100, 300, 500, 1000, 2000]

  if (loading) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Оплата</div>
            <div className="p" style={{ marginTop: 6 }}>
              Загрузка…
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (err) {
    return (
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1">Оплата</div>
            <div className="p" style={{ marginTop: 6 }}>
              Ошибка: <span style={{ opacity: 0.9 }}>{err}</span>
            </div>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
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
    )
  }

  return (
    <div className="section">
      {/* Overlay */}
      {overlay?.open ? (
        <div className="overlay" onClick={() => setOverlay(null)}>
          <div className="overlay__card card" onClick={(e) => e.stopPropagation()}>
            <div className="card__body">
              <div style={{ fontSize: 18, fontWeight: 900 }}>{overlay.title}</div>
              <div className="p" style={{ marginTop: 8, whiteSpace: 'pre-line' }}>
                {overlay.text}
              </div>

              <div className="actions actions--2" style={{ marginTop: 12 }}>
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    setOverlay(null)
                    load()
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
              <div className="p" style={{ marginTop: 6 }}>
                Введите сумму и выберите способ — пополнение баланса происходит автоматически после успешной оплаты.
              </div>
            </div>
          </div>

          {(import.meta as any)?.env?.DEV && forecast ? (
            <div className="pre" style={{ marginTop: 12 }}>
              <b>Forecast (dev only):</b>
              <div style={{ height: 8 }} />
              {JSON.stringify(forecast, null, 2)}
            </div>
          ) : null}
        </div>
      </div>

      {/* Amount */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              Сумма
            </div>
            <div className="p" style={{ marginTop: 6 }}>
              Если сумма не подставилась автоматически — впишите вручную.
            </div>

            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Сумма (₽)"
              inputMode="numeric"
              autoComplete="off"
              style={{ marginTop: 12, fontSize: 22, fontWeight: 900 }}
            />

            <div className="row" style={{ marginTop: 10 }}>
              {quickAmounts.map((x) => (
                <button
                  key={x}
                  className="btn"
                  onClick={() => setAmount(String(x))}
                  style={{ padding: '8px 12px', minHeight: 40 }}
                  title={fmtMoney(x, 'RUB')}
                >
                  {fmtMoney(x, 'RUB')}
                </button>
              ))}
            </div>

            {uploadMsg ? (
              <div className="pre" style={{ marginTop: 12 }}>
                {uploadMsg}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Pay methods */}
      {page === 'main' ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>
                Способы оплаты
              </div>
              <div className="p" style={{ marginTop: 6 }}>
                Внешние оплаты откроются в новой вкладке.
              </div>

              <div className="actions actions--1" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  style={{ width: '100%' }}
                  onClick={() => {
                    if (!amountNumber) {
                      setUploadMsg('Введите сумму.')
                      return
                    }
                    setPage('card')
                  }}
                >
                  Перевод по реквизитам 💳
                </button>
              </div>

              <div style={{ marginTop: 12 }} />

              {paySystems.length === 0 ? (
                <div className="pre">Платёжные способы не найдены.</div>
              ) : (
                <div className="kv">
                  {paySystems.map((ps, idx) => (
                    <div className="kv__item" key={ps.shm_url || idx}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div className="kv__k">
                          {ps.recurring ? 'Автоплатёж' : isStars(ps) ? 'Stars / внешняя' : 'Внешняя оплата'}
                        </div>
                        <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                      </div>

                      <div className="kv__v" style={{ marginTop: 6 }}>
                        {ps.name || 'Payment method'}
                      </div>

                      <div className="actions actions--1" style={{ marginTop: 10 }}>
                        <button className="btn btn--primary" style={{ width: '100%' }} onClick={() => handlePay(ps)}>
                          Оплатить {amountNumber ? `· ${fmtMoney(amountNumber, 'RUB')}` : ''}
                        </button>
                      </div>

                      {ps.recurring ? (
                        <div className="actions actions--1" style={{ marginTop: 10 }}>
                          <button
                            className="btn btn--danger"
                            style={{ width: '100%' }}
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

              <div className="p" style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
                Если Telegram у пользователя заблокирован — это не мешает оплате и отправке квитанции: всё идёт через наш сервер.
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
                  <div className="p" style={{ marginTop: 6 }}>
                    Сделайте перевод и отправьте квитанцию. Проверка — вручную.
                  </div>
                </div>
              </div>

              {/* Amount */}
              <div className="kv" style={{ marginTop: 12 }}>
                <div className="kv__item">
                  <div className="kv__k">Сумма к переводу</div>
                  <div className="kv__v" style={{ fontSize: 20, fontWeight: 900 }}>
                    {amountNumber ? fmtMoney(amountNumber, 'RUB') : '—'}
                  </div>
                </div>
              </div>

              {/* IMPORTANT */}
              <div
                className="card"
                style={{
                  marginTop: 12,
                  boxShadow: 'none',
                  border: '1px solid rgba(255, 100, 100, 0.25)',
                  background: 'rgba(255, 100, 100, 0.10)',
                }}
              >
                <div className="card__body" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900 }}>Важно</div>
                  <div className="p" style={{ marginTop: 6, opacity: 0.95 }}>
                    Квитанция обязательна. Без квитанции перевод не будет зачислен — это ручная проверка.
                  </div>
                </div>
              </div>

              {/* Requisites */}
              <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
                <div className="card__body">
                  <div className="h1" style={{ fontSize: 18 }}>
                    Реквизиты
                  </div>

                  {reqLoading ? (
                    <div className="p" style={{ marginTop: 6 }}>
                      Загрузка реквизитов…
                    </div>
                  ) : reqError ? (
                    <div className="pre" style={{ marginTop: 12 }}>
                      Реквизиты пока недоступны: {String(reqError)}
                    </div>
                  ) : !requisites ? (
                    <div className="pre" style={{ marginTop: 12 }}>
                      Реквизиты не заполнены.
                    </div>
                  ) : (
                    (() => {
                      const holder = String(requisites.holder ?? '').trim()
                      const cardRaw = String(requisites.card ?? '').trim()
                      const cardPretty = formatCardPretty(cardRaw) || cardRaw

                      return (
                        <>
                          <div className="kv" style={{ marginTop: 12 }}>
                            {holder ? (
                              <div className="kv__item">
                                <div className="kv__k">Получатель</div>
                                <div className="kv__v" style={{ fontWeight: 900 }}>
                                  {holder}
                                </div>
                              </div>
                            ) : null}

                            {cardPretty ? (
                              <div className="kv__item">
                                <div className="kv__k">Номер карты</div>
                                <div className="kv__v" style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.4 }}>
                                  {cardPretty}
                                </div>
                                <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
                                  <span className="badge">МИР</span>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="actions actions--2" style={{ marginTop: 12 }}>
                            <button className="btn btn--primary" onClick={() => copyText(cardRaw)} disabled={!cardRaw}>
                              Скопировать карту
                            </button>

                            <label className="btn" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {uploading ? '⏳ Отправляем…' : '🧾 Отправить квитанцию'}
                              <input
                                type="file"
                                accept=".jpg,.jpeg,.png,.pdf"
                                style={{ display: 'none' }}
                                disabled={uploading}
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  if (!f) return
                                  uploadReceipt(f)
                                  e.currentTarget.value = ''
                                }}
                              />
                            </label>
                          </div>

                          {uploadMsg ? (
                            <div className="pre" style={{ marginTop: 12 }}>
                              {uploadMsg}
                            </div>
                          ) : null}

                          <div className="p" style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                            Поддерживаются JPG/PNG/PDF до 2MB.
                          </div>
                        </>
                      )
                    })()
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Secondary navigation — bottom */}
      <div className="section">
        <div className="card">
          <div className="card__body">
            <div className="h1" style={{ fontSize: 18 }}>
              История
            </div>
            <div className="p" style={{ marginTop: 6 }}>
              Если нужно проверить операции или посмотреть отправленные квитанции — откройте разделы ниже.
            </div>
            <div className="actions actions--2" style={{ marginTop: 12 }}>
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
  )
}