import { useInstallPrompt } from "./useInstallPrompt";

export function InstallBanner() {
  const { installed, canPrompt, showIOSHint, promptInstall } = useInstallPrompt();

  if (installed) return null;

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
        </div>

        {canPrompt && (
          <button className="install__btn" onClick={promptInstall}>
            Установить
          </button>
        )}
      </div>
    </div>
  );
}
