// api/src/modules/support/telegram.ts
//
// Outbound Telegram messages for support notifications.
//
// Reuses the existing bot token (TG_BOT_TOKEN) and, when no dedicated support
// list is configured, the existing staff/receipts chat (TG_RECEIPTS_CHAT_ID /
// RECEIPTS_CHAT_ID). All calls are best-effort: callers must not depend on them.

function envStr(name: string, def = ""): string {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

export function supportBotToken(): string {
  return envStr("TG_BOT_TOKEN");
}

/**
 * Admin/operator Telegram chats for support notifications.
 * Dedicated SUPPORT_ADMIN_CHAT_IDS wins; otherwise fall back to the existing
 * receipts/staff chat so no duplicate list is required out of the box.
 */
export function supportAdminChatIds(): string[] {
  const dedicated = envStr("SUPPORT_ADMIN_CHAT_IDS");
  if (dedicated) {
    return dedicated
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  const fallback = envStr("TG_RECEIPTS_CHAT_ID") || envStr("RECEIPTS_CHAT_ID");
  return fallback ? [fallback] : [];
}

export function supportAppBaseUrl(): string {
  const explicit = envStr("SUPPORT_APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const origins = envStr("APP_ORIGIN")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const https = origins.find((o) => o.startsWith("https://"));
  return (https || "https://app.shpun.net").replace(/\/+$/, "");
}

/** Deep link that opens the support ticket in the ShpunApp admin. */
export function supportTicketAdminUrl(ticketId: number | string): string {
  const id = encodeURIComponent(String(ticketId ?? "").trim());
  return `${supportAppBaseUrl()}/admin?tab=support&ticket=${id}`;
}

export type TelegramSendResult = { ok: boolean; error?: string };

export async function sendSupportTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<TelegramSendResult> {
  const token = supportBotToken();
  if (!token) return { ok: false, error: "tg_token_missing" };

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: String(json?.description ?? `http_${res.status}`) };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error ?? "tg_send_failed") };
  }
}
