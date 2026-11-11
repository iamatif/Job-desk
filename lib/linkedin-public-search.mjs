import {createHash} from 'node:crypto';

const SOURCE='LinkedIn public',HOUR=3600000,DAY=86400000,MAX_BODY=2*1024*1024;
const str=(value,max=12000)=>typeof value==='string'?value.slice(0,max):'';
function decode(value){return str(value,MAX_BODY).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{if(entity[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()];const n=parseInt(entity.slice(entity[1]?.toLowerCase()==='x'?2:1),entity[1]?.toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';});}
function plain(value,max=12000){return decode(str(value,MAX_BODY).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function attribute(tag,name){return new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,'i').exec(tag)?.[2]||'';}
function classTag(html,tag,className){return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`,'gi'))].find(match=>attribute(match[0],'class').split(/\s+/).includes(className))?.[0]||'';}
function classText(html,tag,className){const match=[...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,'gi'))].find(match=>attribute(match[0].slice(0,match[0].indexOf('>')+1),'class').split(/\s+/).includes(className));return plain(match?.[1]);}
function canonical(value){try{if(value.length>3000)return '';const url=new URL(decode(value));if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='linkedin.com'||url.hostname.endsWith('.linkedin.com'))||!/^\/jobs\/view\/(?:[^/?#]+-)?\d+\/?$/.test(url.pathname))return '';return 'https://www.linkedin.com'+url.pathname.replace(/\/$/,'');}catch{return '';}}
const cities=new Set(['karachi','lahore','islamabad','rawalpindi','faisalabad','peshawar','multan','quetta','sialkot','gujranwala','hyderabad','bahawalpur','abbottabad','sukkur','sargodha','gujrat','rahim yar khan','sahiwal','mardan','wah','taxila','jhelum']);
const provinces=new Set(['punjab','sindh','balochistan','khyber pakhtunkhwa','islamabad','islamabad capital territory','azad kashmir','gilgit baltistan']);
function pakistanLocation(value){const geo=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s*\((?:remote|hybrid|on-site)\)\s*$/,'').trim();if(/(?:^|,\s*)pakistan$/.test(geo))return true;const parts=geo.split(',').map(v=>v.trim());return parts.length===1?cities.has(geo):parts.length===2&&cities.has(parts[0])&&provinces.has(parts[1]);}
export function parseLinkedInPublicCards(html){
 if(typeof html!=='string'||Buffer.byteLength(html,'utf8')>MAX_BODY)return [];
 const cards=[];for(const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)){if(cards.length>=100)break;const card=match[1];if(!/\bjob-search-card\b/.test(card))continue;cards.push({title:classText(card,'h3','base-search-card__title'),company:classText(card,'h4','base-search-card__subtitle'),location:classText(card,'span','job-search-card__location'),url:canonical(attribute(classTag(card,'a','base-card__full-link'),'href')),posted:attribute(card.match(/<time\b[^>]*>/i)?.[0]||'','datetime')});}return cards;
}
function job(record,now){
 const {title,company,location,url}=record;if(!title||!company||!url||!pakistanLocation(location)||!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/.test(record.posted))return null;
 const time=Date.parse(record.posted);if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==record.posted.slice(0,10)||time>now||now-time>30*DAY)return null;
 const skills=['WordPress','Shopify','Wix','Squarespace','Elementor','WooCommerce','Webflow','HTML','CSS','JavaScript','TypeScript','PHP','React','SEO'].filter(skill=>new RegExp(`\\b${skill}\\b`,'i').test(title));
 return {id:'live_'+createHash('sha256').update('LinkedIn|'+url).digest('hex').slice(0,24),title:title.slice(0,160),company:company.slice(0,120),description:'Open the original listing for full role details.',skills,years:0,experienceKnown:false,location,eligibility:location,source:'LinkedIn',provider:SOURCE,sourceUrl:url,url,posted:new Date(time).toISOString(),expiresAt:null,type:'Not listed',salary:'Not listed',sample:false,color:'mint',initials:company.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase()};
}

export function createLinkedInPublicSearch({fetch:fetcher=globalThis.fetch,now=Date.now,loadCache=()=>null,saveCache=()=>{}}={}){
 const cache=new Map(),pending=new Map(),lastSuccess=new Map(),queue=[];let active=0,blockedUntil=0;
 async function pooled(fn){if(active>=2)await new Promise(resolve=>queue.push(resolve));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
 function failure(records=[],blocked=false){return {records,status:'error',cached:false,message:blocked?'LinkedIn public search is temporarily refusing requests. Available results are shown; try again later.':'LinkedIn public search could not finish refreshing. Available results are shown; try again later.',fetchedAt:new Date(now()).toISOString(),nextRefreshAt:new Date(now()+60000).toISOString()};}
 function validSuccess(value){
  try{
   if(!value||value.status!=='ok'||!Array.isArray(value.records)||value.records.length>200||Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_BODY)return null;
   const fetched=Date.parse(value.fetchedAt),refresh=Date.parse(value.nextRefreshAt);if(!Number.isFinite(fetched)||!Number.isFinite(refresh)||fetched>now()||now()-fetched>DAY||refresh<=fetched||refresh>fetched+HOUR)return null;
   const records=[];for(const record of value.records){if(!record||typeof record!=='object'||!['title','company','location','url','posted'].every(field=>typeof record[field]==='string')||record.title.length>1000||record.company.length>1000||record.location.length>1000||record.posted.length>50)return null;const safe={title:plain(record.title,1000),company:plain(record.company,1000),location:plain(record.location,1000),url:canonical(record.url),posted:record.posted};if(job(safe,now()))records.push(safe);}
   return {records,status:'ok',cached:true,fetchedAt:new Date(fetched).toISOString(),nextRefreshAt:new Date(refresh).toISOString()};
  }catch{return null;}
 }
 async function retrieve(keyword){
  const key=keyword.toLowerCase(),hit=cache.get(key);if(hit&&hit.until>now())return {...hit.value,records:now()-Date.parse(hit.value.fetchedAt)>DAY?[]:hit.value.records,cached:true};if(pending.has(key))return {...await pending.get(key),cached:true};
  const request=pooled(async()=>{
   let previous=validSuccess(lastSuccess.get(key));if(!previous)try{previous=validSuccess(await loadCache(keyword));}catch{/* Persistence is optional. */}
   if(previous){lastSuccess.set(key,previous);while(lastSuccess.size>100)lastSuccess.delete(lastSuccess.keys().next().value);if(Date.parse(previous.nextRefreshAt)>now()){cache.set(key,{until:Date.parse(previous.nextRefreshAt),value:previous});return previous;}}
   function failed(records=[],blocked=false){const value=failure(records,blocked);if(previous?.records.length){value.records=[...new Map([...previous.records,...records].map(record=>[record.url,record])).values()].slice(0,200);value.cached=true;value.fetchedAt=previous.fetchedAt;value.message+=' Cached public listings from the last successful refresh are included.';}return value;}
   if(blockedUntil>now())return {...failed([],true),cached:true,nextRefreshAt:new Date(blockedUntil).toISOString()};
   const records=[];let value;
   try{
    for(let page=0;page<2;page++){
     if(blockedUntil>now())throw Error('blocked');
     const url=new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');url.searchParams.set('keywords',keyword);url.searchParams.set('location','Pakistan');url.searchParams.set('f_TPR','r2592000');url.searchParams.set('start',String(records.length));
     const response=await fetcher(url.href,{headers:{accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(20000)});
     if(!response.ok){if([403,429].includes(response.status)){blockedUntil=now()+60000;throw Error('blocked');}throw Error('unavailable');}
     if(!response.body||Number(response.headers?.get('content-length'))>MAX_BODY)throw Error('invalid');const chunks=[];let size=0;
     for await(const chunk of response.body){size+=chunk.byteLength;if(size>MAX_BODY)throw Error('invalid');chunks.push(Buffer.from(chunk));}
     const html=Buffer.concat(chunks).toString('utf8');const pageRecords=parseLinkedInPublicCards(html);if(html.trim()&&!pageRecords.length)throw Error('invalid');records.push(...pageRecords);if(!pageRecords.length)break;
    }
    value={records,status:'ok',cached:false,fetchedAt:new Date(now()).toISOString(),nextRefreshAt:new Date(now()+HOUR).toISOString()};
    lastSuccess.set(key,value);while(lastSuccess.size>100)lastSuccess.delete(lastSuccess.keys().next().value);
    try{await saveCache(keyword,structuredClone(value));}catch{/* An optional disk cache must not break live results. */}
   }catch(error){value=failed(records,error.message==='blocked');}
   cache.set(key,{until:Date.parse(value.nextRefreshAt),value});while(cache.size>100)cache.delete(cache.keys().next().value);return value;
  });pending.set(key,request);try{return await request;}finally{pending.delete(key);}
 }
 return async({keywords,location})=>{
  if(location==='remote-worldwide')return {jobs:[],sources:[]};
  const results=await Promise.all([...new Set(keywords)].map(retrieve)),jobs=new Map();for(const result of results)for(const record of result.records){try{const listing=job(record,now());if(listing)jobs.set(listing.id,listing);}catch{/* Isolate malformed cards. */}}
  const bad=results.find(result=>result.status!=='ok');return {jobs:[...jobs.values()],sources:[{name:SOURCE,status:bad?'error':'ok',cached:results.every(result=>result.cached),fetchedAt:results.map(result=>result.fetchedAt).filter(Boolean).sort()[0]||null,nextRefreshAt:results.map(result=>result.nextRefreshAt).filter(Boolean).sort()[0]||null,...(bad?{message:bad.message}:{})}]};
 };
}
