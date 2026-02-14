// web/src/shared/api/types.ts

export type ApiOk = { ok: true }
export type ApiErr = { ok: false; error: string }

// /api/me (или /me — как у тебя сейчас настроено в apiFetch)
export type MeResponse =
  | (ApiOk & { profile?: { login?: string | null } })
  | ApiErr

// Ответы логина (Telegram / Password), чтобы роутить:
// next = 'set_password' | 'cabinet'
export type AuthResponse =
  | (ApiOk & {
      login?: string
      next: 'set_password' | 'cabinet'
    })
  | ApiErr

// Ответ установки/смены пароля (подходит и для first-time, и для "Change password" в профиле)
export type PasswordSetResponse =
  | (ApiOk & {
      password_set: 1
    })
  | ApiErr
