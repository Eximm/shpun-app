import { scanSupportLearning } from "./learning.js";
let started=false;
export function startSupportLearning() {
 if(started || process.env.SUPPORT_LEARNING_ENABLED==="false") return;
 started=true;
 const run=()=>{try{const result=scanSupportLearning(100);console.info("SUPPORT_LEARNING",{scanned:result.scanned,changed:result.changed});}catch{console.error("SUPPORT_LEARNING_FAILED");}};
 const first=setTimeout(run,3000); first.unref();
 const timer=setInterval(run,5*60*1000); timer.unref();
}
