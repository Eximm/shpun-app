export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  description?: string;
  durationMs?: number; // default: 3500
};

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  durationMs: number;
};

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const toastStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    listener(toasts);

    // IMPORTANT: React effect cleanup must return void, not boolean
    return () => {
      listeners.delete(listener);
    };
  },

  push(item: Omit<ToastItem, "id">) {
    const id = uid();
    toasts = [...toasts, { ...item, id }];
    emit();
    return id;
  },

  remove(id: string) {
    toasts = toasts.filter(t => t.id !== id);
    emit();
  },

  clear() {
    toasts = [];
    emit();
  },
};

export const toast = {
  success(title: string, opts: ToastOptions = {}) {
    return toastStore.push({
      title,
      description: opts.description,
      variant: "success",
      durationMs: opts.durationMs ?? 3500,
    });
  },

  error(title: string, opts: ToastOptions = {}) {
    return toastStore.push({
      title,
      description: opts.description,
      variant: "error",
      durationMs: opts.durationMs ?? 4500,
    });
  },

  info(title: string, opts: ToastOptions = {}) {
    return toastStore.push({
      title,
      description: opts.description,
      variant: "info",
      durationMs: opts.durationMs ?? 3500,
    });
  },
};