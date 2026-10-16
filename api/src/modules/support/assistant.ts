import knowledge from "./knowledge.json" with { type: "json" };
import type { TicketWithMessages } from "./types.js";

const normalize = (text: string) => text.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();

/** Suggestions for staff only. No billing, network, message or ticket mutations. */
export function suggestSupportReply(ticket: TicketWithMessages) {
  const messages = ticket.messages.filter(m => !m.deletedAt && !m.isInternalNote);
  const latest = messages.at(-1);
  const base = { knowledgeVersion: knowledge.version, mode: "staff_suggestion", autoSend: false,
    policy: knowledge.policy, serviceSnapshot: ticket.serviceSnapshot,
    snapshotIsCurrent: false };
  if (ticket.kind !== "support" || ticket.status === "closed" || !latest || latest.authorType !== "user") {
    return { ...base, suggestions: [], needsOperator: false, reason: "no_pending_user_message" };
  }
  // Match the latest request, never stale keywords from previously solved issues.
  // History remains evidence for staff; it cannot assert operational facts.
  const text = normalize(latest.text);
  const matches = knowledge.scenarios.filter(s =>
    s.triggers.every(group => group.some(trigger => text.includes(normalize(trigger)))));
  const priority = ["operator", "repeat_failure", "windows_clean_install", "subscription_incident"];
  matches.sort((a, b) => {
    const rank = (id: string) => { const i = priority.indexOf(id); return i < 0 ? priority.length : i; };
    return rank(a.id) - rank(b.id) || b.triggers.length - a.triggers.length;
  });
  return { ...base,
    needsOperator: matches.length === 0 || matches.some(s => priority.includes(s.id)),
    reason: matches.length ? "review_checks_before_reply" : "no_matching_scenario",
    suggestions: matches.slice(0, 3).map(s => ({ ...s,
      internal_checks: s.internal_checks.map(id => ({ id, status: "unverified",
        description: knowledge.checks[id as keyof typeof knowledge.checks] })),
    })),
  };
}
