import { useMemo } from 'react'

type Block = {
  title: string
  body?: string
  note?: string
  bullets?: string[]
  steps?: string[]
}

export function ServicesRouter() {
  const blocks = useMemo<Block[]>(
    () => [
      {
        title: 'Что это',
        body:
          'Shpun Router ставит ваш роутер в общую сеть Shpun SDN System. Весь трафик дома уходит в зашифрованный туннель.',
        note: 'Никаких ssh, терминала и ручной правки конфигов — всё делается через LuCI и бота.',
        bullets: ['VPN на все устройства сразу', 'Привязка через бота', 'Статус-виджет в OpenWrt'],
      },
      {
        title: 'Быстрый старт',
        steps: [
          'Поставьте OpenWrt 24.10+ на роутер.',
          'Установите пакет shpun-router_1.0.0_all.ipk.',
          'Откройте LuCI → главная страница.',
          'Найдите виджет Shpun Router / SDN System.',
          'Сканируйте QR-код в виджете и привяжите роутер в боте.',
        ],
        note: 'Обычно всё занимает пару минут с момента установки пакета.',
      },
      {
        title: 'Кому это полезно',
        bullets: [
          'Хотите ускорить и стабилизировать YouTube/стриминг на ТВ и приставках.',
          'Нужно обойти гео-ограничения на устройствах, где нельзя поставить VPN-приложение.',
          'Нужен VPN для игровых консолей (PS, Xbox и др.), которые сами не умеют работать с VPN.',
        ],
      },
      {
        title: 'Пошаговая настройка',
        bullets: [
          'Подготовьте роутер: OpenWrt 24.10+, интернет работает без VPN, доступ в LuCI.',
          'Установите пакет: System → Software → Upload → установить ipk.',
          'Откройте виджет: LuCI → главная → Shpun Router / SDN System.',
          'Привязка: сканируйте QR → откроется бот → выберите услугу для роутеров → завершите привязку.',
        ],
      },
      {
        title: 'FAQ и типичные проблемы',
        bullets: [
          'VPN не подключается: проверьте интернет без VPN → убедитесь, что услуга активна → «обновить статус» в виджете → если не помогло: «сбросить VPN и настройки» и привязать заново.',
          'Не вижу виджет: обновите LuCI / другой браузер / инкогнито → убедитесь, что пакет установлен.',
          'Скорость ниже: CPU роутера может быть узким местом → сравните с рекомендуемыми моделями → проверьте скорость по кабелю и по Wi-Fi отдельно.',
        ],
      },
      {
        title: 'Обновления и сброс',
        bullets: [
          '«Проверить/обновить прошивку» — проверка и установка OTA-обновлений Shpun Router.',
          '«Сбросить VPN и настройки» — убрать привязку и параметры VPN, не трогая сам пакет.',
        ],
      },
    ],
    [],
  )

  return (
    <div className="section">
      {/* header */}
      <div className="card">
        <div className="card__body">
          <div className="row so__headerRow">
            <div>
              <h1 className="h1">Shpun Router</h1>
              <div className="p so__mt6" style={{ opacity: 0.9 }}>
                Подключает OpenWrt-роутер к Shpun SDN System и поднимает единый VPN на всю домашнюю сеть.
              </div>

              <div className="row so__mt10" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="badge">OpenWrt 24.10+</span>
                <span className="badge">Без ручных конфигов</span>
                <span className="badge">OTA-обновления</span>
              </div>
            </div>

            <button className="btn" onClick={() => window.history.back()}>
              ⇦ Назад
            </button>
          </div>

          <div className="actions actions--1 so__mt12">
            <button
              className="btn btn--primary so__btnFull"
              onClick={() => window.location.assign('/services/order?kind=marzban_router')}
            >
              Перейти к заказу Router VPN
            </button>

            <button
              className="btn so__btnFull"
              onClick={() => window.open('https://spb.shpyn.online/files/ipk/shpun-router_1.0.0_all.ipk', '_blank', 'noopener,noreferrer')}
            >
              Скачать пакет Shpun Router
            </button>
          </div>
        </div>
      </div>

      {/* content */}
      {blocks.map((b, i) => (
        <div className="card" key={i}>
          <div className="card__body">
            <div className="h1 so__h18">{b.title}</div>
            {b.body ? <p className="p so__mt6">{b.body}</p> : null}

            {b.note ? (
              <div className="pre so__mt12" style={{ opacity: 0.9 }}>
                {b.note}
              </div>
            ) : null}

            {b.steps ? (
              <ol className="so__mt10" style={{ margin: 0, paddingLeft: 18 }}>
                {b.steps.map((s, idx) => (
                  <li key={idx} style={{ marginBottom: 6 }}>
                    {s}
                  </li>
                ))}
              </ol>
            ) : null}

            {b.bullets ? (
              <ul className="so__mt10" style={{ margin: 0, paddingLeft: 18 }}>
                {b.bullets.map((s, idx) => (
                  <li key={idx} style={{ marginBottom: 6 }}>
                    {s}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}