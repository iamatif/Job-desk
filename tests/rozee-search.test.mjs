import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRozeeSearch} from '../lib/rozee-search.mjs';
const clock=Date.UTC(2026,10,10),key='apish-test-key-123456789';
const row=(id,extra={})=>({id,title:'WordPress Developer',company:'Example',url:`https://www.rozee.pk/wordpress-developer-jobs-${id}`,city:'Lahore',cities:['Lahore'],job_type:'Full Time',experience:'2 years',salary:'PKR 80,000',skills:['WordPress'],description:'<p>Build WordPress sites</p>',posted_at:'2026-11-09',apply_by:'2026-12-01',source:'ROZEE.PK',...extra});
const config=()=>({rozeeApiKey:key,rozeeEnabled:true});
test('documented jobs pages preserve genuine links, plain text and 24-hour coalesced cache',async()=>{
 const calls=[];const search=createRozeeSearch({getConfig:config,now:()=>clock,fetch:async(url,options)=>{calls.push({url,options});return Response.json({jobs:[row(calls.length)],next_page:calls.length===1?2:null,credits_used:1});}});
 const input={keywords:['WordPress'],location:'pakistan-remote'};const [result,parallel]=await Promise.all([search(input),search(input)]);
 assert.equal(result.jobs.length,2);assert.equal(calls.length,2);assert.equal(parallel.sources[0].cached,true);assert.equal(result.jobs[0].description,'Build WordPress sites');assert.equal(result.jobs[0].experienceKnown,false);assert.equal(result.jobs[0].source,'Rozee.pk');assert.equal(result.jobs[0].provider,'API.SH');
 assert.equal(new URL(calls[1].url).searchParams.get('page'),'2');assert.equal(calls[0].options.headers['x-api-key'],key);assert.equal(calls[0].options.redirect,'error');assert.ok(!calls[0].url.includes(key));assert.equal((await search(input)).sources[0].cached,true);assert.equal(Date.parse(result.sources[0].nextRefreshAt)-clock,86400000);
});
test('malformed records, old/future/undated and unsafe URLs are isolated; worldwide needs explicit remote eligibility',async()=>{
 const records=[row(1),row(2,{posted_at:'2026-09-01'}),row(3,{posted_at:null}),row(4,{posted_at:'2026-11-11'}),row(5,{url:'https://rozee.pk.evil.com/job'}),row(6,{url:'javascript:alert(1)'}),null,row(7,{city:'Worldwide',description:'Remote worldwide WordPress role'}),row(8,{city:'Remote',description:'Remote WordPress role'}),row(9,{city:'Worldwide',description:'Office role'})];
 const search=createRozeeSearch({getConfig:config,now:()=>clock,fetch:async()=>Response.json({jobs:records,next_page:null})});
 assert.deepEqual((await search({keywords:['WordPress'],location:'pakistan'})).jobs.map(j=>j.sourceUrl),[row(1).url]);
 assert.deepEqual((await search({keywords:['WordPress'],location:'remote-worldwide'})).jobs.map(j=>j.sourceUrl),[row(7).url]);
});
test('later page failure retains first page and errors are cached without leaking provider body or key',async()=>{
 let calls=0,time=clock;const search=createRozeeSearch({getConfig:config,now:()=>time,fetch:async()=>++calls===1?Response.json({jobs:[row(1)],next_page:2}):new Response(key,{status:429})});
 const input={keywords:['WordPress'],location:'pakistan'};const result=await search(input);assert.equal(result.jobs.length,1);assert.equal(result.sources[0].status,'error');assert.equal(calls,2);assert.ok(!JSON.stringify(result).includes(key));await search(input);assert.equal(calls,2);time+=60001;await search(input);assert.equal(calls,3);
});
test('setup, disabled state and changed keys do not reuse unrelated credentials',async()=>{
 let cfg={apiKey:key,enabled:true},calls=0;const search=createRozeeSearch({getConfig:()=>cfg,now:()=>clock,fetch:async()=>{calls++;return Response.json({jobs:[],next_page:null});}});const input={keywords:['WordPress'],location:'pakistan'};
 assert.equal((await search(input)).sources[0].status,'setup');assert.equal(calls,0);cfg=config();await search(input);cfg={...cfg,rozeeEnabled:false};assert.equal((await search(input)).sources[0].status,'setup');cfg={...config(),rozeeApiKey:'replacement-key-123456789'};await search(input);assert.equal(calls,2);
});
test('requests are limited to two active calls and two documented pages per keyword',async()=>{
 let active=0,peak=0,calls=0;const search=createRozeeSearch({getConfig:config,now:()=>clock,fetch:async()=>{active++;peak=Math.max(peak,active);calls++;await new Promise(resolve=>setTimeout(resolve,5));active--;return Response.json({jobs:[],next_page:2});}});
 await search({keywords:['WordPress','Shopify','Wix'],location:'pakistan'});assert.equal(calls,6);assert.equal(peak,2);
});
test('credentials and quota errors cool down across keywords; invalid bodies fail closed',async()=>{
 let calls=0;const search=createRozeeSearch({getConfig:config,now:()=>clock,fetch:async()=>{calls++;return new Response('private upstream diagnostics',{status:403});}});
 await search({keywords:['WordPress'],location:'pakistan'});const second=await search({keywords:['Shopify'],location:'pakistan'});assert.equal(calls,1);assert.equal(second.sources[0].status,'error');assert.equal(second.sources[0].cached,true);assert.ok(!JSON.stringify(second).includes('private upstream'));
 for(const response of [()=>Response.json({success:false,error:key}),()=>new Response('{}',{headers:{'content-length':String(4*1024*1024+1)}}),()=>Response.json({data:{jobs:[row(1)]}})]){
  const invalid=createRozeeSearch({getConfig:config,now:()=>clock,fetch:async()=>response()});const result=await invalid({keywords:['WordPress'],location:'pakistan'});assert.equal(result.jobs.length,0);assert.equal(result.sources[0].status,'error');assert.ok(!JSON.stringify(result).includes(key));
 }
});

test('API.SH upstream blocks are distinguished from key or quota problems without leaking response text',async()=>{
 const result=await createRozeeSearch({getConfig:config,now:()=>clock,fetch:async()=>Response.json({success:false,error:'the source site blocked this request',credits_used:0},{status:502})})({keywords:['WordPress'],location:'pakistan'});
 assert.match(result.sources[0].message,/HTTP 502/);assert.match(result.sources[0].message,/blocked|unavailable/i);assert.equal(result.jobs.length,0);
});
