import { useMemo } from 'react'
import { useI18n } from '../../shared/i18n'

type Block = {
  title: string
  body?: string
  note?: string
  bullets?: string[]
  steps?: string[]
}

export function ServicesRouter() {
  const { t } = useI18n()

  const blocks = useMemo<Block[]>(
    () => [
      {
        title: t('servicesRouter.what.title', 'Что это'),
        body: t(
          'servicesRouter.what.body',
          'Shpun Router подключает ваш роутер к сети Shpun SDN System. Весь домашний трафик идёт через защищённый VPN-туннель.',
        ),
        note: t(
          'servicesRouter.what.note',
          'Никаких SSH, терминала и ручной настройки конфигов — всё делается через LuCI и бота.',
        ),
        bullets: [
          t('servicesRouter.what.bullet_1', 'VPN сразу для всех устройств дома'),
          t('servicesRouter.what.bullet_2', 'Привязка роутера через бота'),
          t('servicesRouter.what.bullet_3', 'Виджет статуса прямо в OpenWrt'),
        ],
      },
      {
        title: t('servicesRouter.quick_start.title', 'Быстрый старт'),
        steps: [
          t('servicesRouter.quick_start.step_1', 'Установите OpenWrt 24.10+ на роутер.'),
          t('servicesRouter.quick_start.step_2', 'Установите пакет shpun-router_1.0.0_all.ipk.'),
          t('servicesRouter.quick_start.step_3', 'Откройте LuCI и перейдите на главную страницу.'),
          t('servicesRouter.quick_start.step_4', 'Найдите виджет Shpun Router / SDN System.'),
          t('servicesRouter.quick_start.step_5', 'Сканируйте QR-код в виджете и привяжите роутер в боте.'),
        ],
        note: t(
          'servicesRouter.quick_start.note',
          'Обычно вся настройка занимает всего пару минут после установки пакета.',
        ),
      },
      {
        title: t('servicesRouter.useful_for.title', 'Кому это полезно'),
        bullets: [
          t(
            'servicesRouter.useful_for.bullet_1',
            'Если хотите ускорить и стабилизировать YouTube и стриминг на телевизоре или приставке.',
          ),
          t(
            'servicesRouter.useful_for.bullet_2',
            'Если нужно обойти гео-ограничения на устройствах, где нельзя установить VPN-приложение.',
          ),
          t(
            'servicesRouter.useful_for.bullet_3',
            'Если нужен VPN для игровых консолей, таких как PlayStation, Xbox и других.',
          ),
        ],
      },
      {
        title: t('servicesRouter.setup.title', 'Пошаговая настройка'),
        bullets: [
          t(
            'servicesRouter.setup.bullet_1',
            'Подготовьте роутер: OpenWrt 24.10+, интернет должен работать без VPN, доступ в LuCI должен быть открыт.',
          ),
          t(
            'servicesRouter.setup.bullet_2',
            'Установите пакет через LuCI: System → Software → Upload → установить ipk.',
          ),
          t(
            'servicesRouter.setup.bullet_3',
            'Откройте виджет: LuCI → главная страница → Shpun Router / SDN System.',
          ),
          t(
            'servicesRouter.setup.bullet_4',
            'Сканируйте QR-код, откройте бота, выберите услугу для роутера и завершите привязку.',
          ),
        ],
      },
      {
        title: t('servicesRouter.faq.title', 'FAQ и частые проблемы'),
        bullets: [
          t(
            'servicesRouter.faq.bullet_1',
            'VPN не подключается: проверьте, работает ли интернет без VPN, убедитесь, что услуга активна, нажмите «обновить статус» в виджете. Если не помогло — выполните «сбросить VPN и настройки» и привяжите роутер заново.',
          ),
          t(
            'servicesRouter.faq.bullet_2',
            'Не видно виджет: обновите страницу LuCI, попробуйте другой браузер или режим инкогнито, и убедитесь, что пакет установлен.',
          ),
          t(
            'servicesRouter.faq.bullet_3',
            'Скорость стала ниже: ограничением может быть процессор роутера. Сравните модель с рекомендуемыми, а скорость проверяйте отдельно по кабелю и по Wi-Fi.',
          ),
        ],
      },
      {
        title: t('servicesRouter.updates.title', 'Обновления и сброс'),
        bullets: [
          t(
            'servicesRouter.updates.bullet_1',
            '«Проверить/обновить прошивку» — ищет и устанавливает OTA-обновления Shpun Router.',
          ),
          t(
            'servicesRouter.updates.bullet_2',
            '«Сбросить VPN и настройки» — удаляет привязку и параметры VPN, не удаляя сам пакет.',
          ),
        ],
      },
    ],
    [t],
  )

  return (
    <div className="section servicesRouter">
      <div className="card">
        <div className="card__body">
          <div className="row so__headerRow">
            <div>
              <h1 className="h1">{t('servicesRouter.page.title', 'Shpun Router')}</h1>
              <div className="p so__mt6 servicesRouter__sub">
                {t(
                  'servicesRouter.page.sub',
                  'Подключает OpenWrt-роутер к Shpun SDN System и поднимает единый VPN для всей домашней сети.',
                )}
              </div>

              <div className="row so__mt10 servicesRouter__badges">
                <span className="badge">{t('servicesRouter.page.badge_1', 'OpenWrt 24.10+')}</span>
                <span className="badge">{t('servicesRouter.page.badge_2', 'Без ручной настройки')}</span>
                <span className="badge">{t('servicesRouter.page.badge_3', 'OTA-обновления')}</span>
              </div>
            </div>

            <button className="btn" onClick={() => window.history.back()}>
              {t('servicesRouter.page.back', '⇦ Назад')}
            </button>
          </div>

          <div className="actions actions--1 so__mt12">
            <button
              className="btn btn--primary so__btnFull"
              onClick={() => window.location.assign('/services/order?kind=marzban_router')}
            >
              {t('servicesRouter.page.order', 'Перейти к заказу Router VPN')}
            </button>

            <button
              className="btn so__btnFull"
              onClick={() =>
                window.open(
                  'https://spb.shpyn.online/files/ipk/shpun-router_1.0.0_all.ipk',
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              {t('servicesRouter.page.download', 'Скачать пакет Shpun Router')}
            </button>
          </div>
        </div>
      </div>

      {blocks.map((b, i) => (
        <div className="card" key={i}>
          <div className="card__body">
            <div className="h1 so__h18">{b.title}</div>
            {b.body ? <p className="p so__mt6">{b.body}</p> : null}

            {b.note ? <div className="pre so__mt12 servicesRouter__note">{b.note}</div> : null}

            {b.steps ? (
              <ol className="so__mt10 servicesRouter__list servicesRouter__list--ordered">
                {b.steps.map((s, idx) => (
                  <li key={idx} className="servicesRouter__listItem">
                    {s}
                  </li>
                ))}
              </ol>
            ) : null}

            {b.bullets ? (
              <ul className="so__mt10 servicesRouter__list">
                {b.bullets.map((s, idx) => (
                  <li key={idx} className="servicesRouter__listItem">
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