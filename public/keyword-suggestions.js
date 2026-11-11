import {suggestedKeywords} from './job-keywords.js';
const clean=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/word\s+press/g,'wordpress').replace(/square\s+space/g,'squarespace').replace(/front[ -]end/g,'frontend').replace(/[‐‑–—_-]/g,' ').replace(/\s+/g,' ').trim();
const catalog=[
 ['WordPress developer','wordpress cms php website'],['WordPress theme developer','wordpress themes cms php'],['WordPress Elementor developer','wordpress elementor cms website'],['WordPress plugin developer','wordpress plugins php cms'],
 ['Shopify developer','shopify ecommerce liquid store'],['Shopify theme developer','shopify themes liquid ecommerce'],['Shopify Liquid developer','shopify liquid templates ecommerce'],['Shopify app developer','shopify apps javascript ecommerce'],
 ['Wix developer','wix velo cms website'],['Wix Studio developer','wix studio velo website'],['Squarespace developer','squarespace cms website'],['Squarespace designer','squarespace design website'],['CMS developer','cms wordpress shopify wix squarespace webflow'],
 ['Elementor developer','elementor wordpress cms'],['WooCommerce developer','woocommerce wordpress php ecommerce'],['Webflow developer','webflow cms website'],['HubSpot CMS developer','hubspot cms hubl website'],['Drupal developer','drupal cms php'],['Joomla developer','joomla cms php'],
 ['Website developer','web website frontend html css'],['Web developer','web website frontend html css'],['Front-end developer','frontend javascript html css react'],['HTML CSS developer','html css frontend website'],['JavaScript developer','javascript frontend web'],['PHP developer','php backend wordpress laravel'],['Laravel developer','laravel php backend'],['React developer','react javascript frontend'],['Next.js developer','nextjs next.js react javascript frontend'],['Full Stack Developer','full stack javascript php frontend backend'],['E-commerce developer','ecommerce shopify woocommerce stores'],['Website maintenance developer','website wordpress maintenance support'],['UI UX designer','ui ux design figma website']
];
function distance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const before=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=before;}}return row[b.length];}
export function keywordSuggestions(input='',{profile={},selected=[],limit=8}={}){
 const fragments=String(input).slice(0,430).split(/[,;\n]/),query=clean(fragments.pop()),chosen=new Set([...selected,...fragments].map(clean).filter(Boolean));if(chosen.size>=7)return [];
 const preferred=suggestedKeywords(profile),pool=[...new Map([...preferred.map(k=>[k,'']),...catalog].map(([keyword,terms])=>[clean(keyword),{keyword,terms}])).values()];
 const words=query.split(/\s+/).filter(Boolean),ranked=[];
 for(const item of pool){const normalized=clean(item.keyword);if(chosen.has(normalized))continue;let rank=0;
  if(!query)rank=100;
  else if(normalized.startsWith(query))rank=600;
  else if(normalized.includes(query))rank=500;
  else{const target=clean(item.keyword+' '+item.terms).split(/\s+/);if(words.every(word=>target.some(t=>t.startsWith(word))))rank=300;else if(words.every(word=>word.length>=3&&target.some(t=>distance(word,t)<=(word.length>=6?2:1))))rank=150;}
  if(rank){const profileIndex=preferred.findIndex(k=>clean(k)===normalized);if(profileIndex>=0)rank+=30-profileIndex;ranked.push({...item,rank});}
 }
 return ranked.sort((a,b)=>b.rank-a.rank).slice(0,Math.max(1,Math.min(12,Number(limit)||8))).map(item=>item.keyword);
}
