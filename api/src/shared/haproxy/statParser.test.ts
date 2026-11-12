import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShowStat } from "./statParser.js";

// Trimmed real sample from ruin.shpyn.online (`show stat`), header truncated to
// the stable columns the parser reads.
const HEADER =
  "# pxname,svname,qcur,qmax,scur,smax,slim,stot,bin,bout,dreq,dresp,ereq,econ,eresp,wretr,wredis,status,weight,act,bck,chkfail,chkdown,lastchg,downtime,qlimit,pid,iid,sid,throttle,lbtot,tracked,type,rate,rate_lim,rate_max,check_status,check_code,check_duration,hrsp_1xx,hrsp_2xx,hrsp_3xx,hrsp_4xx,hrsp_5xx,hrsp_other,hanafail,req_rate,req_rate_max,req_tot,cli_abrt,srv_abrt,comp_in,comp_out,comp_byp,comp_rsp,lastsess,last_chk,last_agt,qtime,ctime,rtime,ttime,agent_status,agent_code,agent_duration,check_desc,agent_desc,check_rise,check_fall,check_health,agent_rise,agent_fall,agent_health,addr";

function row(fields: Record<string, string>): string {
  const headers = HEADER.replace(/^#\s*/, "").split(",");
  return headers.map((h) => fields[h] ?? "").join(",");
}

test("parses frontend/backend/server rows into topology", () => {
  const csv = [
    HEADER,
    "rf_reality_canary_443,FRONTEND,,,1184,2028,50000,583849,,,,,,,,,,OPEN,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    row({ pxname: "reality_fi", svname: "fi_real_v6_0", status: "UP", weight: "1", act: "1", bck: "0", scur: "7", lastchg: "79687", check_status: "L4OK", addr: "[2a0d:6c2:24:bf3::]:8443" }),
    row({ pxname: "reality_fi", svname: "fi_real_v4", status: "MAINT", weight: "4", act: "1", bck: "0", check_status: "", addr: "194.48.143.19:8443" }),
    row({ pxname: "reality_fi", svname: "fi_real_bk", status: "no check", weight: "3", act: "0", bck: "1", addr: "10.0.0.1:8443" }),
    row({ pxname: "reality_fi", svname: "BACKEND", status: "UP", weight: "5" }),
  ].join("\n");

  const t = parseShowStat(csv);
  assert.equal(t.backends.length, 1);
  const b = t.backends[0];
  assert.equal(b.name, "reality_fi");
  assert.equal(b.status, "up");
  assert.equal(b.servers.length, 3);

  const s0 = b.servers[0];
  assert.equal(s0.name, "fi_real_v6_0");
  assert.equal(s0.status, "up");
  assert.equal(s0.weight, 1);
  assert.equal(s0.checkStatus, "L4OK");
  assert.equal(s0.sessionsCur, 7);
  assert.equal(s0.lastChangeSec, 79687);
  assert.equal(s0.isBackup, false);
  assert.equal(s0.addr, "[2a0d:6c2:24:bf3::]:8443");

  assert.equal(b.servers[1].status, "maint");
  assert.equal(b.servers[2].status, "no_check");
  assert.equal(b.servers[2].isBackup, true);
});

test("status suffixes are normalized to the leading token", () => {
  const csv = [
    HEADER,
    row({ pxname: "bk", svname: "s1", status: "UP 2/3", weight: "1" }),
    row({ pxname: "bk", svname: "s2", status: "DOWN 1/2", weight: "1" }),
    row({ pxname: "bk", svname: "s3", status: "DRAIN (agent)", weight: "1" }),
  ].join("\n");
  const b = parseShowStat(csv).backends[0];
  assert.equal(b.servers[0].status, "up");
  assert.equal(b.servers[1].status, "down");
  assert.equal(b.servers[2].status, "drain");
});

test("empty / missing input yields no backends", () => {
  assert.deepEqual(parseShowStat("").backends, []);
  assert.deepEqual(parseShowStat("   \n  ").backends, []);
});
