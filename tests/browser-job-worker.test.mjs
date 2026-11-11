import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserJobWorker} from '../lib/browser-job-worker.mjs';

const waitFor=async(worker,user,status)=>{for(let i=0;i<100;i++){const state=worker.get(user);if(state?.status===status)return state;await new Promise(r=>setTimeout(r,5));}assert.fail(`Did not reach ${status}: ${JSON.stringify(worker.get(user))}`);};
function browserFixture({challenge=false,blockedStatus=200}={}){
 const state={challenge,closed:0,visits:[],profiles:[]};
 const frame={};let responseListener;
 state.manualResponse=status=>{blockedStatus=status;responseListener?.({request:()=>({isNavigationRequest:()=>true}),frame:()=>frame,status:()=>status});};
 const page={on(event,listener){if(event==='response')responseListener=listener;},mainFrame:()=>frame,setDefaultTimeout(){},setDefaultNavigationTimeout(){},async goto(url){state.visits.push(url);state.url=url;return {status:()=>blockedStatus};},url(){return state.challenge?'https://www.google.com/sorry/index':state.url;},async evaluate(){return {url:page.url(),title:state.challenge?'Unusual traffic':'Search',text:state.challenge?'Our systems have detected unusual traffic. Complete the CAPTCHA.':'Your search did not match any documents.',links:[],jsonLd:[]};}};
 const chromium={async launchPersistentContext(profile,options){state.profiles.push({profile,options});return {pages:()=>[page],async route(pattern,handler){state.route=handler;},async close(){state.closed++;}};}};
 return {state,chromium};
}
const options={keywords:['WordPress'],location:'pakistan',days:30};
test('start is immediate, isolates state and reserves the single browser run',async()=>{
 const fixture=browserFixture({challenge:true}),worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});
 const state=worker.start('alice',options);assert.equal(state.status,'running');assert.equal(worker.get('bob'),null);
 assert.throws(()=>worker.start('bob',options),error=>error.status===409);
 const paused=await waitFor(worker,'alice','paused');paused.jobs.push({fake:true});assert.deepEqual(worker.get('alice').jobs,[]);
 assert.match(fixture.state.profiles[0].profile,/browser-profiles/);assert.equal(fixture.state.profiles[0].options.headless,false);
 await worker.close();
});
test('challenge stays open and resume rechecks it without navigating or falling back',async()=>{
 const fixture=browserFixture({challenge:true});let fallback=0;
 const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium,fallbackSearch:async()=>{fallback++;return {jobs:[]};}});
 worker.start('a',{...options,useBackup:true});await waitFor(worker,'a','paused');const count=fixture.state.visits.length;
 await worker.resume('a');await waitFor(worker,'a','paused');assert.equal(fixture.state.visits.length,count);assert.equal(fixture.state.closed,0);assert.equal(fallback,0);
 fixture.state.challenge=false;await worker.resume('a');await waitFor(worker,'a','completed');assert.equal(fallback,1);await worker.close();
});
test('cancel closes a paused browser, frees the slot, and never uses backup',async()=>{
 const fixture=browserFixture({challenge:true});let fallback=0;
 const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium,fallbackSearch:async()=>{fallback++;return {jobs:[]};}});
 worker.start('a',{...options,useBackup:true});await waitFor(worker,'a','paused');await worker.cancel('a');assert.equal(worker.get('a').status,'cancelled');assert.equal(fixture.state.closed,1);assert.equal(fallback,0);
 assert.equal(worker.start('b',options).status,'running');await worker.close();
});
test('empty public searches finish without backup unless explicitly enabled',async()=>{
 let fallback=0;const fixture=browserFixture(),worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium,fallbackSearch:async()=>{fallback++;return {jobs:[],sources:[{name:'JSearch',status:'ok'}]};}});
 worker.start('a',options);const done=await waitFor(worker,'a','completed');assert.equal(fallback,0);assert.deepEqual(done.jobs,[]);assert.ok(done.nextRefreshAt);
 worker.start('b',{...options,useBackup:true});const backed=await waitFor(worker,'b','completed');assert.equal(fallback,1);assert.ok(backed.sources.some(s=>s.name==='JSearch'));await worker.close();
});
test('403 response pauses rather than attempting a different discovery host',async()=>{
 const fixture=browserFixture({blockedStatus:403}),worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});
 worker.start('a',options);await waitFor(worker,'a','paused');assert.equal(fixture.state.visits.length,1);
 worker.resume('a');await waitFor(worker,'a','paused');assert.equal(fixture.state.visits.length,1);
 fixture.state.manualResponse(200);worker.resume('a');await waitFor(worker,'a','completed');await worker.close();
});
test('cancel reserves the browser until a pending launch has closed its profile',async()=>{
 let resolveLaunch,launched=false,closed=false;
 const chromium={launchPersistentContext(){launched=true;return new Promise(resolve=>{resolveLaunch=resolve;});}};
 const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium});
 const started=worker.start('a',{...options,useBackup:true});assert.equal(started.useBackup,true);
 while(!launched)await new Promise(resolve=>setTimeout(resolve,1));
 const cancellation=worker.cancel('a');assert.equal(worker.get('a').status,'cancelled');
 assert.throws(()=>worker.start('a',options),error=>error.status===409);
 resolveLaunch({async close(){closed=true;}});await cancellation;assert.equal(closed,true);
 assert.equal(worker.start('b',options).useBackup,false);await worker.cancel('b');await worker.close();
});
test('navigation guard permits challenge iframes while blocking unexpected top-level hosts',async()=>{
 const fixture=browserFixture({challenge:true}),worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});
 worker.start('a',options);await waitFor(worker,'a','paused');
 let outcome;
 const request=parent=>({isNavigationRequest:()=>true,url:()=> 'https://challenge.example/captcha',frame:()=>({parentFrame:()=>parent})});
 await fixture.state.route({request:()=>request({}),async continue(){outcome='continued';},async abort(){outcome='aborted';}});assert.equal(outcome,'continued');
 await fixture.state.route({request:()=>request(null),async continue(){outcome='continued';},async abort(){outcome='aborted';}});assert.equal(outcome,'aborted');await worker.close();
});

test('reads hydrated native board results before using Google discovery',async()=>{
 const fixture=browserFixture();let hydrated=0;const context=await fixture.chromium.launchPersistentContext('',{}),page=context.pages()[0];
 page.waitForLoadState=async()=>{hydrated++;};page.evaluate=async()=>({url:page.url(),title:'Jobs',text:'Public jobs',jsonLd:[],links:page.url().includes('/jobs/search/')?[{href:'https://pk.linkedin.com/jobs/view/wordpress-developer-1234567890',text:'WordPress developer'}]:[]});
 const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});worker.start('native',options);await waitFor(worker,'native','completed');
 assert.ok(fixture.state.visits.some(url=>url.startsWith('https://pk.indeed.com/jobs?')));assert.ok(fixture.state.visits.some(url=>url.startsWith('https://www.linkedin.com/jobs/search/')));assert.ok(fixture.state.visits.includes('https://www.linkedin.com/jobs/view/1234567890'));assert.ok(hydrated>=fixture.state.visits.length);await worker.close();
});

test('headless runs close and record access blocks without waiting for an invisible manual check',async()=>{const fixture=browserFixture({challenge:true});const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium,headless:true});worker.start('cloud',options);const result=await waitFor(worker,'cloud','needs_attention');assert.match(result.message,/access check/i);assert.equal(fixture.state.profiles[0].options.headless,true);assert.equal(fixture.state.closed,1);await worker.close();});

test('Indeed-only run uses public card records and does not open gated detail pages or LinkedIn',async()=>{const fixture=browserFixture();const context=await fixture.chromium.launchPersistentContext('',{}),page=context.pages()[0],posted=Date.now()-86400000;page.evaluate=async()=>({url:page.url(),title:'WordPress jobs',text:'WordPress developer jobs',links:[],jsonLd:[],indeedCards:[{id:'verified123',title:'WordPress Developer',company:'Example Studio',location:'Lahore',url:'https://pk.indeed.com/rc/clk?jk=verified123'}],indeedScripts:['window.mosaic.providerData["mosaic-provider-jobcards"]='+JSON.stringify({metaData:{mosaicProviderJobCardsModel:{results:[{jobkey:'verified123',title:'WordPress Developer',company:'Example Studio',country:'PK',formattedLocation:'Lahore',pubDate:posted,snippet:'Build WordPress sites.'}]}}})+';']});let persisted;const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium,onComplete:(user,state)=>{persisted={user,state};}});worker.start('indeed',{keywords:['WordPress developer'],location:'pakistan',days:30,sources:['Indeed']});const result=await waitFor(worker,'indeed','completed');assert.equal(result.jobs.length,1);assert.equal(persisted.user,'indeed');assert.equal(persisted.state.jobs.length,1);assert.deepEqual(result.boards,['Indeed']);assert.equal(fixture.state.visits.length,1);assert.equal(new URL(fixture.state.visits[0]).hostname,'pk.indeed.com');assert.equal(new URL(fixture.state.visits[0]).searchParams.get('sort'),null);await worker.close();});

test('paginates all seven keywords to30 unique recent matches each, newest first, without repeats',async()=>{const fixture=browserFixture(),keywords=['WordPress developer','Shopify developer','Wix developer','Squarespace developer','Webflow developer','PHP developer','React developer'],ctx=await fixture.chromium.launchPersistentContext('',{}),page=ctx.pages()[0];page.evaluate=async()=>{const url=new URL(page.url()),keyword=url.searchParams.get('q'),pageNo=Number(url.searchParams.get('start')||0)/10;const rows=Array.from({length:15},(_,i)=>({jobkey:keyword.replace(/\s/g,'')+(pageNo*10+i),title:keyword,company:'Employer '+i,country:'PK',formattedLocation:'Lahore',pubDate:Date.now()-(i+1)*3600000,snippet:'Build '+keyword+' projects.'}));rows.push({...rows[0],jobkey:'old'+pageNo,pubDate:Date.now()-15*86400000});return {url:page.url(),title:'Jobs',text:'Public jobs',links:[],jsonLd:[],indeedNextPage:'https://pk.indeed.com/jobs?q='+encodeURIComponent(keyword)+'&l=Pakistan&start='+((pageNo+1)*10),indeedScripts:['window.mosaic.providerData["mosaic-provider-jobcards"]='+JSON.stringify({metaData:{mosaicProviderJobCardsModel:{results:rows}}})+';'],indeedCards:rows.map(r=>({id:r.jobkey,title:r.title,company:r.company,location:r.formattedLocation,url:'https://pk.indeed.com/rc/clk?jk='+r.jobkey}))};};const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});worker.start('seven',{keywords,location:'pakistan',days:30,sources:['Indeed']});const state=await waitFor(worker,'seven','completed');assert.equal(state.days,14);assert.equal(state.jobs.length,210);assert.equal(new Set(state.jobs.map(j=>j.id)).size,210);assert.equal(fixture.state.visits.length,21);for(const keyword of keywords)assert.equal(state.jobs.filter(j=>j.matchedKeywords.includes(keyword)).length,30);assert.ok(state.jobs.every(j=>Date.parse(j.posted)>=Date.now()-14*86400000));assert.ok(state.jobs.every((j,i)=>!i||Date.parse(state.jobs[i-1].posted)>=Date.parse(j.posted)));assert.equal(state.keywordProgress.length,7);assert.ok(state.keywordProgress.every(k=>k.pages===3&&k.status==='completed'&&k.matched===30));await worker.close();});

test('repeated public pages stop quickly and overlapping keyword matches merge into one job',async()=>{const fixture=browserFixture(),ctx=await fixture.chromium.launchPersistentContext('',{}),page=ctx.pages()[0];page.evaluate=async()=>{const url=new URL(page.url()),offset=Number(url.searchParams.get('start')||0),row={jobkey:'shared123',title:'WordPress Developer',company:'Shared Employer',country:'PK',formattedLocation:'Lahore',pubDate:Date.now()-86400000,snippet:'WordPress CMS theme development'};return {url:page.url(),title:'Jobs',text:'Jobs',links:[],jsonLd:[],indeedNextPage:'https://pk.indeed.com/jobs?q='+encodeURIComponent(url.searchParams.get('q'))+'&l=Pakistan&start='+(offset+10),indeedScripts:['window.mosaic.providerData["mosaic-provider-jobcards"]='+JSON.stringify({metaData:{mosaicProviderJobCardsModel:{results:[row]}}})+';'],indeedCards:[{id:row.jobkey,title:row.title,company:row.company,location:row.formattedLocation,url:'https://pk.indeed.com/rc/clk?jk='+row.jobkey}]};};const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});worker.start('overlap',{keywords:['WordPress developer','CMS developer'],location:'pakistan',sources:['Indeed']});const result=await waitFor(worker,'overlap','completed');assert.equal(result.jobs.length,1);assert.deepEqual(result.jobs[0].matchedKeywords,['WordPress developer','CMS developer']);assert.equal(fixture.state.visits.length,4);assert.ok(result.keywordProgress.every(k=>k.pages===2&&k.matched===1));await worker.close();});

test('resume after a manual Indeed sign-in returns from the homepage to the original keyword search',async()=>{const fixture=browserFixture({challenge:true}),ctx=await fixture.chromium.launchPersistentContext('',{}),page=ctx.pages()[0];const evaluate=page.evaluate.bind(page);page.evaluate=async()=>{if(fixture.state.challenge)return evaluate();const row={jobkey:'login123',title:'WordPress Developer',company:'Example Studio',country:'PK',formattedLocation:'Lahore',pubDate:Date.now()-86400000,snippet:'WordPress themes'};return {url:page.url(),title:'Indeed',text:'Jobs',links:[],jsonLd:[],indeedCards:page.url().includes('/jobs?')?[{id:row.jobkey,title:row.title,company:row.company,location:row.formattedLocation,url:'https://pk.indeed.com/rc/clk?jk='+row.jobkey}]:[],indeedScripts:['window.mosaic.providerData["mosaic-provider-jobcards"]='+JSON.stringify({metaData:{mosaicProviderJobCardsModel:{results:[row]}}})+';']};};const worker=createBrowserJobWorker({dataDir:'work/worker-tests',chromium:fixture.chromium});worker.start('signin',{keywords:['WordPress developer'],location:'pakistan',sources:['Indeed']});await waitFor(worker,'signin','paused');fixture.state.challenge=false;fixture.state.url='https://pk.indeed.com/';fixture.state.manualResponse(200);worker.resume('signin');const result=await waitFor(worker,'signin','completed');assert.equal(result.jobs.length,1);assert.equal(fixture.state.visits.length,2);assert.equal(fixture.state.visits[1],fixture.state.visits[0]);await worker.close();});
