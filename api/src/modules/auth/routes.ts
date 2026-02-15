// api/src/modules/auth/routes.ts

import type { FastifyInstance } from "fastify";
import { handleAuth } from "./authService.js";
import { setPassword } from "./password.js";
import {
  createLocalSid,
  putSession,
  deleteSession,
  getSessionFromRequest,
} from "../../shared/session/sessionStore.js";
import { shmAuthWithTelegramWebApp } from "../../shared/shm/shmClient.js";
import { createTransfer, consumeTransfer } from "../../shared/linkdb/transferRepo.js";

const ALLOWED_PROVIDERS = new Set(["telegram", "password", "google", "yandex"] as const);
type AllowedProvider = "telegram" | "password" | "google" | "yandex";

function asProvider(v: any): AllowedProvider | null {
  const p = String(v ?? "").trim().toLowerCase();
  return (ALLOWED_PROVIDERS as any).has(p) ? (p as AllowedProvider) : null;
}

function shmRoot(): string {
  const b0 = String(process.env.SHM_BASE ?? "").trim(); // ожидаем ".../shm/" или ".../shm"
  const b = (b0 || "https://bill.shpyn.online/shm/").replace(/\/+$/, "");
  if (b.endsWith("/shm/v1")) return b.slice(0, -3);
  return b;
}
function shmV1(): string {
  return `${shmRoot()}/v1`;
}

async function safeReadJson(res: Response): Promise<any | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function shmGetUserId(sessionId: string): Promise<number> {
  const res = await fetch(`${shmV1()}/user`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "session-id": sessionId,
    },
  });

  const json = await safeReadJson(res);
  const text = json ? "" : await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(
      `shm_user_failed:${res.status}:${String((json ?? text) || "").slice(0, 200)}`
    );
  }

  const u = Array.isArray((json as any)?.data) ? (json as any).data[0] : (json as any)?.data;
  const userId = Number(u?.user_id ?? u?.id ?? 0) || 0;
  if (!userId) throw new Error("shm_user_invalid_response");

  return userId;
}

async function callShmTemplate<T = any>(
  sessionId: string,
  action: string,
  extraData?: any
): Promise<T> {
  const url = `${shmV1()}/template/shpun_app`;
  const body = JSON.stringify({
    session_id: sessionId,
    action,
    ...(extraData ? { data: extraData } : {}),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body,
  });

  const json = await safeReadJson(res);
  const text = json ? "" : await res.text().catch(() => "");

  if (!res.ok) {
    const msg =
      (json as any)?.error ||
      (json as any)?.message ||
      `SHM template failed: ${res.status}`;
    throw new Error(`${msg}:${String(text || "").slice(0, 200)}`);
  }

  return (json ?? {}) as T;
}

async function getPasswordSetFlag(shmSessionId: string): Promise<0 | 1> {
  try {
    const r: any = await callShmTemplate(shmSessionId, "status");
    const v = r?.data?.auth?.password_set;
    return v === 1 || v === "1" ? 1 : 0;
  } catch {
    // важно: не “угадываем” что пароль не установлен — лучше считать установленным, чем мучить людей
    return 1;
  }
}

function firstHeaderValue(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  // CF/nginx иногда кладут списки через запятую
  return s.split(",")[0].trim();
}

function normalizeRedirectPath(input: any, fallback = "/app"): string {
  const v = String(input ?? "").trim();
  if (!v) return fallback;

  // только относительные пути внутри приложения (защита от open-redirect)
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;
  if (/[^\x20-\x7E]/.test(v)) return fallback;

  return v;
}

function getRequestIp(req: any): string {
  return String(req.headers?.["x-real-ip"] ?? req.ip ?? "").trim();
}

function isHttps(req: any): boolean {
  const xfProto = firstHeaderValue(req.headers?.["x-forwarded-proto"]).toLowerCase();
  if (xfProto) return xfProto === "https";
  const proto = String((req as any).protocol ?? "").toLowerCase();
  return proto === "https";
}

function cookieMaxAgeSeconds(): number {
  // максимально долго по умолчанию (365 дней)
  return Number(process.env.SID_COOKIE_MAX_AGE_SEC || 365 * 24 * 60 * 60);
}

function cookieOptions(req: any) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(req), // важно: реальный https, даже если NODE_ENV != production
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
    domain: "app.sdnonline.online", // ✅ фиксируем домен для РФ
  };
}

/* ===================== Bridge helpers ===================== */

function escHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}

function buildIntentUrl(target: string) {
  const u = new URL(target);
  const scheme = u.protocol.replace(":", ""); // https
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

function bridgeHtml(targetUrl: string, errorText?: string) {
  const safeTarget = escHtml(targetUrl);
  const safeErr = errorText ? escHtml(errorText) : "";

  const title = safeErr ? "Ссылка устарела" : "Открываем в браузере…";
  const subtitle = safeErr
    ? "Вернитесь в Telegram и нажмите «Установить» ещё раз."
    : "Для установки приложения нужно открыть сайт во внешнем браузере (Chrome/Safari).";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <meta name="referrer" content="no-referrer" />
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto; padding:20px; background:#0b0b0d; color:#fff;}
    .card{max-width:520px;margin:0 auto;border:1px solid #ffffff1f;border-radius:16px;padding:16px;background:#121219;}
    h2{margin:0 0 8px 0;font-size:20px;}
    .muted{opacity:.75;font-size:14px;line-height:1.35;margin-top:8px;}
    button,a{display:block;width:100%;padding:14px 16px;margin-top:10px;border-radius:12px;border:0;text-align:center;font-weight:700;}
    button{background:#7c5cff;color:#fff}
    a{background:#1a1a22;color:#fff;text-decoration:none}
    code{display:block;word-break:break-all;background:#0d0d13;border:1px solid #ffffff1a;border-radius:10px;padding:10px;margin-top:10px}
    .row{display:flex;gap:10px}
    .row button{flex:1;background:#20202a}
    .warn{margin-top:10px; padding:10px; border-radius:12px; background:#2a1f1f; border:1px solid #ff6b6b33;}
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <div class="muted">${subtitle}</div>
    ${safeErr ? `<div class="warn">${safeErr}</div>` : ""}

    <button id="btn">Открыть в браузере</button>
    <a id="link" href="${safeTarget}" rel="noopener">Открыть обычной ссылкой</a>

    <div class="muted">Если Telegram снова открыл внутри себя: нажмите <b>⋮</b> → <b>Открыть в браузере</b>.</div>

    <div class="muted" style="margin-top:12px;">Ссылка:</div>
    <code id="url">${safeTarget}</code>

    <div class="row">
      <button id="copy">Скопировать</button>
      <button id="retry">Ещё раз</button>
    </div>
  </div>

<script>
(function(){
  const TARGET = ${JSON.stringify(targetUrl)};
  const INTENT = ${JSON.stringify(buildIntentUrl(targetUrl))};
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isTelegram = /Telegram/i.test(ua);

  const btn = document.getElementById("btn");
  const copy = document.getElementById("copy");
  const retry = document.getElementById("retry");

  function openExternal(){
    if (isAndroid && isTelegram) {
      location.href = INTENT;
      setTimeout(function(){ location.href = TARGET; }, 900);
      return;
    }
    location.href = TARGET;
  }

  btn.addEventListener("click", openExternal);
  retry.addEventListener("click", openExternal);

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(TARGET);
      copy.textContent = "Скопировано ✅";
      setTimeout(() => copy.textContent = "Скопировать", 1500);
    } catch (e) {
      prompt("Скопируйте ссылку:", TARGET);
    }
  });

  // автопопытка 1 раз (без циклов)
  setTimeout(openExternal, 250);
})();
</script>
</body>
</html>`;
}

/* ===================== Routes ===================== */

export async function authRoutes(app: FastifyInstance) {
  // ====== POST /api/auth/:provider ======
  app.post("/auth/:provider", async (req, reply) => {
    const { provider: rawProvider } = req.params as { provider: string };
    const provider = asProvider(rawProvider);

    if (!provider) {
      return reply.code(400).send({ ok: false, status: 400, error: "unknown_provider" });
    }

    const body = (req.body ?? {}) as any;

    const result = await handleAuth(provider, body);
    if (!result.ok) return reply.code((result as any).status || 400).send(result);

    const shmSessionId = String((result as any).shmSessionId ?? "").trim();
    if (!shmSessionId) {
      return reply.code(502).send({ ok: false, status: 502, error: "no_shm_session" });
    }

    let shmUserId = Number((result as any).shmUserId ?? 0) || 0;
    if (!shmUserId) {
      try {
        shmUserId = await shmGetUserId(shmSessionId);
      } catch (e: any) {
        return reply.code(502).send({
          ok: false,
          status: 502,
          error: "shm_user_lookup_failed",
          detail: e?.message,
        });
      }
    }

    const localSid = createLocalSid();

    const telegramInitData = provider === "telegram" ? String(body.initData ?? "").trim() : "";

    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      ...(telegramInitData ? { telegramInitData } : {}),
    });

    // ✅ next: только сервер решает, куда идти.
    let next: "set_password" | "home" = "home";

    if (provider === "telegram") {
      const ps = await getPasswordSetFlag(shmSessionId);
      next = ps === 1 ? "home" : "set_password";
    }

    const loginFromApi = String((result as any).login ?? "").trim();

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({
        ok: true,
        user_id: shmUserId,
        login: loginFromApi,
        next,
      });
  });

  // ====== POST /api/auth/password/set  { password } ======
  app.post("/auth/password/set", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const password = String(body.password ?? "").trim();

    const sid = String((req.cookies as any)?.sid ?? "").trim();
    const s = getSessionFromRequest(req) as any;

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code((r as any).status || 400).send(r);

    // ✅ после смены пароля SHM может инвалидировать session_id — обновляем по initData
    try {
      const initData = String(s?.telegramInitData ?? "").trim();
      if (initData && sid) {
        const rr = await shmAuthWithTelegramWebApp(initData);
        if ((rr as any)?.ok && (rr as any).json?.session_id) {
          const newShmSessionId = String((rr as any).json.session_id);
          const newUserId = await shmGetUserId(newShmSessionId);

          putSession(sid, {
            ...s,
            shmSessionId: newShmSessionId,
            shmUserId: newUserId,
            createdAt: s?.createdAt || Date.now(),
          });
        }
      }
    } catch {
      // ignore
    }

    // best-effort флаг password_set
    try {
      const ss = getSessionFromRequest(req) as any;
      const shmSessionId = String(ss?.shmSessionId ?? "").trim();
      if (shmSessionId) {
        await callShmTemplate(shmSessionId, "password.mark_set");
      }
    } catch {
      // ignore
    }

    return reply.send({ ok: true, password_set: 1 });
  });

  // ====== POST /api/auth/transfer/start ======
  // Создаёт одноразовый код на 60 сек и возвращает consume_url (абсолютный).
  app.post("/auth/transfer/start", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const shmSessionId = String(s?.shmSessionId ?? "").trim();
    const shmUserId = Number(s?.shmUserId ?? 0) || 0;

    if (!shmSessionId || !shmUserId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const ip = getRequestIp(req);
    const ua = String(req.headers["user-agent"] ?? "");

    const { code, expiresAt } = createTransfer({
      shmUserId,
      shmSessionId,
      ttlSeconds: 60,
      ip,
      ua,
    });

    const redirectTo = "/app";
    const consumeUrl =
      `https://app.sdnonline.online` +
      `/api/auth/transfer/consume?code=${encodeURIComponent(code)}&redirect=${encodeURIComponent(redirectTo)}`;

    return reply.send({ ok: true, consume_url: consumeUrl, expires_at: expiresAt });
  });

  // ====== GET /api/auth/transfer/consume?code=...&redirect=/app ======
  // Открывается из Telegram WebView. Ставит sid cookie и отдаёт HTML bridge, который выбивает во внешний браузер.
  app.get("/auth/transfer/consume", async (req, reply) => {
    const q = req.query as any;
    const code = String(q.code ?? "").trim();
    const redirectTo = normalizeRedirectPath(q.redirect, "/app");

    const targetUrl = `https://app.sdnonline.online${redirectTo}`;

    const noStore = () =>
      reply
        .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        .header("Pragma", "no-cache");

    if (!code) {
      noStore();
      return reply
        .type("text/html; charset=utf-8")
        .code(400)
        .send(bridgeHtml("https://app.sdnonline.online/login?e=code_required", "code_required"));
    }

    const r = consumeTransfer(code);
    if (!r.ok) {
      noStore();
      const errUrl = `https://app.sdnonline.online/login?e=${encodeURIComponent(r.error)}`;
      return reply
        .type("text/html; charset=utf-8")
        .code(410)
        .send(bridgeHtml(errUrl, r.error));
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId: r.shmSessionId,
      shmUserId: r.shmUserId,
      createdAt: Date.now(),
    });

    noStore();
    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .type("text/html; charset=utf-8")
      .send(bridgeHtml(targetUrl));
  });

  // ====== GET /api/auth/status ======
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
      has_sid_cookie: !!(req.cookies as any)?.sid,
    });
  });

  // ====== POST /api/logout ======
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}
