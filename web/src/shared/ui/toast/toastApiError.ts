// web/src/shared/ui/toast/toastApiError.ts

import { isNotAuthenticated } from "../../api/client";
import { normalizeError } from "../../api/errorText";
import { toast } from "./toast";

export function toastApiError(
  err: unknown,
  opts?: {
    title?: string;
    sound?: boolean;
    durationMs?: number;
    /** ignore suppressToast if you really want to show it */
    force?: boolean;
  }
) {
  // Для auth-ошибок тост не показываем:
  // AuthGate сам покажет единый toast и уведёт на /login.
  if (isNotAuthenticated(err) && !opts?.force) {
    return;
  }

  const n = normalizeError(err, { title: opts?.title });

  // DEV-only: keep raw details out of UI, but available for debugging
  try {
    if ((import.meta as any)?.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[toastApiError]", { raw: err, normalized: n });
    }
  } catch {
    // ignore
  }

  if (n.suppressToast && !opts?.force) return;

  toast.error(n.title, {
    description: n.description,
    sound: opts?.sound !== false,
    durationMs: opts?.durationMs,
  });
}