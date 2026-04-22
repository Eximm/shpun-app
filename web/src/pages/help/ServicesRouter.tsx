// FILE: web/src/pages/help/ServicesRouter.tsx

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";

type Block = {
  icon: string;
  title: string;
  body?: string;
  note?: string;
  bullets?: string[];
  steps?: string[];
};

export function ServicesRouter() {
  const { t } = useI18n();
  const nav = useNavigate();

  const blocks = useMemo<Block[]>(() => [
    {
      icon: "🌐",
      title: t("servicesRouter.what.title", "Что это такое"),
      body: t("servicesRouter.what.body", "Shpun Router подключает ваш роутер к сети Shpun SDN System. Весь домашний трафик идёт через защищённый VPN-туннель — без настройки на каждом устройстве отдельно."),
      note: t("servicesRouter.what.note", "Никаких SSH, терминала и ручных конфигов — всё делается через интерфейс LuCI и Telegram-бота."),
      bullets: [
        t("servicesRouter.what.bullet_1", "VPN сразу для всех устройств дома"),
        t("servicesRouter.what.bullet_2", "Привязка роутера через бота — без терминала"),
        t("servicesRouter.what.bullet_3", "Виджет статуса прямо в OpenWrt"),
      ],
    },
    {
      icon: "👥",
      title: t("servicesRouter.useful_for.title", "Кому это полезно"),
      bullets: [
        t("servicesRouter.useful_for.bullet_1", "Хотите ускорить YouTube и стриминг на телевизоре или приставке"),
        t("servicesRouter.useful_for.bullet_2", "Нужно обойти гео-ограничения на устройствах без VPN-приложения"),
        t("servicesRouter.useful_for.bullet_3", "Нужен VPN для игровых консолей — PlayStation, Xbox и других"),
      ],
    },
    {
      icon: "⚡",
      title: t("servicesRouter.quick_start.title", "Быстрый старт"),
      note: t("servicesRouter.quick_start.note", "Обычно вся настройка занимает несколько минут после установки пакета."),
      steps: [
        t("servicesRouter.quick_start.step_1", "Установите OpenWrt 24.10+ на роутер"),
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
        t("servicesRouter.setup.bullet_1", "Подготовьте роутер: OpenWrt 24.10+, рабочий интернет без VPN, доступ в LuCI"),
        t("servicesRouter.setup.bullet_2", "Установите пакет через LuCI: System → Software → Upload → установить ipk"),
        t("servicesRouter.setup.bullet_3", "Откройте виджет: LuCI → главная страница → Shpun Router / SDN System"),
        t("servicesRouter.setup.bullet_4", "Сканируйте QR-код, откройте бота, выберите услугу и завершите привязку"),
      ],
    },
    {
      icon: "❓",
      title: t("servicesRouter.faq.title", "Частые вопросы"),
      bullets: [
        t("servicesRouter.faq.bullet_1", "VPN не подключается: проверьте интернет без VPN и активность услуги. Нажмите «обновить статус». Если не помогает — сбросьте VPN и привяжите заново."),
        t("servicesRouter.faq.bullet_2", "Не виден виджет: обновите страницу LuCI, попробуйте другой браузер или режим инкогнито."),
        t("servicesRouter.faq.bullet_3", "Скорость снизилась: возможно ограничение процессора роутера. Проверяйте скорость отдельно по кабелю и Wi-Fi."),
      ],
    },
    {
      icon: "🔄",
      title: t("servicesRouter.updates.title", "Обновления и сброс"),
      bullets: [
        t("servicesRouter.updates.bullet_1", "«Проверить/обновить прошивку» — ищет и устанавливает OTA-обновления Shpun Router"),
        t("servicesRouter.updates.bullet_2", "«Сбросить VPN и настройки» — удаляет привязку и параметры VPN, пакет остаётся"),
      ],
    },
  ], [t]);

  return (
    <div className="section">

      {/* ── Hero ── */}
      <div className="card" style={{
        background: "linear-gradient(135deg, rgba(124,92,255,0.12), rgba(77,215,255,0.07))",
        borderColor: "rgba(124,92,255,0.22)",
      }}>
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h1 className="h1">📡 {t("servicesRouter.page.title", "Shpun Router")}</h1>
              <p className="p" style={{ marginTop: 4 }}>
                {t("servicesRouter.page.sub", "Подключает OpenWrt-роутер к Shpun SDN System и поднимает единый VPN для всей домашней сети.")}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <span className="chip chip--ok">OpenWrt 24.10+</span>
                <span className="chip">Без терминала</span>
                <span className="chip chip--accent">OTA-обновления</span>
              </div>
            </div>
            <button className="btn" style={{ flexShrink: 0 }} onClick={() => nav(-1)} type="button">
              ← {t("servicesRouter.page.back", "Назад")}
            </button>
          </div>

          <div className="actions actions--2" style={{ marginTop: 16 }}>
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

      {/* ── Content blocks ── */}
      {blocks.map((b, i) => (
        <div className="card" key={i} style={{ marginTop: 12 }}>
          <div className="card__body">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{b.icon}</span>
              <div className="h1" style={{ fontSize: 17 }}>{b.title}</div>
            </div>

            {b.body && <p className="p" style={{ marginTop: 2 }}>{b.body}</p>}

            {b.note && (
              <div className="pre" style={{ marginTop: 10, borderColor: "rgba(77,215,255,0.20)", background: "rgba(77,215,255,0.05)" }}>
                💡 {b.note}
              </div>
            )}

            {b.steps && (
              <div className="kv" style={{ marginTop: 12 }}>
                {b.steps.map((s, idx) => (
                  <div className="kv__item" key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 900, color: "#060814",
                    }}>
                      {idx + 1}
                    </span>
                    <span style={{ paddingTop: 3, lineHeight: 1.5, fontSize: 14 }}>{s}</span>
                  </div>
                ))}
              </div>
            )}

            {b.bullets && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {b.bullets.map((s, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ flexShrink: 0, marginTop: 3, color: "var(--accent-2)", fontWeight: 900, fontSize: 16 }}>›</span>
                    <span style={{ fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* ── Footer CTA ── */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__body">
          <p className="p" style={{ marginTop: 0 }}>
            {t("servicesRouter.footer.text", "Есть вопросы? Напишите в Telegram-бот — поможем разобраться.")}
          </p>
          <div className="actions actions--2" style={{ marginTop: 12 }}>
            <button
              className="btn btn--primary"
              onClick={() => window.location.assign("/services/order?kind=marzban_router")}
              type="button"
            >
              🚀 {t("servicesRouter.page.order", "Заказать")}
            </button>
            <button className="btn" onClick={() => nav(-1)} type="button">
              ← {t("servicesRouter.page.back", "Назад")}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}