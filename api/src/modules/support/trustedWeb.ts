import { createHash } from "node:crypto";
import { linkDb } from "../../shared/linkdb/db.js";
import { supportModelJSON } from "./modelProvider.js";
import { redactSupportText } from "./learning.js";

linkDb.exec(`CREATE TABLE IF NOT EXISTS support_web_documents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,excerpt TEXT NOT NULL,
 content_hash TEXT NOT NULL,fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_web_uses(message_id INTEGER NOT NULL,document_id INTEGER NOT NULL,PRIMARY KEY(message_id,document_id));`);
export type WebDocument={id:number;url:string;title:string;excerpt:string;content_hash:string;fetched_at:string};
const hosts=new Set(["happ.info","docs.happ.info","www.happ.su","happ.su","support.apple.com","support.microsoft.com","learn.microsoft.com","support.google.com","hysteria.network","v2.hysteria.network"]);
export function allowedSupportURL(value:string) {
 try{const u=new URL(value);return u.protocol==='https:'&&(!u.port||u.port==='443')&&!u.username&&!u.password&&hosts.has(u.hostname.toLowerCase())&&!u.search;}catch{return false;}
}
type DocumentFetcher=(url:string)=>Promise<{title:string;excerpt:string}>;
let override:DocumentFetcher|null=null;
export function setSupportDocumentFetcher(value:DocumentFetcher|null){override=value;}
async function fetchDocument(url:string) {
 if(override)return override(url);
 let current=url;
 for(let redirects=0;redirects<3;redirects++) {
  if(!allowedSupportURL(current))throw new Error('support_web_untrusted_url');
  const r=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'ShpunSupport/1.0'}});
  if(r.status>=300&&r.status<400){current=new URL(r.headers.get('location')??'',current).href;continue;}
  if(!r.ok||!r.body||!/(?:html|text)/i.test(r.headers.get('content-type')??''))throw new Error('support_web_unavailable');
  const reader=r.body.getReader();let html='',bytes=0;const decoder=new TextDecoder();
  try{while(bytes<100000){const part=await reader.read();if(part.done)break;bytes+=part.value.length;html+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel();}
  const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g,'').slice(0,160)??new URL(url).hostname;
  const excerpt=html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g,' ').replace(/\s+/g,' ').trim().slice(0,6500);
  return {title,excerpt};
 }
 throw new Error('support_web_redirect_limit');
}
export async function searchSupportDocs(query:string):Promise<WebDocument[]> {
 if(process.env.SUPPORT_LLM_WEB_ENABLED!=='true')return [];
 const q=String(query).trim().slice(0,220);
 if(q.length<8||redactSupportText(q)!==q)return [];
 const search=await supportModelJSON('web_search',`Найди официальную документацию по общему техническому вопросу.
Ищи только на ${[...hosts].join(', ')}. Не используй форумы, рекламу или чужие инструкции по обходу безопасности.
Верни JSON {urls:string[]}, только ссылки на подходящие страницы документации. Никаких пользовательских данных в поисковых запросах.`,{query:q},false,{browserSearch:true});
 const candidates=[...(Array.isArray(search.urls)?search.urls:[]),...(Array.isArray(search._browserUrls)?search._browserUrls:[])].filter((s):s is string=>typeof s==='string');
 const urls=[...new Set(candidates.map(s=>{try{const u=new URL(s);u.hash='';return u.href;}catch{return '';}}))].filter(allowedSupportURL).slice(0,3);
 const result:WebDocument[]=[];
 for(const url of urls) {
  try {
   let document=linkDb.prepare("SELECT * FROM support_web_documents WHERE url=? AND fetched_at>datetime('now','-1 day')").get(url) as WebDocument|undefined;
   if(!document) {
    const page=await fetchDocument(url);
    const excerpt=redactSupportText(page.excerpt).slice(0,5000);
    if(excerpt.length<80)continue;
    const hash=createHash('sha256').update(excerpt).digest('hex');
    linkDb.prepare(`INSERT INTO support_web_documents(url,title,excerpt,content_hash) VALUES(?,?,?,?)
     ON CONFLICT(url) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,content_hash=excluded.content_hash,fetched_at=datetime('now')`).run(url,page.title.slice(0,160),excerpt,hash);
    document=linkDb.prepare("SELECT * FROM support_web_documents WHERE url=?").get(url) as WebDocument;
   }
   result.push(document);
  }catch{/* An unavailable or redirected source must not become evidence. */}
 }
 return result;
}
export function webDocumentCurrent(document:WebDocument) {
 return !!linkDb.prepare("SELECT 1 FROM support_web_documents WHERE id=? AND content_hash=? AND fetched_at>datetime('now','-1 day')").get(document.id,document.content_hash);
}
export function recentSupportDocs() {
 if(process.env.SUPPORT_LLM_WEB_ENABLED!=='true')return [];
 return (linkDb.prepare("SELECT * FROM support_web_documents WHERE fetched_at>datetime('now','-1 day') ORDER BY fetched_at DESC,id DESC LIMIT 3").all() as WebDocument[]).filter(d=>allowedSupportURL(d.url));
}
export function recordWebUse(messageId:number,documents:WebDocument[]) {
 for(const document of documents)linkDb.prepare('INSERT OR IGNORE INTO support_web_uses(message_id,document_id) VALUES(?,?)').run(messageId,document.id);
}
export function webMessageSources(messageId:number) {
 return linkDb.prepare('SELECT d.title,d.url FROM support_web_documents d JOIN support_web_uses u ON u.document_id=d.id WHERE u.message_id=?').all(messageId) as {title:string;url:string}[];
}
