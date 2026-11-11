const fold=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[‐‑–—_-]/g,' ').replace(/\s+/g,' ').trim();
export function normaliseKeywords(value){
 const parts=typeof value==='string'?value.split(/[,;\n]+/):value;
 if(!Array.isArray(parts)||parts.length>100||parts.some(v=>typeof v!=='string'||/[\x00-\x1f\x7f]/.test(v)))throw new Error('Enter job keywords as text, separated by commas.');
 const output=[],seen=new Set();
 for(const item of parts){const clean=item.trim().replace(/\s+/g,' ');if(!clean)continue;if(clean.length<2||clean.length>60)throw new Error('Each keyword must be between 2 and 60 characters.');const key=fold(clean);if(!seen.has(key)){output.push(clean);seen.add(key);}}
 if(!output.length)throw new Error('Add at least one keyword to find jobs.');
 if(output.length>7)throw new Error('You can save up to seven keywords.');return output;
}
const roleWords=new Set(['developer','development','engineer','engineering','designer','design','programmer','programming','specialist','consultant','manager','analyst','architect','lead','senior','junior']);
const variants={developer:['developer','development','engineer','engineering','programmer'],development:['developer','development','engineer','engineering'],engineer:['engineer','engineering','developer'],designer:['designer','design','developer'],design:['designer','design'],cms:['cms','wordpress','shopify','wix','squarespace','webflow','drupal','joomla','hubspot'],website:['website','web','frontend','front end'],web:['web','website','frontend','front end'],frontend:['frontend','front end'],wordpress:['wordpress','word press']};
const tokens=s=>fold(s).match(/[\p{L}\p{N}+#.]+/gu)||[];
const contains=(hay,word)=>{const candidates=variants[word]||[word];return candidates.some(v=>new RegExp(`(?:^|[^\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^\\p{L}\\p{N}])`,'u').test(hay));};
export function matchedKeywords(job,keywords){
 const title=fold(job.title||job.jobTitle),tags=fold([...(Array.isArray(job.categories)?job.categories:[]),...(Array.isArray(job.skills)?job.skills:[])].join(' '));
 const body=fold(`${job.description||job.jobDescription||''} ${job.excerpt||''}`);
 return keywords.filter(keyword=>{const words=tokens(keyword).filter(w=>!['and','or','&','the','a'].includes(w));if(!words.length)return false;
  if(words.every(w=>contains(title,w)))return true;
  const roles=words.filter(w=>roleWords.has(w));const specialisms=words.filter(w=>!roleWords.has(w));
  if(roles.length&&!roles.some(w=>contains(title,w)))return false;
  if(!roles.length)return words.every(w=>contains(title+' '+tags,w))||(words.length===1&&contains(body,words[0])&&/\b(developer|engineer|designer|programmer|architect)\b/.test(title));
  return specialisms.length>0&&specialisms.every(w=>contains(title+' '+tags+' '+body,w));
 });
}
export function suggestedKeywords(profile={}){
 const skillList=Array.isArray(profile.skills)?profile.skills:[];const result=[];
 for(const name of ['WordPress','Shopify','Wix','Squarespace','Elementor','Webflow','WooCommerce','Drupal','Joomla','HubSpot','JavaScript','PHP'])if(skillList.some(s=>fold(s).includes(fold(name))))result.push(`${name} developer`);
 if(typeof profile.role==='string'&&profile.role.trim()&&profile.role.trim().length<=60)result.push(profile.role.trim());
 for(const fallback of ['CMS developer','Website developer','WordPress developer','Shopify developer','Wix developer','Squarespace developer'])if(result.length<7)result.push(fallback);
 return normaliseKeywords([...new Map(result.map(s=>[fold(s),s])).values()].slice(0,7));
}
export function boardSearchLinks(keyword,location='pakistan-remote'){
 const q=encodeURIComponent(keyword),slug=encodeURIComponent(fold(keyword).replace(/\s+/g,'-'));
 const remote=location==='remote-worldwide';
 const links=[{name:'Indeed',url:remote?`https://www.indeed.com/jobs?q=${q}%20remote&l=Remote`:`https://pk.indeed.com/jobs?q=${q}&l=Pakistan`},{name:'LinkedIn',url:`https://www.linkedin.com/jobs/search/?keywords=${q}&location=${remote?'Worldwide':'Pakistan'}${remote?'&f_WT=2':''}`},{name:'Bayt',url:`https://www.bayt.com/en/${remote?'international':'pakistan'}/jobs/${slug}${remote?'-remote':''}-jobs/`}];
 if(!remote)links.push({name:'Rozee.pk',url:`https://www.rozee.pk/job/jsearch/q/${q}`},{name:'Mustakbil',url:`https://www.mustakbil.com/jobs/search?countryId=162&keywords=${q}`},{name:'NJP',url:'https://njp.gov.pk/'});
 if(location!=='pakistan')links.push({name:'We Work Remotely',url:`https://weworkremotely.com/remote-jobs/search?term=${q}`},{name:'Remote OK',url:`https://remoteok.com/remote-${slug}-jobs`},{name:'Remotive',url:`https://remotive.com/remote-jobs/search?search=${q}`},{name:'WordPress Jobs',url:`https://jobs.wordpress.net/?s=${q}`});
 return links;
}
export function activeSearchJobs(result,now=Date.now()){
 return (Array.isArray(result?.jobs)?result.jobs:[]).filter(job=>!job.expiresAt||Number.isFinite(Date.parse(job.expiresAt))&&Date.parse(job.expiresAt)>now);
}
export function resultMatchesPreferences(result,preferences){
 if(!result)return false;try{const key=values=>normaliseKeywords(values).map(fold).sort().join('|');return key(result.keywords)===key(preferences.keywords)&&(result.location||'pakistan-remote')===(preferences.location||'pakistan-remote');}catch{return false;}
}
