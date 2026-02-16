// api/src/shared/linkdb/transferRepo.ts
//
// DEPRECATED (2026-02): transfer-login был временной “городушкой” для переноса авторизации
// из Telegram WebView во внешний браузер.
// Теперь по канону:
// 1) Telegram Mini App auth (initData -> SHM /telegram/webapp/auth)
// 2) Telegram Login Widget auth (widget payload -> SHM /telegram/web/auth)
// Transfer-login отключён.
//
// Этот модуль оставлен только для совместимости сборки, чтобы случайные старые импорты
// не ломали проект. По умолчанию все функции выбрасывают ошибку.
//
// Если когда-то понадобится включить обратно (не рекомендуется) — поставь
// ENABLE_TRANSFER_LOGIN=1 и мы вернём реализацию осознанно отдельным PR.

export type TransferError =
  | "disabled"
  | "code_not_found"
  | "code_already_used"
  | "code_expired";

export type CreateTransferArgs = {
  shmUserId: number;
  shmSessionId: string;
  ttlSeconds?: number;
  ip?: string;
  ua?: string;
};

export type CreateTransferResult = {
  code: string;
  expiresAt: number;
};

export type ConsumeTransferResult =
  | { ok: false; error: TransferError }
  | { ok: true; shmUserId: number; shmSessionId: string };

function isEnabled(): boolean {
  const v = String(process.env.ENABLE_TRANSFER_LOGIN ?? "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function disabledError(): never {
  throw new Error("transfer_login_disabled");
}

/**
 * Ранее создавал одноразовый код.
 * Теперь отключено.
 */
export function createTransfer(_args: CreateTransferArgs): CreateTransferResult {
  if (!isEnabled()) disabledError();
  disabledError();
}

/**
 * Ранее “съедал” одноразовый код.
 * Теперь отключено.
 */
export function consumeTransfer(_code: string): ConsumeTransferResult {
  if (!isEnabled()) return { ok: false, error: "disabled" };
  return { ok: false, error: "disabled" };
}

/**
 * Ранее чистил таблицу SQLite.
 * Теперь no-op.
 */
export function cleanupTransfers(_opts?: {
  keepUsedMs?: number;
  deleteExpiredOlderThanMs?: number;
}): void {
  // no-op
}
