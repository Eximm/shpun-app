import { suggestSupportReply } from "./assistant.js";
import type { TicketRepository } from "./repository.js";
import type { TicketMessage } from "./types.js";
import { assistantTransaction, readAssistantState, writeAssistantState, type AssistantState } from "./assistantState.js";
import { enrichMessagesWithAttachments } from "./attachmentService.js";
import { chooseSupportVoice, chooseScenarioVoice } from "./voice.js";

export const ASSISTANT_NAME = "Помощник Shpun";
export const assistantEnabled = () => process.env.SUPPORT_ASSISTANT_ENABLED === "true";
const defaultState = (): AssistantState => ({ mode: "active", reason: null, lastUserMessageId: 0, sentScenarios: [], replies: 0 });

export function assistantPublicState(ticketId: number) {
  const state = readAssistantState(ticketId);
  const enabled = assistantEnabled();
  return { enabled, mode: enabled ? state?.mode ?? "staff" : "staff" as const };
}

/** Synchronous transaction prevents double responses across retries/processes. */
export function runSupportAssistant(repo: TicketRepository, ticketId: number, forceHandoff = false): TicketMessage | null {
  if (!assistantEnabled() && !forceHandoff) return null;
  return assistantTransaction(() => {
    const ticket = repo.getTicket(ticketId);
    if (!ticket || ticket.kind !== "support" || ticket.status === "closed") return null;
    const messages = enrichMessagesWithAttachments(repo.listMessages(ticketId)).filter(m => !m.deletedAt && !m.isInternalNote);
    const state = readAssistantState(ticketId) ?? defaultState();
    // Human ownership is permanent for this ticket, including after reopen.
    if (messages.some(m => m.authorType === "staff") || ticket.assignedTo || ticket.status === "in_progress") {
      writeAssistantState(ticketId, { ...state, mode: "staff", reason: "staff_takeover" });
      return null;
    }
    if (state.mode === "staff") return null;
    if (forceHandoff) {
      // Persist the customer's action as a user message so existing unread
      // badges and operator queues see the request even after they read the chat.
      messages.push(repo.addMessage({ ticketId, authorType: "user", authorUserId: ticket.userId,
        authorName: ticket.displayNameSnapshot, text: "Позвать сотрудника поддержки", isInternalNote: false }));
    }
    const latest = messages.at(-1);
    if (!forceHandoff && (!latest || latest.authorType !== "user" || latest.id <= state.lastUserMessageId)) return null;
    const input = latest?.authorType === "user" ? latest.text : "";
    const normalized = input.toLowerCase().replaceAll("ё", "е");
    const say = (group: Parameters<typeof chooseSupportVoice>[0]) => chooseSupportVoice(group, ticketId, latest?.id ?? 0, state.replies);
    let reason = "";
    let text = "";
    let scenario = "";
    // Only carry context across our explicit device question, within this
    // still-active conversation. Never reuse old resolved/staff discussions.
    const clarifyingDevice = state.sentScenarios.at(-1) === "clarify_device";
    const original = clarifyingDevice ? messages.find(m => m.authorType === "user" && m.id === state.lastUserMessageId)?.text ?? "" : "";
    const matchingMessages = original ? messages.map(m => m.id === latest?.id ? { ...m, text: `${original}\n${m.text}` } : m) : messages;
    const result = suggestSupportReply({ ...ticket, messages: matchingMessages });
    const chosen = result.suggestions[0];
    const incident = (process.env.SUPPORT_ASSISTANT_INCIDENT_TEXT ?? "").trim().slice(0, 1500);
    const incidentScenarios = ["windows_happ_tun", "other_device_works", "subscription_import", "flex_variants",
      "subscription_incident", "ru_servers", "local_device", "connection_vs_import"];
    const asksStaff = /оператор|специалист|сотрудник|живой человек|человеку|человека|не бот|без бота|хватит|не помог|уже пробовал|не заработал|бесполез|достало|сколько можно|не понимаешь/.test(normalized);
    const confirmsResolved = /^(спасибо[!,. ]*)?(все работает|заработало|проблема решена|можно закрывать)[!,. ]*$/.test(normalized.trim());
    if (forceHandoff || asksStaff) {
      reason = forceHandoff ? "requested" : "requested_or_failed";
      if (/не помог|уже пробовал|не заработал/.test(normalized)) text = say("failed");
    }
    else if (latest?.attachments?.length) { reason = "attachment_needs_staff"; text = say("attachment"); }
    else if (confirmsResolved && state.replies > 0) {
      if (state.mode === "resolved") return null;
      state.mode = "resolved";
      scenario = "resolved";
      text = `${say("resolved")} ${say("review")}`;
    } else if (state.mode === "resolved") { reason = "issue_returned"; text = say("returned"); }
    else if (chosen && incident && incidentScenarios.includes(chosen.id)) {
      text = incident;
      reason = "confirmed_incident";
    } else if (!chosen && state.replies === 0 && /не работает|не подключается|нет интернета/.test(normalized)) {
      scenario = "clarify_device";
      text = say("clarification");
    } else if (!chosen && state.replies === 1 && state.sentScenarios.at(-1) === "windows_happ_tun" &&
      /^(да|готово|сделал|сделала|перезагрузил|перезагрузила|попробовал|попробовала)[.! ]*$/.test(normalized.trim())) {
      scenario = "check_after_restart";
      text = say("followup");
    } else if (state.replies === 1 && state.sentScenarios.at(-1) === "slow_speed" && /wi.?fi|вай.?фай|мобильн|все|везде|ютуб/.test(normalized)) {
      scenario = "compare_speed";
      text = say("scenario_compare_speed");
    } else if (!chosen || result.needsOperator) reason = "needs_staff";
    else {
      scenario = chosen.id;
      if (["amnezia", "ru_servers", "device_limit", "iphone_app_store", "review", "resolved", "windows_clean_install", "payment_context"].includes(scenario)) {
        reason = "requires_verified_context";
        text = say("needChecks");
      } else if (state.replies >= 2 || state.sentScenarios.includes(scenario)) { reason = "steps_exhausted"; text = say("exhausted"); }
      else text = chooseScenarioVoice(chosen.id, chosen.reply, ticketId, latest?.id ?? 0, state.replies);
    }
    if (reason) {
      state.mode = "staff";
      state.reason = reason;
      text = reason === "needs_staff" && !chosen
        ? say("unknown")
        : text ? `${text}\n\n${say("handoff")}` : say("handoff");
    }
    if (!text) return null;
    if (scenario && !state.sentScenarios.includes(scenario)) state.sentScenarios.push(scenario);
    state.lastUserMessageId = latest?.authorType === "user" ? latest.id : state.lastUserMessageId;
    state.replies++;
    if (state.replies === 1) {
      const greeting = state.mode === "active" ? `${say("greeting")} ${say("opening")}` : say("greeting");
      text = `${greeting}\n\n${text}`;
    }
    if (ticket.source === "telegram") {
      text = `${ASSISTANT_NAME}\n\n${text}`;
      if (state.replies === 1 && state.mode === "active") text += "\n\nЧтобы позвать сотрудника поддержки, напишите «оператор».";
    }
    const message = repo.addMessage({ ticketId, authorType: "system", authorName: ASSISTANT_NAME, text, isInternalNote: false });
    writeAssistantState(ticketId, state);
    // A bot reply never hides the ticket from staff or changes it to waiting_user.
    repo.updateTicket(ticketId, { status: "waiting_staff" });
    return message;
  });
}

export function stopSupportAssistant(ticketId: number) {
  const state = readAssistantState(ticketId) ?? defaultState();
  writeAssistantState(ticketId, { ...state, mode: "staff", reason: "staff_takeover" });
}

