// web/src/shared/ui/toast/toastApiError.ts
import { normalizeError } from "../../api/errorText";
import { toast } from "./toast";

export function toastApiError(err: unknown, opts?: { title?: string; sound?: boolean }) {
  const n = normalizeError(err, { title: opts?.title });

  // DEV-only: keep raw details out of UI, but available for debugging
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn("[toastApiError]", { raw: err, normalized: n });
  }

  if (n.suppressToast) return;

  toast.error(n.title, {
    description: n.description,
    sound: opts?.sound !== false,
  });
}