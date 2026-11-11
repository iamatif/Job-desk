import {createHash} from 'node:crypto';

const NAME='Rozee via API.SH',DAY=86400000,MAX_BODY=4*1024*1024;
const text=(value,max=12000)=>typeof value==='string'?value.slice(0,max):'';
function plain(value,max=12000){return text(value,MAX_BODY).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{if(entity[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()];const n=parseInt(entity.slice(entity[1]?.toLowerCase()==='x'?2:1),entity[1]?.toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function safeUrl(value){try{if(typeof value!=='string'||value.length>3000)return '';const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(url.hostname==='rozee.pk'||url.hostname.endsWith('.rozee.pk'))?url.href:'';}catch{return '';}}
function date(value){if(typeof value!=='string'||!value.trim()||/^\d+$/.test(value))return null;const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():null;}
function normalise(record,location,now){
 if(!record||typeof record!=='object'||Array.isArray(record))return null;
 const title=plain(record.title,160),company=plain(record.company,120),description=plain(record.description),url=safeUrl(record.url),posted=date(record.posted_at),expiresAt=date(record.apply_by);
 if(!title||!company||!url||!posted||Date.parse(posted)>now||now-Date.parse(posted)>30*DAY||expiresAt&&Date.parse(expiresAt)<=now)return null;
 const cities=Array.isArray(record.cities)?record.cities.map(v=>plain(v,100)).filter(Boolean).slice(0,30):[],geo=plain(record.city,300)||cities.join(', '),body=title+' '+description;
 const remote=/\bremote\b|work from home/i.test(geo+' '+title+' '+plain(record.shift,80)+' '+description);
 const global=/\b(?:remote worldwide|worldwide remote|globally remote|work from anywhere in the world|remote anywhere in the world)\b/i.test(body)||/^(?:worldwide|anywhere(?: in the world)?|global)$/i.test(geo);
 const restricted=/\b(?:US|USA|UK|United States|United Kingdom|Canada|Australia|India|Europe)[ -]+(?:only|residents|citizens|based)\b|\b(?:must|only)\b[^.!?]{0,65}\b(?:reside|resident|citizen|based|located)\b[^.!?]{0,50}\b(?:US|USA|UK|United States|United Kingdom|Canada|Australia|India|Europe)\b/i.test(body);
 // A board's Pakistani identity alone is not evidence that an unspecified listing hires there.
 const pk=/\bpakistan\b|^PK$|\b(?:lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|multan|quetta|sialkot|gujranwala|hyderabad|bahawalpur|abbottabad|sukkur|sargodha|gujrat|rahim yar khan)\b/i.test(geo);
 if(restricted||(location==='remote-worldwide'?(!remote||!global):!pk))return null;
 const skills=Array.isArray(record.skills)?record.skills.map(v=>plain(v,100)).filter(Boolean).slice(0,50):[];
 return {id:'live_'+createHash('sha256').update('Rozee.pk|'+url).digest('hex').slice(0,24),title,company,description,skills,years:0,experienceKnown:false,location:remote?'Remote':geo,eligibility:location==='remote-worldwide'?'Worldwide · verify listing':geo,source:'Rozee.pk',provider:'API.SH',url,sourceUrl:url,posted,expiresAt,type:plain(record.job_type,80)||'Not listed',salary:plain(record.salary,120)||'Not listed',sample:false,color:'mint',initials:company.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase()};
}

export function createRozeeSearch({fetch:fetcher=globalThis.fetch,now=Date.now,getConfig=()=>({})}={}){
 const cache=new Map(),pending=new Map(),cooldown=new Map(),queue=[];let active=0;
 async function pooled(fn){if(active>=2)await new Promise(resolve=>queue.push(resolve));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
 const stamp=()=>new Date(now()).toISOString();
 async function retrieve(keyword,secret){
  const fingerprint=createHash('sha256').update(secret).digest('hex'),key=JSON.stringify([keyword.toLowerCase(),fingerprint]);
  const hit=cache.get(key);if(hit&&hit.until>now())return {...hit.value,cached:true};if(pending.has(key))return {...await pending.get(key),cached:true};
  const request=pooled(async()=>{
   const blocked=cooldown.get(fingerprint);if(blocked&&blocked.until>now())return {...blocked.value,cached:true};
   const records=[];let error='',blockedProvider=false,upstreamStatus=0;
   try{
    let page=1;for(let index=0;index<2;index++){
     const current=getConfig();if(!current.rozeeEnabled||current.rozeeApiKey!==secret)throw Error('configuration');
     const url=new URL('https://api.api.sh/rozee/v1/search');url.searchParams.set('q',keyword);url.searchParams.set('page',String(page));
     const response=await fetcher(url.href,{headers:{accept:'application/json','x-api-key':secret},redirect:'error',signal:AbortSignal.timeout(45000)});
     if(!response.ok){upstreamStatus=response.status;blockedProvider=[401,402,403,429].includes(response.status);throw Error(blockedProvider?'allowance':'unavailable');}
     if(Number(response.headers?.get('content-length'))>MAX_BODY||!response.body)throw Error('invalid');
     const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>MAX_BODY)throw Error('invalid');chunks.push(Buffer.from(chunk));}
     const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.success===false||data.error||!Array.isArray(data.jobs))throw Error('invalid');records.push(...data.jobs.slice(0,100));
     if(data.next_page==null)break;
     if(!Number.isSafeInteger(data.next_page)||data.next_page<=page)break;page=data.next_page;
    }
   }catch{error=[502,503,504].includes(upstreamStatus)?`API.SH could not reach Rozee (HTTP ${upstreamStatus}). Rozee is blocked or temporarily unavailable to this provider; other sources remain available.`:blockedProvider?'API.SH rejected the key or its provider allowance is reached. Check the API.SH account.':'Rozee via API.SH could not finish refreshing. Available results are shown; try again later.';}
   const until=now()+(error?60000:DAY),value={records,status:error?'error':'ok',cached:false,fetchedAt:stamp(),nextRefreshAt:new Date(until).toISOString(),...(error?{message:error}:{})};
   cache.set(key,{until,value});while(cache.size>100)cache.delete(cache.keys().next().value);
   if(blockedProvider){cooldown.set(fingerprint,{until,value:{...value,records:[]}});while(cooldown.size>100)cooldown.delete(cooldown.keys().next().value);}
   return value;
  });pending.set(key,request);try{return await request;}finally{pending.delete(key);}
 }
 return async({keywords,location})=>{
  const config=getConfig();if(!config.rozeeApiKey||!config.rozeeEnabled)return {jobs:[],sources:[{name:NAME,status:'setup',cached:false,message:'Add and enable a separate API.SH key in Account settings for Rozee searches.',fetchedAt:null,nextRefreshAt:null}]};
  const results=await Promise.all([...new Set(keywords)].map(keyword=>retrieve(keyword,config.rozeeApiKey))),jobs=new Map();
  for(const result of results)for(const record of result.records){try{const job=normalise(record,location,now());if(job)jobs.set(job.id,job);}catch{/* One malformed record must not hide valid listings. */}}
  const bad=results.find(result=>result.status!=='ok');return {jobs:[...jobs.values()],sources:[{name:NAME,status:bad?'error':'ok',cached:results.every(result=>result.cached),fetchedAt:results.map(result=>result.fetchedAt).filter(Boolean).sort()[0]||null,nextRefreshAt:results.map(result=>result.nextRefreshAt).filter(Boolean).sort()[0]||null,...(bad?{message:bad.message}:{})}]};
 };
}
