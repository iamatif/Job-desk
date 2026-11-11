import {mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';

export function createProviderSettings({dataDir,db:sharedDb,env=process.env,now=Date.now}){
 mkdirSync(dataDir,{recursive:true});const db=sharedDb||new DatabaseSync(join(dataDir,'job-search-settings.sqlite'));
 db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS job_provider_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 // Provider-specific rows deliberately isolate old SerpApi credentials and counters.
 const file='jsearch-config',usageFile='jsearch-usage',backupFile='searchapi-config',backupUsageFile='searchapi-usage',rozeeFile='apish-config';
 const read=key=>JSON.parse(db.prepare('SELECT value FROM job_provider_settings WHERE key=?').get(key)?.value||'{}');
 const write=(key,value)=>db.prepare('INSERT INTO job_provider_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 let config={apiKey:env.OPENWEBNINJA_API_KEY||'',enabled:!!env.OPENWEBNINJA_API_KEY,dailyLimit:14,...read(file)},usage=read(usageFile),backup={apiKey:'',enabled:false,...read(backupFile)},backupUsage=read(backupUsageFile),rozee={apiKey:'',enabled:false,...read(rozeeFile)};
 function refresh(){config={apiKey:env.OPENWEBNINJA_API_KEY||'',enabled:!!env.OPENWEBNINJA_API_KEY,dailyLimit:14,...read(file)};usage=read(usageFile);backup={apiKey:'',enabled:false,...read(backupFile)};backupUsage=read(backupUsageFile);rozee={apiKey:'',enabled:false,...read(rozeeFile)};}
 const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
 function day(){return new Date(now()).toISOString().slice(0,10);}
 function used(){return usage.day===day()?count(usage.used):0;}
 function monthlyUsed(){return usage.month===day().slice(0,7)?count(usage.monthlyUsed):0;}
 function backupUsed(){return count(backupUsage.usedTotal);}
 function resets(){const date=new Date(now());return {dailyResetsAt:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)).toISOString(),monthlyResetsAt:new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)).toISOString()};}
 function status(){refresh();return {rozee:{configured:!!rozee.apiKey,enabled:rozee.enabled===true},provider:'JSearch',providerId:'jsearch',configured:!!config.apiKey,enabled:config.enabled===true,dailyLimit:config.dailyLimit,unlimited:config.unlimited===true,usedToday:used(),remainingToday:Math.max(0,config.dailyLimit-used()),monthlyLimit:200,usedThisMonth:monthlyUsed(),remainingThisMonth:Math.max(0,200-monthlyUsed()),backup:{provider:'SearchApi',configured:!!backup.apiKey,enabled:backup.enabled===true,usedTotal:backupUsed(),requestLimit:100,remaining:Math.max(0,100-backupUsed())},...resets()};}
 function save(value){
  if(value?.provider!=='jsearch')throw new Error('The job search provider changed. Reload Account settings before saving your JSearch key.');
  if(!value||typeof value!=='object'||typeof value.enabled!=='boolean'||!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>100)throw new Error('Choose a daily limit between 1 and 100 requests.');
  for(const [field,label] of [['apiKey','OpenWeb Ninja'],['fallbackApiKey','SearchApi'],['rozeeApiKey','API.SH']])if(value[field]!==undefined&&(typeof value[field]!=='string'||value[field]&&!/^[a-zA-Z0-9._-]{16,256}$/.test(value[field].trim())))throw new Error(`Enter a valid ${label} API key.`);
  for(const field of ['removeKey','fallbackEnabled','removeFallbackKey','unlimited','rozeeEnabled','removeRozeeKey'])if(value[field]!==undefined&&typeof value[field]!=='boolean')throw new Error('Choose a valid connection action.');
  db.exec('BEGIN IMMEDIATE');try{refresh();
  const next={apiKey:value.removeKey?'':value.apiKey?.trim()||config.apiKey,enabled:value.enabled,dailyLimit:value.dailyLimit,unlimited:value.unlimited??config.unlimited??false};
  const nextBackup={apiKey:value.removeFallbackKey?'':value.fallbackApiKey?.trim()||backup.apiKey,enabled:value.removeFallbackKey?false:value.fallbackEnabled??backup.enabled};
  const nextRozee={apiKey:value.removeRozeeKey?'':value.rozeeApiKey?.trim()||rozee.apiKey,enabled:value.removeRozeeKey?false:value.rozeeEnabled??rozee.enabled};
  write(file,next);write(backupFile,nextBackup);write(rozeeFile,nextRozee);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return status();
 }
 function reserve(provider='jsearch'){
  db.exec('BEGIN IMMEDIATE');try{refresh();
   let allowed=['jsearch','searchapi'].includes(provider)&&!(!config.unlimited&&used()>=config.dailyLimit);
   if(provider==='jsearch'&&(!config.enabled||!config.apiKey||(!config.unlimited&&monthlyUsed()>=200)))allowed=false;
   if(provider==='searchapi'&&(!backup.enabled||!backup.apiKey||(!config.unlimited&&backupUsed()>=100)))allowed=false;
   if(allowed){write(usageFile,{day:day(),used:used()+1,month:day().slice(0,7),monthlyUsed:monthlyUsed()+(provider==='jsearch'?1:0)});if(provider==='searchapi')write(backupUsageFile,{usedTotal:backupUsed()+1});}
   db.exec('COMMIT');return allowed;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }

 return {getConfig:()=>{refresh();return {...config,rozeeApiKey:rozee.apiKey,rozeeEnabled:rozee.enabled===true,provider:'jsearch',fallbackApiKey:backup.apiKey,fallbackEnabled:backup.enabled===true,dailyLimitReached:!config.unlimited&&used()>=config.dailyLimit,primaryLimitReached:!config.unlimited&&monthlyUsed()>=200,backupLimitReached:!config.unlimited&&backupUsed()>=100};},status,save,reserve,close:()=>{if(!sharedDb)db.close();}};
}

