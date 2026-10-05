// FILE: web/src/pages/help/ServicesRouter.tsx

import { useMemo } from "react";
import { useI18n } from "../../shared/i18n";
import { PageBackButton } from "../../shared/ui/PageBackButton";

type BlockTone = "default" | "good" | "warn";

type Block = {
  icon: string;
  title: string;
  body?: string;
  note?: string;
  bullets?: string[];
  steps?: string[];
  link?: {
    href: string;
    label: string;
  };
  tone?: BlockTone;
};

const ROUTER_INSTALLER_URL = "https://router.shpun.net/files/router/shpun-router-installer.exe";
const ROUTER_INSTALLER_WIN7_URL = "https://router.shpun.net/files/router/shpun-router-installer-win7.exe";

export function ServicesRouter() {
  const { t } = useI18n();

  const blocks = useMemo<Block[]>(() => [
    {
      icon: "🌐",
      title: t("servicesRouter.what.title", "Что это"),
      body: t("servicesRouter.what.body", "Shpun Router включает VPN сразу для всей домашней сети. Отдельное VPN-приложение на телевизор, приставку и другие устройства ставить не нужно."),
      note: t("servicesRouter.what.note", "Для первой установки нужен только компьютер с Windows. Всё остальное подскажет установщик."),
      bullets: [
        t("servicesRouter.what.bullet_1", "VPN сразу для всех устройств дома"),
        t("servicesRouter.what.bullet_2", "Привязка роутера по коду"),
        t("servicesRouter.what.bullet_3", "Виджет статуса прямо в OpenWrt"),
      ],
    },
    {
      icon: "🛒",
      title: t("servicesRouter.hardware.title", "Сначала нужен роутер с OpenWrt"),
      body: t("servicesRouter.hardware.body", "Для Shpun Router обязательно нужен роутер с OpenWrt 24.x или 25.x. OpenWrt можно установить самостоятельно на совместимую модель или купить роутер, где она уже установлена. Наша программа саму OpenWrt не устанавливает — она ставит пакет Shpun Router на подготовленный роутер."),
      note: t("servicesRouter.hardware.note", "Если не хотите прошивать роутер самостоятельно, проще купить готовый вариант с OpenWrt. Ниже показан один подходящий пример, но можно выбрать и другую модель."),
      bullets: [
        t("servicesRouter.hardware.bullet_1", "К моменту установки Shpun Router на роутере уже должна работать OpenWrt 24.x или 25.x"),
        t("servicesRouter.hardware.bullet_2", "Можно прошить совместимый роутер самостоятельно"),
        t("servicesRouter.hardware.bullet_3", "Самый простой вариант для новичка — купить роутер с уже установленной OpenWrt"),
      ],
      link: {
        href: "https://routerich.ru/products/ax3000",
        label: t("servicesRouter.hardware.example_link", "Посмотреть пример подходящего роутера"),
      },
      tone: "good",
    },
    {
      icon: "⚠️",
      title: t("servicesRouter.weak.title", "Слабые роутеры"),
      body: t("servicesRouter.weak.body", "Старые и бюджетные роутеры можно использовать только на свой страх и риск. Они часто упираются в процессор, режут скорость VPN, перегреваются или нестабильно держат туннель."),
      bullets: [
        t("servicesRouter.weak.bullet_1", "Одноядерные и старые MIPS-модели лучше не брать для Router VPN"),
        t("servicesRouter.weak.bullet_2", "64/128 МБ RAM может хватить только для очень лёгких сценариев"),
        t("servicesRouter.weak.bullet_3", "Если скорость важна, выбирайте модель помощнее, а не самый дешёвый OpenWrt-совместимый роутер"),
      ],
      tone: "warn",
    },
    {
      icon: "👥",
      title: t("servicesRouter.useful_for.title", "Кому это полезно"),
      bullets: [
        t("servicesRouter.useful_for.bullet_1", "Хотите ускорить YouTube и стриминг на телевизоре или приставке"),
        t("servicesRouter.useful_for.bullet_2", "Нужно обойти гео-ограничения на устройствах без VPN-приложения"),
        t("servicesRouter.useful_for.bullet_3", "Нужен VPN для игровых консолей, ТВ, приставок и всей домашней сети"),
      ],
    },
    {
      icon: "❓",
      title: t("servicesRouter.faq.title", "Частые вопросы"),
      bullets: [
        t("servicesRouter.faq.bullet_1", "VPN не подключается: проверьте интернет без VPN и активность услуги, затем нажмите «обновить статус». Если не помогло — сбросьте VPN и привяжите роутер заново."),
        t("servicesRouter.faq.bullet_2", "Не виден виджет: обновите страницу LuCI, попробуйте другой браузер или режим инкогнито, убедитесь, что пакет установлен."),
        t("servicesRouter.faq.bullet_3", "Скорость снизилась: чаще всего это ограничение CPU роутера. Проверяйте скорость отдельно по кабелю и Wi‑Fi."),
      ],
    },
    {
      icon: "🔄",
      title: t("servicesRouter.updates.title", "Обновления и сброс"),
      bullets: [
        t("servicesRouter.updates.bullet_1", "«Проверить/обновить прошивку» ищет и ставит OTA-обновления Shpun Router"),
        t("servicesRouter.updates.bullet_2", "«Сбросить VPN и настройки» удаляет привязку и параметры VPN, пакет остаётся установленным"),
        t("servicesRouter.updates.bullet_3", "Ветка 1.x поддерживает OpenWrt 24.x, ветка 2.x — OpenWrt 25.x"),
      ],
    },
  ], [t]);

  return (
    <div className="section miniPage router-help-page">
      <PageBackButton label={t("servicesRouter.page.back", "Назад")} />
      <div className="card miniPage__hero router-help-hero">
        <div className="card__body">
          <div className="miniPage__head">
            <div>
              <h1 className="h1">📡 {t("servicesRouter.page.title", "Shpun Router")}</h1>
              <p className="p miniPage__subtitle">
                {t("servicesRouter.page.sub", "Сначала подготовьте роутер: на нём уже должна работать OpenWrt 24.x или 25.x. Её можно установить самостоятельно или купить готовый роутер. Дальше наша небольшая программа для Windows почти всё сделает за вас.")}
              </p>
            </div>
          </div>

          <div className="router-help-tags">
            <span className="chip chip--ok">OpenWrt 24.x</span>
            <span className="chip chip--ok">OpenWrt 25.x</span>
            <span className="chip chip--accent">Windows</span>
            <span className="chip">{t("servicesRouter.no_commands")}</span>
          </div>

          <div className="router-help-note">
            <span aria-hidden="true">✓</span>
            <span>{t("servicesRouter.choose.how", "Важно: программа установит Shpun Router, но не саму OpenWrt. OpenWrt должна быть установлена на роутере заранее.")}</span>
          </div>
        </div>
      </div>

      <div className="card miniPage__panel router-help-card router-help-card--good">
        <div className="card__body">
          <div className="router-help-card__head">
            <span className="router-help-card__icon" aria-hidden="true">🟢</span>
            <div className="h1 router-help-card__title">
              {t("servicesRouter.install25.title", "Простая установка через Windows")}
            </div>
          </div>
          <div className="router-help-note">
            <span aria-hidden="true">✓</span>
            <strong>{t("servicesRouter.install25.only", "Подходит для OpenWrt 24 и 25. Команды вводить не нужно.")}</strong>
          </div>
          <p className="p router-help-card__body">
            {t("servicesRouter.install25.why", "Когда роутер с OpenWrt уже у вас, подключите его к интернету, а компьютер с Windows — к этому роутеру. Скачайте и запустите программу. Она сама найдёт роутер, подберёт и скачает нужный пакет Shpun Router, проверит старые VPN и предложит удалить их, если они могут мешать. После вашего подтверждения программа установит Shpun Router.")}
          </p>
          <div className="router-help-steps">
            {[
              t("servicesRouter.install25.step_1", "Подключите роутер к интернету, а компьютер с Windows — к Wi-Fi или LAN-порту этого роутера"),
              t("servicesRouter.install25.step_2", "Скачайте программу для своей Windows: обычную версию для Windows 10/11 или версию для Windows 7/8"),
              t("servicesRouter.install25.step_3", "Запустите скачанный файл. Если Windows покажет предупреждение, нажмите «Подробнее», затем «Выполнить в любом случае»"),
              t("servicesRouter.install25.step_4", "Следуйте подсказкам. Если на роутере есть пароль, введите его. Если программа найдёт другой VPN, она покажет его и спросит разрешение на удаление. Без вашего согласия ничего не удалится"),
              t("servicesRouter.install25.step_5", "Дождитесь надписи «Готово». Программа установит Shpun Router, покажет код роутера и откроет ShpunApp"),
            ].map((step, idx) => (
              <div className="router-help-step" key={idx}>
                <span className="router-help-step__num">{idx + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className="actions actions--2 miniPage__actions">
            <button className="btn btn--primary" onClick={() => window.open(ROUTER_INSTALLER_URL, "_blank", "noopener,noreferrer")} type="button">
              ⬇️ {t("servicesRouter.install25.download_modern", "Windows 10/11 — скачать")}
            </button>
            <button className="btn" onClick={() => window.open(ROUTER_INSTALLER_WIN7_URL, "_blank", "noopener,noreferrer")} type="button">
              ⬇️ {t("servicesRouter.install25.download_legacy", "Windows 7/8 — скачать")}
            </button>
          </div>
        </div>
      </div>

      <div className="card miniPage__panel router-help-card router-help-card--good">
        <div className="card__body">
          <div className="router-help-card__head">
            <span className="router-help-card__icon" aria-hidden="true">🔗</span>
            <div className="h1 router-help-card__title">
              {t("servicesRouter.after_install.title", "Последний шаг — привяжите роутер")}
            </div>
          </div>
          <div className="router-help-steps">
            {[
              t("servicesRouter.after_install.step_1", "Скопируйте код, который покажет программа. Этот код также есть в блоке Shpun Router на главной странице роутера"),
              t("servicesRouter.after_install.step_2", "Закажите услугу Shpun Router в приложении и введите код. Роутер сам получит настройки и подключится — после этого пользуйтесь чистым интернетом на всех домашних устройствах"),
            ].map((step, idx) => (
              <div className="router-help-step" key={idx}>
                <span className="router-help-step__num">{idx + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {blocks.map((block, index) => (
        <div
          className={`card miniPage__panel router-help-card router-help-card--${block.tone ?? "default"}`}
          key={`${block.title}-${index}`}
        >
          <div className="card__body">
            <div className="router-help-card__head">
              <span className="router-help-card__icon" aria-hidden="true">{block.icon}</span>
              <div className="h1 router-help-card__title">{block.title}</div>
            </div>

            {block.body && <p className="p router-help-card__body">{block.body}</p>}

            {block.note && (
              <div className="router-help-note">
                <span aria-hidden="true">💡</span>
                <span>{block.note}</span>
              </div>
            )}

            {block.steps && (
              <div className="router-help-steps">
                {block.steps.map((step, idx) => (
                  <div className="router-help-step" key={idx}>
                    <span className="router-help-step__num">{idx + 1}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            )}

            {block.bullets && (
              <div className="router-help-list">
                {block.bullets.map((item, idx) => (
                  <div className="router-help-list__item" key={idx}>
                    <span aria-hidden="true">›</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}

            {block.link && (
              <div className="actions actions--1 miniPage__actions">
                <a className="btn btn--soft" href={block.link.href} rel="noopener noreferrer" target="_blank">
                  🔎 {block.link.label}
                </a>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="card miniPage__panel router-help-footer">
        <div className="card__body">
          <p className="p">
            {t("servicesRouter.footer.text", "Ещё нет готового роутера? Можно самостоятельно установить OpenWrt 24.x или 25.x на совместимую модель. Если не хотите заниматься прошивкой, купите роутер с уже установленной OpenWrt. Дальше наша небольшая программа поможет установить Shpun Router.")}
          </p>
          <div className="actions actions--1 miniPage__actions">
            <button
              className="btn btn--primary"
              onClick={() => window.location.assign("/services/order?kind=marzban_router")}
              type="button"
            >
              🚀 {t("servicesRouter.page.order", "Заказать")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServicesRouter;
