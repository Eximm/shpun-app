import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../shared/api/client'

type PaySystem = {
  name?: string
  shm_url?: string
  recurring?: string | number
  amount?: number
}

type PaysystemsResp = { ok: true; items: PaySystem[]; raw?: any }
type ForecastResp = { ok: true; raw: any }

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
  // PWA / browser
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function Payments() {
  const [page, setPage] = useState<'main' | 'card'>('main')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [amount, setAmount] = useState<string>('') // пользователь вводит
  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [forecast, setForecast] = useState<any>(null)

  // overlay как в miniapp
  const [overlay, setOverlay] = useState<{
    open: boolean
    title: string
    text: string
    spinner?: boolean
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
      // paysystems
      const ps = (await apiFetch('/payments/paysystems', { method: 'GET' })) as PaysystemsResp
      const rawItems = ps?.items || []

      // фильтр "старых" Stars из miniapp можно оставить прямо тут
      const filtered = rawItems.filter((x) => {
        const n = String(x?.name || '')
        if (n === 'Telegram Stars Rescue') return false
        if (n === 'Telegram Stars Karlson') return false
        return true
      })

      setPaySystems(filtered)

      // forecast (не обязательно, но вкусно)
      try {
        const fc = (await apiFetch('/payments/forecast', { method: 'GET' })) as ForecastResp
        setForecast(fc?.raw ?? null)
      } catch {
        setForecast(null)
      }

      // если сумма не задана — попробуем подставить дефолт
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

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openOverlayForExternalPay() {
    setOverlay({
      open: true,
      title: 'Окно оплаты открыто ✅',
      text:
        'Если оплата открылась в новой вкладке — завершите её там и вернитесь сюда.<br>' +
        'После оплаты можно просто закрыть вкладку и нажать “Обновить”.',
    })
  }

  async function handlePay(ps: PaySystem) {
    if (!ps?.shm_url) return
    if (!amountNumber || amountNumber < 1) {
      setUploadMsg('Введите корректную сумму.')
      return
    }

    const fullUrl = `${ps.shm_url}${amountNumber}`

    // В PWA stars — это просто внешний линк
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

      // apiFetch у тебя JSON-ориентированный; для FormData проще напрямую:
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
            <h1 className="h1">Оплата</h1>
            <p className="p">Загрузка…</p>
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
            <h1 className="h1">Оплата</h1>
            <p className="p">
              Ошибка: <span style={{ color: 'rgba(255,255,255,0.82)' }}>{err}</span>
            </p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn--primary" onClick={load}>
                Повторить
              </button>
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
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            backdropFilter: 'blur(10px)',
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => setOverlay(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 620,
              margin: '10vh auto 0',
              boxShadow: '0 30px 80px rgba(0,0,0,0.65)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card__body">
              <div style={{ fontSize: 18, fontWeight: 1000 }}>{overlay.title}</div>
              <div className="p" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: overlay.text }} />
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
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
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 className="h1">Оплата</h1>
              <p className="p">
                Введите сумму и выберите способ. Квитанции принимаем через приложение — это не зависит от доступности
                Telegram у клиента.
              </p>
            </div>
            <button className="btn" onClick={load}>
              ⟳ Обновить
            </button>
          </div>

          {forecast ? (
            <div className="pre" style={{ marginTop: 14 }}>
              <b>Прогноз (сырой):</b>
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
            <p className="p">Сумма обычно подставляется автоматически. Если нет — просто впишите.</p>

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

            <div className="p" style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
              Текущая сумма:{' '}
              <span style={{ color: 'rgba(255,255,255,0.88)', fontWeight: 900 }}>
                {amountNumber ? fmtMoney(amountNumber, 'RUB') : '—'}
              </span>
            </div>

            {uploadMsg ? <div className="pre" style={{ marginTop: 12 }}>{uploadMsg}</div> : null}
          </div>
        </div>
      </div>

      {/* Pay methods */}
      {page === 'main' ? (
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="h1" style={{ fontSize: 18 }}>
                Оплата
              </div>
              <p className="p">Выберите способ оплаты. Внешние оплаты откроются в новой вкладке.</p>

              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={() => {
                    if (!amountNumber) {
                      setUploadMsg('Введите сумму.')
                      return
                    }
                    setPage('card')
                  }}
                >
                  Перевод на карту РФ 💳
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
                          {ps.recurring
                            ? 'Автоплатёж'
                            : isStars(ps)
                            ? 'Stars / внешняя'
                            : 'Внешняя оплата'}
                        </div>
                        <span className="badge">{ps.recurring ? 'recurring' : 'one-time'}</span>
                      </div>

                      <div className="kv__v" style={{ marginTop: 6 }}>
                        {ps.name || 'Payment method'}
                      </div>

                      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                        <button className="btn btn--primary" onClick={() => handlePay(ps)}>
                          Оплатить {amountNumber ? `· ${fmtMoney(amountNumber, 'RUB')}` : ''}
                        </button>

                        {ps.recurring ? (
                          <button
                            className="btn btn--danger"
                            onClick={removeAutopayment}
                            title="Отвязать автоплатёж"
                          >
                            Отвязать
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="p" style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
                Если Telegram у пользователя заблокирован — это не мешает оплате и отправке квитанции: всё идёт через наш
                сервер.
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Card transfer page */
        <div className="section">
          <div className="card">
            <div className="card__body">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="h1" style={{ fontSize: 18 }}>
                    Перевод на карту
                  </div>
                  <p className="p">Сделайте перевод и отправьте квитанцию.</p>
                </div>
                <button className="btn" onClick={() => setPage('main')}>
                  ⇦ Назад
                </button>
              </div>

              <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
                <div className="card__body">
                  <div className="kv">
                    <div className="kv__item">
                      <div className="kv__k">Сумма к переводу</div>
                      <div className="kv__v">{amountNumber ? fmtMoney(amountNumber, 'RUB') : '—'}</div>
                    </div>
                    <div className="kv__item">
                      <div className="kv__k">Квитанция</div>
                      <div className="kv__v">{uploading ? 'Отправляем…' : 'Готово к загрузке'}</div>
                    </div>
                    <div className="kv__item">
                      <div className="kv__k">Важно</div>
                      <div className="kv__v">Квитанция обязательна</div>
                    </div>
                  </div>

                  <div className="pre" style={{ marginTop: 12 }}>
                    Без квитанции перевод не будет зачислен — это ручная проверка.
                  </div>

                  <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
                    <label
                      className="btn btn--primary"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
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

                    <button className="btn" onClick={() => setPage('main')} disabled={uploading}>
                      Вернуться
                    </button>
                  </div>

                  {uploadMsg ? <div className="pre" style={{ marginTop: 12 }}>{uploadMsg}</div> : null}
                </div>
              </div>

              <div className="p" style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
                Поддерживаются JPG/PNG/PDF до 2MB.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
