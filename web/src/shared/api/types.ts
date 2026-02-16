// web/src/shared/api/types.ts

export type ApiOk = { ok: true };
export type ApiErr = { ok: false; error: string; detail?: unknown };
export type ApiResult<T> = (ApiOk & T) | ApiErr;

// /api/me
export type MeProfile = {
  login?: string | null;
  passwordSet?: boolean; // важно для gate в SetPassword
  user_id?: number | null;
};

export type MeResponse = ApiResult<{ profile?: MeProfile }>;

// Ответы логина (Telegram / Password / Widget):
// next = 'set_password' | 'home'
export type AuthResponse = ApiResult<{
  login?: string;
  next: "set_password" | "home";
  user_id?: number;
}>;

// Ответ установки/смены пароля
export type PasswordSetResponse = ApiResult<{
  password_set: 1;
}>;
