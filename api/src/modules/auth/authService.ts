// api/src/modules/auth/authService.ts

import { telegramAuth } from "./providers/telegram.js";
import { googleAuth } from "./providers/google.js";
import { yandexAuth } from "./providers/yandex.js";
import { passwordAuth } from "./providers/password.js";

export type AllowedProvider = "telegram" | "password" | "google" | "yandex";

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: any;

  shmSessionId?: string;
  shmUserId?: number;
  login?: string;
}

export async function handleAuth(provider: AllowedProvider | string, body: any): Promise<AuthResult> {
  switch (provider) {
    case "telegram":
      return telegramAuth(body);

    case "password":
      // ✅ регистрация/логин будет реализована внутри passwordAuth(body)
      // через body.mode = "register" | "login"
      return passwordAuth(body);

    case "google":
      return googleAuth(body);

    case "yandex":
      return yandexAuth(body);

    default:
      return { ok: false, status: 400, error: "unknown_provider" };
  }
}
