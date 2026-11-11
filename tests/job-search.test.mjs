import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJobSearch} from '../lib/job-search.mjs';

const now=Date.UTC(2026,10,10);
const him=(extra={})=>({title:'WordPress Developer',companyName:'Acme',descriptionHTML:'<p>Build WordPress &amp; PHP websites.</p><script>bad()</script>',categories:['PHP'],locationRestrictions:[],timezoneRestrictions:[],employmentType:'Full Time',applicationLink:'https://acme.test/apply',guid:'https://himalayas.app/companies/acme/jobs/wp',pubDate:now/1000-100,expiryDate:now/1000+86400,...extra});
const fixture=async url=>new Response(JSON.stringify(url.includes('himalayas')?{jobs:[him()]}:{jobs:[{id:12,jobTitle:'WordPress Developer',companyName:'Acme',jobDescription:'WordPress websites',jobGeo:'Anywhere',url:'https://jobicy.com/jobs/12',pubDate:'2026-11-09'}]}));
test('real feed records become safe plain jobs, deduplicated with unknown experience',async()=>{
 const search=createJobSearch({expanded:false,fetch:fixture,now:()=>now});const r=await search({keywords:['WordPress'],location:'pakistan-remote'});
 assert.equal(r.jobs.length,1);assert.equal(r.jobs[0].experienceKnown,false);assert.equal(r.jobs[0].years,0);assert.equal(r.jobs[0].sample,false);assert.equal(r.jobs[0].description.includes('<'),false);assert.equal(r.jobs[0].description.includes('bad()'),false);assert.match(r.jobs[0].description,/& PHP/);assert.equal(r.jobs[0].url,'https://acme.test/apply');assert.deepEqual(r.jobs[0].matchedKeywords,['WordPress']);assert.equal(r.sources.every(s=>s.status==='ok'),true);
 assert.ok(r.jobs[0].skills.includes('WordPress'));assert.ok(r.jobs[0].skills.includes('PHP'));
});
test('unsafe, expired and geographically ineligible records are omitted',async()=>{
 const search=createJobSearch({expanded:false,now:()=>now,fetch:async url=>new Response(JSON.stringify(url.includes('himalayas')?{jobs:[him({expiryDate:now/1000-1}),him({applicationLink:'javascript:alert(1)'}),him({locationRestrictions:['United States']}),him({timezoneRestrictions:['America/New_York']})]}:{jobs:[{jobTitle:'WordPress Developer',companyName:'US',jobDescription:'WordPress',jobGeo:'USA',url:'https://jobicy.com/jobs/1'}]}))});
 assert.deepEqual((await search({keywords:['WordPress']})).jobs,[]);
});
test('cache coalesces requests and expires per provider without inventing failed results',async()=>{
 let calls=0,clock=now;const search=createJobSearch({expanded:false,now:()=>clock,fetch:async url=>{calls++;await new Promise(r=>setTimeout(r,5));return fixture(url);}});
 await Promise.all([search({keywords:['WordPress']}),search({keywords:['WordPress']})]);assert.equal(calls,2);
 assert.equal((await search({keywords:['WordPress']})).sources.every(s=>s.cached),true);
 clock+=3600001;await search({keywords:['WordPress']});assert.equal(calls,3);
 const failed=await createJobSearch({expanded:false,fetch:async()=>{throw Error('offline');}})({keywords:['WordPress']});assert.deepEqual(failed.jobs,[]);assert.equal(failed.sources.every(s=>s.status==='error'),true);
});
test('query bounds and explicit geographical parameters are enforced',async()=>{
 const urls=[];const search=createJobSearch({expanded:false,fetch:async u=>{urls.push(new URL(u));return new Response('{"jobs":[]}');}});
 await assert.rejects(search({keywords:[]}));await assert.rejects(search({keywords:Array.from({length:8},(_,i)=>'role '+i)}));await assert.rejects(search({keywords:['WordPress'],location:'elsewhere'}));
 await search({keywords:['WordPress'],location:'pakistan'});assert.equal(urls.find(u=>u.hostname==='himalayas.app').searchParams.get('exclude_worldwide'),'true');
 await search({keywords:['WordPress'],location:'remote-worldwide'});assert.equal(urls.at(-2).searchParams.get('worldwide'),'true');
});
test('numeric timezone offsets must include Pakistan and expired cached jobs disappear',async()=>{
 let clock=now;const search=createJobSearch({expanded:false,now:()=>clock,fetch:async url=>new Response(JSON.stringify(url.includes('himalayas')?{jobs:[him({companyName:'Compatible',timezoneRestrictions:[-8,0,5,5.5],expiryDate:now/1000+10}),him({companyName:'Incompatible',timezoneRestrictions:[-8,0,5.5]})]}:{jobs:[]}))});
 let result=await search({keywords:['WordPress']});assert.deepEqual(result.jobs.map(j=>j.company),['Compatible']);clock+=11000;result=await search({keywords:['WordPress']});assert.deepEqual(result.jobs,[]);assert.equal(result.sources.every(s=>s.cached),true);
});
test('partial errors are visible and malformed oversized feeds never become fabricated jobs',async()=>{
 const search=createJobSearch({expanded:false,now:()=>now,fetch:async url=>url.includes('himalayas')?new Response(JSON.stringify({jobs:[him()]})):new Response('x',{headers:{'content-length':String(5*1024*1024)}})});
 const result=await search({keywords:['WordPress']});assert.equal(result.jobs.length,1);assert.deepEqual(result.sources.map(s=>s.status),['ok','error']);assert.match(result.sources[1].message,/invalid feed/);
});
test('pool bounds concurrent network requests and title relevance ranks results',async()=>{
 let active=0,maximum=0;const search=createJobSearch({expanded:false,now:()=>now,fetch:async url=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return new Response(JSON.stringify({jobs:url.includes('himalayas')?[him({title:'Web Developer',companyName:'Body match',guid:'https://himalayas.app/companies/body/jobs/web'}),him({companyName:'Title match'})]:[]}));}});
 const result=await search({keywords:['WordPress','PHP','CMS','web','developer','JavaScript','Elementor']});assert.equal(maximum,3);assert.equal(result.jobs[0].company,'Title match');assert.equal(result.jobs.length,2);
});
test('Jobicy searches the specialism so role variants can match',async()=>{
 const urls=[];const search=createJobSearch({expanded:false,now:()=>now,fetch:async url=>{urls.push(new URL(url));return new Response(JSON.stringify({jobs:url.includes('jobicy')?[{jobTitle:'Senior Shopify Engineer',companyName:'Store Co',jobDescription:'Build Shopify themes',jobGeo:'Anywhere',url:'https://jobicy.com/jobs/123',pubDate:'2026-11-09'}]:[]}));}});
 const result=await search({keywords:['Shopify developer']});assert.equal(urls.find(u=>u.hostname==='jobicy.com').searchParams.get('tag'),'Shopify');assert.equal(result.jobs.length,1);
});
test('explicit US-based title is excluded for Pakistan while US working hours are allowed',async()=>{
 const search=createJobSearch({expanded:false,now:()=>now,fetch:async url=>new Response(JSON.stringify({jobs:url.includes('himalayas')?[him({title:'WordPress Developer (U.S. Based, Remote Contractor)',companyName:'US only'}),him({title:'WordPress Developer - US working hours',companyName:'Pakistan friendly',guid:'https://himalayas.app/companies/remote/jobs/wp'})]:[]}))});
 const result=await search({keywords:['WordPress developer']});assert.deepEqual(result.jobs.map(j=>j.company),['Pakistan friendly']);
});
test('server only returns dated jobs from the last30 days, including when cached records age out',async()=>{
 let clock=now;const search=createJobSearch({expanded:false,now:()=>clock,fetch:async u=>new Response(JSON.stringify({jobs:u.includes('himalayas')?[['Fresh',now/1000-100],['Old',now/1000-31*86400],['Unknown',null],['Future',now/1000+86400]].map(([companyName,pubDate])=>him({companyName,pubDate,guid:'https://himalayas.app/companies/'+companyName+'/jobs/wp',expiryDate:now/1000+365*86400})):[]}))});
 assert.deepEqual((await search({keywords:['WordPress']})).jobs.map(j=>j.company),['Fresh']);clock+=32*86400000;assert.deepEqual((await search({keywords:['WordPress']})).jobs,[]);
});
