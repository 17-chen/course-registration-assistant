import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { BrowserSession } from "../src/browser-session.js";
import { RegistrationRunner } from "../src/registration-runner.js";

const fixture = `<!DOCTYPE html><meta charset="utf-8"><style>header{display:flex;gap:15px;align-items:center}button{height:40px}header button{width:50px}#term{width:220px}#global{width:180px}#modal{border:1px solid;padding:10px}</style>
<header><button>‹</button><button id="next">›</button><span id="term">Fall 2026 Wenzhou</span><button id="global">Register Now</button></header>
<main><section id="target"><a href="#" aria-label="Details for REL*1700*W02: Religion">REL*1700*W02: Religion</a><p id="status">Planned</p><p>Waitlisted: 5</p><button id="drop">Drop Waitlist</button><button id="remove">Remove</button><button id="localwait">Waitlist</button><button id="localreg">Register</button></section>
<section><a href="#" aria-label="Details for PHIL*1100*W02: Philosophy">PHIL*1100*W02</a><p>Planned</p><button>Waitlist</button></section></main>
<div id="modal" role="dialog" style="display:none"><h3>Section Details</h3><div id="detailbody"></div><button aria-label="Close Section Details">Close</button></div>
<script>
window.log=[];window.termIndex=0;window.counts='0 / 30 / 5';
const terms=['Fall 2026 Wenzhou','Winter 2027 Wenzhou','Spring 2027 Wenzhou'];
document.getElementById('drop').style.display='none';
document.getElementById('next').onclick=()=>{log.push('next');document.getElementById('term').innerText=terms[++termIndex]};
document.querySelector('#target a').onclick=(e)=>{e.preventDefault();log.push('details');document.getElementById('modal').style.display='block';document.getElementById('detailbody').innerText='Retrieving information...';setTimeout(()=>document.getElementById('detailbody').innerText='REL*1700*W02 Religion Spring 2027 Wenzhou Seats Available Available/Capacity/Waitlisted '+counts,30)};
document.querySelector('#modal button').onclick=()=>{log.push('close');document.getElementById('modal').style.display='none'};
document.getElementById('localwait').onclick=()=>{log.push('waitlist');document.getElementById('status').innerText='Waitlisted';document.getElementById('drop').style.display='inline'};
document.getElementById('localreg').onclick=()=>{log.push('register');document.getElementById('status').innerText='Registered, but not started'};
for(const id of ['global','remove','drop'])document.getElementById(id).onclick=()=>log.push(id);
</script>`;

test("real Chrome: fresh details after reload, queue transitions, scoped submit and Safari serialization", {skip:!process.env.WKU_BROWSER_SMOKE}, async()=>{
  const chrome=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try{
    const context=await chrome.newContext();
    await context.route('https://wku-test.invalid/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
    const browser=new BrowserSession({rootDir:'/tmp/course-assistant-test'});
    browser.context=context;browser.page=await context.newPage();browser.kind='chrome';
    await browser.goto('https://wku-test.invalid/');
    const expectedTerm='Spring 2027 Wenzhou',code='REL*1700*W02';
    const runner=new RegistrationRunner({rootDir:'/tmp/course-assistant-test'});runner.browser=browser;
    runner.refreshLoginState=async()=>true;
    // Wrong term refuses both opening details and submission.
    assert.equal((await browser.monitorOperation({action:'submit',code,expectedTerm,intent:'waitlist'})).clicked,false);
    await runner.restoreScheduleTerm(expectedTerm);
    // Exercise the same serialized operation via the Safari executeScript path.
    browser.driver={executeScript:(script,input)=>browser.page.evaluate(({script,input})=>new Function('input',`return (function(){${script}})(input);`)(input),{script,input})};
    const snapshot=await browser.inspectMonitoringSection(code,expectedTerm);
    assert.match(snapshot.availabilityText,/0 \/ 30 \/ 5/);
    assert.equal(snapshot.waitlisted,false); // Waitlisted: 5 is a headcount.
    browser.driver=null;
    await browser.reload();await runner.restoreScheduleTerm(expectedTerm);
    await browser.page.evaluate(()=>{window.counts='1 / 30 / 5'});
    const second=await browser.inspectMonitoringSection(code,expectedTerm);
    assert.match(second.availabilityText,/1 \/ 30 \/ 5/);
    assert.equal((await browser.monitorOperation({code,expectedTerm})).waitlisted,false);
    await browser.page.evaluate(()=>{window.counts='0 / 30 / 4'});
    const third=await browser.inspectMonitoringSection(code,expectedTerm);
    assert.match(third.availabilityText,/0 \/ 30 \/ 4/);
    assert.equal((await browser.monitorOperation({action:'submit',code,expectedTerm,intent:'waitlist'})).clicked,true);
    assert.equal((await browser.monitorOperation({code,expectedTerm})).waitlisted,true);
    assert.equal((await browser.monitorOperation({action:'submit',code,expectedTerm,intent:'waitlist'})).clicked,false);
    const log=await browser.page.evaluate(()=>window.log);
    assert.deepEqual(log,['next','next','details','close','details','close','waitlist']);
    // An eligibility overlay blocks reads/submits until it disappears.
    await browser.page.evaluate(()=>{const mask=document.createElement('div');mask.textContent='Refreshing registration eligibility...';document.body.append(mask)});
    assert.equal((await browser.monitorOperation({action:'submit',code,expectedTerm,intent:'register'})).safe,false);
  }finally{await chrome.close();}
});
