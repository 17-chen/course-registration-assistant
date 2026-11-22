import test from "node:test";
import assert from "node:assert/strict";
import { RegistrationRunner } from "../src/registration-runner.js";
import { parseAvailability } from "../src/section-parser.js";

const runner = () => new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
const counts = (a, w) => ({ available: a, capacity: 30, waitlisted: w });
const planned = { found: true, registered: false, waitlisted: false, canRegister: false };
const options = { allowWaitlist: true, waitlistLimit: 5 };

test("queue head vacancy is watched, then queue slot triggers one waitlist attempt", () => {
  const r = runner();
  const sequence = [[0,5], [1,5], [0,4], [0,4], [0,3], [0,5], [0,4]];
  const decisions = sequence.map(([a,w]) => r.monitorDecision(planned, counts(a,w), options));
  assert.deepEqual(decisions.map(d => d.intent), [null,null,"waitlist","waitlist","waitlist",null,"waitlist"]);
  assert.equal(decisions[1].hot, true);
  assert.deepEqual(decisions.map(d => r.evaluateMonitorTrigger("REL*1700*W02",d).shouldAttempt), [false,false,true,false,false,false,true]);
});

test("ordinary course requires an actual seat, without treating zero queue as waitlist opening", () => {
  const r=runner();
  assert.equal(r.monitorDecision(planned,counts(0,0),options).intent,null);
  assert.equal(r.monitorDecision(planned,counts(1,0),options).intent,"register");
  assert.equal(r.monitorDecision(planned,counts(0,4),{...options,allowWaitlist:false}).intent,null);
});

test("own waitlist membership is separate from queue size and needs an enabled Register control", () => {
  const r=runner();
  assert.equal(r.monitorDecision({...planned,waitlisted:true},counts(1,5),options).intent,null);
  assert.equal(r.monitorDecision({...planned,waitlisted:true,canRegister:true},counts(1,5),options).intent,"register");
  assert.equal(r.monitorDecision({...planned,registered:true},counts(1,0),options).intent,null);
});

test("unknown detail counts never submit or rearm an existing attempt", () => {
  const r=runner();
  const action=r.monitorDecision(planned,counts(0,4),options);
  assert.equal(r.evaluateMonitorTrigger("REL*1700*W02",action).shouldAttempt,true);
  const unknown=r.monitorDecision(planned,parseAvailability("loading"),options);
  assert.equal(r.evaluateMonitorTrigger("REL*1700*W02",unknown).shouldAttempt,false);
  assert.equal(r.evaluateMonitorTrigger("REL*1700*W02",action).shouldAttempt,false);
});

test("parses the actual details format with the accessibility legend", () => {
  assert.deepEqual(Object.values(parseAvailability("Seats Available Available/Capacity/Waitlisted 1 / 30 / 5")).slice(0,3), [1,30,5]);
});

test("dry run never invokes submit, including an open waitlist slot", async () => {
  const r=runner();r.capture=async()=>{};
  r.browser={monitorOperation:async()=>assert.fail("dry run must not submit")};
  await r.attemptMonitorAction({dryRun:true},"REL*1700*W02","waitlist","候补有位置");
  assert.match(r.state.message,/演练未点击加入候补/);
});

test("waitlist membership is confirmed on the target card and reported separately from success", async () => {
  const r=runner();r.capture=async()=>{};
  let submits=0;
  r.browser={
    monitorOperation:async(input)=>{
      assert.equal(input.expectedTerm,"Spring 2027 Wenzhou");
      assert.equal(input.code,"REL*1700*W02");
      if(input.action==="submit"){submits++;return{safe:true,clicked:true};}
      return{safe:true,found:true,waitlisted:true,registered:false};
    },
    registrationProcessingState:async()=>({active:false}),
    wait:async()=>{},
  };
  await r.attemptMonitorAction({dryRun:false,targetTerm:"Spring 2027 Wenzhou"},"REL*1700*W02","waitlist","候补有位置");
  assert.equal(submits,1);assert.equal(r.state.phase,"waitlisted");assert.equal(r.state.results[0].kind,"waitlisted");
});

test("unconfirmed submission is never repeated", async () => {
  const r=runner();let submits=0;
  r.browser={monitorOperation:async(input)=>{if(input.action==="submit")submits++;return{safe:true,clicked:true,found:true};},registrationProcessingState:async()=>({active:false}),wait:async()=>{}};
  const originalNow=Date.now;let now=10000;Date.now=()=>now+=10000;
  try{await r.attemptMonitorAction({dryRun:false,targetTerm:"Spring 2027 Wenzhou"},"REL*1700*W02","waitlist","候补有位置");}finally{Date.now=originalNow;}
  assert.equal(submits,1);assert.equal(r.state.phase,"error");
});

test("a queue-head vacancy uses a 30-second focused interval instead of 2 seconds", async () => {
  const r=runner();
  r.refreshLoginState=async()=>true;
  r.waitForScheduleTerm=async()=>({term:"Spring 2027 Wenzhou"});
  r.restoreScheduleTerm=async()=>{};
  r.browser={inspectMonitoringSection:async()=>({...planned,availabilityText:"Seats Available 1 / 30 / 5"})};
  let interval;
  r.waitForNextRefresh=async(ms)=>{interval=ms;r.stopRequested=true;};
  await r.runLoop({mode:"monitor",selected:["REL*1700*W02"],intervalMs:60000,...options});
  assert.equal(interval,30000);
  assert.equal(r.state.focusedSection,"REL*1700*W02");
});

test("waiting publishes a deadline and stopping clears it promptly", async () => {
  const r=runner();r.running=true;
  const updates=[];r.on("state",state=>updates.push({...state}));
  const before=Date.now();
  const wait=r.waitForNextRefresh(60000);
  assert.equal(Date.parse(r.state.nextRefreshAt)>=before+60000,true);
  r.stop();
  await wait;
  assert.equal(r.state.nextRefreshAt,null);
  assert.equal(r.state.phase,"stopped");
  assert.equal(updates.some(state=>state.phase==="waiting-refresh"),true);
});

test("focus alternates one course and all five without starving other courses", async () => {
  const r=runner();const reads=[],waits=[],scopes=[];
  r.refreshLoginState=async()=>true;
  r.waitForScheduleTerm=async()=>({term:"Spring 2027 Wenzhou"});
  r.restoreScheduleTerm=async()=>{};
  r.reloadForMonitoring=async()=>{};
  r.browser={inspectMonitoringSection:async(code)=>{
    reads.push(code);
    return {...planned,availabilityText:`Seats Available ${code==="A"?1:0} / 30 / 5`};
  }};
  r.waitForNextRefresh=async(ms)=>{
    waits.push(ms);scopes.push(r.state.nextCheckScope);
    if(waits.length===4)r.stopRequested=true;
  };
  await r.runLoop({mode:"monitor",selected:["A","B","C","D","E"],intervalMs:60000,...options});
  assert.deepEqual(reads,["A","B","C","D","E","A","A","B","C","D","E","A"]);
  assert.deepEqual(waits,[30000,30000,30000,30000]);
  assert.deepEqual(scopes,["focused","all","focused","all"]);
});

test("losing the focus condition restores the configured ordinary interval", async () => {
  const r=runner();const waits=[];let aReads=0;
  r.refreshLoginState=async()=>true;
  r.waitForScheduleTerm=async()=>({term:"Spring 2027 Wenzhou"});
  r.restoreScheduleTerm=async()=>{};
  r.reloadForMonitoring=async()=>{};
  r.browser={inspectMonitoringSection:async(code)=>({...planned,availabilityText:`Seats Available ${code==="A" && ++aReads===1?1:0} / 30 / 5`})};
  r.waitForNextRefresh=async(ms)=>{waits.push(ms);if(waits.length===2)r.stopRequested=true;};
  await r.runLoop({mode:"monitor",selected:["A","B"],intervalMs:60000,...options});
  assert.deepEqual(waits,[30000,60000]);
  assert.equal(r.state.focusedSection,null);
  assert.equal(r.state.nextCheckScope,"all");
});

 test("an ordinary course opportunity is submitted during a full round even after a hot course", async () => {
  const r=runner();r.running=true;const actions=[];
  r.refreshLoginState=async()=>true;
  r.waitForScheduleTerm=async()=>({term:"Spring 2027 Wenzhou"});
  r.restoreScheduleTerm=async()=>{};
  r.browser={inspectMonitoringSection:async(code)=>({...planned,availabilityText:code==="A"?"Seats Available 1 / 30 / 5":"Seats Available 1 / 30 / 0"})};
  r.attemptMonitorAction=async(_options,code,intent)=>{actions.push([code,intent]);r.stopRequested=true;};
  await r.runLoop({mode:"monitor",selected:["A","B"],intervalMs:60000,...options});
  assert.deepEqual(actions,[["B","register"]]);
});

test("a missing waitlist button does not consume the opportunity before it becomes available", async () => {
  const r=runner();let submits=0;r.capture=async()=>{};
  const decision={intent:"waitlist"};
  assert.equal(r.evaluateMonitorTrigger("REL*1700*W02",decision).shouldAttempt,true);
  r.browser={monitorOperation:async()=>{submits++;return{safe:true,clicked:false};}};
  await r.attemptMonitorAction({dryRun:false,targetTerm:"Spring 2027 Wenzhou"},"REL*1700*W02","waitlist","队列有位置");
  assert.equal(submits,1);
  assert.equal(r.evaluateMonitorTrigger("REL*1700*W02",decision).shouldAttempt,true);
});
