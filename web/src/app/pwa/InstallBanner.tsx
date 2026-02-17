import { useState } from "react";
import { useInstallPrompt } from "./useInstallPrompt";

export function InstallBanner() {
  const { installed, canPrompt, showIOSHint, inTelegram, promptInstall, copyLink } =
    useInstallPrompt();

  const [copied, setCopied] = useState(false);

  if (installed) return null;

  const showChromeHint = !canPrompt && !showIOSHint && !inTelegram;

  async function onCopy() {
    const ok = await copyLink();
    setCopied(ok);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="install">
      <div className="install__row">
        <div>
          <div className="install__title">Установить Shpun</div>
          <div className="install__text">
            Полноэкранный режим и быстрый доступ — как обычное приложение.
          </div>

          {showIOSHint && (
            <div className="install__hint">
              iPhone/iPad: нажмите <b>Поделиться</b> → <b>На экран Домой</b>.
            </div>
          )}

          {inTelegram && (
            <div className="install__hint">
              Внутри Telegram установка как приложения обычно недоступна. Откройте
              эту страницу в Chrome/Safari.
            </div>
          )}

          {showChromeHint && (
            <div className="install__hint">
              Chrome: откройте меню <b>⋮</b> → <b>Установить приложение</b> (или
              <b> Добавить на главный экран</b>).
            </div>
          )}
        </div>

        {canPrompt ? (
          <button className="install__btn" onClick={promptInstall}>
            Установить
          </button>
        ) : inTelegram ? (
          <button className="install__btn" onClick={onCopy}>
            {copied ? "Скопировано ✓" : "Скопировать ссылку"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
