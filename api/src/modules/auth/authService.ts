// api/src/modules/auth/authService.ts

import { telegramAuth } from "./providers/telegram.js";
import { googleAuth } from "./providers/google.js";
import { yandexAuth } from "./providers/yandex.js";

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
  detail?: any;

  shmSessionId?: string;
  shmUserId?: number;
  login?: string;
}

export async function handleAuth(
  provider: string,
  body: any
): Promise<AuthResult> {
  switch (provider) {
    case "telegram":
      return telegramAuth(body);

    case "google":
      return googleAuth(body);

    case "yandex":
      return yandexAuth(body);

    default:
      return { ok: false, status: 400, error: "unknown_provider" };
  }
}
