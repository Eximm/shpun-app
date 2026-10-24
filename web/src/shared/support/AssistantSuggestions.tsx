import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n";

type Suggestion = { id: string; title: string; reply: string; next_steps: string[]; escalate_if: string[];
  internal_checks: { id: string; description: string }[] };

/** Internal checklist. Nothing is sent until the operator reviews and sends a reply. */
export function AssistantSuggestions({ ticketId, lastMessageId, canUse, onUse }: {
  ticketId: number; lastMessageId: number; canUse: boolean; onUse: (text: string) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [learned,setLearned]=useState<{id:number;title:string;answer:string;conditions:string;sourceTicketId:number}[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setItems([]);
    setLearned([]);
    setFailed(false);
    void apiFetch<{ assistant: { suggestions: Suggestion[] }; learned?:typeof learned }>(`/admin/support/tickets/${ticketId}/assistant`, { method: "GET" })
      .then(r => { if (!disposed) {setItems(r.assistant.suggestions);setLearned(r.learned??[]);} })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [ticketId, lastMessageId]);
  return (
    <details className="admin-gap-top-sm">
      <summary>{t("support.assistant.suggestions")}</summary>
      <p className="p">{t("support.assistant.checks_hint")}</p>
      {learned.map(item=><div className="card admin-gap-top-sm" key={item.id}><div className="card__body">
        <strong>{t("support.learning.from_cases")}: {item.title}</strong><p className="p">{item.answer}</p>
        {item.conditions&&<p className="p">{item.conditions}</p>}
        <button type="button" className="btn btn--soft" disabled={!canUse} onClick={()=>onUse(item.answer)}>{t("support.assistant.use_reply")}</button>
      </div></div>)}
      {failed ? <p className="p">{t("support.assistant.suggestions_failed")}</p> : null}
      {!failed && items.length === 0 ? <p className="p">{t("support.assistant.no_suggestions")}</p> : null}
      {items.map(item => <div className="card admin-gap-top-sm" key={item.id}><div className="card__body">
        <strong>{item.title}</strong>
        <ul>{item.internal_checks.map(check => <li key={check.id}>{check.description}</li>)}</ul>
        <p className="p">{item.reply}</p>
        <strong>{t("support.assistant.next_steps")}</strong>
        <ul>{item.next_steps.map(step => <li key={step}>{step}</li>)}</ul>
        <strong>{t("support.assistant.escalation")}</strong>
        <ul>{item.escalate_if.map(step => <li key={step}>{step}</li>)}</ul>
        <button type="button" className="btn btn--soft" disabled={!canUse} onClick={() => onUse(item.reply)}>{t("support.assistant.use_reply")}</button>
      </div></div>)}
    </details>
  );
}
