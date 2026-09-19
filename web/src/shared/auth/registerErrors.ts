// web/src/shared/auth/registerErrors.ts
//
// Pure mapping/classification for registration errors.
//
// Kept free of React/DOM so it can be unit-tested with esbuild (see
// scripts/test-registration-errors.mjs) and reused by the Login modal.
//
// Rules:
//  - field errors are additionally shown under the matching field;
//  - everything else is a form-level error shown in the panel above submit;
//  - registration never falls back to the generic sign-in message.

export type RegisterErrorField = "email" | "password" | "referral" | "form";

export type RegisterErrorInfo = {
  field: RegisterErrorField;
  /** The exact i18n key in the dictionary (not a translated string). */
  key: string;
};

export type RegisterErrorText = {
  field: RegisterErrorField;
  message: string;
};

export type Translate = (key: string, fallback?: string) => string;

const CODE_RE = /^[a-z0-9_:.|-]+$/i;

function looksLikeCode(value: string): boolean {
  const v = String(value || "").trim();
  return v.length > 0 && CODE_RE.test(v) && !/\s/.test(v);
}

/** Returns the i18n key for an email validation code, or null. */
export function emailErrorKey(code: unknown): string | null {
  switch (String(code ?? "").trim()) {
    case "email_required":           return "login.err.email_required";
    case "email_non_ascii":          return "login.err.email_non_ascii";
    case "email_invalid_format":     return "login.err.email_invalid_format";
    case "email_local_too_short":    return "login.err.email_local_too_short";
    case "email_local_invalid":      return "login.err.email_local_invalid";
    case "email_domain_invalid":     return "login.err.email_domain_invalid";
    case "email_domain_numeric":     return "login.err.email_domain_invalid";
    case "email_domain_not_allowed": return "login.err.email_domain_not_allowed";
    default:                         return null;
  }
}

export function mapEmailError(code: string, t: Translate): string {
  const key = emailErrorKey(code);
  return key ? t(key) : "";
}

/**
 * Classify a raw registration error into a field + i18n key.
 *
 * `raw` must be a backend code (e.g. `email_domain_not_allowed`,
 * `shm_register_exception`). A human-readable backend message is passed through
 * unchanged as a form-level error.
 */
export function classifyRegisterError(raw: unknown, t: Translate): RegisterErrorText {
  const value = String(raw ?? "").trim();

  if (!value) {
    return { field: "form", message: t("login.err.register_failed") };
  }
  if (!looksLikeCode(value)) {
    // Already a human-readable message (backend `message`/`details`).
    return { field: "form", message: value };
  }

  const info = registerErrorInfo(value);
  return { field: info.field, message: t(info.key) };
}

/** Field + i18n key for a raw registration code (no translation). */
export function registerErrorInfo(raw: unknown): RegisterErrorInfo {
  const code = String(raw ?? "").trim();

  const emailKey = emailErrorKey(code);
  if (emailKey) return { field: "email", key: emailKey };

  switch (code) {
    case "login_taken":
    case "user_exists":
      return { field: "email", key: "login.err.login_taken" };
    case "telegram_login_not_allowed_in_regular_register":
      return { field: "email", key: "login.err.telegram_login_not_allowed" };

    case "password_too_short":
    case "password_too_short_or_weak":
      return { field: "password", key: "login.err.password_too_short" };
    case "invalid_password":
    case "password_invalid":
      return { field: "password", key: "login.err.password_invalid" };

    case "invalid_referral_alias":
    case "alias_not_found":
    case "referral_not_found":
    case "invalid_partner_id":
      return { field: "referral", key: "login.partner.not_found" };

    case "registration_limited":
      return { field: "form", key: "login.err.registration_limited" };
    case "network_error":
      return { field: "form", key: "login.err.register_network" };

    case "shm_auth_unavailable":
    case "shm_register_exception":
    case "shm_auth_exception":
    case "shm_register_failed":
    case "registration_unavailable":
      return { field: "form", key: "login.err.register_unavailable" };

    default:
      // Registration-specific fallback. Never login.err.generic.
      return { field: "form", key: "login.err.register_failed" };
  }
}