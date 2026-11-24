const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/app/appearance/snowModel.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const moduleValue={exports:{}}; new Function('module','exports',compiled.outputText)(moduleValue,moduleValue.exports);
const {createBank,growBank,depositFlake,brushBank,bankPath,SNOWMAN_COSTS}=moduleValue.exports;
const banks=['off','light','steady','flurry'].map((intensity)=>{const bank=createBank(.3);for(let i=0;i<600;i++)growBank(bank,.1,intensity);return bank;});
const volume = bank => bank.heights.reduce((a,b)=>a+b,0);
assert.equal(volume(banks[0]),0);
assert.ok(volume(banks[1]) < volume(banks[2]) && volume(banks[2]) < volume(banks[3]));
assert.ok(banks[3].heights.every(h=>Number.isFinite(h)&&h>=0&&h<=17));
assert.equal(banks[3].heights[0],0);
const bank=createBank(); depositFlake(bank,.5,4); const before=volume(bank); const removed=brushBank(bank,.5,.2);
assert.ok(removed>0); assert.ok(Math.abs(before-volume(bank)-removed)<1e-8);
assert.ok(volume(bank)>=0); const after=volume(bank); brushBank(bank,.5,.2);assert.ok(volume(bank)<=after);
const empty=createBank();assert.equal(brushBank(empty,.5),0);depositFlake(empty,NaN);assert.equal(volume(empty),0);
const tiny=createBank();growBank(tiny,3600,'flurry');assert.ok(volume(tiny)<3,'no instant catch-up from a long hidden frame');
assert.ok(bankPath(banks[2],375).endsWith('Z'));
assert.deepEqual(SNOWMAN_COSTS,[15,25,35]);
console.log('PASS snow intensity, bounded accumulation, brushing conservation, zero farming, frame gaps and snowman costs');

const {restoreBanks,serializeBanks,snowOpacity,createDustedBank}=moduleValue.exports;
assert.equal(snowOpacity(createBank()),0);
const dust=createDustedBank(.25);assert.ok(snowOpacity(dust)>0 && snowOpacity(dust)<.6);
const restored=restoreBanks(serializeBanks(new Map([['/home|balance',banks[3]],['/home|cleaned',createBank()]])));
assert.ok(volume(restored.get('/home|balance'))>0);
assert.equal(volume(restored.get('/home|cleaned')),0,'cleared banks stay empty on restore');
for(const raw of ['broken','null','{}','{"version":2,"banks":[]}','{"version":1,"banks":[["/bad",{"seed":0.5,"heights":[null]}]]}'])assert.equal(restoreBanks(raw).size,0);
assert.equal(restoreBanks(serializeBanks(new Map(Array.from({length:100},(_,i)=>['/card'+i,createBank()])))).size,64);
console.log('PASS persistent banks, clean reload, bounded dust opacity and corrupted/oversized snapshots');

const {snowfallCount,SNOWFALL}=moduleValue.exports;
for(const [w,h] of [[320,568],[393,852],[768,1024],[1920,1080]]) {
  const counts=['light','steady','flurry'].map(i=>snowfallCount(i,w,h));
  assert.ok(counts[0]>=24 && counts[1]>=counts[0]*2 && counts[2]>=counts[1]*1.6,'distinct density even on narrow phones');
  assert.ok(counts[2]<=240,'bounded particle budget');
}
assert.equal(snowfallCount('off',393,852),0);
assert.ok(SNOWFALL.flurry.speed>SNOWFALL.light.speed*2);
assert.ok(SNOWFALL.flurry.drift>SNOWFALL.light.drift*3);
console.log('PASS distinct phone/desktop snowfall density, speed, drift and bounded particle budget');

const {slideBank,loosenBank,landSnow,fallSnow}=moduleValue.exports;
const roof=createBank();roof.heights=roof.heights.map((_,i)=>i>0&&i<47?4:0);
const roofInitial=volume(roof),beforeStill=roof.heights.slice();
assert.deepEqual(slideBank(roof,.1,.04,300),{left:0,right:0});assert.deepEqual(roof.heights,beforeStill,'static friction');
let rightSpill=0,leftSpill=0;
for(let i=0;i<240;i++){const spill=slideBank(roof,.8,.04,300);rightSpill+=spill.right;leftSpill+=spill.left;}
assert.equal(leftSpill,0);assert.ok(rightSpill>0 && volume(roof)>0,'partial downhill shedding');
assert.ok(Math.abs(roofInitial-volume(roof)-rightSpill)<1e-8,'roof transport conserves mass');
const mirror=createBank();mirror.heights=beforeStill.slice();let mirrorSpill=0;
for(let i=0;i<240;i++)mirrorSpill+=slideBank(mirror,-.8,.04,300).left;
assert.ok(Math.abs(mirrorSpill-rightSpill)<1e-8,'left and right physics mirror each other');
const preShake=volume(roof),loose=loosenBank(roof,.8);
assert.ok(loose.right>loose.left);assert.ok(Math.abs(preShake-volume(roof)-loose.left-loose.right)<1e-8);
const lower=createBank(),area=80,remainder=landSnow(lower,.8,area,500,8);
assert.ok(Math.abs(volume(lower)*500/47+remainder-area)<1e-8,'landing conserves area across tile widths');
const full=createBank();full.heights.fill(8);assert.equal(landSnow(full,.5,80,300,8),80,'full roof cannot create or hide mass');
const airborne={x:0,y:0,vx:10,vy:0,area:8,age:0};
for(let i=0;i<25;i++)fallSnow(airborne,.04,.6);
assert.ok(airborne.x>60 && airborne.y>180 && airborne.vy>370,'downward gravity and downhill acceleration');
console.log('PASS roof friction, mirrored downhill shedding, partial shake, mass conservation and ballistic landing');
