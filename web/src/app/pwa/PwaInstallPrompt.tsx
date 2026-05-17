import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import {
  clearPwaInstalledMarker,
  detectPwaInstallPlatform,
  markPwaInstalled,
  PWA_INSTALL_PROMPT_SESSION_KEY,
  pwaGuideKey,
  shouldTreatPwaAsInstalled,
} from "../../shared/pwa/install";
import { toast } from "../../shared/ui/toast";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

function isTelegramMiniApp(): boolean {
  try {
    const tg = (window as any)?.Telegram?.WebApp;
    return String(tg?.initData ?? "").trim().length > 50;
  } catch {
    return false;
  }
}

function getPwaInstallPrompt(): BeforeInstallPromptEvent | null {
  try {
    return (window as any).__pwaInstallPrompt ?? null;
  } catch {
    return null;
  }
}

function hasShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(PWA_INSTALL_PROMPT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markShownThisSession() {
  try {
    sessionStorage.setItem(PWA_INSTALL_PROMPT_SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

type PwaInstallPromptProps = {
  enabled?: boolean;
};

export function PwaInstallPrompt({ enabled = true }: PwaInstallPromptProps) {
  const { t } = useI18n();
  const loc = useLocation();
  const guide = useMemo(() => pwaGuideKey(detectPwaInstallPlatform()), []);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(() => getPwaInstallPrompt());

  useEffect(() => {
    const onInstallAvailable = () => {
      const next = getPwaInstallPrompt();
      setPrompt(next);
      if (!next) return;
      clearPwaInstalledMarker();
      if (!enabled) return;
      if (shouldTreatPwaAsInstalled() || isTelegramMiniApp() || hasShownThisSession()) return;
      markShownThisSession();
      setShowGuide(false);
      setOpen(true);
    };

    const onInstalled = () => {
      markPwaInstalled();
      setPrompt(null);
      setOpen(false);
      toast.success(t("pwa.onboarding.install.accepted.title"), {
        description: t("pwa.onboarding.install.accepted.text"),
        durationMs: 3500,
      });
    };

    window.addEventListener("beforeinstallprompt", onInstallAvailable);
    window.addEventListener("appinstalled", onInstalled);

    const timer = window.setTimeout(() => {
      if (!enabled) return;
      if (shouldTreatPwaAsInstalled() || isTelegramMiniApp() || hasShownThisSession()) return;
      const next = getPwaInstallPrompt();
      setPrompt(next);
      markShownThisSession();
      setShowGuide(false);
      setOpen(true);
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onInstallAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled, t]);

  useEffect(() => {
    if (!enabled || shouldTreatPwaAsInstalled() || isTelegramMiniApp()) setOpen(false);
  }, [enabled, loc.pathname]);

  async function install() {
    const activePrompt = prompt || getPwaInstallPrompt();
    if (!activePrompt) {
      setShowGuide(true);
      return;
    }
    setBusy(true);
    try {
      await activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      (window as any).__pwaInstallPrompt = null;
      setPrompt(null);

      if (choice?.outcome === "accepted") {
        markPwaInstalled();
        setOpen(false);
      } else {
        toast.info(t("pwa.onboarding.install.dismissed.title"), {
          description: t("pwa.onboarding.install.dismissed.text"),
          durationMs: 3000,
        });
        setOpen(false);
      }
    } catch {
      setShowGuide(true);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setShowGuide(false);
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" onMouseDown={close} className="modal pwa-install-modal" style={{ zIndex: 9998 }}>
      <div className="card modal__card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__body">
          <div className="modal__title">{t(`pwa.onboarding.install.${guide}.title`)}</div>
          <p className="p" style={{ marginTop: 8 }}>
            {showGuide ? t(`pwa.onboarding.install.${guide}.text`) : t("pwa.onboarding.install.prompt.text")}
          </p>
          {showGuide ? (
            <div className="pre pwa-install-steps">{t(`pwa.onboarding.install.${guide}.steps`)}</div>
          ) : null}
          <div className={`actions ${showGuide ? "actions--1" : "actions--2"} modal-actions`}>
            {!showGuide ? (
              <>
                <button className="btn" type="button" onClick={close} disabled={busy}>
                  {t("pwa.onboarding.button.later")}
                </button>
                <button className="btn btn--primary" type="button" onClick={() => void install()} disabled={busy}>
                  {busy ? "..." : t("pwa.onboarding.button.install")}
                </button>
              </>
            ) : (
              <button className="btn btn--primary" type="button" onClick={close} disabled={busy}>
                {t("pwa.onboarding.button.ok")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
