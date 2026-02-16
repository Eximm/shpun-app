// api/src/modules/auth/authService.ts

import { passwordAuth } from "./providers/password.js";

export type AllowedProvider = "telegram" | "password" | "google" | "yandex";

export type AuthResult = {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: unknown;

  shmSessionId?: string;
  shmUserId?: number;
  login?: string;
};

/**
 * handleAuth — центральный роутер провайдеров.
 *
 * Важно:
 * - Telegram auth НЕ обрабатывается здесь.
 *   Он реализован напрямую в routes.ts через SHM canonical endpoints.
 *
 * - Google/Yandex пока не реализованы (заглушки).
 *
 * Это место должно оставаться тонким диспетчером.
 */
export async function handleAuth(
  provider: AllowedProvider | string,
  body: unknown
): Promise<AuthResult> {
  switch (provider) {
    case "password":
      // Логин / регистрация через passwordAuth
      return passwordAuth(body as any);

    case "telegram":
      // Telegram обрабатывается напрямую в routes.ts
      return {
        ok: false,
        status: 400,
        error: "telegram_provider_not_supported_here",
      };

    case "google":
    case "yandex":
      return {
        ok: false,
        status: 501,
        error: "provider_not_implemented",
      };

    default:
      return { ok: false, status: 400, error: "unknown_provider" };
  }
}
