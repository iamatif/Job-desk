const DAY=86400000;
const WINDOWS={latest:14,day:1,threeDays:3,week:7,fortnight:14};
export function jobSourceNames(job){return [...new Set([job.source,...(Array.isArray(job.applyOptions)?job.applyOptions:[]).map(o=>o.name)].filter(v=>typeof v==='string'&&v))];}
export function isRecentJob(job,{days=30,now=Date.now()}={}){
 const posted=typeof job?.posted==='string'?Date.parse(job.posted):NaN;
 const expires=job?.expiresAt?Date.parse(job.expiresAt):null;
 return Number.isFinite(posted)&&posted<=now&&posted>=now-days*DAY&&(expires===null||Number.isFinite(expires)&&expires>now);
}
export function selectSearchJobs(jobs,{period='latest',source='',keyword='',sort='newest',now=Date.now()}={}){
 const current=(Array.isArray(jobs)?jobs:[]).filter(job=>isRecentJob(job,{days:WINDOWS[period]||14,now})&&(!keyword||job.matchedKeywords?.includes(keyword))&&(!source||jobSourceNames(job).includes(source)));
 current.sort((a,b)=>Date.parse(b.posted)-Date.parse(a.posted));
 if(sort==='newest')return current;
 if(sort==='preferred'){
  const tiers=[[],[],[]];for(const job of current){const names=jobSourceNames(job);tiers[names.some(n=>['Indeed','LinkedIn'].includes(n))?0:names.some(n=>['Rozee.pk','Bayt'].includes(n))?1:2].push(job);}
  const mixed=tiers.map(items=>{const groups=new Map();for(const job of items){if(!groups.has(job.source))groups.set(job.source,[]);groups.get(job.source).push(job);}const output=[];for(let i=0;output.length<items.length;i++)for(const group of groups.values())if(group[i])output.push(group[i]);return output;});
  const output=[];while(output.length<current.length)for(const tier of [0,0,1,1,2])if(mixed[tier].length)output.push(mixed[tier].shift());return output;
 }
 const groups=new Map();for(const job of current){const key=job.source||job.provider||'Other';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);}
 const result=[];for(let index=0;result.length<current.length;index++)for(const group of groups.values())if(index<group.length)result.push(group[index]);
 return result;
}

export function jobFreshness(job,{now=Date.now(),first=false}={}){if(!isRecentJob(job,{now,days:14}))return null;return first?'Newest':now-Date.parse(job.posted)<=DAY?'New':null;}
export function freshFeedState(state,now=Date.now()){if(!state)return state;const jobs=selectSearchJobs(state.jobs||[],{now,sort:'newest'});return {...state,days:Math.min(Number(state.days)||14,14),jobs,...(Array.isArray(state.keywordProgress)?{keywordProgress:state.keywordProgress.map(item=>({...item,matched:jobs.filter(job=>job.matchedKeywords?.includes(item.keyword)).length}))}:{})};}
