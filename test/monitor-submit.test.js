import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { monitorControl } from '../src/monitor-controls.js';
const code='REL*1700*W02',expectedTerm='Spring 2027 Wenzhou';

function fixture({disabled=false,hidden=false,missing=false,wrongCode=false}={}) {
 const clicks=[];
 const element=(text,aria='')=>({innerText:text,getClientRects:()=>[{}],getAttribute:(key)=>key==='aria-label'?aria:null,classList:{contains:()=>false},click:()=>clicks.push(text)});
 const link=element(code,`Details for ${code}: Religion`);
 const waitlist=element('Waitlist',wrongCode?'Waitlist section REL*1700*W01':`Waitlist section ${code}`);
 waitlist.disabled=disabled;if(hidden)waitlist.getClientRects=()=>[];
 const register=element('Register');
 const drop=element('Drop Waitlist',`Drop Waitlist for section ${code}`);drop.disabled=true;
 const card={innerText:'Planned Waitlisted: 4',parentElement:null,querySelectorAll:()=>missing?[register]:[waitlist,register]};link.parentElement=card;
 const document={body:{},querySelectorAll:(selector)=>selector==='a'?[link]:[]};
 const scheduleControl=(input)=>{if(input.action==='register'){clicks.push('Register Now');return{clicked:true};}return{term:expectedTerm,busy:false};};
 const run=(intent)=>vm.runInNewContext(`(${monitorControl.toString()})(input, scheduleControl)`,{document,input:{action:'submit',code,expectedTerm,intent},scheduleControl});
 return{clicks,run};
}

test('waitlist joins only the target course Waitlist, never Register Now',()=>{
 const f=fixture();assert.equal(f.run('waitlist').clicked,true);assert.deepEqual(f.clicks,['Waitlist']);
});
for(const options of [{missing:true},{hidden:true},{disabled:true},{wrongCode:true}]){
 test(`unavailable or wrong-section Waitlist never falls back globally: ${JSON.stringify(options)}`,()=>{
  const f=fixture(options);assert.equal(f.run('waitlist').clicked,false);assert.deepEqual(f.clicks,[]);
 });
}
test('normal registration uses Register Now rather than Waitlist',()=>{
 const f=fixture();assert.equal(f.run('register').clicked,true);assert.deepEqual(f.clicks,['Register Now']);
});
