import { createHash } from "node:crypto";
import { linkDb } from "../../shared/linkdb/db.js";
import { getTicketRepository } from "./repository.js";
import type { TicketMessage } from "./types.js";
import { supportModelStats } from "./modelProvider.js";
import "./modelQueue.js";

linkDb.exec(`
CREATE TABLE IF NOT EXISTS support_learning_reviews (
 ticket_id INTEGER PRIMARY KEY, source_hash TEXT NOT NULL, outcome TEXT NOT NULL,
 reason TEXT NOT NULL, message_count INTEGER NOT NULL, analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_learned_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, source_ticket_id INTEGER NOT NULL UNIQUE,
 source_message_id INTEGER NOT NULL, confirmation_message_id INTEGER,
 source_hash TEXT NOT NULL, title TEXT NOT NULL, problem TEXT NOT NULL, answer TEXT NOT NULL,
 keywords TEXT NOT NULL DEFAULT '[]', conditions TEXT NOT NULL DEFAULT '',
 service_category TEXT, status TEXT NOT NULL DEFAULT 'draft', auto_reply INTEGER NOT NULL DEFAULT 0,
 verified INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 reviewed_by INTEGER, reviewed_at TEXT, used_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_learning_uses (
 id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, case_version INTEGER NOT NULL,
 ticket_id INTEGER NOT NULL, user_message_id INTEGER NOT NULL UNIQUE, assistant_message_id INTEGER NOT NULL,
 outcome TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export type LearnedCase = {
 id: number; sourceTicketId: number; sourceMessageId: number; confirmationMessageId: number | null;
 title: string; problem: string; answer: string; keywords: string[]; conditions: string;
 serviceCategory: string | null; status: string; autoReply: boolean; verified: boolean;
 version: number; usedCount: number; reviewedBy: number | null; reviewedAt: string | null;
 sourceHash: string; updatedAt: string;
 reviewMethod?:"model"|"staff"|"pending";
};
const map = (r: any): LearnedCase => ({ id:r.id, sourceTicketId:r.source_ticket_id, sourceMessageId:r.source_message_id,
 confirmationMessageId:r.confirmation_message_id, title:r.title, problem:r.problem, answer:r.answer,
 keywords:JSON.parse(r.keywords), conditions:r.conditions, serviceCategory:r.service_category,
 status:r.status, autoReply:!!r.auto_reply, verified:!!r.verified, version:r.version, usedCount:r.used_count,
 reviewedBy:r.reviewed_by, reviewedAt:r.reviewed_at, sourceHash:r.source_hash, updatedAt:r.updated_at,
 reviewMethod:r.status!=="approved"?"pending":r.reviewed_by===null?"model":"staff" });

const publicMessages = (id: number) => getTicketRepository().listMessages(id).filter(m => !m.deletedAt && !m.isInternalNote && m.authorType !== "system");
const digest = (messages: TicketMessage[], status:string) => createHash("sha256").update(JSON.stringify(["learning-v2",status,messages.map(m => [m.id,m.authorType,m.text])])).digest("hex");
const normalize = (text: string) => text.toLowerCase().replaceAll("ё","е");
const stop = new Set("здравствуйте привет спасибо пожалуйста работает работать работа подключение подключить проблема вопрос помощь помогите после перед через когда здесь этот такая такое как что для или при все уже еще нет мне меня вас вам это будет было была если тогда только очень пока да нет хорошо понятно решить решение могу можно нужно надо сделать сделал делает делали давайте попробуйте напишите подскажите пользователь поддержка shpun шпунь".split(" "));
function terms(text: string) {
 return [...new Set((normalize(text).match(/[a-zа-я][a-zа-я0-9-]{2,}/g) ?? []).filter(w => !stop.has(w)).map(w => w.replace(/(иями|ами|ого|ему|ение|ения|ить|ать|ться|ется|ет|ый|ая|ое|ые|ов|ам|ах|ом|ы|и|а|я|у|е)$/,"")))].filter(w => w.length >= 3);
}

/** Drafts never contain subscription links or known account identifiers. Review remains mandatory. */
export function redactSupportText(text: string, names: string[] = []) {
 let value = text.replace(/(?:https?:\/\/|vless:\/\/|vmess:\/\/|ss:\/\/|trojan:\/\/|hysteria2?:\/\/|happ:\/\/|t.me\/)[^\s<>]+/gi,"[ссылка скрыта]")
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,"[почта скрыта]")
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,"[адрес скрыт]")
  .replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]{1,39}\b/gi,"[адрес скрыт]")
  .replace(/(?:password|пароль|token|session_id|api[_ -]?key|код подтверждения)\s*[:=]\s*["']?[^\s,;"']+/gi,"[секрет скрыт]")
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,"[ключ скрыт]")
  .replace(/[a-z0-9_+/=-]{24,}/gi,"[ключ скрыт]")
  .replace(/@[a-z0-9_]{3,}/gi,"[имя скрыто]")
  .replace(/\+?\d[\d ()-]{7,}\d/g,"[номер скрыт]");
 for (const name of names.flatMap(n => n.split(/\s+/)).filter(n => n.length >= 3)) value = value.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"giu"),"[имя скрыто]");
 return value.trim().slice(0,4000);
}

function confirmed(text: string) {
 const n=normalize(text);
 return !/не (?:заработ|помог|решен|получ|работает|открывается|подключается)|все (?:еще|равно)|снова не|но не/.test(n) &&
 /(?:все|теперь) работает|заработал[оаи]?|проблема решена|вопрос решен|помогло|получилось/.test(n);
}

export function analyzeSupportTicket(ticketId: number) {
 const repo=getTicketRepository(), ticket=repo.getTicket(ticketId);
 if(!ticket || ticket.kind!=="support") return;
 const messages=publicMessages(ticketId), hash=digest(messages,ticket.status);
 const previous=linkDb.prepare("SELECT source_hash FROM support_learning_reviews WHERE ticket_id=?").get(ticketId) as any;
 if(previous?.source_hash===hash) {
  linkDb.prepare("UPDATE support_learning_reviews SET analyzed_at=datetime('now') WHERE ticket_id=?").run(ticketId);
  return;
 }
 let outcome="unresolved", reason="Нет подтверждённого решения";
 const confirmations=messages.filter(m=>m.authorType==="user" && confirmed(m.text));
 const confirmation=confirmations.at(-1);
 const before=confirmation ? messages.filter(m=>m.id<confirmation.id) : messages;
 const solution=[...before].reverse().find(m=>m.authorType==="staff" && m.text.trim().length>=30 && !/^(отлично|спасибо|рад[ыа]?|оставьте отзыв)/i.test(m.text.trim()));
 const question=messages.find(m=>m.authorType==="user" && m.text.trim().length>=8);
 const terminal=ticket.status==="closed"||ticket.status==="resolved";
 const laterFailure=confirmation && messages.some(m=>m.id>confirmation.id && m.authorType==="user" && /не работает|не помог|снова|опять|вернул/.test(normalize(m.text)));
 if(!terminal) { outcome="ongoing"; reason="Обращение ещё открыто"; }
 else if(solution && question && !laterFailure) {
   outcome=confirmation ? "confirmed" : "needs_verification";
   reason=confirmation ? "Клиент подтвердил результат после ответа сотрудника" : "Ответ сотрудника есть, но клиент не подтвердил результат";
 }
 return linkDb.transaction(()=>{
  // Edited/deleted/reopened source cannot remain a trusted public instruction.
  linkDb.prepare("UPDATE support_learned_cases SET status='draft',auto_reply=0,verified=0,version=version+1,updated_at=datetime('now') WHERE source_ticket_id=? AND source_hash<>? AND status='approved'").run(ticketId,hash);
  if(terminal && solution && question && !laterFailure) {
   const names=[ticket.displayNameSnapshot??"",ticket.userLoginSnapshot??"",...messages.filter(m=>m.authorType==="user").map(m=>m.authorName??"")];
   const problem=redactSupportText(question.text,names), answer=redactSupportText(solution.text,names);
   linkDb.prepare(`INSERT INTO support_learned_cases(source_ticket_id,source_message_id,confirmation_message_id,source_hash,title,problem,answer,keywords,service_category)
    VALUES(@ticketId,@solution,@confirmation,@hash,@title,@problem,@answer,@keywords,@category)
    ON CONFLICT(source_ticket_id) DO UPDATE SET source_message_id=excluded.source_message_id,confirmation_message_id=excluded.confirmation_message_id,
    source_hash=excluded.source_hash,title=excluded.title,problem=excluded.problem,answer=excluded.answer,keywords=excluded.keywords,
    verified=0,auto_reply=0,version=version+1,updated_at=datetime('now')
    WHERE support_learned_cases.status='draft' AND support_learned_cases.source_hash<>excluded.source_hash`).run({ticketId,solution:solution.id,confirmation:confirmation?.id??null,hash,title:problem.slice(0,160),problem,answer,keywords:JSON.stringify(terms(problem).slice(0,10)),category:ticket.serviceCategory});
  }
  linkDb.prepare(`INSERT INTO support_learning_reviews(ticket_id,source_hash,outcome,reason,message_count) VALUES(?,?,?,?,?)
    ON CONFLICT(ticket_id) DO UPDATE SET source_hash=excluded.source_hash,outcome=excluded.outcome,reason=excluded.reason,message_count=excluded.message_count,analyzed_at=datetime('now')`).run(ticketId,hash,outcome,reason,messages.length);
  return outcome;
 })();
}

export function scanSupportLearning(limit=100) {
 const tickets=linkDb.prepare(`SELECT t.id FROM support_tickets t LEFT JOIN support_learning_reviews r ON r.ticket_id=t.id
  WHERE t.kind='support' ORDER BY r.analyzed_at IS NOT NULL, r.analyzed_at ASC, t.id ASC LIMIT ?`).all(Math.max(1,Math.min(200,limit))) as {id:number}[];
 let changed=0;
 for(const t of tickets) if(analyzeSupportTicket(t.id)) changed++;
 return {scanned:tickets.length,changed,...learningStats()};
}

export function learningStats() {
 const outcomes=linkDb.prepare("SELECT outcome,COUNT(*) count FROM support_learning_reviews GROUP BY outcome").all();
 const cases=linkDb.prepare("SELECT status,COUNT(*) count FROM support_learned_cases GROUP BY status").all();
 const uses=linkDb.prepare("SELECT outcome,COUNT(*) count FROM support_learning_uses GROUP BY outcome").all();
 return {outcomes,cases,uses,model:supportModelStats()};
}
export function listLearnedCases() { return (linkDb.prepare("SELECT * FROM support_learned_cases ORDER BY status='draft' DESC,updated_at DESC,id DESC LIMIT 200").all() as any[]).map(map); }
export function getLearnedCase(id:number) { const r=linkDb.prepare("SELECT * FROM support_learned_cases WHERE id=?").get(id); return r?map(r):null; }

export class LearningError extends Error { constructor(public code:string,public status=400){super(code);} }
export function reviewLearnedCase(id:number, input: {version:number;title:string;problem:string;answer:string;keywords:string[];conditions:string;status:"approved"|"rejected"|"archived";autoReply:boolean;verified:boolean}, adminId:number) {
 const item=getLearnedCase(id);
 if(!item) throw new LearningError("case_not_found",404);
 if(input.version!==item.version) throw new LearningError("case_changed",409);
 const title=String(input.title??"").trim().slice(0,160), problem=String(input.problem??"").trim().slice(0,4000), answer=String(input.answer??"").trim().slice(0,2000);
 const keywords=Array.isArray(input.keywords)?[...new Set(input.keywords.filter(x=>typeof x==="string").flatMap(terms))].slice(0,15):[];
 if(!["approved","rejected","archived"].includes(input.status)) throw new LearningError("invalid_case_status");
 if(input.status==="approved") {
  if(!title||problem.length<8||answer.length<15||keywords.length<2||input.verified!==true||typeof input.autoReply!=="boolean") throw new LearningError("review_required");
  if(redactSupportText(answer)!==answer || redactSupportText(problem)!==problem || redactSupportText(title)!==title) throw new LearningError("remove_private_data");
  if(input.autoReply && (String(input.conditions??"").trim() || /[\[\]]|\b(?:user_?id|session|token|password)\b|парол|оплат|перен[ео]с|списани|зачисл|возврат|удалите|сброс|отключите антивирус/i.test(answer))) throw new LearningError("staff_only_answer");
  if(!sourceCurrent(item)) throw new LearningError("source_changed",409);
 }
 const r=linkDb.prepare(`UPDATE support_learned_cases SET title=?,problem=?,answer=?,keywords=?,conditions=?,status=?,auto_reply=?,verified=?,version=version+1,reviewed_by=?,reviewed_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND version=?`).run(title,problem,answer,JSON.stringify(keywords),String(input.conditions??"").trim().slice(0,2000),input.status,Number(input.status==="approved"&&!!input.autoReply),Number(!!input.verified),adminId,id,input.version);
 if(!r.changes) throw new LearningError("case_changed",409);
 return getLearnedCase(id)!;
}
export function sourceCurrent(item:LearnedCase) {
 const t=getTicketRepository().getTicket(item.sourceTicketId);
 return !!t && ["closed","resolved"].includes(t.status) && digest(publicMessages(item.sourceTicketId),t.status)===item.sourceHash;
}
export function modelKnowledge(category:string|null) {
 return listLearnedCases().filter(c=>c.status==="approved"&&c.verified&&c.autoReply&&(!c.serviceCategory||c.serviceCategory===category)&&sourceCurrent(c)).slice(0,35);
}
export function caseConversation(item:LearnedCase) {
 const t=getTicketRepository().getTicket(item.sourceTicketId);
 const names=[t?.displayNameSnapshot??"",t?.userLoginSnapshot??""];
 return publicMessages(item.sourceTicketId).slice(-25).map(m=>({id:m.id,role:m.authorType,text:redactSupportText(m.text,names).slice(0,1400)}));
}
export function publishModelCase(item:LearnedCase,data:{title:string;problem:string;answer:string;keywords:string[]},explanation:string) {
 return linkDb.transaction(()=>{
 if(!sourceCurrent(item)||!item.confirmationMessageId||item.status!=="draft")return false;
 const keywords=Array.isArray(data.keywords)?[...new Set(data.keywords.flatMap(terms))].slice(0,12):[];
 const title=String(data.title??"").trim().slice(0,160),problem=String(data.problem??"").trim().slice(0,2000),answer=String(data.answer??"").trim().slice(0,1200);
 if(!title||problem.length<8||answer.length<15||keywords.length<2)return false;
 if([title,problem,answer].some(s=>redactSupportText(s)!==s)||/[\[\]]|парол|оплат|перен[ео]с|списани|зачисл|возврат|удал|сброс|антивирус|брандмауэр|реестр/i.test(answer))return false;
 const result=linkDb.prepare(`UPDATE support_learned_cases SET title=?,problem=?,answer=?,keywords=?,conditions='',status='approved',auto_reply=1,verified=1,
  reviewed_by=NULL,reviewed_at=datetime('now'),version=version+1,updated_at=datetime('now') WHERE id=? AND version=? AND status='draft'`).run(title,problem,answer,JSON.stringify(keywords),item.id,item.version).changes;
 if(result)linkDb.prepare(`INSERT INTO support_model_reviews(case_id,source_hash,result,explanation) VALUES(?,?,'approved',?)
  ON CONFLICT(case_id) DO UPDATE SET source_hash=excluded.source_hash,result='approved',explanation=excluded.explanation,created_at=datetime('now')`).run(item.id,item.sourceHash,redactSupportText(explanation).slice(0,1000));
 return !!result;
 }).immediate();
}

export function findLearnedCases(query:string, serviceCategory:string|null, autoOnly=false) {
 const words=new Set(terms(redactSupportText(query)));
 if(words.size<2) return [];
 const rows=(linkDb.prepare("SELECT * FROM support_learned_cases WHERE status='approved' AND verified=1 ORDER BY id DESC LIMIT 500").all() as any[]).map(map);
 return rows.filter(c=>(!autoOnly||c.autoReply)&&(!c.serviceCategory||c.serviceCategory===serviceCategory)).map(c=>{
  const keys=[...new Set(c.keywords.flatMap(terms))];
  const matched=keys.filter(k=>words.has(k)).length;
  const score=keys.length?matched/keys.length:0;
  return {item:c,score,matched};
 }).filter(r=>r.matched>=2&&r.score>=(autoOnly?1:0.65)&&sourceCurrent(r.item)).sort((a,b)=>b.score-a.score||b.matched-a.matched).slice(0,3);
}
export function chooseLearnedCase(query:string,category:string|null) {
 const matches=findLearnedCases(query,category,true);
 if(!matches.length || (matches[1] && matches[0]!.score-matches[1].score<0.15)) return null;
 return matches[0]!.item;
}
export function recordLearnedUse(item:LearnedCase,ticketId:number,userMessageId:number,assistantMessageId:number) {
 const r=linkDb.prepare("INSERT OR IGNORE INTO support_learning_uses(case_id,case_version,ticket_id,user_message_id,assistant_message_id) VALUES(?,?,?,?,?)").run(item.id,item.version,ticketId,userMessageId,assistantMessageId);
 if(r.changes) linkDb.prepare("UPDATE support_learned_cases SET used_count=used_count+1 WHERE id=?").run(item.id);
}
export function recordLearningOutcome(ticketId:number,outcome:"confirmed"|"handoff") {
 linkDb.prepare("UPDATE support_learning_uses SET outcome=? WHERE ticket_id=? AND outcome='pending'").run(outcome,ticketId);
 // Model-published advice that repeatedly fails returns to staff review. It
 // cannot immediately republish itself from the same unchanged evidence.
 if(outcome==="handoff") {
  const failing=linkDb.prepare(`SELECT c.id FROM support_learned_cases c JOIN support_learning_uses u ON u.case_id=c.id
   WHERE c.status='approved' AND c.reviewed_by IS NULL AND c.id IN (SELECT case_id FROM support_learning_uses WHERE ticket_id=?)
   GROUP BY c.id HAVING SUM(u.outcome='handoff')>=2 AND SUM(u.outcome='confirmed')=0`).all(ticketId) as {id:number}[];
  for(const item of failing) {
   linkDb.prepare("UPDATE support_learned_cases SET status='draft',auto_reply=0,verified=0,version=version+1,updated_at=datetime('now') WHERE id=?").run(item.id);
   linkDb.prepare("UPDATE support_model_reviews SET result='staff',explanation='Repeated unsuccessful applications; staff review required' WHERE case_id=?").run(item.id);
  }
 }
}
