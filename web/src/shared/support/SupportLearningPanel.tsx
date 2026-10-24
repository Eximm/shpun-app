import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { useI18n } from "../i18n";

type Case = {id:number;sourceTicketId:number;confirmationMessageId:number|null;title:string;problem:string;answer:string;
 keywords:string[];conditions:string;status:string;autoReply:boolean;verified:boolean;version:number;usedCount:number};
type Stats = {outcomes:{outcome:string;count:number}[];cases:{status:string;count:number}[];uses:{outcome:string;count:number}[]};

export function SupportLearningPanel({onOpenSource}:{onOpenSource:(id:number)=>void}) {
 const {t}=useI18n();
 const [items,setItems]=useState<Case[]>([]),[stats,setStats]=useState<Stats|null>(null),[error,setError]=useState("");
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState<Case|null>(null),[keywords,setKeywords]=useState("");
 const editorRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{if(editing)editorRef.current?.scrollIntoView({block:"nearest",behavior:"smooth"});},[editing?.id]);
 async function load() {
  const r=await apiFetch<{items:Case[];stats:Stats}>("/admin/support/learning",{method:"GET"});setItems(r.items);setStats(r.stats);
 }
 async function run(analyze=false) {
  setBusy(true);setError("");
  try{if(analyze)await apiFetch("/admin/support/learning/analyze",{method:"POST"});await load();}
  catch{setError(t("support.learning.load_failed"));}finally{setBusy(false);}
 }
 async function save(status:"approved"|"rejected"|"archived") {
  if(!editing)return;setBusy(true);setError("");
  try {
   await apiFetch(`/admin/support/learning/${editing.id}`,{method:"PATCH",body:{...editing,status,keywords:keywords.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)}});
   setEditing(null);await load();
  }catch{setError(t("support.learning.save_failed"));}finally{setBusy(false);}
 }
 return <details className="card admin-gap-top-sm" onToggle={e=>{if(e.currentTarget.open&&!stats)void run();}}>
  <summary className="card__body"><strong>{t("support.learning.title")}</strong></summary>
  <div className="card__body">
   <p className="p">{t("support.learning.intro")}</p>
   <button type="button" className="btn btn--soft" disabled={busy} onClick={()=>void run(true)}>{t("support.learning.analyze")}</button>
   {stats&&<p className="p">{t("support.learning.stats",{analyzed:stats.outcomes.reduce((n,r)=>n+r.count,0),draft:stats.cases.find(s=>s.status==="draft")?.count??0,approved:stats.cases.find(s=>s.status==="approved")?.count??0,used:stats.uses.reduce((n,r)=>n+r.count,0),confirmed:stats.uses.find(s=>s.outcome==="confirmed")?.count??0})}</p>}
   {error&&<p role="alert">{error}</p>}
   {!busy&&items.length===0&&<p className="p">{t("support.learning.empty")}</p>}
   {items.map(item=><div className="card admin-gap-top-sm" key={item.id}><div className="card__body">
    <strong>{item.title}</strong><p className="p">{t(`support.learning.status.${item.status}`)} · {item.confirmationMessageId?t("support.learning.confirmed"):t("support.learning.unconfirmed")}</p>
    <p className="p">{item.answer}</p>
    <div className="actions"><button type="button" className="btn btn--soft" onClick={()=>onOpenSource(item.sourceTicketId)}>{t("support.learning.source")}</button>
    <button type="button" className="btn btn--soft" onClick={()=>{setEditing({...item});setKeywords(item.keywords.join(", "));}}>{t("support.learning.edit")}</button></div>
   </div></div>)}
   {editing&&<div className="card admin-gap-top-sm" ref={editorRef}><div className="card__body">
    <label className="field"><span>{t("support.learning.case_title")}</span><input className="input" value={editing.title} maxLength={160} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
    <label className="field"><span>{t("support.learning.problem")}</span><textarea className="input" value={editing.problem} onChange={e=>setEditing({...editing,problem:e.target.value})}/></label>
    <label className="field"><span>{t("support.learning.answer")}</span><textarea className="input" value={editing.answer} maxLength={2000} onChange={e=>setEditing({...editing,answer:e.target.value})}/></label>
    <label className="field"><span>{t("support.learning.keywords")}</span><input className="input" value={keywords} onChange={e=>setKeywords(e.target.value)}/></label>
    <label className="field"><span>{t("support.learning.conditions")}</span><textarea className="input" value={editing.conditions} onChange={e=>setEditing({...editing,conditions:e.target.value})}/></label>
    <label className="field"><span><input type="checkbox" checked={editing.verified} onChange={e=>setEditing({...editing,verified:e.target.checked})}/> {t("support.learning.verify")}</span></label>
    <label className="field"><span><input type="checkbox" checked={editing.autoReply} onChange={e=>setEditing({...editing,autoReply:e.target.checked})}/> {t("support.learning.auto")}</span></label>
    <p className="p">{t("support.learning.auto_hint")}</p>
    <div className="actions"><button type="button" className="btn btn--primary" disabled={busy} onClick={()=>void save("approved")}>{t("support.learning.approve")}</button>
    <button type="button" className="btn btn--soft" disabled={busy} onClick={()=>void save("rejected")}>{t("support.learning.reject")}</button>
    <button type="button" className="btn btn--soft" disabled={busy} onClick={()=>void save("archived")}>{t("support.learning.archive")}</button>
    <button type="button" className="btn btn--soft" onClick={()=>setEditing(null)}>{t("common.cancel")}</button></div>
   </div></div>}
  </div>
 </details>;
}
