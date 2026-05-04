// FILE: web/src/pages/help/ServicesRouter.tsx

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";

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

export function ServicesRouter() {
  const { t } = useI18n();
  const nav = useNavigate();

  const blocks = useMemo<Block[]>(() => [
    {
      icon: "🌐",
      title: t("servicesRouter.what.title", "Что это"),
      body: t("servicesRouter.what.body", "Shpun Router подключает OpenWrt-роутер к Shpun SDN System. Весь домашний трафик идёт через защищённый VPN-туннель."),
      note: t("servicesRouter.what.note", "Никаких SSH, терминала и ручной настройки конфигов — всё делается через LuCI и Telegram-бота."),
      bullets: [
        t("servicesRouter.what.bullet_1", "VPN сразу для всех устройств дома"),
        t("servicesRouter.what.bullet_2", "Привязка роутера через бота"),
        t("servicesRouter.what.bullet_3", "Виджет статуса прямо в OpenWrt"),
      ],
    },
    {
      icon: "📶",
      title: t("servicesRouter.hardware.title", "Какой роутер выбрать"),
      body: t("servicesRouter.hardware.body", "Лучший вариант — роутер класса AX3000 или его аналоги с Wi‑Fi 6 и предустановленной OpenWrt 24.10.x. Подойдёт сопоставимая модель с нормальным CPU, достаточной памятью и свежей OpenWrt — без привязки к конкретному магазину или бренду."),
      note: t("servicesRouter.hardware.note", "Идеально, если продавец уже поставил OpenWrt 24.10.x и проверил LuCI. Тогда установка Shpun Router обычно занимает пару минут."),
      bullets: [
        t("servicesRouter.hardware.bullet_1", "Рекомендуемый класс: AX3000 / Wi‑Fi 6 / современный двухъядерный или лучше CPU"),
        t("servicesRouter.hardware.bullet_2", "Желательно: 256 МБ RAM или больше, 128 МБ flash или больше"),
        t("servicesRouter.hardware.bullet_3", "Обязательно: поддержка OpenWrt 24.10.x и доступ в LuCI"),
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
      icon: "⚡",
      title: t("servicesRouter.quick_start.title", "Быстрый старт"),
      note: t("servicesRouter.quick_start.note", "Если OpenWrt 24.10.x уже установлена, вся настройка обычно занимает несколько минут."),
      steps: [
        t("servicesRouter.quick_start.step_1", "Подготовьте роутер с OpenWrt 24.10.x"),
        t("servicesRouter.quick_start.step_2", "Установите пакет shpun-router_1.0.0_all.ipk"),
        t("servicesRouter.quick_start.step_3", "Откройте LuCI и перейдите на главную страницу"),
        t("servicesRouter.quick_start.step_4", "Найдите виджет Shpun Router / SDN System"),
        t("servicesRouter.quick_start.step_5", "Сканируйте QR-код и привяжите роутер в боте"),
      ],
    },
    {
      icon: "🔧",
      title: t("servicesRouter.setup.title", "Пошаговая настройка"),
      bullets: [
        t("servicesRouter.setup.bullet_1", "Проверьте, что интернет работает без VPN, а доступ в LuCI открыт"),
        t("servicesRouter.setup.bullet_2", "Установите пакет через LuCI: System → Software → Upload → install ipk"),
        t("servicesRouter.setup.bullet_3", "Откройте LuCI → главная страница → Shpun Router / SDN System"),
        t("servicesRouter.setup.bullet_4", "Сканируйте QR-код, откройте бота, выберите услугу Router VPN и завершите привязку"),
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
      ],
    },
  ], [t]);

  return (
    <div className="section miniPage router-help-page">
      <div className="card miniPage__hero router-help-hero">
        <div className="card__body">
          <div className="miniPage__head">
            <div>
              <h1 className="h1">📡 {t("servicesRouter.page.title", "Shpun Router")}</h1>
              <p className="p miniPage__subtitle">
                {t("servicesRouter.page.sub", "Router VPN для всей домашней сети на OpenWrt 24.10.x. Главное — выбрать роутер, который не будет слабым местом.")}
              </p>
            </div>
            <button className="btn miniPage__back" onClick={() => nav(-1)} type="button">
              {t("servicesRouter.page.back", "Назад")}
            </button>
          </div>

          <div className="router-help-tags">
            <span className="chip chip--ok">OpenWrt 24.10.x</span>
            <span className="chip chip--accent">AX3000 class</span>
            <span className="chip">LuCI</span>
          </div>

          <div className="actions actions--2 miniPage__actions">
            <button
              className="btn btn--primary"
              onClick={() => window.location.assign("/services/order?kind=marzban_router")}
              type="button"
            >
              🚀 {t("servicesRouter.page.order", "Заказать Router VPN")}
            </button>
            <button
              className="btn"
              onClick={() => window.open("https://spb.shpyn.online/files/ipk/shpun-router_1.0.0_all.ipk", "_blank", "noopener,noreferrer")}
              type="button"
            >
              ⬇️ {t("servicesRouter.page.download", "Скачать пакет")}
            </button>
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
            {t("servicesRouter.footer.text", "Если сомневаетесь в модели роутера, лучше выбрать класс AX3000 или аналог с предустановленной OpenWrt 24.10.x. Слабые устройства оставьте только для экспериментов.")}
          </p>
          <div className="actions actions--2 miniPage__actions">
            <button
              className="btn btn--primary"
              onClick={() => window.location.assign("/services/order?kind=marzban_router")}
              type="button"
            >
              🚀 {t("servicesRouter.page.order", "Заказать")}
            </button>
            <button className="btn" onClick={() => nav(-1)} type="button">
              {t("servicesRouter.page.back", "Назад")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ServicesRouter;
