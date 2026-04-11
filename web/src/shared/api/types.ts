// web/src/shared/api/types.ts

export type ApiOk = { ok: true };
export type ApiErr = { ok: false; error: string; detail?: unknown };
export type ApiResult<T> = (ApiOk & T) | ApiErr;

// Ответы логина (/auth/password, /auth/telegram)
export type AuthResponse = ApiResult<{
  login?: string;
  next: "set_password" | "home";
  user_id?: number;
}>;

// Ответ установки/смены пароля (/auth/password/set)
export type PasswordSetResponse = ApiResult<{
  password_set: 1;
}>;

// Email пользователя (/user/email)
export type UserEmailResponse = ApiResult<{
  email?: string | null;
  emailVerified?: boolean | null;
}>;