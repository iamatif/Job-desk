import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdditionalSearch} from '../lib/additional-job-search.mjs';
import {createJobSearch} from '../lib/job-search.mjs';
import {selectSearchJobs} from '../public/job-results.js';

const now=Date.UTC(2026,10,10),key='own.test_key_1234567890';
const record=(extra={})=>({job_title:'Shopify Developer',employer_name:'Store Co',job_location:'Worldwide',job_country:null,job_description:'Build Shopify Liquid themes. Work from anywhere in the world.',job_is_remote:true,job_employment_type:'Full-time',job_posted_at_datetime_utc:'2026-11-09T00:00:00Z',job_apply_link:'https://www.linkedin.com/jobs/view/123',...extra});
const feed=u=>new Response(u.includes('remoteok')?'[]':'<rss><channel></channel></rss>');
const payload=jobs=>JSON.stringify({status:'OK',data:{jobs,cursor:null}});
const config=()=>({provider:'jsearch',apiKey:key,enabled:true});

test('JSearch uses v2 nested response, header-only credentials and Pakistan/remote search parameters',async()=>{
 const requests=[];const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async(u,o)=>{requests.push({url:new URL(u),headers:o.headers});return u.includes('openwebninja')?new Response(payload([record()])):feed(u);}});
 const result=await search({keywords:['Shopify developer'],location:'pakistan-remote'}),requestsToApi=requests.filter(r=>r.url.hostname==='api.openwebninja.com');assert.equal(requestsToApi.length,2);
 for(const r of requestsToApi){assert.equal(r.url.pathname,'/jsearch/search-v2');assert.equal(r.headers['x-api-key'],key);assert.equal(r.url.href.includes(key),false);assert.equal(r.url.searchParams.get('num_pages'),'1');assert.equal(r.url.searchParams.get('language'),'en');}
 assert.ok(requestsToApi.some(r=>r.url.searchParams.get('country')==='pk'&&r.url.searchParams.get('query').includes('Pakistan')));assert.ok(requestsToApi.some(r=>r.url.searchParams.get('work_from_home')==='true'));
 assert.equal(result.sources.find(s=>s.name==='JSearch').status,'ok');assert.ok(result.jobs.some(j=>j.source==='LinkedIn'&&j.provider==='JSearch'));assert.equal(JSON.stringify(result).includes(key),false);
 const count=requestsToApi.length;await search({keywords:['Shopify developer'],location:'pakistan-remote'});assert.equal(requests.filter(r=>r.url.hostname==='api.openwebninja.com').length,count);
});
test('Indeed, LinkedIn, Rozee and Bayt links retain genuine hostname attribution and safe alternatives',async()=>{
 const urls=['https://pk.indeed.com/viewjob?jk=123','https://www.linkedin.com/jobs/view/123','https://www.rozee.pk/shopify-developer-jobs-123','https://www.bayt.com/en/pakistan/jobs/shopify-123/'];
 const jobs=urls.map((url,i)=>record({employer_name:'Store '+i,job_apply_link:url,apply_options:[{apply_link:url,publisher:'Wrong label'},{apply_link:'javascript:alert(1)',publisher:'Unsafe'},{apply_link:'https://careers.example.com/job/'+i,publisher:'Company'}]}));
 const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload(jobs)):feed(u)})({keywords:['Shopify developer'],location:'remote-worldwide'});
 assert.deepEqual(result.jobs.map(j=>j.source),['Indeed','LinkedIn','Rozee.pk','Bayt']);assert.equal(result.jobs.every(j=>j.applyOptions.length===2&&j.applyOptions.every(o=>o.url.startsWith('https:'))),true);
});
test('JSearch country metadata and explicit restrictions override broad remote labels; expired roles disappear',async()=>{
 const jobs=[record({employer_name:'US country',job_country:'US'}),record({employer_name:'US text',job_description:'Candidates must be located in the United States.'}),record({employer_name:'Expired',job_offer_expiration_datetime_utc:'2026-11-09T00:00:00Z'}),record({employer_name:'Unknown',job_location:'',job_description:'Build Shopify themes.'}),record({employer_name:'Good company',job_description:'We are a US-based company hiring worldwide. Build Shopify themes.'}),record({employer_name:'Pakistan onsite',job_location:'Lahore',job_country:'PK',job_is_remote:false}),record({employer_name:'Bad URL',job_apply_link:'http://localhost/private'})];
 const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload(jobs)):feed(u)});
 const world=await search({keywords:['Shopify developer'],location:'remote-worldwide'});assert.deepEqual(world.jobs.map(j=>j.company),['Unknown','Good company']);assert.match(world.jobs[0].eligibility,/not specified/i);
 const pk=await search({keywords:['Shopify developer'],location:'pakistan'});assert.deepEqual(pk.jobs.map(j=>j.company),['Pakistan onsite']);assert.match(pk.jobs[0].location,/Pakistan/);
});
test('JSearch missing key, local limits, credentials and provider errors stay honest and secret-free',async()=>{
 for(const [getConfig,reserve,expected,upstream] of [[()=>({}),()=>true,'setup',null],[config,()=>false,'limited',null],[config,()=>true,'error',new Response('{"error":"SECRET"}',{status:401})],[config,()=>true,'error',new Response('{"error":"SECRET"}',{status:429})],[config,()=>true,'error',new Response('{"status":"ERROR","error":"SECRET"}')]]){
  let calls=0;const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig,reserve,fetch:async u=>{if(u.includes('openwebninja')){calls++;return upstream;}return feed(u);}})({keywords:['Shopify developer'],location:'remote-worldwide'});assert.equal(result.sources.find(s=>s.name==='JSearch').status,expected);assert.equal(calls,upstream?1:0);assert.equal(JSON.stringify(result).includes('SECRET'),false);
 }
});
test('JSearch validates v2 shape, ignores malformed dates, invalidates cache on rotation and coalesces requests',async()=>{
 let token=key,calls=0;const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:()=>({...config(),apiKey:token}),reserve:()=>true,fetch:async u=>{if(!u.includes('openwebninja'))return feed(u);calls++;return new Response(payload([record({job_posted_at_datetime_utc:'invalid',job_posted_at:'999999999999999999999 days ago'})]));}});
 const [result]=await Promise.all([search({keywords:['Shopify'],location:'remote-worldwide'}),search({keywords:['Shopify'],location:'remote-worldwide'})]);assert.equal(calls,1);assert.equal(result.jobs[0].posted,null);
 token='different-key-1234567890';await search({keywords:['Shopify'],location:'remote-worldwide'});assert.equal(calls,2);
 const invalid=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response('{"status":"OK","data":[]}'):feed(u)})({keywords:['Shopify'],location:'remote-worldwide'});assert.equal(invalid.sources.find(s=>s.name==='JSearch').status,'error');
});
test('duplicate jobs retain original links from all their publishers in the combined search',async()=>{
 const urls=['https://www.linkedin.com/jobs/view/123','https://pk.indeed.com/viewjob?jk=123','https://www.rozee.pk/shopify-developer-jobs-123','https://www.bayt.com/en/pakistan/jobs/shopify-123/'];
 const result=await createJobSearch({now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload(urls.map(url=>record({job_apply_link:url})))):u.includes('remoteok')?new Response('[]'):u.includes('weworkremotely')?new Response('<rss><channel></channel></rss>'):new Response('{"jobs":[]}')})({keywords:['Shopify developer'],location:'remote-worldwide'});
 assert.equal(result.jobs.length,1);assert.deepEqual(new Set(result.jobs[0].applyOptions.map(o=>o.name)),new Set(['LinkedIn','Indeed','Rozee.pk','Bayt']));
});
test('explicit UK, Colombia and only-open-to applicant restrictions cannot be labelled worldwide',async()=>{
 const descriptions=['Candidates must be based in the United Kingdom.','Applicants must be located in Colombia.','This position is only open to candidates in the United States.'];
 const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload(descriptions.map((job_description,i)=>record({employer_name:'Restricted '+i,job_description})))):feed(u)})({keywords:['Shopify developer'],location:'remote-worldwide'});
 assert.deepEqual(result.jobs,[]);
});
test('date fallback uses exact timestamps and never treats 30+ days as a known recent posting',async()=>{
 const records=[record({employer_name:'Unknown age',job_posted_at_datetime_utc:null,job_posted_at:'30+ days ago'}),record({employer_name:'Exact timestamp',job_posted_at_datetime_utc:null,job_posted_at_timestamp:now/1000-86400}),record({employer_name:'Old timestamp',job_posted_at_datetime_utc:null,job_posted_at_timestamp:now/1000-31*86400})];
 const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload(records)):feed(u)})({keywords:['Shopify developer'],location:'remote-worldwide'});
 assert.deepEqual(selectSearchJobs(result.jobs,{now}).map(j=>j.company),['Exact timestamp']);
});

test('a preferred publisher remains visible when a public feed already contains the same role',async()=>{
 const result=await createJobSearch({now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>u.includes('openwebninja')?new Response(payload([record()])):u.includes('himalayas')?new Response(JSON.stringify({jobs:[{title:'Shopify Developer',companyName:'Store Co',description:'Build Shopify Liquid themes.',locationRestrictions:[],timezoneRestrictions:[],applicationLink:'https://company.test/apply',guid:'https://himalayas.app/companies/store/jobs/dev',pubDate:now/1000-86400}]})):u.includes('remoteok')?new Response('[]'):u.includes('weworkremotely')?new Response('<rss><channel></channel></rss>'):new Response('{"jobs":[]}')})({keywords:['Shopify developer'],location:'pakistan-remote'});
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].source,'LinkedIn');assert.equal(result.jobs[0].url,'https://www.linkedin.com/jobs/view/123');assert.ok(result.jobs[0].applyOptions.some(o=>o.name==='Himalayas'));
});
