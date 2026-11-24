const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/app/appearance/phoneSnowModel.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const {newPhoneSnowState,updatePhoneSnow,motionVector}=mod.exports;
const g={x:0,y:0,z:9.8},zero={x:0,y:0,z:0};
let state=newPhoneSnowState();for(let i=0;i<100;i++)state=updatePhoneSnow(state,g,zero,i*50);
assert.equal(state.wind,0);assert.equal(state.shakeAt,-Infinity);
state=newPhoneSnowState();for(let i=0;i<40;i++)state=updatePhoneSnow(state,{x:i/10,y:0,z:9.8},null,i*50);
assert.ok(state.wind<0&&state.wind>=-1);assert.equal(state.shakeAt,-Infinity,'gradual tilt is not a shake');
state=newPhoneSnowState();for(let i=0;i<40;i++)state=updatePhoneSnow(state,g,{x:Math.sin(i)*2.5,y:0,z:0},i*50);
assert.equal(state.shakeAt,-Infinity,'walking-scale acceleration is ignored');
state=updatePhoneSnow(newPhoneSnowState(),g,{x:16,y:0,z:0},1000);
state=updatePhoneSnow(state,g,{x:-16,y:0,z:0},1150);assert.equal(state.shakeAt,1150);
state=updatePhoneSnow(state,g,{x:16,y:0,z:0},1300);state=updatePhoneSnow(state,g,{x:-16,y:0,z:0},1450);assert.equal(state.shakeAt,1150);
state=updatePhoneSnow(state,g,{x:16,y:0,z:0},5300);state=updatePhoneSnow(state,g,{x:-16,y:0,z:0},5450);assert.equal(state.shakeAt,5450);
assert.equal(motionVector({x:null,y:0,z:9}),null);assert.equal(motionVector({x:NaN,y:0,z:0}),null);
assert.equal(updatePhoneSnow(state,null,null,6000),state);
console.log('PASS stationary/gradual tilt/walking rejection, opposing shake pulses, cooldown and missing sensor data');
const rotated=newPhoneSnowState();let landscape=rotated;
for(let i=0;i<30;i++)landscape=updatePhoneSnow(landscape,{x:0,y:4,z:9},zero,i*50,90);
assert.ok(landscape.wind>.3&&landscape.wind<=1,'landscape tilt follows screen orientation');
let fallback=updatePhoneSnow(newPhoneSnowState(),g,null,0);
fallback=updatePhoneSnow(fallback,{x:16,y:0,z:9.8},null,150);
fallback=updatePhoneSnow(fallback,{x:-16,y:0,z:9.8},null,300);assert.equal(fallback.shakeAt,300,'raw accelerometer fallback works without linear acceleration');

const {screenGravity}=mod.exports;
const near=(v,x,y)=>assert.ok(Math.abs(v.x-x)<1e-8&&Math.abs(v.y-y)<1e-8);
near(screenGravity({x:0,y:9.8,z:0},0),0,1);
near(screenGravity({x:-9.8,y:0,z:0},0),1,0);
near(screenGravity({x:9.8,y:0,z:0},0),-1,0);
near(screenGravity({x:0,y:-9.8,z:0},0),0,-1);
near(screenGravity({x:9.8,y:0,z:0},90),0,1);
near(screenGravity({x:-9.8,y:0,z:0},270),0,1);
near(screenGravity({x:0,y:-9.8,z:0},180),0,1);
assert.equal(screenGravity({x:.1,y:0,z:9.8},0),null,'flat phone has no reliable screen-plane gravity');
console.log('PASS locked portrait 90/180-degree gravity and compensated screen auto-rotation');

// Chromium SensorReadingRemapper maps device axes as (x*cos-y*sin, x*sin+y*cos).
// Canvas gravity negates mapped X but keeps mapped Y (DOM Y points down).
for(const [angle,c,s] of [[0,1,0],[90,0,1],[180,-1,0],[270,0,-1]]){
  const x=3,y=7,m=Math.hypot(x,y);near(screenGravity({x,y,z:0},angle),-(x*c-y*s)/m,(x*s+y*c)/m);
}
