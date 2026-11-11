import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdditionalSearch} from '../lib/additional-job-search.mjs';
import {selectSearchJobs} from '../public/job-results.js';
const now=Date.UTC(2026,10,10),primary='primary-token-12345678',backup='backup-token-12345678';
const config=()=>({provider:'jsearch',enabled:true,apiKey:primary,fallbackEnabled:true,fallbackApiKey:backup,dailyLimitReached:false,primaryLimitReached:false,backupLimitReached:false});
const free=u=>new Response(u.includes('remoteok')?'[]':'<rss><channel></channel></rss>');
test('each keyword is searched independently without OR or publisher clauses and cache is shared',async()=>{
 const urls=[];const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async u=>{urls.push(new URL(u));return u.includes('openwebninja')?new Response('{"status":"OK","data":{"jobs":[]}}'):free(u);}});
 const result=await search({keywords:['WordPress developer','Shopify developer'],location:'pakistan-remote'}),queries=urls.filter(u=>u.hostname==='api.openwebninja.com');assert.equal(queries.length,4);
 assert.ok(queries.every(u=>!u.searchParams.get('query').includes(' OR ')&&!u.searchParams.get('query').includes(' via ')));
 assert.equal(queries.filter(u=>u.searchParams.get('query').startsWith('WordPress developer')).length,2);
 assert.equal(queries.filter(u=>u.searchParams.get('query').startsWith('Shopify developer')).length,2);
 const status=result.sources.find(s=>s.name==='JSearch');assert.equal(status.fetchedAt,new Date(now).toISOString());assert.equal(status.nextRefreshAt,new Date(now+3600000).toISOString());
 await search({keywords:['Shopify developer','WordPress developer'],location:'pakistan-remote'});assert.equal(urls.filter(u=>u.hostname==='api.openwebninja.com').length,4);
});
test('simple queries retain actual Indeed and LinkedIn results that restrictive queries lose',async()=>{
 const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async raw=>{const u=new URL(raw);if(!raw.includes('openwebninja'))return free(raw);const q=u.searchParams.get('query'),source=q.startsWith('Shopify')?'linkedin.com':'pk.indeed.com';return new Response(JSON.stringify({status:'OK',data:{jobs:/ OR | via /.test(q)?[]:[{job_title:q.startsWith('Shopify')?'Shopify Developer':'WordPress Developer',employer_name:'Fixture company',job_country:'PK',job_location:'Pakistan',job_is_remote:false,job_description:'Develop CMS websites',job_posted_at_datetime_utc:new Date(now-86400000).toISOString(),job_apply_link:'https://'+source+'/jobs/example'}]}}));}});
 const result=await search({keywords:['WordPress developer','Shopify developer'],location:'pakistan'});assert.deepEqual(new Set(result.jobs.map(j=>j.source)),new Set(['Indeed','LinkedIn']));
});
test('preferred order gives Indeed and LinkedIn priority, then Rozee/Bayt before a large Himalayas group',()=>{
 const make=(id,source)=>({id,source,posted:new Date(now-1000).toISOString()}),jobs=[...Array.from({length:30},(_,i)=>make('h'+i,'Himalayas')),...Array.from({length:3},(_,i)=>make('i'+i,'Indeed')),...Array.from({length:3},(_,i)=>make('l'+i,'LinkedIn')),make('r','Rozee.pk'),make('b','Bayt')];
 const first=selectSearchJobs(jobs,{now,sort:'preferred'}).slice(0,5).map(j=>j.source);assert.deepEqual(first,['Indeed','LinkedIn','Rozee.pk','Bayt','Himalayas']);
});
test('SearchApi backup handles primary quota using its own bearer key and normalizes real publisher links',async()=>{
 const requested=[],routes=[];const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:route=>{routes.push(route);return true;},fetch:async(u,o)=>{requested.push({url:new URL(u),headers:o.headers});if(u.includes('openwebninja'))return new Response('{}',{status:429});if(u.includes('searchapi.io'))return new Response(JSON.stringify({jobs:[{title:'WordPress Developer',company_name:'Backup Co',location:'Pakistan',description:'Build WordPress themes.',detected_extensions:{posted_at:'1 day ago',schedule:'Full-time'},apply_link:'https://pk.indeed.com/viewjob?jk=backup'}]}));return free(u);}})({keywords:['WordPress developer'],location:'pakistan'});
 assert.ok(result.jobs.some(j=>j.provider==='SearchApi'&&j.source==='Indeed'));assert.deepEqual(routes,['jsearch','searchapi']);const request=requested.find(r=>r.url.hostname==='www.searchapi.io');assert.equal(request.headers.authorization,'Bearer '+backup);assert.equal(request.url.href.includes(primary)||request.url.href.includes(backup),false);assert.equal(JSON.stringify(result).includes(backup),false);
});
test('primary monthly quota may use backup, but daily guard never bypasses user limits',async()=>{
 for(const daily of [true,false]){let requests=0;const result=await createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:()=>({...config(),dailyLimitReached:daily,primaryLimitReached:true}),reserve:route=>!daily&&route==='searchapi',fetch:async u=>{if(u.includes('searchapi.io')){requests++;return new Response('{"jobs":[]}');}if(u.includes('openwebninja'))throw Error('Must not call exhausted primary');return free(u);}})({keywords:['WordPress developer'],location:'pakistan'});assert.equal(requests,daily?0:1);assert.ok(result.sources.some(s=>s.name==='JSearch'&&s.status==='limited'));}
});

test('JSearch follows up to three cursor pages, accounting for each request and caching each page',async()=>{
 const urls=[];let reservations=0;const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:()=>({...config(),fallbackEnabled:false}),reserve:()=>{reservations++;return true;},fetch:async raw=>{if(!raw.includes('openwebninja'))return free(raw);const u=new URL(raw);urls.push(u);const cursor=u.searchParams.get('cursor'),page=cursor==='two'?2:cursor==='three'?3:1;return new Response(JSON.stringify({status:'OK',data:{cursor:page===1?'two':page===2?'three':'four',jobs:[{job_title:'WordPress Developer',employer_name:'Page '+page,job_country:'PK',job_location:'Pakistan',job_description:'WordPress websites',job_posted_at_datetime_utc:new Date(now-86400000).toISOString(),job_apply_link:'https://'+(page===2?'www.linkedin.com':'pk.indeed.com')+'/jobs/'+page}]}}));}});
 const result=await search({keywords:['WordPress developer'],location:'pakistan'});assert.equal(result.jobs.length,3);assert.equal(reservations,3);assert.deepEqual(urls.map(u=>u.searchParams.get('cursor')),[null,'two','three']);
 await search({keywords:['WordPress developer'],location:'pakistan'});assert.equal(reservations,3);assert.equal(urls.length,3);
});
test('a later-page provider failure retains earlier real jobs and reports incomplete availability',async()=>{
 const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:()=>({...config(),fallbackEnabled:false}),reserve:()=>true,fetch:async raw=>{if(!raw.includes('openwebninja'))return free(raw);if(new URL(raw).searchParams.has('cursor'))return new Response('{}',{status:429});return new Response(JSON.stringify({status:'OK',data:{cursor:'next',jobs:[{job_title:'WordPress Developer',employer_name:'First page',job_country:'PK',job_location:'Pakistan',job_posted_at_datetime_utc:new Date(now-86400000).toISOString(),job_apply_link:'https://pk.indeed.com/jobs/first'}]}}));}});
 const result=await search({keywords:['WordPress developer'],location:'pakistan'});assert.equal(result.jobs.length,1);assert.equal(result.sources.find(s=>s.name==='JSearch').status,'error');
});
test('repeated cursor stops pagination without looping',async()=>{
 let count=0;const search=createAdditionalSearch({expandRoleVariants:false,now:()=>now,getConfig:config,reserve:()=>true,fetch:async raw=>{if(!raw.includes('openwebninja'))return free(raw);count++;return new Response(JSON.stringify({status:'OK',data:{cursor:'same',jobs:[{job_title:'WordPress Developer',employer_name:'Co',job_country:'PK',job_location:'Pakistan',job_posted_at_datetime_utc:new Date(now-86400000).toISOString(),job_apply_link:'https://www.linkedin.com/jobs/one'}]}}));}});await search({keywords:['WordPress developer'],location:'pakistan'});assert.equal(count,2);
});

test('platform variants add genuine extra publisher jobs while retaining keyword relevance',async()=>{
 const queries=[];const search=createAdditionalSearch({now:()=>now,getConfig:config,reserve:()=>true,fetch:async raw=>{if(!raw.includes('openwebninja'))return free(raw);const q=new URL(raw).searchParams.get('query');queries.push(q);const extra=q.startsWith('Shopify jobs');return Response.json({status:'OK',data:{cursor:extra?'do-not-follow-variant':null,jobs:[{job_title:'Shopify Developer',employer_name:extra?'Extra Indeed employer':'Original employer',job_country:'PK',job_location:'Pakistan',job_posted_at_datetime_utc:new Date(now-86400000).toISOString(),job_apply_link:'https://pk.indeed.com/jobs/'+(extra?'extra':'original')}]}});}});
 const result=await search({keywords:['Shopify developer'],location:'pakistan'});assert.deepEqual(queries,['Shopify developer jobs in Pakistan','Shopify jobs in Pakistan']);assert.equal(result.jobs.length,2);assert.equal(result.jobs.every(j=>j.source==='Indeed'),true);
});
