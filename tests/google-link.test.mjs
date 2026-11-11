import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createJobdeskServer} from '../server.mjs';
const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const clientId='link-fixture.apps.googleusercontent.com', password='Link fixture password 2026!';
const jwk={...publicKey.export({format:'jwk'}),kid:'link-test',alg:'RS256'};
function token(nonce, sub, email){const now=Math.floor(Date.now()/1000);const parts=[{alg:'RS256',kid:'link-test'},{iss:'https://accounts.google.com',aud:clientId,sub,email,email_verified:true,name:'Google name',nonce,iat:now,exp:now+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url'));return [...parts,sign('RSA-SHA256',Buffer.from(parts.join('.')),privateKey).toString('base64url')].join('.');}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-link-'));let identity={sub:'first-google',email:'different@example.test'},nonce='',invalidClient=false,exchanges=0,tokenGate=null;
 const app=createJobdeskServer({dataDir:dir,port:0,testMode:true,googleFetch:async url=>{if(url.endsWith('/token')){exchanges++;if(tokenGate){tokenGate.enter();await tokenGate.wait;}return invalidClient?Response.json({error:'invalid_client',error_description:'DO NOT EXPOSE'},{status:401}):Response.json({id_token:token(nonce,identity.sub,identity.email)});}return Response.json({keys:[jwk]});}});
 await app.start();const db=new DatabaseSync(join(dir,'jobdesk.sqlite'));
 t.after(async()=>{db.close();await app.close();await rm(dir,{recursive:true,force:true});});
 const base=`http://localhost:${app.port}`;
 const call=(path,method='GET',body,cookie='',csrf='')=>fetch(base+path,{method,redirect:'manual',headers:{origin:base,'content-type':'application/json',cookie,'x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 const signup=async email=>{const r=await call('/api/auth/signup','POST',{name:'Local name',email,password});const cookie=r.headers.get('set-cookie').split(';')[0];const me=await(await call('/api/auth/me','GET',undefined,cookie)).json();return {cookie,...me};};
 const owner=await signup('local@example.test');assert.equal((await call('/api/account/google','POST',{clientId,clientSecret:'test-only'},owner.cookie,owner.csrf)).status,200);
 const grant=async user=>{assert.equal((await call('/api/account/google/connect','POST',{password},user.cookie,user.csrf)).status,200);};
 const start=async user=>{const r=await call('/auth/google','GET',undefined,user?.cookie);const u=new URL(r.headers.get('location'));nonce=u.searchParams.get('nonce');return {state:u.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};};
 const finish=(flow,user,extra='code=test')=>call(`/auth/google/callback?state=${flow.state}&${extra}`,'GET',undefined,[user?.cookie,flow.cookie].filter(Boolean).join('; '));
 return {db,call,owner,signup,grant,start,finish,setIdentity:value=>identity=value,setInvalid:value=>invalidClient=value,exchanges:()=>exchanges,pauseToken:()=>{let enter,release;const entered=new Promise(resolve=>enter=resolve),wait=new Promise(resolve=>release=resolve);tokenGate={enter,wait};return {entered,release};}};
}
test('different Google email preserves local identity, workspace and CV, and both sign-in methods work',async t=>{
 const f=await fixture(t),{owner,db}=f;const workspace=JSON.stringify({profile:{name:'Keep me'},jobs:[{id:'saved-job'}]});
 db.prepare('INSERT INTO workspaces(user_id,content,updated_at) VALUES(?,?,?)').run(owner.user.id,workspace,Date.now());
 db.prepare('INSERT INTO cv_documents VALUES(?,?,?,?,?)').run(owner.user.id,'fixture.txt','text/plain',Buffer.from('fixture CV'),'2026-11-10');
 await f.grant(owner);assert.equal((await f.finish(await f.start(owner),owner)).headers.get('location'),'/');
 const stored=db.prepare('SELECT name,email,google_sub FROM users WHERE id=?').get(owner.user.id);assert.equal(stored.name,'Local name');assert.equal(stored.email,'local@example.test');assert.equal(stored.google_sub,'first-google');
 assert.equal(db.prepare('SELECT content FROM workspaces WHERE user_id=?').get(owner.user.id).content,workspace);assert.equal(Buffer.from(db.prepare('SELECT content FROM cv_documents WHERE user_id=?').get(owner.user.id).content).toString(),'fixture CV');
 assert.equal((await f.call('/api/auth/login','POST',{email:'local@example.test',password})).status,200);
 const r=await f.finish(await f.start());assert.equal(r.headers.get('location'),'/');const cookie=r.headers.getSetCookie().find(s=>s.startsWith('jobdesk_session=')).split(';')[0];assert.equal((await(await f.call('/api/auth/me','GET',undefined,cookie)).json()).user.id,owner.user.id);
});
test('link authorization expires, is session-specific, and rejects a callback from a second session',async t=>{
 const f=await fixture(t);await f.grant(f.owner);f.db.prepare('UPDATE sessions SET google_link_until=1').run();assert.equal((await f.call('/auth/google','GET',undefined,f.owner.cookie)).headers.get('location'),'/?error=google-reauth-required');
 await f.grant(f.owner);const flow=await f.start(f.owner);const second=await f.call('/api/auth/login','POST',{email:'local@example.test',password});const otherSession={cookie:second.headers.get('set-cookie').split(';')[0]};assert.equal((await f.finish(flow,otherSession)).headers.get('location'),'/?error=google-link-expired');assert.equal(f.exchanges(),0);
 await f.grant(f.owner);const expired=await f.start(f.owner);f.db.prepare('UPDATE oauth_flows SET expires_at=1').run();assert.equal((await f.finish(expired,f.owner)).headers.get('location'),'/?error=google-link-expired');
});
test('an existing Google subject cannot be merged into another local account',async t=>{
 const f=await fixture(t);await f.grant(f.owner);assert.equal((await f.finish(await f.start(f.owner),f.owner)).headers.get('location'),'/');const other=await f.signup('other@example.test');await f.grant(other);assert.equal((await f.finish(await f.start(other),other)).headers.get('location'),'/?error=google-linked-elsewhere');assert.equal(f.db.prepare('SELECT google_sub FROM users WHERE id=?').get(other.user.id).google_sub,null);
});
test('Google-only sessions cannot silently switch Google subjects',async t=>{
 const f=await fixture(t);const login=await f.finish(await f.start());const cookie=login.headers.getSetCookie().find(s=>s.startsWith('jobdesk_session=')).split(';')[0];f.setIdentity({sub:'other-sub',email:'other-google@example.test'});assert.equal((await f.finish(await f.start({cookie}),{cookie})).headers.get('location'),'/?error=google-email-mismatch');
});
test('Google client rejection and declined consent have specific safe errors',async t=>{
 const f=await fixture(t);f.setInvalid(true);await f.grant(f.owner);assert.equal((await f.finish(await f.start(f.owner),f.owner)).headers.get('location'),'/?error=google-invalid-client');await f.grant(f.owner);assert.equal((await f.finish(await f.start(f.owner),f.owner,'error=access_denied')).headers.get('location'),'/?error=google-denied');assert.equal(f.exchanges(),1);
});

test('logout during Google token exchange revokes the pending link without issuing a session',async t=>{
 const f=await fixture(t);await f.grant(f.owner);const flow=await f.start(f.owner),gate=f.pauseToken();const pending=f.finish(flow,f.owner);
 await gate.entered;
 try { assert.equal((await f.call('/api/auth/logout','POST',{},f.owner.cookie,f.owner.csrf)).status,200); }
 finally { gate.release(); }
 const result=await pending;assert.equal(result.headers.get('location'),'/?error=google-link-expired');
 assert.equal(result.headers.getSetCookie().some(value=>value.startsWith('jobdesk_session=')),false);
 assert.equal(f.db.prepare('SELECT google_sub FROM users WHERE id=?').get(f.owner.user.id).google_sub,null);
 assert.equal(f.db.prepare('SELECT count(*) AS total FROM sessions WHERE user_id=?').get(f.owner.user.id).total,0);
});
