import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual,createPublicKey,verify} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,dirname,resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseCvText} from './lib/cv-parser.mjs';
import {extractCv,validateCvUpload} from './lib/extract-cv.mjs';
import {profileIssues} from './public/profile-data.js';
import {installationBuild} from './lib/runtime-health.mjs';
import {createJobSearch,searchPreferences} from './lib/job-search.mjs';
import {createProviderSettings} from './lib/job-provider-settings.mjs';
import {createPublicFeedCache} from './lib/public-feed-cache.mjs';
import {createBrowserJobWorker} from './lib/browser-job-worker.mjs';
import {createAdditionalSearch} from './lib/additional-job-search.mjs';
import {selectSearchJobs} from './public/job-results.js';
import {matchedKeywords} from './public/job-keywords.js';
import {createScheduledJobs,runScheduledJobs} from './lib/scheduled-jobs.mjs';
import {validWorkspaceMetadata} from './lib/workspace-metadata.mjs';
const BUILD_ID=installationBuild();

const ROOT=dirname(fileURLToPath(import.meta.url));
const scrypt=promisify(scryptCallback),DAY=86400000;
const random=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
async function passwordHash(password){const salt=randomBytes(16).toString('hex');const value=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return `${salt}:${value.toString('hex')}`;}
async function passwordMatches(password,stored){const [salt,expected]=stored.split(':');const value=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return same(value.toString('hex'),expected);}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split(/=(.*)/s)).filter(v=>v[0]).map(([k,v])=>[k,v||'']));}
const formatCookie=(name,value,seconds,secure=false)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;
function validProfile(p){return p&&text(p.name,100)&&p.name.trim()&&text(p.role,100)&&Number.isFinite(p.years)&&p.years>=0&&p.years<=50&&Array.isArray(p.skills)&&p.skills.length<=200&&p.skills.every(s=>text(s,100))&&text(p.summary,5000)&&text(p.experience,10000)&&text(p.portfolio,2000)&&typeof p.fictional==='boolean'&&profileIssues(p,{complete:false}).length===0;}
function validHttps(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
function validWorkspace(s){
 if(!s||!validProfile(s.profile)||!Array.isArray(s.jobs)||s.jobs.length>2000||!s.applications||typeof s.applications!=='object'||Array.isArray(s.applications))return false;
 if(s.searchPreferences!==undefined){try{searchPreferences(s.searchPreferences,{allowEmpty:true});}catch{return false;}}
 if(!s.jobs.every(j=>j&&text(j.id,100)&&/^[a-zA-Z0-9_-]+$/.test(j.id)&&text(j.title,160)&&j.title.trim()&&text(j.company,120)&&text(j.description,12000)&&Number.isFinite(j.years)&&j.years>=0&&j.years<=50&&text(j.location,150)&&Array.isArray(j.skills)&&j.skills.length<=200&&j.skills.every(v=>text(v,100))&&(!j.url||validHttps(j.url))))return false;
 const ids=new Set(s.jobs.map(j=>j.id));if(ids.size!==s.jobs.length||!validWorkspaceMetadata(s))return false;
 const entries=Object.entries(s.applications);return entries.length<=2000&&entries.every(([id,a])=>ids.has(id)&&a&&text(a.draft,60000)&&['Draft','Ready','Applied','Interview','Rejected','Archived'].includes(a.status)&&typeof a.reviewed==='boolean'&&(a.status!=='Ready'||a.reviewed));
}
export function verifyGoogleIdToken(token,{clientId,nonce,keys,now=Date.now()}){
 const parts=String(token).split('.');if(parts.length!==3)throw new Error('Invalid identity token');
 const header=JSON.parse(Buffer.from(parts[0],'base64url'));const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
 if(header.alg!=='RS256'||!text(header.kid,200))throw new Error('Invalid token algorithm');
 const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw new Error('Unknown signing key');
 const key=createPublicKey({key:jwk,format:'jwk'});if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),key,Buffer.from(parts[2],'base64url')))throw new Error('Invalid token signature');
 if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||(claims.azp&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!Number.isFinite(claims.iat)||claims.iat*1000>now+60000||!same(claims.nonce,nonce)||!text(claims.sub,255)||!claims.sub||claims.email_verified!==true||!emailPattern.test(cleanEmail(claims.email)))throw new Error('Invalid identity claims');
 return {sub:claims.sub,email:cleanEmail(claims.email),name:text(claims.name,100)&&claims.name.trim()?claims.name.trim():cleanEmail(claims.email).split('@')[0]};
}

export function createJobdeskServer({dataDir=join(ROOT,'data'),port=4180,host='127.0.0.1',publicOrigin='',headless=false,testMode=false,googleFetch=fetch,jobSearchFetch=fetch,browserWorkerFactory=createBrowserJobWorker,cookieName='jobdesk_session',oauthCookieName='jobdesk_oauth'}={}){
 if(publicOrigin){const origin=new URL(publicOrigin);if(origin.protocol!=='https:'||origin.origin!==publicOrigin||origin.username||origin.password)throw new Error('PUBLIC_ORIGIN must be an HTTPS origin with no path or trailing slash.');}
 const cookie=(name,value,seconds)=>formatCookie(name,value,seconds,!!publicOrigin);
 const searchLimits=new Map();
 mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(join(dataDir,'jobdesk.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT,google_sub TEXT UNIQUE,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS oauth_flows(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL,user_id TEXT);
 CREATE TABLE IF NOT EXISTS recovery(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cv_documents(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,filename TEXT NOT NULL,mime TEXT NOT NULL,content BLOB NOT NULL,uploaded_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS installation_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 db.prepare("INSERT OR IGNORE INTO installation_settings SELECT 'owner_id',id FROM users ORDER BY created_at,id LIMIT 1").run();
 if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='user_id'))db.exec('ALTER TABLE oauth_flows ADD COLUMN user_id TEXT');
 if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='google_link_until'))db.exec('ALTER TABLE sessions ADD COLUMN google_link_until INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='link_verified'))db.exec('ALTER TABLE oauth_flows ADD COLUMN link_verified INTEGER NOT NULL DEFAULT 0');
 if(!db.prepare('PRAGMA table_info(oauth_flows)').all().some(c=>c.name==='link_session_hash'))db.exec('ALTER TABLE oauth_flows ADD COLUMN link_session_hash TEXT');
 if(!db.prepare('PRAGMA table_info(workspaces)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
 const configFile=join(dataDir,'google-oauth.json');let config={clientId:process.env.GOOGLE_CLIENT_ID||'',clientSecret:process.env.GOOGLE_CLIENT_SECRET||''};
 if(existsSync(configFile)){try{config={...config,...JSON.parse(readFileSync(configFile,'utf8'))};}catch{console.error('Google configuration could not be loaded. Use Account settings to reconnect.');}}
 const googleReady=()=>!!(config.clientId&&config.clientSecret);const isOwner=id=>db.prepare("SELECT value FROM installation_settings WHERE key='owner_id'").get()?.value===id;const setOwner=id=>db.prepare("INSERT OR IGNORE INTO installation_settings VALUES('owner_id',?)").run(id);let jwks={keys:[],expires:0};const limits=new Map();
 const jobProvider=createProviderSettings({dataDir,db,env:testMode?{}:process.env});
 const searchJobs=createJobSearch({fetch:jobSearchFetch,getConfig:jobProvider.getConfig,reserve:jobProvider.reserve,linkedInCache:createPublicFeedCache({db})});
 const backupSearch=createAdditionalSearch({getConfig:()=>({...jobProvider.getConfig(),fallbackEnabled:false}),reserve:jobProvider.reserve,expandRoleVariants:false,fetch:(url,options)=>new URL(url).hostname==='api.openwebninja.com'?jobSearchFetch(url,options):Promise.resolve(new Response(url.includes('remoteok')?'[]':'<rss><channel></channel></rss>'))});
 const fetchBackup=async input=>{
  const result=await backupSearch(input),jobs=result.jobs.flatMap(job=>{const target=(job.applyOptions||[]).find(option=>['Indeed','LinkedIn'].includes(option.name));return target?[{...job,source:target.name,sourceUrl:target.url,url:target.url,matchedKeywords:matchedKeywords(job,input.keywords)}]:[];});
  return {jobs:selectSearchJobs(jobs,{period:input.days===1?'day':input.days===3?'threeDays':input.days===7?'week':input.days===14?'fortnight':'latest',sort:'preferred'}).slice(0,120),sources:result.sources.filter(source=>source.name==='JSearch')};
 };
 const scheduledJobs=createScheduledJobs({db});
 const browserWorker=browserWorkerFactory({dataDir,headless,fallbackSearch:fetchBackup,onComplete:(user,state)=>scheduledJobs.capture(user,state)});
 const server=http.createServer((req,res)=>handle(req,res).catch(error=>{if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Something went wrong. Please try again.'});else res.end();if(!error.status&&!testMode)console.error('Request failed:',error.name);}));
 const actualPort=()=>server.address()?.port||port;const base=()=>publicOrigin||`http://localhost:${actualPort()}`;
 function json(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
 function redirect(res,path){res.writeHead(302,{location:path,'cache-control':'no-store'});res.end();}
 function session(req){const token=cookies(req)[cookieName];if(!token||!/^[a-zA-Z0-9_-]{43}$/.test(token))return null;return db.prepare('SELECT s.*,u.name,u.email,u.google_sub,(u.password_hash IS NOT NULL) AS has_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token),Date.now());}
 function requireSession(req){const s=session(req);if(!s)throw new HttpError(401,'Please sign in to continue.');return s;}
 function requireCsrf(req,s){if(!same(req.headers['x-csrf-token'],s.csrf))throw new HttpError(403,'Please reload the page and try again.');}
 function issue(res,userId){const token=random(),csrf=random();db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(hash(token),userId,csrf,Date.now()+7*DAY);const previous=res.getHeader('set-cookie');res.setHeader('set-cookie',[...(previous?Array.isArray(previous)?previous:[previous]:[]),cookie(cookieName,token,7*86400)]);return csrf;}
 function rateLimit(req){const key=req.socket.remoteAddress;const now=Date.now();const entry=limits.get(key)||{count:0,until:now+15*60000};if(now>entry.until){entry.count=0;entry.until=now+15*60000;}entry.count++;limits.set(key,entry);if(entry.count>40)throw new HttpError(429,'Too many attempts. Please wait 15 minutes and try again.');}
 async function body(req,maxBytes=2*1024*1024,tooLargeMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'Send JSON data.');let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>maxBytes)throw new HttpError(413,tooLargeMessage||(maxBytes>2*1024*1024?'Choose a CV of 5 MB or smaller.':'This workspace is too large to save.'));chunks.push(c);}try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new HttpError(400,'Please check the form and try again.');}}
 async function handle(req,res){
  res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');res.setHeader('referrer-policy','no-referrer');res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const allowedHosts=new Set([`localhost:${actualPort()}`,`127.0.0.1:${actualPort()}`,...(publicOrigin?[new URL(publicOrigin).host]:[])]);if(!allowedHosts.has(req.headers.host))throw new HttpError(403,'Invalid Jobdesk host.');
  const url=new URL(req.url,base());const path=url.pathname;
  if(req.headers.host.startsWith('127.0.0.1:')&&['GET','HEAD'].includes(req.method))return redirect(res,base()+url.pathname+url.search);
  if(!['GET','HEAD','POST','PUT'].includes(req.method))throw new HttpError(405,'Method not allowed.');
  if(['POST','PUT'].includes(req.method)&&![base(),`http://127.0.0.1:${actualPort()}`].includes(req.headers.origin))throw new HttpError(403,'This request must come from your Jobdesk app.');
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{app:'jobdesk-local',version:'3.3.0',buildId:BUILD_ID,capabilities:['cv-upload','structured-profile','keyword-job-search','google-account-link','keyword-suggestions','multi-source-job-search','jsearch-provider','recent-job-filters','priority-search','workspace-history','provider-backup','rozee-apish','paginated-job-search','linkedin-public','chromium-job-worker','scheduled-job-collection','indeed-pagination','fourteen-day-feed'],pid:process.pid});
  if(path==='/api/auth/me'&&req.method==='GET'){const s=requireSession(req);return json(res,200,{user:{id:s.user_id,name:s.name,email:s.email,googleConnected:!!s.google_sub,hasPassword:!!s.has_password,isOwner:isOwner(s.user_id)},csrf:s.csrf,googleAvailable:googleReady()});}
  if(path==='/api/auth/config'&&req.method==='GET')return json(res,200,{googleAvailable:googleReady()});
  if(path==='/api/auth/signup'&&req.method==='POST'){
   rateLimit(req);const p=await body(req),email=cleanEmail(p.email);if(!text(p.name,100)||!p.name.trim()||!emailPattern.test(email)||email.length>254||!text(p.password,128)||p.password.length<12)throw new HttpError(400,'Enter your name, a valid email, and a password of 12–128 characters.');
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new HttpError(409,'An account already uses this email. Please sign in.');
   const password=await passwordHash(p.password);const userId=random();
   try{db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(userId,p.name.trim(),email,password,null,Date.now());}catch(e){if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new HttpError(409,'An account already uses this email. Please sign in.');throw e;}
   setOwner(userId);issue(res,userId);return json(res,201,{ok:true});
  }
  if(path==='/api/auth/login'&&req.method==='POST'){
   rateLimit(req);const p=await body(req);if(!text(p.password,128))throw new HttpError(401,'The email or password is incorrect.');const u=db.prepare('SELECT * FROM users WHERE email=?').get(cleanEmail(p.email));
   if(!u?.password_hash){await passwordHash('Timing equalization password');throw new HttpError(401,'The email or password is incorrect.');}if(!await passwordMatches(p.password,u.password_hash))throw new HttpError(401,'The email or password is incorrect.');issue(res,u.id);return json(res,200,{ok:true});
  }
  if(path==='/api/auth/logout'&&req.method==='POST'){const s=requireSession(req);requireCsrf(req,s);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);res.setHeader('set-cookie',cookie(cookieName,'',0));return json(res,200,{ok:true});}
  if(path==='/api/account/job-search'){
   const s=requireSession(req);
   if(req.method==='GET')return json(res,200,{...jobProvider.status(),canManage:isOwner(s.user_id)});
   if(req.method==='PUT'){requireCsrf(req,s);if(!isOwner(s.user_id))throw new HttpError(403,'Only the first account on this PC can manage the job search provider.');const p=await body(req,4096);let status;try{status=jobProvider.save(p);}catch(error){throw new HttpError(400,error.message);}return json(res,200,{...status,canManage:true});}
   throw new HttpError(405,'Method not allowed.');
  }
  if(path==='/api/browser-jobs'&&req.method==='GET'){
   const session=requireSession(req),live=browserWorker.get(session.user_id);scheduledJobs.capture(session.user_id,live);const saved=scheduledJobs.result(session.user_id);
   return json(res,200,live&&(['running','paused'].includes(live.status)||!saved||Date.parse(live.searchedAt)>Date.parse(saved.searchedAt))?live:saved||live||{status:'idle',jobs:[],sources:[]});
  }
  if(path==='/api/job-schedule'){
   const session=requireSession(req);
   if(req.method==='GET')return json(res,200,scheduledJobs.status(session.user_id));
   if(req.method==='PUT'){requireCsrf(req,session);const value=await body(req,4096);try{return json(res,200,scheduledJobs.save(session.user_id,value));}catch(error){throw new HttpError(400,error.message);}}
   throw new HttpError(405,'Method not allowed.');
  }
  if(['/api/browser-jobs/start','/api/browser-jobs/resume','/api/browser-jobs/cancel'].includes(path)){
   const session=requireSession(req);if(req.method!=='POST')throw new HttpError(405,'Method not allowed.');requireCsrf(req,session);
   if(path.endsWith('/start')){
    const value=await body(req,4096);let preferences;try{preferences=searchPreferences(value);}catch(error){throw new HttpError(400,error.message);}
    const requestedDays=value.days??14,days=Math.min(requestedDays,14);if(![1,3,7,14,30].includes(requestedDays)||value.useBackup!==undefined&&typeof value.useBackup!=='boolean')throw new HttpError(400,'Choose a valid date range and backup preference.');
    return json(res,202,await browserWorker.start(session.user_id,{...preferences,days,useBackup:value.useBackup===true,sources:value.sources}));
   }
   await body(req,4096);return json(res,200,await (path.endsWith('/resume')?browserWorker.resume(session.user_id):browserWorker.cancel(session.user_id)));
  }
  if(path==='/api/jobs/search'&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);let preferences;try{preferences=searchPreferences(await body(req,4096));}catch(error){if(error.status)throw error;throw new HttpError(400,error.message);}
   const now=Date.now(),previous=searchLimits.get(s.user_id)||0;if(now-previous<1500)throw new HttpError(429,'Please wait a moment before searching again.');searchLimits.set(s.user_id,now);if(searchLimits.size>2000)for(const [id,time] of searchLimits)if(now-time>60000)searchLimits.delete(id);
   return json(res,200,await searchJobs(preferences));
  }
  if(path==='/api/cv'&&req.method==='GET'){
   const s=requireSession(req);const row=db.prepare('SELECT filename,length(content) AS size,uploaded_at AS uploadedAt FROM cv_documents WHERE user_id=?').get(s.user_id);return json(res,200,{document:row||null});
  }
  if(path==='/api/cv/download'&&req.method==='GET'){
   const s=requireSession(req);const row=db.prepare('SELECT * FROM cv_documents WHERE user_id=?').get(s.user_id);if(!row)throw new HttpError(404,'No uploaded CV was found.');
   const fallback=row.filename.replace(/[^a-zA-Z0-9._-]/g,'_');const encoded=encodeURIComponent(row.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
   res.writeHead(200,{'content-type':row.mime,'content-length':row.content.length,'content-disposition':`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,'cache-control':'no-store'});return res.end(Buffer.from(row.content));
  }
  if(path==='/api/cv/remove'&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);db.prepare('DELETE FROM cv_documents WHERE user_id=?').run(s.user_id);return json(res,200,{ok:true,document:null});
  }
  if(['/api/cv/import','/api/cv/parse-text'].includes(path)&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);const p=await body(req,path.endsWith('/import')?7*1024*1024:2*1024*1024);let source,upload;
   if(path.endsWith('/import')){upload=validateCvUpload(p);source=await extractCv(upload.bytes,upload.type);}else source=p.text;
   let result;try{result=parseCvText(source,{now:new Date().toISOString().slice(0,10)});}catch(error){throw new HttpError(400,error.message);}
   result.profile.name||=s.name;result.profile.email||=s.email;let document=null;
   if(upload){const uploadedAt=new Date().toISOString();const mime={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain; charset=utf-8'}[upload.type];db.prepare('INSERT INTO cv_documents VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET filename=excluded.filename,mime=excluded.mime,content=excluded.content,uploaded_at=excluded.uploaded_at').run(s.user_id,upload.filename,mime,upload.bytes,uploadedAt);document={filename:upload.filename,size:upload.bytes.length,uploadedAt};}
   else document=db.prepare('SELECT filename,length(content) AS size,uploaded_at AS uploadedAt FROM cv_documents WHERE user_id=?').get(s.user_id)||null;
   return json(res,200,{...result,document});
  }
  if(path==='/api/workspace'){
   const s=requireSession(req);if(req.method==='GET'){const row=db.prepare('SELECT content,revision FROM workspaces WHERE user_id=?').get(s.user_id);return json(res,200,{workspace:row?JSON.parse(row.content):null,revision:row?.revision||0});}
   if(req.method==='PUT'){requireCsrf(req,s);const p=await body(req,16*1024*1024,'This workspace exceeds the16 MB local save limit. Download your unsaved edits before reducing it.');if(!validWorkspace(p))throw new HttpError(400,'Some workspace details are invalid. Please check your profile and jobs.');if(!/^\d{1,12}$/.test(req.headers['if-match']||''))throw new HttpError(428,'Reload your workspace before saving.');const expected=Number(req.headers['if-match']);const current=db.prepare('SELECT revision FROM workspaces WHERE user_id=?').get(s.user_id)?.revision||0;if(current!==expected)throw new HttpError(409,'This workspace changed in another window. Download your unsaved edits, then reload the latest workspace.');const revision=current+1;db.prepare('INSERT INTO workspaces(user_id,content,updated_at,revision) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at,revision=excluded.revision').run(s.user_id,JSON.stringify(p),Date.now(),revision);return json(res,200,{ok:true,revision});}
  }
  if(path==='/api/account/google'&&req.method==='GET'){requireSession(req);return json(res,200,{available:googleReady(),clientId:config.clientId,redirectUri:base()+'/auth/google/callback'});}
  if(path==='/api/account/google/connect'&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);rateLimit(req);const p=await body(req,4096),u=db.prepare('SELECT password_hash FROM users WHERE id=?').get(s.user_id);
   if(!u?.password_hash||!text(p.password,128)||!await passwordMatches(p.password,u.password_hash))throw new HttpError(401,'Enter your current Jobdesk password to connect Google.');
   db.prepare('UPDATE sessions SET google_link_until=? WHERE token_hash=?').run(Date.now()+5*60000,s.token_hash);return json(res,200,{ok:true});
  }
  if(path==='/api/account/google'&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);if(!isOwner(s.user_id))throw new HttpError(403,'Only the first account can change this installation’s Google configuration.');const p=await body(req);if(!text(p.clientId,300)||!p.clientId.endsWith('.apps.googleusercontent.com')||!/^[a-zA-Z0-9_.-]+$/.test(p.clientId)||!text(p.clientSecret,1000)||(!p.clientSecret&&(!config.clientSecret||p.clientId!==config.clientId)))throw new HttpError(400,'Enter a valid Google web client ID and client secret.');
   config={clientId:p.clientId,clientSecret:p.clientSecret||config.clientSecret};writeFileSync(configFile,JSON.stringify(config),{mode:0o600});return json(res,200,{ok:true});
  }
  if(path==='/api/account/recovery'&&req.method==='POST'){
   const s=requireSession(req);requireCsrf(req,s);const p=await body(req);const u=db.prepare('SELECT password_hash FROM users WHERE id=?').get(s.user_id);if(!u.password_hash||!text(p.password,128)||!await passwordMatches(p.password,u.password_hash))throw new HttpError(401,'Enter your current password to create a recovery code.');const code=random();db.prepare('INSERT INTO recovery VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').run(s.user_id,hash(code));return json(res,200,{code});
  }
  if(path==='/api/auth/recover'&&req.method==='POST'){
   rateLimit(req);const p=await body(req);if(!text(p.code,100)||!text(p.password,128)||p.password.length<12)throw new HttpError(400,'Enter a recovery code and a new password of 12–128 characters.');const u=db.prepare('SELECT id FROM users WHERE email=?').get(cleanEmail(p.email));const recovery=u&&db.prepare('SELECT code_hash FROM recovery WHERE user_id=?').get(u.id);if(!recovery||!same(hash(p.code),recovery.code_hash))throw new HttpError(401,'The email or recovery code is incorrect.');const password=await passwordHash(p.password);const consumed=db.prepare('DELETE FROM recovery WHERE user_id=? AND code_hash=?').run(u.id,recovery.code_hash);if(consumed.changes!==1)throw new HttpError(401,'The email or recovery code is incorrect.');db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(password,u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);return json(res,200,{ok:true});
  }
  if(path==='/auth/google'&&req.method==='GET'){
   if(!googleReady())return redirect(res,'/login?error=google-unavailable');const s=session(req);let verified=0;
   if(s?.has_password){const grant=db.prepare('UPDATE sessions SET google_link_until=0 WHERE token_hash=? AND google_link_until>?').run(s.token_hash,Date.now());if(grant.changes!==1)return redirect(res,'/?error=google-reauth-required');verified=1;}
   const state=random(),verifier=random(),nonce=random();db.prepare('DELETE FROM oauth_flows WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO oauth_flows(state_hash,verifier,nonce,expires_at,user_id,link_verified,link_session_hash) VALUES(?,?,?,?,?,?,?)').run(hash(state),verifier,nonce,Date.now()+(s?5:10)*60000,s?.user_id||null,verified,s?.token_hash||null);res.setHeader('set-cookie',cookie(oauthCookieName,state,600));
   const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:config.clientId,redirect_uri:base()+'/auth/google/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();return redirect(res,u.href);
  }
  if(path==='/auth/google/callback'&&req.method==='GET'){
   const state=url.searchParams.get('state'),bound=cookies(req)[oauthCookieName];res.setHeader('set-cookie',cookie(oauthCookieName,'',0));
   if(!googleReady()||!state||!same(state,bound))return redirect(res,'/login?error=google-failed');const flow=db.prepare('SELECT * FROM oauth_flows WHERE state_hash=?').get(hash(state));db.prepare('DELETE FROM oauth_flows WHERE state_hash=?').run(hash(state));const fail=code=>redirect(res,(flow?.user_id?'/?error=':'/login?error=')+code);if(!flow)return fail('google-failed');if(flow.expires_at<=Date.now())return fail(flow.user_id?'google-link-expired':'google-failed');if(url.searchParams.get('error')==='access_denied')return fail('google-denied');if(!url.searchParams.get('code')||url.searchParams.has('error'))return fail('google-failed');
   try{
    const current=session(req);if(flow.user_id&&(!current||current.user_id!==flow.user_id||current.token_hash!==flow.link_session_hash))return fail('google-link-expired');
    const response=await googleFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:url.searchParams.get('code'),client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:base()+'/auth/google/callback',grant_type:'authorization_code',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});if(!response.ok){const problem=await response.json().catch(()=>({}));return fail(problem.error==='invalid_client'?'google-invalid-client':'google-failed');}const tokens=await response.json();
    if(Date.now()>jwks.expires){const r=await googleFetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Identity verification unavailable');const data=await r.json();jwks={keys:data.keys,expires:Date.now()+3600000};}
    let identity;try{identity=verifyGoogleIdToken(tokens.id_token,{clientId:config.clientId,nonce:flow.nonce,keys:jwks.keys});}catch(e){if(e.message!=='Unknown signing key')throw e;const r=await googleFetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw e;const data=await r.json();jwks={keys:data.keys,expires:Date.now()+3600000};identity=verifyGoogleIdToken(tokens.id_token,{clientId:config.clientId,nonce:flow.nonce,keys:jwks.keys});}
    // Provider requests yield control: logout, recovery, or expiry may revoke the link meanwhile.
    if(flow.user_id){const active=session(req);if(flow.expires_at<=Date.now()||!active||active.user_id!==flow.user_id||active.token_hash!==flow.link_session_hash)return fail('google-link-expired');}
    else if(flow.expires_at<=Date.now())return fail('google-failed');
    let user=db.prepare('SELECT * FROM users WHERE google_sub=?').get(identity.sub);
    if(flow.user_id){const owner=db.prepare('SELECT * FROM users WHERE id=?').get(flow.user_id);if(!owner)return fail('google-link-expired');if(user&&user.id!==owner.id)return fail('google-linked-elsewhere');if(!flow.link_verified&&(owner.password_hash||owner.google_sub!==identity.sub))return fail('google-email-mismatch');db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(identity.sub,owner.id);user=owner;}
    if(!user){if(db.prepare('SELECT id FROM users WHERE email=?').get(identity.email))return redirect(res,'/login?error=google-existing');const id=random();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,identity.name,identity.email,null,identity.sub,Date.now());setOwner(id);user={id};}
    issue(res,user.id);return redirect(res,'/');
   }catch{if(!testMode)console.error('Google sign-in failed: identity-or-network');return fail('google-failed');}
  }
  if(path.startsWith('/api/'))throw new HttpError(404,'This page could not be found.');
  if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
  let filename=path.slice(1);if(['','login','signup','forgot-password'].includes(filename))filename='index.html';
  if(!/^[a-zA-Z0-9._/-]+$/.test(filename)||filename.includes('..')||filename.startsWith('.'))throw new HttpError(404,'This page could not be found.');
  const file=resolve(ROOT,'public',filename);if(!file.startsWith(resolve(ROOT,'public')+'/')&&!file.startsWith(resolve(ROOT,'public')+'\\'))throw new HttpError(404,'This page could not be found.');
  let bytes;try{bytes=await readFile(file);}catch{throw new HttpError(404,'This page could not be found.');}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
 }
 return {get port(){return actualPort();},runScheduled:options=>runScheduledJobs({store:scheduledJobs,worker:browserWorker,backupSearch:fetchBackup,...options}),start(){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});},async close(){await browserWorker.close();if(!server.listening){db.close();return;}return new Promise(resolve=>{server.close(()=>{db.close();resolve();});server.closeIdleConnections();});}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dataDir=process.env.JOBDESK_DATA_DIR||join(ROOT,'data');const app=createJobdeskServer({dataDir,port:Number(process.env.PORT)||4180,host:process.env.HOST||'127.0.0.1',publicOrigin:process.env.PUBLIC_ORIGIN||'',headless:process.env.JOBDESK_HEADLESS==='true'});await app.start();writeFileSync(join(dataDir,'server.pid'),String(process.pid));console.log(`Jobdesk is running at ${process.env.PUBLIC_ORIGIN||'http://localhost:'+app.port}`);const stop=async()=>{await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
