import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),"support-learning-"));
process.env.SUPPORT_ASSISTANT_ENABLED="false";
const service=await import("./service.js");
const learning=await import("./learning.js");
const {getTicketRepository}=await import("./repository.js");
const {linkDb}=await import("../../shared/linkdb/db.js");
const {runSupportAssistant}=await import("./assistantRuntime.js");
const repo=getTicketRepository();
let uid=12000;
async function solved(word="dns",confirmation="Теперь всё работает, помогло") {
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:`В Happ возникает ошибка ${word} на планшете`});
 service.addStaffMessage({ticketId:t.id,operatorId:1,text:`Откройте настройки Happ и выберите автоматический ${word}. Затем подключитесь ещё раз.`});
 service.addUserMessage(t.id,t.userId,confirmation);
 service.closeUserTicket(t.id,t.userId);
 learning.analyzeSupportTicket(t.id);
 return {ticket:t,item:learning.listLearnedCases().find(c=>c.sourceTicketId===t.id)!};
}
function approve(item: ReturnType<typeof learning.getLearnedCase>&{},keywords:string[],autoReply=true) {
 return learning.reviewLearnedCase(item.id,{...item,version:item.version,keywords,conditions:"",status:"approved",verified:true,autoReply},1);
}
test("extracts real operator answer with evidence but never auto-publishes",async()=>{
 const {ticket,item}=await solved();
 assert.ok(item.confirmationMessageId);
 assert.equal(item.status,"draft");assert.equal(item.autoReply,false);
 assert.equal(learning.chooseLearnedCase("Happ dns",""),null);
 assert.equal(learning.analyzeSupportTicket(ticket.id),undefined);
 assert.equal(learning.listLearnedCases().filter(c=>c.sourceTicketId===ticket.id).length,1);
});
test("generic thanks and negative confirmations do not prove resolution",async()=>{
 for(const text of ["Спасибо за ответ","Не получилось, всё равно не работает","Помогло на минуту, сейчас не работает"]) {
  const {item}=await solved("negative",text);assert.equal(item.confirmationMessageId,null);
 }
});
test("review requires explicit verification and optimistic concurrency",async()=>{
 const {item}=await solved("verify");
 assert.throws(()=>learning.reviewLearnedCase(item.id,{...item,status:"approved",verified:false,autoReply:true},1),/review_required/);
 const approved=approve(item,["happ","verify"]);
 assert.equal(approved.status,"approved");
 assert.throws(()=>approve(item,["happ","verify"]),/case_changed/);
 assert.equal(learning.chooseLearnedCase("Happ verify","other")?.id,item.id);
 assert.equal(learning.chooseLearnedCase("Happ другая проблема","other"),null);
});
test("private identifiers are redacted and forbidden from published replies",async()=>{
 const text=learning.redactSupportText("Никита test@example.org https://site.example/secret vless://abc @privateuser 192.0.2.10",["Никита"]);
 for(const privateValue of ["Никита","test@example.org","site.example","vless://","@privateuser","192.0.2.10"])assert.ok(!text.includes(privateValue));
 const {item}=await solved("private");
 assert.throws(()=>learning.reviewLearnedCase(item.id,{...item,title:"Happ private",answer:"Напишите мне test@example.org для решения",keywords:["happ","private"],status:"approved",verified:true,autoReply:true},1),/remove_private_data/);
 assert.throws(()=>learning.reviewLearnedCase(item.id,{...item,answer:"Оплата зачислена, можно подключаться снова.",keywords:["happ","private"],status:"approved",verified:true,autoReply:true},1),/staff_only_answer/);
});
test("source deletion invalidates a published instruction immediately",async()=>{
 const {item,ticket}=await solved("deleteproof");approve(item,["happ","deleteproof"]);
 assert.ok(learning.chooseLearnedCase("Happ deleteproof",null));
 repo.softDeleteMessage(item.sourceMessageId,1,"admin");
 assert.equal(learning.chooseLearnedCase("Happ deleteproof",null),null);
 learning.analyzeSupportTicket(ticket.id);assert.equal(learning.getLearnedCase(item.id)?.status,"draft");
});
test("ambiguous cases never get an automatic reply",async()=>{
 const first=await solved("ambiguous"),second=await solved("ambiguous");
 approve(first.item,["happ","ambiguous"]);approve(second.item,["happ","ambiguous"]);
 assert.equal(learning.findLearnedCases("Happ ambiguous",null,true).length,2);
 assert.equal(learning.chooseLearnedCase("Happ ambiguous",null),null);
});
test("new topic learned from a dialogue actually answers another customer and records outcome",async()=>{
 const {item}=await solved("freshknowledge");approve(item,["happ","freshknowledge"]);
 process.env.SUPPORT_ASSISTANT_ENABLED="true";
 try {
  const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Ошибка freshknowledge в Happ"});
  assert.ok(t.messages.at(-1)!.text.includes(item.answer));
  assert.equal(t.assistant?.mode,"active");
  assert.equal(learning.getLearnedCase(item.id)?.usedCount,1);
  repo.addMessage({ticketId:t.id,authorType:"user",text:"Спасибо, всё работает"});runSupportAssistant(repo,t.id);
  assert.equal((linkDb.prepare("SELECT outcome FROM support_learning_uses WHERE ticket_id=?").get(t.id) as any).outcome,"confirmed");
  assert.ok(!service.getUserTicket(t.id,t.userId)!.messages.some(m=>m.text.includes("source_ticket")));
 }finally{process.env.SUPPORT_ASSISTANT_ENABLED="false";}
});
test("status transition from ongoing to closed is analyzed even without a new message",async()=>{
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Новая ошибка Happ closer"});
 service.addStaffMessage({ticketId:t.id,operatorId:1,text:"Откройте настройки Happ и выберите автоматический вариант подключения."});
 learning.analyzeSupportTicket(t.id);
 service.closeUserTicket(t.id,t.userId);learning.analyzeSupportTicket(t.id);
 assert.ok(learning.listLearnedCases().some(c=>c.sourceTicketId===t.id));
});
