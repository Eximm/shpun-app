export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  description?: string;
  durationMs?: number; // default: 3500
  sound?: boolean; // default: true
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

/* =========================================================
   Sound ("кряк")
   ========================================================= */

let audioBase: HTMLAudioElement | null = null;
let lastPlayAt = 0;

// можно потом связать с настройкой пользователя
let soundEnabled = true;

function playCry() {
  if (!soundEnabled) return;

  // антиспам: не чаще 1 раза в 700мс
  const now = Date.now();
  if (now - lastPlayAt < 700) return;
  lastPlayAt = now;

  try {
    if (!audioBase) {
      audioBase = new Audio("/sounds/cry.ogg");
      audioBase.preload = "auto";
      audioBase.volume = 0.8;
    }

    // clone — чтобы несколько тостов подряд не обрубали звук
    const a = audioBase.cloneNode(true) as HTMLAudioElement;
    a.play().catch(() => {});
  } catch {
    // ignore
  }
}

/* =========================================================
   Store
   ========================================================= */

export const toastStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    listener(toasts);

    return () => {
      listeners.delete(listener);
    };
  },

  push(item: Omit<ToastItem, "id">, opts?: { sound?: boolean }) {
    const id = uid();

    // звук по умолчанию включён
    if (opts?.sound !== false) playCry();

    // Newest on top
    toasts = [{ ...item, id }, ...toasts];

    emit();
    return id;
  },

  remove(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  },

  clear() {
    toasts = [];
    emit();
  },

  // на будущее (можно дергать из настроек)
  setSoundEnabled(v: boolean) {
    soundEnabled = !!v;
  },
};

export const toast = {
  success(title: string, opts: ToastOptions = {}) {
    return toastStore.push(
      {
        title,
        description: opts.description,
        variant: "success",
        durationMs: opts.durationMs ?? 3500,
      },
      { sound: opts.sound !== false }
    );
  },

  error(title: string, opts: ToastOptions = {}) {
    return toastStore.push(
      {
        title,
        description: opts.description,
        variant: "error",
        durationMs: opts.durationMs ?? 4500,
      },
      { sound: opts.sound !== false }
    );
  },

  info(title: string, opts: ToastOptions = {}) {
    return toastStore.push(
      {
        title,
        description: opts.description,
        variant: "info",
        durationMs: opts.durationMs ?? 3500,
      },
      { sound: opts.sound !== false }
    );
  },
};