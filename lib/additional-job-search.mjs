import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {matchedKeywords} from '../public/job-keywords.js';

const str=(v,max=12000)=>typeof v==='string'?v.slice(0,max):'';
function decode(v){return str(v,4*1024*1024).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{if(e[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[e.toLowerCase()]||' ';const n=parseInt(e.slice(e[1]?.toLowerCase()==='x'?2:1),e[1]?.toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';});}
function plain(v,max=12000){return decode(decode(v)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function safeUrl(value){try{const u=new URL(str(value,3001));if(value.length>3000||u.protocol!=='https:'||u.username||u.password||!u.hostname.includes('.')||isIP(u.hostname)||u.hostname.startsWith('[')||/\.(local|localhost|internal)$/i.test(u.hostname))return '';return u.href;}catch{return '';}}
const pakistan=/\bpakistan\b|^PK$|\b(lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|multan)\b/i;
const world=/^(anywhere(?: in the world)?|worldwide|global|remote[ ,·-]*(?:worldwide|global))$/i;
// Explicit hiring restrictions override broad board labels and company boilerplate.
const restricted=/(?:\b(?:u\.?s\.?|usa|united states|uk|united kingdom|canada|australia|europe|eu|eea|germany|india|philippines|colombia)[ -]*(?:only|based(?!\s+(?:company|team|agency|business|startup|organisation|organization|employer|firm|headquarters))|residents?|citizens?)\b)|(?:\b(?:must|need to|requires?)\b[^.!?]{0,65}\b(?:authorized|eligible|resident|reside|citizen|based|located|live|living)\b[^.!?]{0,50}\b(?:united states|u\.?s\.?|usa|uk|united kingdom|canada|europe|australia|germany|india|philippines|colombia)\b)|(?:\b(?:remote|work|working|reside)\s+(?:from|in|within)\s+(?:anywhere\s+in\s+)?(?:the\s+)?(?:united states|u\.?s\.?|usa|uk|canada|europe|australia|germany|india|philippines|colombia)\b)/i;
const applicantOnly=/\b(?:only\s+(?:open|available)\s+to|restricted\s+to)\s+(?:candidates?|applicants?|residents?|workers?|people)?[^.!?]{0,55}\b(?:united states|united kingdom|u\.?s\.?|usa|uk|canada|europe|eu|eea|australia|germany|india|philippines|colombia)\b/i;
function eligibility(geo,body,location,remote){
 geo=plain(geo,300);if(restricted.test(body)||applicantOnly.test(body))return null;
 const pk=pakistan.test(geo),global=world.test(geo)||(!geo||/^remote$/i.test(geo))&&/\b(?:work from anywhere in the world|remote worldwide|globally remote)\b/i.test(body);
 if(!remote){if(location!=='remote-worldwide'&&pk)return geo;return null;}
 if(location==='pakistan')return pk?geo:null;
 if(location==='remote-worldwide')return global?'Worldwide · verify listing':!geo||/^remote$/i.test(geo)?'Remote · location not specified; verify eligibility':null;
 if(pk)return geo;if(global)return 'Worldwide · verify listing';if(/^(asia|apac|asia pacific)$/i.test(geo))return geo+' · verify eligibility';
 return !geo||/^remote$/i.test(geo)?'Remote · location not specified; verify eligibility':null;
}
function boardName(url){const host=new URL(url).hostname.toLowerCase();for(const [domain,name] of [['linkedin.com','LinkedIn'],['indeed.com','Indeed'],['rozee.pk','Rozee.pk'],['bayt.com','Bayt'],['mustakbil.com','Mustakbil'],['weworkremotely.com','We Work Remotely'],['remoteok.com','Remote OK']])if(host===domain||host.endsWith('.'+domain))return name;return host.replace(/^www\./,'');}
function listing(title,company,body,fields){title=plain(title,160);company=plain(company,120);if(!title||!company)return null;body=plain(body);const skills=['WordPress','Shopify','Wix','Squarespace','Elementor','WooCommerce','Webflow','Drupal','Joomla','HubSpot','HTML','CSS','JavaScript','TypeScript','PHP','Liquid','React','SEO'].filter(s=>new RegExp(`\\b${s}\\b`,'i').test(title+' '+body));return {id:'live_'+createHash('sha256').update(fields.provider+'|'+fields.sourceUrl).digest('hex').slice(0,24),title,company,description:body,skills,years:0,experienceKnown:false,sample:false,color:'mint',initials:company.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(),salary:'Not listed',type:'Not listed',expiresAt:null,...fields};}
function iso(v){const t=typeof v==='string'?Date.parse(v):NaN;return Number.isFinite(t)?new Date(t).toISOString():null;}
function timestampDate(v){if(typeof v!=='number'||!Number.isFinite(v)||v<=0)return null;const value=v<1e12?v*1000:v;return value<=8640000000000000?new Date(value).toISOString():null;}
function relativeDate(v,now){const m=/^(\d+)\s+(hour|day|week|month)s?\s+ago$/i.exec(str(v,60));if(!m)return null;const value=now-Number(m[1])*({hour:3600000,day:86400000,week:604800000,month:2592000000}[m[2].toLowerCase()]);return Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value).toISOString():null;}
function jsearch(record,location,scope,now){
 const body=plain(record.job_description),country=plain(record.job_country,80);let geo=plain(record.job_location,300)||[record.job_city,record.job_state].map(v=>plain(v,80)).filter(Boolean).join(', ');
 // Country metadata can restrict a listing even when the display location says Anywhere.
 if(country&&!world.test(country)){if(!geo||world.test(geo)||/^remote$/i.test(geo))geo=country==='PK'?'Pakistan':country;else if(country==='PK'&&!/\bPakistan\b/i.test(geo))geo+=', Pakistan';}
 const remote=record.job_is_remote===true||record.job_is_remote!==false&&(record.work_arrangement==='remote'||/\bremote\b|work from home/i.test(geo+' '+str(record.job_title)));
 if(scope==='remote'&&!remote)return null;
 const allowed=eligibility(geo,plain(record.job_title)+' '+body,location,remote);if(!allowed)return null;
 const expiresAt=iso(record.job_offer_expiration_datetime_utc);if(expiresAt&&Date.parse(expiresAt)<=now)return null;
 const urls=[record.job_apply_link,...(Array.isArray(record.apply_options)?record.apply_options:[]).slice(0,20).map(o=>o?.apply_link)].map(safeUrl).filter(Boolean);
 const options=[...new Set(urls)].slice(0,5).map(url=>({name:boardName(url),url}));if(!options.length)return null;
 const main=options.find(o=>['LinkedIn','Indeed','Rozee.pk','Bayt','Mustakbil'].includes(o.name))||options[0];
 return listing(record.job_title,record.employer_name,body,{provider:'JSearch',source:main.name,sourceUrl:main.url,url:main.url,applyOptions:options,location:remote?'Remote':geo,eligibility:allowed,posted:iso(record.job_posted_at_datetime_utc)||timestampDate(record.job_posted_at_timestamp)||relativeDate(record.job_posted_at,now),expiresAt,type:plain(record.job_employment_type,80)||'Not listed',salary:plain(record.job_salary_string,100)||'Not listed'});
}
function remoteOk(record,location){const geo=plain(record.location,300),body=plain(record.description),allowed=eligibility(geo,plain(record.position)+' '+body,location,true),url=safeUrl(record.url);if(!allowed||!url||!/(^|\.)remoteok\.com$/i.test(new URL(url).hostname))return null;return listing(record.position,record.company,body,{provider:'Remote OK',source:'Remote OK',sourceUrl:url,url,location:'Remote',eligibility:allowed,posted:iso(record.date)});}
function rssRecords(xml){
 if(!/<rss\b/i.test(xml)||!/<\/channel\s*>/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Invalid feed');
 return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].slice(0,500).map(([,item])=>{const get=tag=>{const v=new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`,'i').exec(item)?.[1]||'';return decode(v.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/,'$1'));};return {title:get('title'),url:get('link'),region:get('region'),country:get('country'),description:get('description'),type:get('type'),posted:get('pubDate')};});
}
function wwr(record,location){const title=plain(record.title,300),split=title.indexOf(':');if(split<1)return null;const company=title.slice(0,split),role=title.slice(split+1),body=plain(record.description),geo=record.country||record.region,allowed=eligibility(geo,role+' '+body,location,true),url=safeUrl(record.url);if(!allowed||!url||new URL(url).hostname!=='weworkremotely.com')return null;return listing(role,company,body,{provider:'We Work Remotely',source:'We Work Remotely',sourceUrl:url,url,location:'Remote',eligibility:allowed,posted:iso(record.posted),type:plain(record.type,80)||'Not listed'});}

function backupRecord(record){
 const extensions=Array.isArray(record.extensions)?record.extensions:[],detected=record.detected_extensions||{};
 return {job_title:record.title,employer_name:record.company_name,job_location:record.location,job_description:record.description,job_is_remote:detected.work_from_home===true||extensions.some(v=>/remote|work from home/i.test(str(v)))||/^(anywhere|worldwide|remote)$/i.test(str(record.location)),job_posted_at:detected.posted_at,job_posted_at_datetime_utc:record.posted_at_datetime_utc,job_employment_type:detected.schedule||detected.schedule_type,job_apply_link:record.apply_link,apply_options:(Array.isArray(record.apply_links)?record.apply_links:[]).map(o=>({apply_link:o.link||o.url}))};
}
export function createAdditionalSearch({fetch:fetcher=globalThis.fetch,now=Date.now,getConfig=()=>({}),reserve=()=>false,expandRoleVariants=true}={}){
 const cache=new Map(),pending=new Map(),cooldown=new Map();let active=0;const queue=[];
 async function pooled(fn){if(active>=3)await new Promise(resolve=>queue.push(resolve));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
 async function retrieve(name,keyword='',scope='',publisher='',cursor='',signal){
  if(signal?.aborted)return {status:'error',records:[],cached:false,message:'Search deadline reached.',reason:'timeout'};
  const config=getConfig(),primary=name==='JSearch',backup=name==='SearchApi',indexed=primary||backup,secret=backup?config.fallbackApiKey:config.apiKey,enabled=backup?config.fallbackEnabled:config.enabled;
  if(indexed&&(!secret||!enabled||primary&&config.provider!=='jsearch'))return {status:'setup',records:[],cached:false,message:primary?'JSearch is not configured or is paused in Account settings.':'Add and enable a SearchApi backup key in Account settings.'};
  const key=JSON.stringify([name,keyword.toLowerCase(),scope,publisher,cursor,indexed?createHash('sha256').update(secret).digest('hex'):'']),hit=cache.get(key);
  if(hit&&hit.until>now())return {...hit.value,cached:true};if(!signal&&pending.has(key))return {...await pending.get(key),cached:true};
  const request=pooled(async()=>{
   const circuitKey=indexed?name+'|'+createHash('sha256').update(secret).digest('hex'):'',circuit=indexed?cooldown.get(circuitKey):null;if(circuit&&circuit.until>now())return {...circuit.value,cached:true};
   if(signal?.aborted)return {status:'error',records:[],cached:false,message:'Search deadline reached.',reason:'timeout'};
   const current=getConfig();
   if(indexed&&(primary?current.apiKey!==secret||!current.enabled:current.fallbackApiKey!==secret||!current.fallbackEnabled))return {status:'setup',records:[],cached:false,message:'Provider settings changed before this request.'};
   if(indexed&&(current.dailyLimitReached||primary&&current.primaryLimitReached||backup&&current.backupLimitReached||!reserve(backup?'searchapi':'jsearch')))return {status:'limited',records:[],cached:false,reason:current.dailyLimitReached?'daily-limit':'quota',message:current.dailyLimitReached?'The shared daily search limit is reached. Cached results and public sources remain available.':name+' local allowance is reached. Public sources remain available.',nextRefreshAt:new Date(now()+3600000).toISOString()};
   try{
    const url=new URL(primary?'https://api.openwebninja.com/jsearch/search-v2':backup?'https://www.searchapi.io/api/v1/search':name==='Remote OK'?'https://remoteok.com/api':'https://weworkremotely.com/remote-jobs.rss');
    const query=keyword+(scope==='pakistan'?' jobs in Pakistan':' remote worldwide jobs')+(publisher?' via '+publisher:'');
    if(primary){if(cursor)url.searchParams.set('cursor',cursor);url.searchParams.set('query',query);url.searchParams.set('country',scope==='pakistan'?'pk':'us');url.searchParams.set('language','en');url.searchParams.set('num_pages','1');url.searchParams.set('date_posted','month');if(scope==='remote')url.searchParams.set('work_from_home','true');}
    if(backup){url.searchParams.set('engine','google_jobs');url.searchParams.set('q',query);url.searchParams.set('gl',scope==='pakistan'?'pk':'us');url.searchParams.set('hl','en');if(scope==='pakistan')url.searchParams.set('location','Pakistan');}
    const response=await fetcher(url.href,{headers:{accept:name==='We Work Remotely'?'application/rss+xml':'application/json',...(primary?{'x-api-key':secret}:backup?{authorization:'Bearer '+secret}:{})},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(indexed?45000:12000)]):AbortSignal.timeout(indexed?45000:12000),redirect:'error'});
    if(!response.ok){if(indexed&&[401,403].includes(response.status))throw Error('credentials');if(indexed&&response.status===429)throw Error('quota');throw Error('unavailable');}
    if(Number(response.headers?.get('content-length'))>4*1024*1024||!response.body)throw Error('invalid');let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.byteLength;if(size>4*1024*1024)throw Error('invalid');chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks).toString('utf8');let records,nextCursor=null;
    if(name==='We Work Remotely')records=rssRecords(raw);else{const data=JSON.parse(raw);if(primary){if(data.error||data.status!=='OK')throw Error('provider');if(!Array.isArray(data.data?.jobs))throw Error('invalid');records=data.data.jobs;nextCursor=typeof data.data.cursor==='string'&&data.data.cursor.length<=8192?data.data.cursor:null;}else if(backup){if(data.error||!Array.isArray(data.jobs))throw Error('provider');records=data.jobs.map(backupRecord);}else{if(!Array.isArray(data))throw Error('invalid');records=data;}}
    const until=now()+3600000,value={status:'ok',nextCursor,records:records.slice(0,1000),cached:false,fetchedAt:new Date(now()).toISOString(),nextRefreshAt:new Date(until).toISOString()};cache.set(key,{until,value});while(cache.size>150)cache.delete(cache.keys().next().value);return value;
   }catch(error){const reason=['TimeoutError','AbortError'].includes(error.name)||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)?'timeout':error.message==='credentials'?'credentials':error.message==='quota'?'quota':'unavailable';const message=name==='Remote OK'?(reason==='timeout'?'Remote OK timed out while refreshing its public feed. Other available sources are shown.':'Remote OK could not refresh its public feed. Other available sources are shown.'):reason==='credentials'?name+' rejected the key or its plan is not enabled. Check Account settings.':reason==='quota'?name+' provider allowance is reached. A configured backup or public sources can continue.':name+' is temporarily unavailable or returned an invalid feed.';const until=now()+60000,value={status:'error',records:[],cached:false,message,reason,nextRefreshAt:new Date(until).toISOString()};cache.set(key,{until,value});if(indexed&&['credentials','quota'].includes(reason)){cooldown.set(circuitKey,{until,value});while(cooldown.size>100)cooldown.delete(cooldown.keys().next().value);}return value;}
  });if(!signal)pending.set(key,request);try{return await request;}finally{if(!signal)pending.delete(key);}
 }
 return async({keywords,location,signal})=>{
  const scopes=location==='pakistan-remote'?['pakistan','remote']:location==='pakistan'?['pakistan']:['remote'];
  // Natural-language searches per role avoid OR/publisher clauses that return empty indexed results.
  const roles=[...keywords].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  const variants=expandRoleVariants?[...new Set(roles.filter(k=>/\b(?:developer|engineer|designer)\b/i.test(k)).map(k=>/\b(WordPress|Shopify|Wix|Squarespace|Webflow)\b/i.exec(k)?.[1]).filter(Boolean))]:[];
  const queries=[...roles.flatMap(keyword=>scopes.map(scope=>({keyword,scope,publisher:'',maxPages:3}))),...variants.flatMap(keyword=>scopes.map(scope=>({keyword,scope,publisher:'',maxPages:1})))];

  const tasks=[...['Remote OK','We Work Remotely'].map(async name=>({name,...await retrieve(name,'','','','',signal)})),...queries.map(async ({keyword,scope,publisher,maxPages})=>{
   const result={name:'JSearch',scope,...await retrieve('JSearch',keyword,scope,publisher,'',signal)},pages=[result],seen=new Set();
   let last=result;
   for(let page=1;page<maxPages&&last.status==='ok'&&last.records.length&&last.nextCursor&&!seen.has(last.nextCursor);page++){
    const cursor=last.nextCursor;seen.add(cursor);last={name:'JSearch',scope,...await retrieve('JSearch',keyword,scope,publisher,cursor,signal)};pages.push(last);
   }
   const config=getConfig();
   if(['error','limited'].includes(result.status)&&result.reason!=='daily-limit'&&!config.dailyLimitReached&&config.fallbackEnabled&&config.fallbackApiKey&&!config.backupLimitReached)pages.push({name:'SearchApi',scope,...await retrieve('SearchApi',keyword,scope,publisher,'',signal)});
   return pages;
  })];
  const raw=await Promise.all(tasks),results=raw.flat(),jobs=[];
  for(const r of results)for(const record of r.records){if(!record||typeof record!=='object')continue;try{const job=['JSearch','SearchApi'].includes(r.name)?jsearch(record,location,r.scope,now()):r.name==='Remote OK'?remoteOk(record,location):wwr(record,location);if(job){if(r.name==='SearchApi')job.provider='SearchApi';if(matchedKeywords(job,keywords).length)jobs.push(job);}}catch{/* Isolate malformed records. */}}
  const sourceNames=['Remote OK','We Work Remotely','JSearch',...(results.some(r=>r.name==='SearchApi')?['SearchApi']:[])];
  const sources=sourceNames.map(name=>{const group=results.filter(r=>r.name===name),bad=group.find(r=>r.status!=='ok'),dates=group.map(r=>r.fetchedAt).filter(Boolean).sort(),refresh=group.map(r=>r.nextRefreshAt).filter(Boolean).sort();return {name,status:bad?.status||'ok',cached:group.every(r=>r.cached),fetchedAt:dates[0]||null,nextRefreshAt:refresh[0]||null,...(bad?{message:bad.message,reason:bad.reason}:{})};});
  return {jobs,sources};
 };
}
