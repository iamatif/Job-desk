import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJobdeskServer} from '../server.mjs';
import {SAMPLE_PROFILE,SAMPLE_JOBS} from '../public/model.js';
test('larger valid saved-job histories persist past the old2MB save limit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-large-workspace-')),app=createJobdeskServer({dataDir:dir,port:0,testMode:true});
 try{await app.start();const base=`http://localhost:${app.port}`,headers={origin:base,'content-type':'application/json'},signup=await fetch(base+'/api/auth/signup',{method:'POST',headers,body:JSON.stringify({name:'Large workspace QA',email:'large@example.test',password:'Safe Test Password 2026!'})}),cookie=signup.headers.get('set-cookie').split(';')[0],me=await(await fetch(base+'/api/auth/me',{headers:{cookie}})).json();
 const workspace={profile:SAMPLE_PROFILE,jobs:Array.from({length:200},(_,i)=>({...SAMPLE_JOBS[0],id:'job'+i,description:'A'.repeat(12000),savedAt:'2026-11-10T12:00:00.000Z'})),applications:{},activity:[{id:'event-1',jobId:'job0',type:'saved',at:'2026-11-10T12:00:00.000Z',title:'Shopify Developer',company:'QA'}]};
 const response=await fetch(base+'/api/workspace',{method:'PUT',headers:{...headers,cookie,'x-csrf-token':me.csrf,'if-match':'0'},body:JSON.stringify(workspace)});assert.equal(response.status,200);
 const loaded=await(await fetch(base+'/api/workspace',{headers:{cookie}})).json();assert.equal(loaded.workspace.jobs.length,200);assert.equal(loaded.workspace.activity.length,1);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
