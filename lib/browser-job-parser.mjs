import {createHash} from 'node:crypto';
import {matchedKeywords} from '../public/job-keywords.js';
import {isRecentJob} from '../public/job-results.js';

const DAY=86400000, MAX_JSON=1024*1024;
const string=(value,max=12000)=>typeof value==='string'?value.slice(0,max):'';
function plain(value,max=12000){
 return string(value,MAX_JSON).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e)=>{
  if(e[0]!=='#')return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[e.toLowerCase()];
  const hex=e[1]?.toLowerCase()==='x',n=parseInt(e.slice(hex?2:1),hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
 }).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function canonical(value,source){
 try{
  if(typeof value!=='string'||value.length>3000)return '';
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return '';
  if(source==='Indeed'&&['indeed.com','www.indeed.com','pk.indeed.com'].includes(u.hostname)&&['/viewjob','/rc/clk'].includes(u.pathname)){
   const id=u.searchParams.get('jk');return id&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)?`https://${u.hostname==='indeed.com'?'www.indeed.com':u.hostname}/viewjob?jk=${encodeURIComponent(id)}`:'';
  }
  if(source==='LinkedIn'&&['linkedin.com','www.linkedin.com','pk.linkedin.com'].includes(u.hostname)){
   const id=/^\/jobs\/view\/(?:[^/?#]+-)?(\d+)\/?$/.exec(u.pathname)?.[1];return id?`https://www.linkedin.com/jobs/view/${id}`:'';
  }
 }catch{/* Invalid or untrusted URL. */}return '';
}
function googleTarget(value,base){
 try{
  const u=new URL(value,base);
  if(u.protocol!=='https:'||u.username||u.password||u.port)return '';
  if(['www.google.com','google.com','www.google.com.pk','google.com.pk'].includes(u.hostname)&&u.pathname==='/url')return u.searchParams.get('q')||u.searchParams.get('url')||'';
  return u.href;
 }catch{return '';}
}
export function extractGoogleJobLinks(snapshot,{source,limit=5}={}){
 const result=new Set(),cap=Number.isInteger(limit)?Math.max(0,Math.min(20,limit)):5;
 if(!cap||!Array.isArray(snapshot?.links))return [];
 for(const link of snapshot.links.slice(0,1500)){
  const url=canonical(googleTarget(link?.href,snapshot.url),source);if(url)result.add(url);if(result.size>=cap)break;
 }return [...result];
}
function postings(raw){
 if(!Array.isArray(raw))return [];
 const result=[];let bytes=0,nodes=0;
 for(const value of raw.slice(0,30)){
  if(typeof value!=='string'||value.length>MAX_JSON)continue;bytes+=Buffer.byteLength(value,'utf8');if(bytes>2*MAX_JSON)break;
  let root;try{root=JSON.parse(value);}catch{continue;}
  const stack=[{value:root,depth:0}];
  while(stack.length&&nodes<1500){
   const {value:item,depth}=stack.pop();if(!item||typeof item!=='object'||depth>20)continue;nodes++;
   if(!Array.isArray(item)&&[item['@type']].flat().some(type=>type==='JobPosting'||type==='https://schema.org/JobPosting'))result.push(item);
   if(Array.isArray(item)){for(const child of item.slice(0,200))stack.push({value:child,depth:depth+1});}
   else for(const child of Object.values(item).slice(0,100))if(child&&typeof child==='object')stack.push({value:child,depth:depth+1});
  }
 }return result.slice(0,30);
}
function isoDate(value){
 if(typeof value!=='string'||value.length>50||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))return null;
 const time=Date.parse(value);if(!Number.isFinite(time))return null;
 // Date.parse rolls invalid calendar days into the next month.
 const date=value.slice(0,10),calendar=new Date(`${date}T00:00:00Z`);if(calendar.toISOString().slice(0,10)!==date)return null;
 return new Date(time).toISOString();
}
function relativeDate(value,now){
 const cleaned=plain(value,100),absolute=isoDate(cleaned);if(absolute)return absolute;const text=cleaned.toLowerCase();
 if(/^(?:just now|today)$/.test(text))return new Date(now).toISOString();
 const match=/^(?:(?:posted|reposted)\s+)?(\d{1,3})\s+(minute|hour|day|week)s?\s+ago$/.exec(text);if(!match)return null;
 return new Date(now-Number(match[1])*({minute:60000,hour:3600000,day:DAY,week:7*DAY}[match[2]])).toISOString();
}
const countries={PK:'Pakistan',US:'United States',GB:'United Kingdom',CA:'Canada',AU:'Australia'};
function geoName(value){
 if(typeof value==='string')return countries[value.toUpperCase()]||plain(value,250);
 if(!value||typeof value!=='object')return '';
 const a=value.address||value;
 const country=typeof a.addressCountry==='object'?a.addressCountry.name||a.addressCountry.code:a.addressCountry;
 return [a.addressLocality,a.addressRegion,countries[string(country).toUpperCase()]||plain(country,100),!a.addressCountry?value.name:''].map(v=>plain(v,150)).filter(Boolean).join(', ');
}
const list=value=>value===undefined||value===null?[]:Array.isArray(value)?value.slice(0,30):[value];
const pakistan=text=>/\bpakistan\b|^PK$/i.test(text);
const worldwide=text=>/^(?:worldwide|anywhere|global|remote\s*\(?worldwide\)?)$/i.test(text.trim());
function geography(record,location){
 const places=list(record.jobLocation).map(geoName).filter(Boolean),requirements=list(record.applicantLocationRequirements).map(geoName).filter(Boolean);
 const remote=list(record.jobLocationType).some(t=>/^(?:TELECOMMUTE|REMOTE)$/i.test(string(t)));
 const restricted=plain(`${record.title||''} ${record.description||''}`);
 if(/\b(?:u\.?s\.?|usa|united states|uk|united kingdom|canada|australia)[ -]*(?:based|only)\b|\bonly (?:in|within) (?:the )?(?:united states|usa|us|uk|canada|australia)\b/i.test(restricted))return null;
 // A broad label mixed with a specific applicant country is contradictory;
 // do not turn the broad label into a claim of worldwide eligibility.
 if(requirements.some(worldwide)&&requirements.some(value=>!worldwide(value)))return null;
 if(requirements.length&&!requirements.some(pakistan)&&!requirements.some(worldwide)&&location!=='remote-worldwide')return null;
 const global=remote&&(requirements.length?requirements.some(worldwide):places.some(worldwide));
 const pk=(requirements.length?requirements.some(pakistan):places.some(pakistan));
 if(location==='remote-worldwide'?!global:location==='pakistan'?!pk:!pk&&!global)return null;
 const eligibility=requirements.length?requirements.join('; '):places.join('; ');
 return {location:plain(remote?`Remote${places.length?' — '+places.join('; '):''}`:places.join('; '),150),eligibility};
}
function listingSkills(text){
 return ['WordPress','Shopify','Wix','Squarespace','Elementor','WooCommerce','Webflow','Drupal','Joomla','HubSpot','HTML','CSS','JavaScript','TypeScript','PHP','Liquid','React','Node.js','GraphQL','Git','Figma','SEO'].filter(skill=>new RegExp('(?:^|[^a-z0-9])'+skill.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(text));
}
function normalize(record,url,{source,keywords,location,days,now}){
 if(record.url&&canonical(record.url,source)!==url)return null;
 const title=plain(record.title,160),company=plain(record.hiringOrganization?.name,120),description=plain(record.description);
 if(!title||!company||!description)return null;
 const posted=isoDate(record.datePosted),expiresAt=record.validThrough===undefined?null:isoDate(record.validThrough);
 if(!posted||record.validThrough!==undefined&&!expiresAt||!isRecentJob({posted,expiresAt},{now,days}))return null;
 const geo=geography(record,location);if(!geo)return null;
 const job={id:'live_'+createHash('sha256').update(source+'|'+url).digest('hex').slice(0,24),title,company,description,skills:listingSkills(title+' '+description),years:0,experienceKnown:false,...geo,source,provider:'Browser search',sourceUrl:url,url,posted,expiresAt,type:plain(list(record.employmentType).map(t=>plain(t,80)).filter(Boolean).join(', '),80)||'Not listed',salary:'Not listed',sample:false,color:'mint',initials:company.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()};
 job.matchedKeywords=matchedKeywords(job,keywords);return job.matchedKeywords.length?job:null;
}
export function parseBrowserJobPage(snapshot,{source,keywords=[],location='pakistan-remote',days=30,now=Date.now()}={}){
 try{
  if(!['Indeed','LinkedIn'].includes(source)||!['pakistan','pakistan-remote','remote-worldwide'].includes(location)||!Array.isArray(keywords)||keywords.length>7||keywords.some(k=>typeof k!=='string'||k.length>60)||!Number.isFinite(now)||!Number.isFinite(days)||days<1||days>30)return null;
  const url=canonical(snapshot?.url,source);if(!url)return null;
  const records=postings(snapshot.jsonLd);
  for(const record of records){const job=normalize(record,url,{source,keywords,location,days,now});if(job)return job;}
  if(records.length||source!=='LinkedIn')return null;
  const posted=relativeDate(snapshot.postedText,now);if(!posted)return null;
  return normalize({title:snapshot.jobTitle||snapshot.titleText,hiringOrganization:{name:snapshot.company},description:snapshot.description,datePosted:posted,jobLocation:{name:plain(snapshot.location,500)},jobLocationType:/\bremote\b/i.test(string(snapshot.location))?'TELECOMMUTE':undefined},url,{source,keywords,location,days,now});
 }catch{return null;}
}

// Parse only the JSON assignment that Indeed publishes for its public search cards.
// Never execute page scripts or infer posting dates from search-engine snippets.
function indeedCardData(scripts){
 for(const script of (Array.isArray(scripts)?scripts:[]).slice(0,5)){
  if(typeof script!=='string'||script.length>2*MAX_JSON)continue;
  const marker=/window\.mosaic\.providerData\s*\[\s*["']mosaic-provider-jobcards["']\s*\]\s*=\s*/.exec(script);if(!marker)continue;
  const start=marker.index+marker[0].length;if(script[start]!=='{')continue;let depth=0,quoted=false,escaped=false;
  for(let index=start;index<script.length&&index-start<MAX_JSON;index++){
   const c=script[index];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{const data=JSON.parse(script.slice(start,index+1));const rows=data?.metaData?.mosaicProviderJobCardsModel?.results;return Array.isArray(rows)?rows.slice(0,100):[];}catch{break;}}
  }
 }return [];
}
export function parseIndeedSearchPage(snapshot,{keywords=[],location='pakistan-remote',days=30,now=Date.now(),limit=10}={}){
 try{
  const page=new URL(snapshot?.url);if(page.protocol!=='https:'||page.username||page.password||page.port||!['pk.indeed.com','www.indeed.com','indeed.com'].includes(page.hostname)||page.pathname!=='/jobs'||!Array.isArray(keywords)||!keywords.length||keywords.length>7||keywords.some(k=>typeof k!=='string'||k.length>60)||!['pakistan','pakistan-remote','remote-worldwide'].includes(location)||!Number.isFinite(now)||days<1||days>30)return [];
  const cards=Array.isArray(snapshot.indeedCards)?snapshot.indeedCards.slice(0,100):[],jobs=[],seen=new Set();
  for(const row of indeedCardData(snapshot.indeedScripts)){
   if(!row||typeof row!=='object'||typeof row.jobkey!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(row.jobkey)||seen.has(row.jobkey)||!Number.isSafeInteger(row.pubDate)||row.pubDate<=0||row.pubDate>now||row.pubDate<now-days*DAY)continue;
   const url=canonical(`https://${page.hostname}/viewjob?jk=${encodeURIComponent(row.jobkey)}`,'Indeed');
   const card=cards.find(c=>c.id===row.jobkey&&canonical(c.url,'Indeed')===url&&plain(c.title,160)===plain(row.title,160)&&plain(c.company,120)===plain(row.company,120)&&plain(c.location,150)===plain(row.formattedLocation,150));if(!card)continue;
   const job=normalize({title:row.title,hiringOrganization:{name:row.company},description:row.snippet,datePosted:new Date(row.pubDate).toISOString(),jobLocation:{address:{addressLocality:row.formattedLocation,addressCountry:row.country}},jobLocationType:row.remoteLocation===true?'TELECOMMUTE':undefined,employmentType:row.jobTypes},url,{source:'Indeed',keywords,location,days,now});
   if(!job)continue;job.descriptionIsExcerpt=true;job.verification='Indeed public search card';job.postedSource='Indeed pubDate';job.salary=plain(row.salarySnippet?.text,160)||'Not listed';seen.add(row.jobkey);jobs.push(job);if(jobs.length>=Math.max(1,Math.min(20,limit)))break;
  }return jobs;
 }catch{return [];}
}

export function nextIndeedSearchPage(snapshot){
 try{const current=new URL(snapshot.url),next=new URL(snapshot.indeedNextPage,current);if(!snapshot.indeedNextPage||current.protocol!=='https:'||next.protocol!=='https:'||current.username||current.password||current.port||next.username||next.password||next.port||!['pk.indeed.com','www.indeed.com','indeed.com'].includes(current.hostname)||next.hostname!==current.hostname||current.pathname!=='/jobs'||next.pathname!=='/jobs')return null;
 const fold=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');if(fold(current.searchParams.get('q'))!==fold(next.searchParams.get('q'))||fold(current.searchParams.get('l'))!==fold(next.searchParams.get('l')))return null;
 const offset=next.searchParams.get('start');if(!/^\d{1,4}$/.test(offset||'')||Number(offset)<=Number(current.searchParams.get('start')||0)||Number(offset)>1000)return null;current.searchParams.delete('vjk');current.searchParams.set('start',String(Number(offset)));return current.href;
 }catch{return null;}
}
