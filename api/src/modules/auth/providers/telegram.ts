import { verifyTelegramInitData } from "../../../shared/telegram/verifyInitData.js";
import { shmAuthWithTelegramWebApp } from "../../../shared/shm/shmClient.js";
import { getLink, insertLink, touchLink } from "../../../shared/linkdb/linkRepo.js";

const SHM_BASE_URL = (
  process.env.SHM_BASE_URL || "https://bill.shpyn.online/shm/v1"
).replace(/\/+$/, "");

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";

function parseTelegramWebAppInitData(initData: string): {
  tgId: string | null;
  username: string;
} {
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return { tgId: null, username: "" };

    const user = JSON.parse(userRaw);
    const tgId = user?.id != null ? String(user.id) : null;
    const username = user?.username != null ? String(user.username) : "";
    return { tgId, username };
  } catch {
    return { tgId: null, username: "" };
  }
}

async function shmGetCurrentUser(sessionId: string) {
  const res = await fetch(`${SHM_BASE_URL}/user`, {
    method: "GET",
    headers: {
      Cookie: `session_id=${sessionId}`,
      Accept: "application/json",
    },
  });

  const json = await res.json().catch(() => undefined);
  const text = json ? "" : await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, json, text };
}

async function shmCallShpunApp(
  sessionId: string,
  telegram_id: string,
  telegram_login: string
) {
  // best-effort — не ломаем авторизацию из-за шаблона
  await fetch(`${SHM_BASE_URL}/template/shpun_app`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      action: "auth.telegram",
      telegram_id,
      telegram_login,
    }),
  }).catch(() => undefined);
}

export async function telegramAuth(body: any) {
  const initData = String(body.initData ?? "").trim();
  if (!initData) return { ok: false, status: 400, error: "initData_required" };

  if (!TG_BOT_TOKEN) {
    return { ok: false, status: 500, error: "TG_BOT_TOKEN_missing" };
  }

  const valid = verifyTelegramInitData(initData, TG_BOT_TOKEN);
  if (!valid) return { ok: false, status: 401, error: "bad_init_data" };

  const tgUser = parseTelegramWebAppInitData(initData);
  if (!tgUser.tgId) return { ok: false, status: 400, error: "tg_user_missing" };

  // 1) SHM telegram auth -> { session_id }
  const r = await shmAuthWithTelegramWebApp(initData);
  if (!r.ok || !r.json?.session_id) {
    return {
      ok: false,
      status: r.status || 401,
      error: "telegram_auth_failed",
      detail: r.json ?? r.text,
    };
  }

  const shmSessionId = String(r.json.session_id);

  // 2) /user -> user_id + login
  const me = await shmGetCurrentUser(shmSessionId);
  if (!me.ok || !me.json) {
    return {
      ok: false,
      status: 500,
      error: "failed_to_get_user",
      detail: me.json ?? me.text,
    };
  }

  const j = me.json as any;
  const shmUserId = Number(j.user_id);
  const login = String(j.login ?? "");

  if (!Number.isFinite(shmUserId)) {
    return { ok: false, status: 500, error: "invalid_user_payload", detail: j };
  }

  // 3) LinkDB upsert (telegram -> user)
  const profile = "default";
  const meta = JSON.stringify({ username: tgUser.username });

  const existing = getLink("telegram", profile, tgUser.tgId);

  if (!existing) {
    try {
      insertLink("telegram", profile, tgUser.tgId, shmUserId, meta);
    } catch {
      const re = getLink("telegram", profile, tgUser.tgId);
      if (!re || Number(re.shm_user_id) !== shmUserId) {
        return { ok: false, status: 409, error: "tg_already_linked" };
      }
      touchLink("telegram", profile, tgUser.tgId, meta);
    }
  } else {
    if (Number(existing.shm_user_id) !== shmUserId) {
      return { ok: false, status: 409, error: "tg_already_linked" };
    }
    touchLink("telegram", profile, tgUser.tgId, meta);
  }

  // 4) settings best-effort
  await shmCallShpunApp(shmSessionId, tgUser.tgId, tgUser.username);

  return {
    ok: true,
    shmSessionId,
    shmUserId,
    login,
  };
}
