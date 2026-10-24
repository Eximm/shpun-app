import assert from "node:assert/strict";
import test,{beforeEach} from "node:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),"support-model-"));
process.env.SUPPORT_ASSISTANT_ENABLED="false";
process.env.SUPPORT_LLM_ENABLED="true";
const provider=await import("./modelProvider.js");
const service=await import("./service.js");
const learning=await import("./learning.js");
const worker=await import("./modelWorker.js");
const {linkDb}=await import("../../shared/linkdb/db.js");
const {getTicketRepository}=await import("./repository.js");
const repo=getTicketRepository();
let uid=17000;
const envelope=(value:unknown)=>({choices:[{message:{content:JSON.stringify(value)}}],usage:{total_tokens:100}});
beforeEach(()=>{linkDb.prepare("DELETE FROM support_model_jobs").run();process.env.SUPPORT_ASSISTANT_ENABLED="false";delete process.env.SUPPORT_LLM_DAILY_REQUESTS;});
async function source() {
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Happ не определяет DNS на планшете"});
 const answer="В настройках Happ выберите автоматический DNS, затем подключитесь ещё раз.";
 service.addStaffMessage({ticketId:t.id,operatorId:1,text:answer});
 service.addUserMessage(t.id,t.userId,"Спасибо, теперь всё работает");service.closeUserTicket(t.id,t.userId);
 learning.analyzeSupportTicket(t.id);
 return {ticket:t,item:learning.listLearnedCases().find(c=>c.sourceTicketId===t.id)!,answer};
}
test("real data export cannot activate without explicit approval",()=>{
 provider.setSupportModelTransport(null);process.env.SUPPORT_LLM_REAL_DIALOGUE_APPROVED="false";
 assert.equal(provider.modelReady(),false);
});
test("model generalizes and verifies a confirmed case without a manual publication",async()=>{
 const {item,answer}=await source();
 provider.setSupportModelTransport(async body=>{
  const system=String((body.messages as any[])[0].content);
  return envelope(system.includes("аналитик")?{title:"Happ: разрешение адресов",problem:"Не определяются адреса сайтов в Happ",answer,keywords:["happ","dns"],risk:"low",evidence_quote:answer,reason:"Общий обратимый шаг"}:{safe:true,reason:"Шаг подтверждён источником"});
 });
 worker.queueModelLearning();await worker.processSupportModelJob();
 const learned=learning.getLearnedCase(item.id)!;
 assert.equal(learned.status,"approved");assert.equal(learned.autoReply,true);assert.equal(learned.reviewedBy,null);
 assert.equal((linkDb.prepare("SELECT result FROM support_model_reviews WHERE case_id=?").get(item.id) as any).result,"approved");
});
test("semantic reply does not require a keyword match and keeps source provenance",async()=>{
 const item=learning.listLearnedCases().find(c=>c.status==='approved')!;
 const query="Страницы не находятся по именам, хотя само подключение включено";
 assert.equal(learning.chooseLearnedCase(query,null),null);
 provider.setSupportModelTransport(async body=>{
  const system=String((body.messages as any[])[0].content);
  return envelope(system.includes("независимый")?{safe:true,reason:"Совет основан на карточке"}:{action:"reply",reply:"Попробуйте выбрать автоматический DNS в настройках Happ, затем подключитесь снова.",used_case_ids:[item.id],question_only:false,reason:"Похожий случай по смыслу"});
 });
 process.env.SUPPORT_ASSISTANT_ENABLED="true";
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:query});
 assert.equal(t.messages.length,1);assert.equal(t.assistant?.pending,true);
 await worker.processSupportModelJob();
 const result=service.getUserTicket(t.id,t.userId)!;
 assert.match(result.messages.at(-1)!.text,/автоматический DNS/);
 assert.equal(result.assistant?.pending,false);
 assert.equal((linkDb.prepare("SELECT case_id FROM support_learning_uses WHERE ticket_id=?").get(t.id) as any).case_id,item.id);
 assert.equal(await worker.processSupportModelJob(),false);
});
test("unsupported advice fails verification and hands off",async()=>{
 provider.setSupportModelTransport(async body=>envelope(String((body.messages as any[])[0].content).includes("независимый")?
  {safe:false,reason:"Необоснованный совет"}:{action:"reply",reply:"Отключите защиту устройства, это поможет?",used_case_ids:[],question_only:true,reason:"Уточнение"}));
 process.env.SUPPORT_ASSISTANT_ENABLED="true";
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Новая странная ситуация на устройстве"});
 await worker.processSupportModelJob();
 const result=service.getUserTicket(t.id,t.userId)!;
 assert.equal(result.assistant?.mode,"staff");assert.ok(!result.messages.some(m=>m.text.includes("Отключите защиту")));
});
test("a staff reply during generation wins over the model",async()=>{
 let tid=0;
 provider.setSupportModelTransport(async body=>{
  if(!String((body.messages as any[])[0].content).includes("независимый")) {
   service.addStaffMessage({ticketId:tid,operatorId:1,text:"Здравствуйте! Я уже занимаюсь вашим вопросом."});
   return envelope({action:"reply",reply:"Какое устройство используете?",used_case_ids:[],question_only:true,reason:"Уточнение"});
  }
  return envelope({safe:true,reason:"Уточнение"});
 });
 process.env.SUPPORT_ASSISTANT_ENABLED="true";
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Пожалуйста, помогите разобраться в ситуации"});tid=t.id;
 await worker.processSupportModelJob();
 assert.equal(service.getUserTicket(t.id,t.userId)!.messages.filter(m=>m.authorType==='system').length,0);
});
test("provider failure falls back without losing the user message",async()=>{
 provider.setSupportModelTransport(async()=>{throw new Error('simulated_timeout');});
 process.env.SUPPORT_ASSISTANT_ENABLED="true";
 const t=await service.createTicket({userId:++uid,source:"app",categoryKey:"connection",text:"Совсем неизвестная проблема"});
 await worker.processSupportModelJob();
 const result=service.getUserTicket(t.id,t.userId)!;
 assert.equal(result.messages[0]!.text,"Совсем неизвестная проблема");assert.equal(result.assistant?.mode,'staff');
});
test("daily budget blocks a request before invoking the provider",async()=>{
 let called=false;provider.setSupportModelTransport(async()=>{called=true;return envelope({ok:true});});
 process.env.SUPPORT_LLM_DAILY_REQUESTS="1";
 await assert.rejects(()=>provider.supportModelJSON('test','test',{}),/budget_exhausted/);
 assert.equal(called,false);
});
test("repeated unsuccessful uses suspend automatically learned advice",async()=>{
 const item=learning.listLearnedCases().find(c=>c.status==='approved')!;
 for(const id of [800001,800002]) {
  learning.recordLearnedUse(item,id,id,id+10);
  learning.recordLearningOutcome(id,'handoff');
 }
 assert.equal(learning.getLearnedCase(item.id)?.status,'draft');
 assert.equal(learning.getLearnedCase(item.id)?.autoReply,false);
 worker.queueModelLearning();assert.equal(await worker.processSupportModelJob(),false);
});
