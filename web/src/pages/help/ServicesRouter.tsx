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
  tone?: BlockTone;
};

const ROUTER_PACKAGE_24_URL = "https://spb.shpyn.online/files/ipk/shpun-router_1.1.8_all.ipk";
const ROUTER_INSTALLER_25_URL = "https://spb.shpyn.online/files/apk/shpun-router-openwrt25-installer.exe";
const ROUTER_INSTALLER_25_WIN7_URL = "https://spb.shpyn.online/files/apk/shpun-router-openwrt25-win7.exe";

export function ServicesRouter() {
  const { t } = useI18n();

  const blocks = useMemo<Block[]>(() => [
    {
      icon: "🌐",
      title: t("servicesRouter.what.title", "Что это"),
      body: t("servicesRouter.what.body", "Shpun Router подключает OpenWrt-роутер к Shpun SDN System. Весь домашний трафик идёт через защищённый VPN-туннель."),
      note: t("servicesRouter.what.note", "Всё устанавливается через веб-интерфейс роутера. Терминал и ручная настройка не нужны."),
      bullets: [
        t("servicesRouter.what.bullet_1", "VPN сразу для всех устройств дома"),
        t("servicesRouter.what.bullet_2", "Привязка роутера по коду"),
        t("servicesRouter.what.bullet_3", "Виджет статуса прямо в OpenWrt"),
      ],
    },
    {
      icon: "📶",
      title: t("servicesRouter.hardware.title", "Какой роутер выбрать"),
      body: t("servicesRouter.hardware.body", "Лучший вариант — роутер класса AX3000 или его аналоги с Wi‑Fi 6 и предустановленной OpenWrt 24.x или 25.x. Подойдёт сопоставимая модель с нормальным CPU, достаточной памятью и свежей OpenWrt — без привязки к конкретному магазину или бренду."),
      note: t("servicesRouter.hardware.note", "Идеально, если продавец уже поставил OpenWrt 24.x или 25.x и проверил LuCI. Тогда установка Shpun Router обычно занимает пару минут."),
      bullets: [
        t("servicesRouter.hardware.bullet_1", "Рекомендуемый класс: AX3000 / Wi‑Fi 6 / современный двухъядерный или лучше CPU"),
        t("servicesRouter.hardware.bullet_2", "Желательно: 256 МБ RAM или больше, 128 МБ flash или больше"),
        t("servicesRouter.hardware.bullet_3", "Обязательно: поддержка OpenWrt 24.x или 25.x и доступ в LuCI"),
      ],
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
                {t("servicesRouter.page.sub", "Сначала выберите свою версию OpenWrt. После этого вы увидите только нужные шаги и правильный файл.")}
              </p>
            </div>
          </div>

          <div className="router-help-tags">
            <span className="chip chip--ok">OpenWrt 24.x</span>
            <span className="chip chip--ok">OpenWrt 25.x</span>
            <span className="chip chip--accent">AX3000 class</span>
            <span className="chip">LuCI</span>
          </div>

          <div className="router-help-note">
            <span aria-hidden="true">🔎</span>
            <span>{t("servicesRouter.choose.how", "Как узнать версию: откройте страницу роутера 192.168.1.1. Номер OpenWrt написан на главной странице.")}</span>
          </div>
          <div className="actions actions--2 miniPage__actions">
            <button
              className="btn btn--primary"
              onClick={() => document.getElementById("openwrt-25")?.scrollIntoView({ behavior: "smooth" })}
              type="button"
            >
              {t("servicesRouter.choose.25", "У меня OpenWrt 25")}
            </button>
            <button
              className="btn"
              onClick={() => document.getElementById("openwrt-24")?.scrollIntoView({ behavior: "smooth" })}
              type="button"
            >
              {t("servicesRouter.choose.24", "У меня OpenWrt 24")}
            </button>
          </div>
        </div>
      </div>

      <div className="card miniPage__panel router-help-card router-help-card--good" id="openwrt-25">
        <div className="card__body">
          <div className="router-help-card__head">
            <span className="router-help-card__icon" aria-hidden="true">🟢</span>
            <div className="h1 router-help-card__title">
              {t("servicesRouter.install25.title", "OpenWrt 25.x — установка через Windows")}
            </div>
          </div>
          <div className="router-help-note">
            <span aria-hidden="true">✓</span>
            <strong>{t("servicesRouter.install25.only", "Этот раздел только для OpenWrt 25. Если у вас OpenWrt 24 — пропустите его.")}</strong>
          </div>
          <p className="p router-help-card__body">
            {t("servicesRouter.install25.why", "Зачем нужна программа: OpenWrt 25 не разрешает поставить наш файл обычной кнопкой в панели роутера. Установщик сам подключится к роутеру и всё сделает правильно. Команды вводить не нужно.")}
          </p>
          <div className="router-help-steps">
            {[
              t("servicesRouter.install25.step_1", "Подключите роутер к интернету, а компьютер — к LAN или Wi-Fi этого роутера"),
              t("servicesRouter.install25.step_2", "Выберите кнопку для своей Windows: Windows 10/11 или Windows 7/8"),
              t("servicesRouter.install25.step_3", "Запустите скачанный файл. Если Windows покажет предупреждение, нажмите «Подробнее», затем «Выполнить в любом случае»"),
              t("servicesRouter.install25.step_4", "Нажмите «Установить». Программа сама найдёт роутер. Если на роутере есть пароль, программа попросит его ввести"),
              t("servicesRouter.install25.step_5", "Дождитесь надписи об успешной установке, затем откройте страницу роутера 192.168.1.1"),
            ].map((step, idx) => (
              <div className="router-help-step" key={idx}>
                <span className="router-help-step__num">{idx + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className="actions actions--2 miniPage__actions">
            <button className="btn btn--primary" onClick={() => window.open(ROUTER_INSTALLER_25_URL, "_blank", "noopener,noreferrer")} type="button">
              ⬇️ {t("servicesRouter.install25.download_modern", "Windows 10/11 — скачать")}
            </button>
            <button className="btn" onClick={() => window.open(ROUTER_INSTALLER_25_WIN7_URL, "_blank", "noopener,noreferrer")} type="button">
              ⬇️ {t("servicesRouter.install25.download_legacy", "Windows 7/8 — скачать")}
            </button>
          </div>
        </div>
      </div>

      <div className="card miniPage__panel router-help-card" id="openwrt-24">
        <div className="card__body">
          <div className="router-help-card__head">
            <span className="router-help-card__icon" aria-hidden="true">🔵</span>
            <div className="h1 router-help-card__title">
              {t("servicesRouter.install24.title", "OpenWrt 24.x — установка через LuCI")}
            </div>
          </div>
          <div className="router-help-note">
            <span aria-hidden="true">✓</span>
            <strong>{t("servicesRouter.install24.only", "Этот раздел только для OpenWrt 24. Программа-установщик из раздела OpenWrt 25 здесь не нужна.")}</strong>
          </div>
          <div className="router-help-steps">
            {[
              t("servicesRouter.install24.step_1", "Убедитесь, что интернет на роутере уже работает"),
              t("servicesRouter.install24.step_2", "Нажмите кнопку «Скачать пакет 1.1.8» ниже"),
              t("servicesRouter.install24.step_3", "Откройте панель роутера 192.168.1.1 и перейдите: System (Система) → Software (Программы) → Upload package"),
              t("servicesRouter.install24.step_4", "Выберите скачанный файл и подтвердите установку. Когда установка закончится, вернитесь на главную страницу"),
            ].map((step, idx) => (
              <div className="router-help-step" key={idx}>
                <span className="router-help-step__num">{idx + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className="actions miniPage__actions">
            <button className="btn btn--primary" onClick={() => window.open(ROUTER_PACKAGE_24_URL, "_blank", "noopener,noreferrer")} type="button">
              ⬇️ {t("servicesRouter.install24.download", "OpenWrt 24.x — скачать пакет 1.1.8")}
            </button>
          </div>
        </div>
      </div>

      <div className="card miniPage__panel router-help-card router-help-card--good">
        <div className="card__body">
          <div className="router-help-card__head">
            <span className="router-help-card__icon" aria-hidden="true">🔗</span>
            <div className="h1 router-help-card__title">
              {t("servicesRouter.after_install.title", "Готово. Теперь подключите роутер к услуге")}
            </div>
          </div>
          <div className="router-help-steps">
            {[
              t("servicesRouter.after_install.step_1", "На главной странице роутера найдите большой блок Shpun Router. В нём будет короткий код"),
              t("servicesRouter.after_install.step_2", "Закажите услугу Shpun Router в приложении и введите этот код. Роутер сам получит настройки и подключится"),
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
          </div>
        </div>
      ))}

      <div className="card miniPage__panel router-help-footer">
        <div className="card__body">
          <p className="p">
            {t("servicesRouter.footer.text", "Если сомневаетесь в модели роутера, лучше выбрать класс AX3000 или аналог с предустановленной OpenWrt 24.x или 25.x. Слабые устройства оставьте только для экспериментов.")}
          </p>
          <div className="actions actions--2 miniPage__actions">
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
