// api/src/modules/auth/providers/telegram.ts

/**
 * Telegram auth переехал в каноничные маршруты routes.ts:
 *  - POST /api/auth/telegram        (Telegram Mini App initData)
 *  - POST /api/auth/telegram_widget (Telegram Login Widget payload)
 *
 * Этот файл оставлен как безопасная заглушка, чтобы:
 * - не тянуть старые зависимости (verifyInitData, linkdb, legacy SHM endpoints)
 * - не ломать сборку из-за “не тех” экспортов
 * - явно фиксировать решение: Telegram НЕ провайдер authService
 */

export type TelegramAuthResult =
  | {
      ok: true;
      shmSessionId: string;
      shmUserId: number;
      login: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      detail?: unknown;
    };

export async function telegramAuth(_body: any): Promise<TelegramAuthResult> {
  return {
    ok: false,
    status: 400,
    error: "telegram_auth_moved_to_routes",
  };
}
