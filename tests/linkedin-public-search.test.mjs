import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLinkedInPublicSearch,parseLinkedInPublicCards} from '../lib/linkedin-public-search.mjs';
const clock=Date.UTC(2026,10,10),input={keywords:['WordPress'],location:'pakistan-remote'};
// Minimal card preserving the element/class/attribute structure of LinkedIn's observed guest HTML.
const card=(id,extra={})=>{const r={title:'WordPress &amp; PHP Developer',company:'Example Ltd',location:'Lahore, Punjab, Pakistan',url:`https://pk.linkedin.com/jobs/view/wordpress-developer-${id}?position=1&amp;trackingId=abc`,date:'2026-11-09',...extra};return `<li><div class="base-card relative base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}"><a class="base-card__full-link absolute" href="${r.url}" data-tracking-control-name="public_jobs_jserp-result_search-card"><span class="sr-only">${r.title}</span></a><h3 class="base-search-card__title">${r.title}</h3><h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/example">${r.company}</a></h4><span class="job-search-card__location">${r.location}</span><time class="job-search-card__listdate--new" datetime="${r.date}">1 day ago</time></div></li>`;};

test('observed public guest HTML card parses its genuine title, employer, location and datetime',async()=>{
 let calls=0;const html=readFileSync(new URL('./fixtures/linkedin-public-card.html',import.meta.url),'utf8');
 const search=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>new Response(++calls===1?html:'')});const result=await search(input);
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].title,'FULL STACK WORDPRESS DEVELOPER');assert.equal(result.jobs[0].company,'Quick Digital Solutions');assert.equal(result.jobs[0].location,'Karāchi, Sindh, Pakistan');assert.equal(result.jobs[0].posted,'2026-11-10T00:00:00.000Z');assert.ok(result.jobs[0].url.endsWith('-4489430743'));assert.ok(!result.jobs[0].url.includes('?'));
});

test('documented guest card yields canonical dated genuine LinkedIn jobs with two-page hourly cache',async()=>{
 const calls=[];const search=createLinkedInPublicSearch({now:()=>clock,fetch:async(url,options)=>{calls.push({url,options});return new Response(card(calls.length));}});
 const [result,parallel]=await Promise.all([search(input),search(input)]);assert.equal(result.jobs.length,2);assert.equal(calls.length,2);assert.equal(parallel.sources[0].cached,true);
 const first=result.jobs[0];assert.equal(first.url,'https://www.linkedin.com/jobs/view/wordpress-developer-1');assert.equal(first.company,'Example Ltd');assert.equal(first.title,'WordPress & PHP Developer');assert.equal(first.source,'LinkedIn');assert.equal(first.provider,'LinkedIn public');assert.equal(first.experienceKnown,false);assert.deepEqual(first.skills,['WordPress','PHP']);assert.equal(first.location,'Lahore, Punjab, Pakistan');assert.match(first.description,/original listing/);
 const url=new URL(calls[0].url);assert.equal(url.hostname,'www.linkedin.com');assert.equal(url.searchParams.get('location'),'Pakistan');assert.equal(url.searchParams.get('f_TPR'),'r2592000');assert.equal(new URL(calls[1].url).searchParams.get('start'),'1');assert.equal(calls[0].options.redirect,'error');assert.deepEqual(calls[0].options.headers,{accept:'text/html'});assert.equal(Date.parse(result.sources[0].nextRefreshAt)-clock,3600000);await search(input);assert.equal(calls.length,2);
});
test('unknown or foreign geography, missing/future/stale dates and unsafe links are excluded',async()=>{
 const html=[card(1),card(2,{location:'Lahore'}),card(3,{location:'Springfield, United States'}),card(4,{location:'Remote'}),card(5,{date:''}),card(6,{date:'2026-09-10'}),card(7,{date:'2026-11-11'}),card(8,{url:'https://linkedin.com.evil.com/jobs/view/role-8'}),card(9,{url:'javascript:alert(1)'}),card(10,{location:'Karachi, Sindh, Pakistan',title:'Shopify Developer'})].join('');
 const search=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>new Response(html)});const result=await search(input);assert.equal(result.jobs.length,3);assert.ok(result.jobs.every(job=>job.posted==='2026-11-09T00:00:00.000Z'));
});
test('empty first page skips pagination and worldwide scope makes no network calls',async()=>{
 let calls=0;const search=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>{calls++;return new Response('');}});assert.equal((await search({...input,location:'remote-worldwide'})).jobs.length,0);assert.equal(calls,0);assert.equal((await search(input)).jobs.length,0);assert.equal(calls,1);
});
test('later page denial retains available jobs, blocks queued keywords and retries only after cooldown',async()=>{
 let calls=0,time=clock;const search=createLinkedInPublicSearch({now:()=>time,fetch:async()=>++calls===1?new Response(card(1)):new Response('Access denied',{status:429})});
 const result=await search(input);assert.equal(result.jobs.length,1);assert.equal(result.sources[0].status,'error');assert.equal(calls,2);await search({keywords:['Shopify'],location:'pakistan'});assert.equal(calls,2);await search(input);assert.equal(calls,2);time+=60001;await search(input);assert.equal(calls,3);
});
test('at most two simultaneous guest requests and at most two pages per keyword',async()=>{
 let calls=0,active=0,peak=0;const search=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>{calls++;active++;peak=Math.max(active,peak);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response(card(calls));}});await search({keywords:['WordPress','Shopify','Wix'],location:'pakistan'});assert.equal(calls,6);assert.equal(peak,2);
});
test('403 halts queued keywords without changing host; oversized and unexpected HTML fail closed',async()=>{
 let calls=0;const search=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>{calls++;return new Response('Forbidden',{status:403});}});await search({keywords:['WordPress','Shopify','Wix','Squarespace','Elementor'],location:'pakistan'});assert.ok(calls<=2);await search({keywords:['PHP'],location:'pakistan'});assert.ok(calls<=2);
 for(const response of [()=>new Response('too large',{headers:{'content-length':String(2*1024*1024+1)}}),()=>new Response('<html>Sign in to continue</html>')]){const invalid=createLinkedInPublicSearch({now:()=>clock,fetch:async()=>response()});const result=await invalid(input);assert.equal(result.sources[0].status,'error');assert.equal(result.jobs.length,0);}
});
test('successful cards persist across instances and remain available on provider refusal with original timestamp',async()=>{
 let persisted,calls=0,time=clock;const options={now:()=>time,loadCache:async()=>persisted,saveCache:async(keyword,value)=>{assert.equal(keyword,'WordPress');persisted=structuredClone(value);}};
 const first=createLinkedInPublicSearch({...options,fetch:async()=>new Response(++calls===1?card(1):'')});await first(input);assert.equal(persisted.status,'ok');assert.equal(persisted.records.length,1);
 const second=createLinkedInPublicSearch({...options,fetch:async()=>{throw Error('Fresh cache should avoid network');}});assert.equal((await second(input)).sources[0].cached,true);
 time+=3600001;let denials=0;const third=createLinkedInPublicSearch({...options,fetch:async()=>{denials++;return new Response('Forbidden',{status:403});}});const fallback=await third(input);assert.equal(fallback.jobs.length,1);assert.equal(fallback.sources[0].status,'error');assert.equal(fallback.sources[0].cached,true);assert.equal(fallback.sources[0].fetchedAt,new Date(clock).toISOString());assert.equal(persisted.status,'ok');assert.equal(denials,1);assert.match(fallback.sources[0].message,/cached/i);
 time=clock+86400001;const expired=createLinkedInPublicSearch({...options,fetch:async()=>new Response('Forbidden',{status:403})});assert.equal((await expired(input)).jobs.length,0);
});
test('pure parser seeds actual cards; future or invalid cache and throwing persistence hooks are ignored',async()=>{
 const records=parseLinkedInPublicCards(card(1));assert.equal(records.length,1);assert.equal(records[0].url,'https://www.linkedin.com/jobs/view/wordpress-developer-1');
 for(const invalid of [{records,status:'ok',fetchedAt:new Date(clock+1000).toISOString(),nextRefreshAt:new Date(clock+3600000).toISOString()},{records,status:'ok',fetchedAt:'invalid',nextRefreshAt:'invalid'},{records:new Array(201).fill(records[0]),status:'ok',fetchedAt:new Date(clock).toISOString(),nextRefreshAt:new Date(clock+3600000).toISOString()}]){
  let calls=0;const search=createLinkedInPublicSearch({now:()=>clock,loadCache:()=>invalid,saveCache:()=>{throw Error('disk full');},fetch:async()=>{calls++;return new Response('');}});assert.equal((await search(input)).sources[0].status,'ok');assert.equal(calls,1);
 }
 const search=createLinkedInPublicSearch({now:()=>clock,loadCache:()=>{throw Error('unavailable');},saveCache:()=>{throw Error('unavailable');},fetch:async()=>new Response('')});assert.equal((await search(input)).sources[0].status,'ok');
});
