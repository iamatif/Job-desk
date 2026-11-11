import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdditionalSearch} from '../lib/additional-job-search.mjs';
const now=Date.UTC(2026,10,10);
const remote=(extra={})=>({position:'WordPress Developer',company:'Remote Co',location:'Worldwide',description:'Build WordPress websites',url:'https://remoteok.com/remote-jobs/123',date:'2026-11-09',tags:['wordpress'],...extra});
const rss='<rss><channel><item><title><![CDATA[Web Co: Shopify Developer]]></title><link>https://weworkremotely.com/remote-jobs/web-co-shopify</link><region>Anywhere in the World</region><type>Contract</type><description><![CDATA[<p>Build Shopify &amp; Liquid themes</p>]]></description></item></channel></rss>';
const fixture=async url=>new Response(url.includes('remoteok')?JSON.stringify([{legal:'terms'},remote()]):rss);
test('public remote sources normalize records, retain attribution and cache across keyword searches',async()=>{
 const urls=[];const search=createAdditionalSearch({fetch:async u=>{urls.push(u);return fixture(u);},now:()=>now});
 const result=await search({keywords:['Shopify developer','WordPress developer'],location:'pakistan-remote'});
 assert.ok(result.jobs.some(j=>j.source==='Remote OK'));assert.ok(result.jobs.some(j=>j.source==='We Work Remotely'));assert.equal(result.jobs.every(j=>!j.description.includes('<')&&!j.experienceKnown),true);assert.equal(result.sources.find(s=>s.name==='JSearch').status,'setup');
 await search({keywords:['Shopify developer'],location:'remote-worldwide'});assert.equal(urls.length,2);
});
test('worldwide remote rejects explicit country-only jobs and labels unknown geography',async()=>{
 const search=createAdditionalSearch({now:()=>now,fetch:async u=>u.includes('remoteok')?new Response(JSON.stringify([remote({company:'US Only',description:'Must be authorized to work in the United States.'}),remote({company:'Unknown',location:'',description:'Build WordPress websites'}),remote({company:'Germany',location:'Germany'})])):new Response('<rss><channel></channel></rss>')});
 const result=await search({keywords:['WordPress'],location:'remote-worldwide'});assert.deepEqual(result.jobs.map(j=>j.company),['Unknown']);assert.match(result.jobs[0].eligibility,/not specified/i);
});
test('feed failures, oversized data and XML entity declarations cannot fabricate jobs',async()=>{
 for(const fetch of [async()=>new Response('bad',{headers:{'content-length':'9000000'}}),async u=>u.includes('remoteok')?new Response('{}'):new Response('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss><channel></channel></rss>')]){
 const result=await createAdditionalSearch({fetch,now:()=>now})({keywords:['WordPress'],location:'remote-worldwide'});assert.equal(result.jobs.length,0);assert.equal(result.sources.filter(s=>s.status==='error').length,2);}
});
test('candidate residency overrides worldwide labels while employer headquarters do not restrict applicants',async()=>{
 const search=createAdditionalSearch({now:()=>now,fetch:async u=>u.includes('remoteok')?new Response(JSON.stringify([remote({company:'Restricted',description:'Candidates must be located in the United States. Build WordPress themes.'}),remote({company:'Global employer',description:'We are a US-based company hiring worldwide. Build WordPress themes.',url:'https://remoteok.com/remote-jobs/124'})])):new Response('<rss><channel></channel></rss>')});
 const result=await search({keywords:['WordPress'],location:'remote-worldwide'});assert.deepEqual(result.jobs.map(j=>j.company),['Global employer']);
});
test('Remote OK timeouts are source-specific and never cause retries through access-denied responses',async()=>{
 let calls=0;const failed=await createAdditionalSearch({now:()=>now,fetch:async u=>{if(u.includes('remoteok')){calls++;throw new DOMException('request timed out','TimeoutError');}return new Response(rss);}})({keywords:['Shopify developer'],location:'remote-worldwide'});
 assert.equal(failed.sources.find(s=>s.name==='Remote OK').reason,'timeout');assert.match(failed.sources.find(s=>s.name==='Remote OK').message,/Remote OK.*timed out/i);assert.ok(failed.jobs.length);assert.equal(calls,1);
 calls=0;await createAdditionalSearch({now:()=>now,fetch:async u=>{if(u.includes('remoteok')){calls++;return new Response('access denied',{status:403});}return new Response(rss);}})({keywords:['Shopify'],location:'remote-worldwide'});assert.equal(calls,1);
});

test('aborting a backup search stops queued provider requests before quota reservation',async()=>{const controller=new AbortController();let reserved=0,calls=0;const search=createAdditionalSearch({getConfig:()=>({provider:'jsearch',apiKey:'test-api-key-123456789',enabled:true}),reserve:()=>{reserved++;return true;},fetch:async(url,options)=>{calls++;controller.abort();if(options.signal.aborted)throw new DOMException('Aborted','AbortError');return new Response('[]');}});const result=await search({keywords:['WordPress developer','Shopify developer','CMS developer','Wix developer'],location:'pakistan-remote',signal:controller.signal});assert.ok(reserved<=1);assert.ok(calls<=3);assert.equal(result.jobs.length,0);});
