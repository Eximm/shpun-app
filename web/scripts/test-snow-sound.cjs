const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const moduleValue={exports:{}};
const compiled=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/app/appearance/snowFoley.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
new Function('module','exports',compiled.outputText)(moduleValue,moduleValue.exports);
const {createSnowFoley,snowNoise}=moduleValue.exports;
let time=0,seq=0,starts=0,stops=0,buffers=0;
const jobs=new Map(),automations=[];
const timers={set:(fn,ms)=>{const id=++seq;jobs.set(id,{fn,at:time+ms});return id;},clear:id=>jobs.delete(id)};
const advance=ms=>{time+=ms;let job;while((job=[...jobs].find(([,v])=>v.at<=time))){jobs.delete(job[0]);job[1].fn();}};
const param=()=>({value:0,setValueAtTime(value){this.value=value;},cancelAndHoldAtTime(){},setTargetAtTime(value,at,tau){this.value=value;automations.push({value,tau});}});
const connectable=()=>({connect(other){return other;},disconnect(){}});
const context={sampleRate:8000,currentTime:0,destination:{},
 createBuffer(channels,length,sampleRate){buffers++;const samples=new Float32Array(length);return {duration:length/sampleRate,getChannelData:()=>samples};},
 createBufferSource(){return {...connectable(),start(){starts++;},stop(){stops++;}};},
 createBiquadFilter(){return {...connectable(),Q:param(),frequency:param()};},
 createGain(){return {...connectable(),gain:param()};}
};
const foley=createSnowFoley(context,timers);
for(let i=0;i<200;i++){foley.stroke(.6);advance(20);}
assert.equal(starts,1,'hundreds of movements use one continuous voice');assert.equal(stops,0);
foley.release();advance(200);foley.stroke(.3);assert.equal(starts,1,'a brief pause resumes the same voice without retriggering');
foley.release();advance(600);assert.equal(stops,1,'release fades then disconnects');
foley.stroke(.7,420,"roll");assert.equal(starts,2);
assert.ok(automations.filter(a=>a.tau===.09).at(-1).value<=560,"rolling uses a softer lower-frequency texture");assert.equal(buffers,1,'reuse the same seamless noise buffer');
foley.dispose();advance(2000);assert.equal(stops,2);assert.equal(jobs.size,0);foley.stroke();assert.equal(starts,2,'disposed audio never resumes');
assert.ok(automations.some(a=>a.value===0&&a.tau===.085),'release uses a gradual envelope');
assert.ok(automations.filter(a=>a.tau===.065).every(a=>a.value<=.07&&a.value>0),'brush loudness is bounded and smoothed');
const samples=snowNoise(context).getChannelData(0),overlap=Math.round(context.sampleRate*.08);
assert.ok(samples.every(Number.isFinite));
assert.ok(Math.abs(samples[samples.length-1]-samples[overlap-1])<1e-7,'loop end crossfades to the actual next source segment');
console.log('PASS continuous brush voice, no rapid retriggering, soft attack/release, buffer seam, pause, disposal and bounded volume');
