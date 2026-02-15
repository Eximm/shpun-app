// api/src/modules/auth/authService.ts

import { telegramAuth } from "./providers/telegram.js";
import { googleAuth } from "./providers/google.js";
import { yandexAuth } from "./providers/yandex.js";
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

export async function handleAuth(
  provider: AllowedProvider | string,
  body: unknown
): Promise<AuthResult> {
  switch (provider) {
    case "telegram":
      return telegramAuth(body as any);

    case "password":
      // ✅ регистрация/логин будет реализована внутри passwordAuth(body)
      // через body.mode = "register" | "login"
      return passwordAuth(body as any);

    case "google":
      return googleAuth(body as any);

    case "yandex":
      return yandexAuth(body as any);

    default:
      return { ok: false, status: 400, error: "unknown_provider" };
  }
}
