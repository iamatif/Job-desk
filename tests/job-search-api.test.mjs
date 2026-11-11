import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJobdeskServer} from '../server.mjs';
test('search API requires authentication, CSRF and bounded input, returning honest provider results',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-search-'));let calls=0;const app=createJobdeskServer({dataDir:dir,port:0,testMode:true,jobSearchFetch:async()=>{calls++;return new Response('{"jobs":[]}');}});
 try{await app.start();const base=`http://localhost:${app.port}`;const post=(path,p,extra={})=>fetch(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...extra},body:JSON.stringify(p)});
 assert.equal((await post('/api/jobs/search',{keywords:['WordPress']})).status,401);
 const signup=await post('/api/auth/signup',{name:'Test',email:'search@example.test',password:'Safe Test Password 1234!'});const cookie=signup.headers.get('set-cookie').split(';')[0];const me=await (await fetch(base+'/api/auth/me',{headers:{cookie}})).json();
 assert.equal((await post('/api/jobs/search',{keywords:['WordPress']},{cookie})).status,403);
 const headers={cookie,'x-csrf-token':me.csrf};assert.equal((await post('/api/jobs/search',{keywords:[]},headers)).status,400);assert.equal((await post('/api/jobs/search',{keywords:Array.from({length:8},(_,i)=>'role '+i)},headers)).status,400);
 const result=await post('/api/jobs/search',{keywords:['WordPress']},headers);assert.equal(result.status,200);const data=await result.json();assert.deepEqual(data.jobs,[]);assert.equal(data.sources.length,7);assert.equal(calls,5);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
