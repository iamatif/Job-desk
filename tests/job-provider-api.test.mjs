import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJobdeskServer} from '../server.mjs';

test('only installation owner can manage provider key; search uses it without leaking it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-provider-api-')),secret='c'.repeat(64),rozeeSecret='ash_live_'+ 'r'.repeat(32),urls=[];let receivedKey='',receivedRozeeKey='';
 const app=createJobdeskServer({dataDir:dir,port:0,testMode:true,jobSearchFetch:async (url,options)=>{urls.push(new URL(url));if(url.includes('api.api.sh')){receivedRozeeKey=options.headers['x-api-key'];return new Response(JSON.stringify({jobs:[{title:'Shopify Developer',company:'Rozee API Store',city:'Lahore',description:'Build Shopify themes.',posted_at:new Date().toISOString(),url:'https://www.rozee.pk/shopify-developer-jobs-123'}],next_page:null}));}if(url.includes('openwebninja'))receivedKey=options.headers['x-api-key'];return new Response(url.includes('openwebninja')?JSON.stringify({status:'OK',data:{jobs:[{job_title:'Shopify Developer',employer_name:'API Store',job_location:'Worldwide',job_description:'Build Shopify Liquid themes',job_is_remote:true,job_posted_at_datetime_utc:new Date().toISOString(),job_apply_link:'https://pk.indeed.com/viewjob?jk=123'}]}}):url.includes('remoteok')?'[]':url.includes('weworkremotely')?'<rss><channel></channel></rss>':'{"jobs":[]}');}});
 try{await app.start();const base=`http://localhost:${app.port}`;const req=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await req('/api/account/job-search')).status,401);
 async function signup(email){const response=await req('/api/auth/signup','POST',{name:'Test User',email,password:'Safe Test Password 1234!'});const cookie=response.headers.get('set-cookie').split(';')[0],me=await (await req('/api/auth/me','GET',null,{cookie})).json();return {cookie,'x-csrf-token':me.csrf};}
 const owner=await signup('owner@example.test'),other=await signup('other@example.test'),settings={provider:'jsearch',apiKey:secret,enabled:true,dailyLimit:4,rozeeApiKey:rozeeSecret,rozeeEnabled:true};
 assert.equal((await req('/api/account/job-search','PUT',settings,{cookie:owner.cookie})).status,403);assert.equal((await req('/api/account/job-search','PUT',settings,other)).status,403);
 const saved=await req('/api/account/job-search','PUT',settings,owner);assert.equal(saved.status,200);const status=await saved.json();assert.equal(status.configured,true);assert.equal(JSON.stringify(status).includes(secret),false);
 const otherStatus=await (await req('/api/account/job-search','GET',null,other)).json();assert.equal(otherStatus.canManage,false);assert.equal(JSON.stringify(otherStatus).includes(secret),false);
 const response=await req('/api/jobs/search','POST',{keywords:['Shopify developer'],location:'pakistan-remote'},other);assert.equal(response.status,200);const result=await response.json();assert.ok(result.jobs.some(j=>j.source==='Indeed'&&j.provider==='JSearch'));assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(result.sources.length,7);assert.equal(receivedKey,secret);assert.equal(receivedRozeeKey,rozeeSecret);assert.ok(result.jobs.some(j=>j.source==='Rozee.pk'&&j.provider==='API.SH'));assert.equal(JSON.stringify(result).includes(rozeeSecret),false);assert.equal(JSON.stringify(status).includes(rozeeSecret),false);assert.equal(JSON.stringify(otherStatus).includes(rozeeSecret),false);assert.equal(urls.some(u=>u.href.includes(rozeeSecret)),false);assert.equal(urls.some(u=>u.href.includes(secret)),false);
 assert.equal((await req('/api/account/job-search','GET',null,owner)).status,200);assert.equal((await req('/data/job-search-provider.json')).status,404);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
