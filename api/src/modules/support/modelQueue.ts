import { linkDb } from "../../shared/linkdb/db.js";
linkDb.exec(`CREATE TABLE IF NOT EXISTS support_model_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,purpose TEXT NOT NULL,entity_id INTEGER NOT NULL,revision TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',error TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(purpose,entity_id,revision)
);
CREATE TABLE IF NOT EXISTS support_model_reviews (
 case_id INTEGER PRIMARY KEY,source_hash TEXT NOT NULL,result TEXT NOT NULL,explanation TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
export function enqueueModelJob(purpose:"reply"|"learn",entityId:number,revision:string) {
 linkDb.prepare(`INSERT INTO support_model_jobs(purpose,entity_id,revision) VALUES(?,?,?)
  ON CONFLICT(purpose,entity_id,revision) DO UPDATE SET status='queued',updated_at=datetime('now')
  WHERE support_model_jobs.purpose='learn' AND support_model_jobs.status='failed' AND support_model_jobs.updated_at<datetime('now','-1 hour')`).run(purpose,entityId,revision);
}
export function modelReplyPending(ticketId:number) {
 return !!linkDb.prepare("SELECT 1 FROM support_model_jobs WHERE purpose='reply' AND entity_id=? AND status IN ('queued','running') LIMIT 1").get(ticketId);
}
export function takeModelJob() {
 return linkDb.transaction(()=>{
  linkDb.prepare("UPDATE support_model_jobs SET status='queued',updated_at=datetime('now') WHERE status='running' AND updated_at<datetime('now','-2 minutes')").run();
  const job=linkDb.prepare("SELECT * FROM support_model_jobs WHERE status='queued' ORDER BY purpose='reply' DESC,id LIMIT 1").get() as ModelJob|undefined;
  if(!job)return null;
  linkDb.prepare("UPDATE support_model_jobs SET status='running',updated_at=datetime('now') WHERE id=?").run(job.id);return job;
 }).immediate();
}
export type ModelJob={id:number;purpose:"reply"|"learn";entity_id:number;revision:string};
export function finishModelJob(id:number,status:"done"|"failed"|"cancelled",error:string|null=null) {
 linkDb.prepare("UPDATE support_model_jobs SET status=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,error,id);
}
