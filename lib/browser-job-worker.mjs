import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {parseBrowserJobPage,parseIndeedSearchPage,nextIndeedSearchPage,extractGoogleJobLinks} from './browser-job-parser.mjs';

import {matchedKeywords} from '../public/job-keywords.js';
import {isRecentJob} from '../public/job-results.js';
const SOURCES=['LinkedIn','Indeed'];
const MANUAL_HOSTS=new Set(['accounts.google.com','consent.google.com','secure.indeed.com','auth.indeed.com']);
const clone=value=>value?structuredClone(value):null;
function problem(message,status=400){return Object.assign(new Error(message),{status});}
function allowed(url,source){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;return source==='Google'?u.hostname==='www.google.com'||u.hostname==='google.com':source==='Indeed'?['indeed.com','www.indeed.com','pk.indeed.com'].includes(u.hostname):['linkedin.com','www.linkedin.com','pk.linkedin.com'].includes(u.hostname);}catch{return false;}}
function detailUrl(url,source){if(!allowed(url,source))return false;const u=new URL(url);return source==='Indeed'?/^\/(?:viewjob|rc\/clk)$/.test(u.pathname)&&/^[a-zA-Z0-9]+$/.test(u.searchParams.get('jk')||''):/^\/jobs\/view\/(?:[^/?]+-)?\d+\/?$/.test(u.pathname);}
function challenge(snapshot,httpStatus){
 const url=snapshot.url||'',text=`${snapshot.title||''}\n${snapshot.text||''}`.slice(0,100000);
 if(httpStatus===403||httpStatus===429)return 'The website has restricted this request. Resolve the restriction in the visible browser, then press Resume.';
 if(/\/sorry(?:\/|\?)|\/checkpoint(?:\/|\?)|\/authwall|\/login|\/uas\/login|accounts\.google\.com|consent\.google\.com|(?:secure|auth)\.indeed\.com/i.test(url)||/verify (?:that )?you are human|verify (?:your )?identity|complete (?:the |a )?captcha|unusual traffic|security verification|access denied|\bforbidden\b|too many requests|sign in to (?:view|continue)|log in to continue|checking your browser|just a moment\.\.\./i.test(text))return 'The website requires a manual CAPTCHA, sign-in, consent, or access check. Complete it in the visible browser, then press Resume.';
 return null;
}
async function snapshot(page){return page.evaluate(()=>{
 const pick=selectors=>{for(const selector of selectors){const el=document.querySelector(selector);if(el?.textContent?.trim())return el.textContent.trim();}return '';};
 return {url:location.href,title:document.title,indeedNextPage:document.querySelector('a[data-testid="pagination-page-next"],a[aria-label="Next Page"],a[aria-label="Next"]')?.href||null,text:(document.body?.innerText||'').slice(0,100000),jsonLd:[...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,30).map(el=>(el.textContent||'').slice(0,250000)),indeedScripts:location.hostname.endsWith('indeed.com')?[...document.querySelectorAll('script:not([src])')].map(el=>el.textContent||'').filter(text=>text.includes('mosaic-provider-jobcards')).slice(0,5).map(text=>text.slice(0,1048576)):[],indeedCards:[...document.querySelectorAll('.job_seen_beacon a[data-jk]')].slice(0,100).map(a=>{const card=a.closest('.job_seen_beacon');return {id:a.dataset.jk,url:a.href,title:a.querySelector('span[title]')?.textContent?.trim()||a.textContent.trim(),company:card.querySelector('[data-testid="company-name"]')?.textContent?.trim()||'',location:card.querySelector('[data-testid="text-location"]')?.textContent?.trim()||''};}),links:[...document.querySelectorAll('a[href]')].slice(0,1500).map(el=>({href:el.href,text:(el.textContent||'').slice(0,300)})),jobTitle:pick(['.top-card-layout__title','.topcard__title','h1']),company:pick(['.topcard__org-name-link','.topcard__flavor']),location:pick(['.topcard__flavor--bullet']),description:pick(['.show-more-less-html__markup','.description__text']),postedText:pick(['.posted-time-ago__text','.topcard__flavor--metadata'])};
 });}

/** One visible, serial, read-only browser run. Browser dependency is injectable for tests. */
export function createBrowserJobWorker({dataDir,chromium,fallbackSearch,now=Date.now,headless=false,onError=()=>{},onComplete=()=>{}}={}){
 if(!dataDir)throw problem('A local data directory is required.');
 const states=new Map();let active=null,closed=false;
 const timestamp=()=>new Date(now()).toISOString();
 function update(run,fields){Object.assign(run.state,fields,{lastUpdatedAt:timestamp()});}
 async function dispose(run){if(run.disposal)return run.disposal;const context=run.context;run.context=null;if(context){run.disposal=context.close().catch(()=>{}).finally(()=>{run.disposal=null;});await run.disposal;}}
 function finish(run,status,message){run.state.jobs=run.state.jobs.filter(job=>isRecentJob(job,{days:Math.min(run.days,14),now:now()})).sort((a,b)=>Date.parse(b.posted)-Date.parse(a.posted));run.state.keywordProgress=run.state.keywordProgress.map(item=>({...item,status:status==='cancelled'?'cancelled':status==='error'?'failed':run.blockedSources.has('Indeed')&&item.status!=='completed'?'blocked':'completed',matched:run.state.jobs.filter(job=>job.matchedKeywords?.includes(item.keyword)).length}));update(run,{status,phase:status,message,nextRefreshAt:new Date(now()+3600000).toISOString()});if(['completed','needs_attention'].includes(status))try{onComplete(run.userId,clone(run.state));}catch(error){try{onError(error);}catch{}update(run,{status:'error',phase:'error',message:'Jobs were fetched but could not be saved. Please try again.'});}}
 function release(run){if(active===run)active=null;}
 function owns(userId){return states.get(String(userId));}
 function checkOwner(userId){const run=owns(userId);if(!run)throw problem('No browser search exists for this account.',404);return run;}
 function cancelled(run){return run.state.status==='cancelled'||closed;}
 function pause(run,reason){update(run,{status:'paused',message:reason});}
 async function execute(run,recheck=false){
  try{
   if(!run.context){
    let engine=chromium;if(!engine){process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve(dataDir,'playwright-browsers');engine=(await import('playwright')).chromium;}
    const profile=join(resolve(dataDir),headless?'scheduled-browser-profiles':'browser-profiles',createHash('sha256').update(run.userId).digest('hex'));
    await mkdir(profile,{recursive:true});if(cancelled(run))return;
    const context=await engine.launchPersistentContext(profile,{headless,viewport:headless?{width:1280,height:800}:null,timeout:30000});run.context=context;
    if(cancelled(run)){await dispose(run);return;}
    if(context.route)await context.route('**/*',async route=>{const request=route.request();let manualHost=false,mainNavigation=false;try{mainNavigation=request.isNavigationRequest()&&request.frame().parentFrame()===null;}catch{mainNavigation=request.isNavigationRequest();}try{const url=new URL(request.url());manualHost=url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&MANUAL_HOSTS.has(url.hostname);}catch{}if(mainNavigation&&!manualHost&&!['Google',...SOURCES].some(source=>allowed(request.url(),source)))await route.abort();else await route.continue();});
    run.page=context.pages()[0]||await context.newPage();run.page.setDefaultTimeout(15000);run.page.setDefaultNavigationTimeout(30000);
    run.page.on?.('response',response=>{try{if(response.request().isNavigationRequest()&&response.frame()===run.page.mainFrame())run.httpStatus=response.status();}catch{}});
   }
   while(run.index<run.steps.length){
    if(cancelled(run))return;
    const step=run.steps[run.index];run.state.keywordProgress=run.state.keywordProgress.map(item=>item.keyword===step.keyword?{...item,status:'searching'}:item);if(run.blockedSources.has(step.source)){run.index++;continue;}update(run,{phase:step.kind==='discovery'?'discovering':'verifying',message:`${step.kind==='discovery'?'Finding':'Verifying'} ${step.source} jobs for ${step.keyword}.`,progress:{completed:run.index,total:run.steps.length}});
    // A completed manual sign-in can return to the board homepage.
    // Resume the pending search there; keep access checks on their current page.
    if(recheck&&step.kind==='discovery'&&step.source==='Indeed'&&allowed(run.page.url(),'Indeed')&&new URL(run.page.url()).pathname==='/')recheck=false;
    if(!recheck){const response=await run.page.goto(step.url,{waitUntil:'domcontentloaded',timeout:30000});run.httpStatus=response?.status()||0;}
    recheck=false;if(cancelled(run))return;
    // Search results and JobPosting JSON-LD can arrive after DOMContentLoaded.
    if(run.page.waitForLoadState)await run.page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
    if(cancelled(run))return;
    const view=await snapshot(run.page);if(cancelled(run))return;
    const reason=challenge(view,run.httpStatus);if(reason){if(headless){run.blockedSources.add(step.source);run.index++;continue;}pause(run,reason);return;}
    if(!allowed(view.url,step.discoveryHost||step.source)){pause(run,'The browser reached an unexpected website. Return to the requested public jobs page, then press Resume.');return;}
    if(step.kind==='discovery'){
     const publicSearch=step.source==='Indeed'&&step.discoveryHost==='Indeed';
     const publicJobs=publicSearch?parseIndeedSearchPage(view,{keywords:[step.keyword],location:run.state.location,days:run.days,now:now(),limit:20}):[];
     if(publicSearch){
      const key=step.keyword,info=run.keywordPages.get(key)||{pages:0,ids:new Set(),urls:new Set()};info.pages++;info.urls.add(step.url);
      const rawIds=(view.indeedCards||[]).map(card=>card.id).filter(Boolean),newIds=rawIds.filter(id=>!info.ids.has(id));for(const id of rawIds)info.ids.add(id);
      for(const job of publicJobs){const existing=run.state.jobs.find(item=>item.id===job.id||item.url===job.url);if(existing){existing.matchedKeywords=matchedKeywords(existing,run.state.keywords);continue;}if(run.state.jobs.filter(item=>item.matchedKeywords?.includes(key)).length>=30)break;job.matchedKeywords=matchedKeywords(job,run.state.keywords);run.state.jobs.push(job);}
      const count=run.state.jobs.filter(job=>job.matchedKeywords?.includes(key)).length,next=nextIndeedSearchPage(view);
      const follow=!!next&&count<30&&info.pages<10&&!info.urls.has(next)&&(info.pages===1||newIds.length>0);
      if(follow)run.steps.splice(run.index+1,0,{...step,url:next,page:(step.page||1)+1,fallbackUrl:null});
      run.keywordPages.set(key,info);run.state.jobs.sort((a,b)=>Date.parse(b.posted)-Date.parse(a.posted));run.state.keywordProgress=run.state.keywordProgress.map(item=>({...item,...(item.keyword===key?{pages:info.pages,status:follow?'searching':'completed'}:{}),matched:run.state.jobs.filter(job=>job.matchedKeywords?.includes(item.keyword)).length}));
      // Public cards already provide verified summaries/dates; do not open gated detail pages.
      if(rawIds.length||publicJobs.length||follow){run.index++;update(run,{progress:{completed:run.index,total:run.steps.length}});continue;}
     }
     const urls=extractGoogleJobLinks(view,{source:step.source,limit:5}).filter(url=>detailUrl(url,step.source));
     const details=urls.filter(url=>!run.seenUrls.has(url)).slice(0,5).map(url=>{run.seenUrls.add(url);return {kind:'detail',url,source:step.source,keyword:step.keyword};});
     if(!urls.length&&step.fallbackUrl)details.push({kind:'discovery',url:step.fallbackUrl,source:step.source,keyword:step.keyword,discoveryHost:'Google'});
     run.steps.splice(run.index+1,0,...details);
    }else{
     const job=parseBrowserJobPage(view,{source:step.source,keywords:run.state.keywords,location:run.state.location,days:run.days,now:now()});
     if(job&&!run.state.jobs.some(existing=>existing.id===job.id||existing.sourceUrl===job.sourceUrl))run.state.jobs.push(job);
    }
    run.index++;update(run,{progress:{completed:run.index,total:run.steps.length}});
   }
   if(cancelled(run))return;
   update(run,{progress:{completed:run.index,total:run.steps.length},sources:run.state.boards.map(name=>({name,status:run.blockedSources.has(name)?'error':'ok',...(run.blockedSources.has(name)?{}:{fetchedAt:timestamp()}),message:run.blockedSources.has(name)?'Website access check blocked this board. Automatic verification is unavailable.':'Public browser search completed; only verified recent listings are included.'}))});
   if(!run.state.jobs.length&&run.useBackup&&fallbackSearch){
    update(run,{phase:'backup',message:'No verified browser jobs found. Checking the enabled backup.'});
    const backup=await fallbackSearch({keywords:run.state.keywords,location:run.state.location,days:run.days});
    if(cancelled(run))return;
    run.state.jobs=Array.isArray(backup?.jobs)?backup.jobs.slice(0,120):[];run.state.sources.push(...(Array.isArray(backup?.sources)?backup.sources:[]));
   }
   await dispose(run);if(!cancelled(run)){finish(run,run.blockedSources.size?'needs_attention':'completed',run.blockedSources.size?`Found ${run.state.jobs.length} verified jobs. A website access check blocked ${[...run.blockedSources].join(', ')}.`:run.state.jobs.length?`Found ${run.state.jobs.length} verified jobs.`:'No verified recent jobs found for these keywords.');release(run);}
  }catch(error){
   try{onError(error);}catch{}
   if(cancelled(run))return;
   await dispose(run);if(!cancelled(run)){finish(run,'error','The local browser search could not continue. Check that Chromium is installed and try again.');release(run);}
  }
 }
 function launch(run,recheck=false){run.promise=execute(run,recheck);return run.promise;}
 return {
  start(userId,input={}){
   if(closed)throw problem('The browser worker is closed.',503);if(active)throw problem('A browser search is already running or waiting for manual action.',409);
   if(!userId)throw problem('An account is required.',401);
   const sources=input.sources??SOURCES;if(!Array.isArray(sources)||sources.length<1||sources.length>2||new Set(sources).size!==sources.length||sources.some(name=>!SOURCES.includes(name)))throw problem('Choose Indeed, LinkedIn or both job boards.');
   const keywords=Array.isArray(input.keywords)?[...new Set(input.keywords.filter(k=>typeof k==='string').map(k=>k.trim()).filter(Boolean))]:[];
   if(!keywords.length||keywords.length>7||keywords.some(k=>k.length>100))throw problem('Enter between 1 and 7 job keywords.');
   const location=input.location||'pakistan-remote';if(!['pakistan','pakistan-remote','remote-worldwide'].includes(location))throw problem('Choose a supported job location.');
   const requestedDays=input.days??14;const days=Math.min(requestedDays,14);if(!Number.isInteger(requestedDays)||requestedDays<1||requestedDays>30)throw problem('Choose a date range between 1 and 30 days.');
   const after=new Date(now()-days*86400000).toISOString().slice(0,10),steps=keywords.flatMap(keyword=>sources.map(source=>{
    const url=new URL('https://www.google.com/search');url.searchParams.set('q',`${keyword} ${location==='remote-worldwide'?'worldwide remote':'Pakistan'} site:${source==='Indeed'?'indeed.com/viewjob':'linkedin.com/jobs/view'} after:${after}`);url.searchParams.set('num','10');
    const direct=new URL(source==='Indeed'?'https://pk.indeed.com/jobs':'https://www.linkedin.com/jobs/search/');
    if(source==='Indeed'){direct.searchParams.set('q',keyword);direct.searchParams.set('l',location==='remote-worldwide'?'Remote':'Pakistan');}
    else{direct.searchParams.set('keywords',keyword);direct.searchParams.set('location',location==='remote-worldwide'?'Worldwide':'Pakistan');direct.searchParams.set('f_TPR',`r${days*86400}`);direct.searchParams.set('sortBy','DD');if(location==='remote-worldwide')direct.searchParams.set('f_WT','2');}
    return {kind:'discovery',source,keyword,url:direct.href,discoveryHost:source,fallbackUrl:url.href};
   }));
   const state={id:randomUUID(),scheduled:input.scheduled===true,status:'running',phase:'starting',message:'Opening the visible local browser.',progress:{completed:0,total:steps.length},jobs:[],keywordProgress:keywords.map(keyword=>({keyword,pages:0,matched:0,status:'pending'})),boards:[...sources],sources:sources.map(name=>({name,status:'pending'})),keywords,location,days,useBackup:input.useBackup===true,searchedAt:timestamp(),lastUpdatedAt:timestamp(),nextRefreshAt:null};
   const run={userId:String(userId),state,days,useBackup:input.useBackup===true,steps,index:0,seenUrls:new Set(),keywordPages:new Map(),blockedSources:new Set(),context:null};states.delete(run.userId);states.set(run.userId,run);while(states.size>100)states.delete(states.keys().next().value);active=run;
   // Capture the immediate status before asynchronous browser launch can update it.
   const result=clone(state);queueMicrotask(()=>{if(!cancelled(run))launch(run);});return result;
  },
  get(userId){const state=clone(owns(userId)?.state);if(state){state.jobs=state.jobs.filter(job=>isRecentJob(job,{days:Math.min(state.days,14),now:now()}));state.keywordProgress=state.keywordProgress.map(item=>({...item,matched:state.jobs.filter(job=>job.matchedKeywords?.includes(item.keyword)).length}));}return state;},
  resume(userId){const run=checkOwner(userId);if(run.state.status!=='paused')throw problem('This browser search is not paused.',409);update(run,{status:'running',message:'Rechecking the current page.'});const result=clone(run.state);launch(run,true);return result;},
  async cancel(userId){const run=checkOwner(userId);if(['running','paused','cancelled'].includes(run.state.status)){finish(run,'cancelled','Browser search cancelled.');await dispose(run);await run.promise;await dispose(run);release(run);}return clone(run.state);},
  async close(){closed=true;const run=active;if(run){finish(run,'cancelled','Browser search stopped.');await dispose(run);await run.promise;await dispose(run);release(run);}},
 };
}

