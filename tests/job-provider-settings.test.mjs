import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProviderSettings} from '../lib/job-provider-settings.mjs';
import {DatabaseSync} from 'node:sqlite';

test('Rozee credentials are separate, omission-safe, validated atomically and never returned in status',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-rozee-'));let settings;
 try{settings=createProviderSettings({dataDir:dir,env:{OPENWEBNINJA_API_KEY:'primary-key-123456789'}});
 const base={provider:'jsearch',enabled:true,dailyLimit:1,unlimited:true};
 settings.save({...base,rozeeApiKey:'rozee-key-123456789',rozeeEnabled:true});assert.equal(settings.getConfig().rozeeApiKey,'rozee-key-123456789');assert.deepEqual(settings.status().rozee,{configured:true,enabled:true});assert.equal(JSON.stringify(settings.status()).includes('rozee-key'),false);
 settings.save(base);assert.equal(settings.getConfig().rozeeApiKey,'rozee-key-123456789');assert.equal(settings.getConfig().rozeeEnabled,true);
 for(const extra of [{rozeeApiKey:'bad key'},{rozeeEnabled:'yes'},{removeRozeeKey:1}])assert.throws(()=>settings.save({...base,apiKey:'replacement-key-123456789',...extra}));assert.equal(settings.getConfig().apiKey,'primary-key-123456789');
 settings.close();settings=createProviderSettings({dataDir:dir,env:{}});assert.equal(settings.getConfig().rozeeEnabled,true);assert.equal(settings.status().unlimited,true);
 settings.save({...base,removeRozeeKey:true});assert.equal(settings.status().rozee.configured,false);assert.equal(settings.getConfig().rozeeEnabled,false);assert.equal(settings.getConfig().apiKey,'primary-key-123456789');
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});

test('backup credentials stay isolated and both providers consume the same daily allowance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-backup-'));let settings;
 try{settings=createProviderSettings({dataDir:dir,env:{}});
 settings.save({provider:'jsearch',apiKey:'primary-key-12345678',enabled:true,dailyLimit:2,fallbackApiKey:'backup-key-123456789',fallbackEnabled:true});
 assert.equal(settings.getConfig().fallbackApiKey,'backup-key-123456789');assert.equal(settings.getConfig().fallbackEnabled,true);
 assert.equal(settings.reserve('unsupported'),false);assert.equal(settings.reserve('searchapi'),true);assert.equal(settings.reserve(),true);assert.equal(settings.reserve('searchapi'),false);
 assert.equal(settings.getConfig().dailyLimitReached,true);assert.equal(settings.status().backup.usedTotal,1);assert.equal(settings.status().usedThisMonth,1);
 assert.equal(JSON.stringify(settings.status()).includes('backup-key'),false);assert.equal(settings.status().dailyResetsAt.endsWith('Z'),true);
 settings.save({provider:'jsearch',apiKey:'',enabled:true,dailyLimit:2});assert.equal(settings.getConfig().fallbackApiKey,'backup-key-123456789');
 settings.save({provider:'jsearch',enabled:false,dailyLimit:2,removeKey:true});assert.equal(settings.status().backup.configured,true);
 settings.close();settings=createProviderSettings({dataDir:dir,env:{}});assert.equal(settings.status().usedToday,2);
 settings.save({provider:'jsearch',enabled:false,dailyLimit:2,removeFallbackKey:true});assert.equal(settings.status().backup.configured,false);assert.equal(settings.status().backup.usedTotal,1);
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});

test('backup starter cap survives new days, months, key changes and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-backup-cap-'));let clock=Date.UTC(2026,10,10),settings;
 try{settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});settings.save({provider:'jsearch',enabled:false,dailyLimit:100,fallbackApiKey:'backup-key-123456789',fallbackEnabled:true});
 for(let i=0;i<100;i++)assert.equal(settings.reserve('searchapi'),true);
 clock=Date.UTC(2026,11,1);settings.close();settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});settings.save({provider:'jsearch',enabled:false,dailyLimit:100,fallbackApiKey:'replacement-key-123456789',fallbackEnabled:true});
 assert.equal(settings.reserve('searchapi'),false);assert.equal(settings.getConfig().backupLimitReached,true);assert.equal(settings.status().backup.remaining,0);assert.equal(settings.status().usedToday,0);assert.equal(settings.status().usedThisMonth,0);
 assert.equal(settings.status().dailyResetsAt,'2026-12-02T00:00:00.000Z');assert.equal(settings.status().monthlyResetsAt,'2027-01-01T00:00:00.000Z');
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});

test('backup settings reject invalid secrets and flags before mutating either provider',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-backup-validation-'));const settings=createProviderSettings({dataDir:dir,env:{}});
 try{for(const extra of [{fallbackApiKey:'not valid key!!'},{fallbackApiKey:'short'},{fallbackEnabled:'yes'},{removeFallbackKey:1}])assert.throws(()=>settings.save({provider:'jsearch',enabled:true,dailyLimit:14,...extra}));assert.equal(settings.status().configured,false);}
 finally{settings.close();await rm(dir,{recursive:true,force:true});}
});

test('provider secrets stay local, blank edits preserve them and usage survives restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-provider-'));let clock=Date.UTC(2026,10,10);
 let settings;try{settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});assert.equal(settings.status().configured,false);
 settings.save({provider:'jsearch',apiKey:'a'.repeat(64),enabled:true,dailyLimit:2});assert.equal(settings.status().configured,true);assert.equal(JSON.stringify(settings.status()).includes('a'.repeat(64)),false);
 assert.equal(settings.reserve(),true);settings.save({provider:'jsearch',apiKey:'',enabled:true,dailyLimit:2});assert.equal(settings.getConfig().apiKey,'a'.repeat(64));
 settings.close();settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});assert.equal(settings.status().usedToday,1);assert.equal(settings.reserve(),true);assert.equal(settings.reserve(),false);
 clock+=86400000;assert.equal(settings.reserve(),true);settings.save({provider:'jsearch',removeKey:true,enabled:false,dailyLimit:2});assert.equal(settings.status().configured,false);assert.equal(settings.reserve(),false);
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});
test('provider configuration rejects unsupported values',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-provider-'));
 const settings=createProviderSettings({dataDir:dir,env:{}});try{for(const p of [{apiKey:'bad key',enabled:true,dailyLimit:30},{apiKey:'a'.repeat(64),enabled:'yes',dailyLimit:30},{enabled:true,dailyLimit:0},{enabled:true,dailyLimit:101}])assert.throws(()=>settings.save({provider:'jsearch',...p}));}
 finally{settings.close();await rm(dir,{recursive:true,force:true});}
});
test('JSearch settings never reuse a legacy SerpApi key and reject stale provider forms',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-provider-migration-')),db=new DatabaseSync(join(dir,'legacy.sqlite'));
 try{db.exec('CREATE TABLE job_provider_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO job_provider_settings VALUES(?,?)').run('config',JSON.stringify({apiKey:'legacy-serpapi-key-should-not-transfer',enabled:true,dailyLimit:30}));
 const settings=createProviderSettings({dataDir:dir,db,env:{}});assert.equal(settings.status().provider,'JSearch');assert.equal(settings.status().configured,false);assert.equal(settings.getConfig().apiKey,'');assert.equal(settings.status().dailyLimit,14);
 assert.throws(()=>settings.save({apiKey:'jsearch-key-1234567890',enabled:true,dailyLimit:14}),/reload|provider/i);
 settings.save({provider:'jsearch',apiKey:'jsearch-key-1234567890',enabled:true,dailyLimit:14});assert.equal(settings.status().configured,true);assert.equal(settings.getConfig().apiKey,'jsearch-key-1234567890');
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('JSearch local monthly cap persists across days and restart independently of daily limits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-provider-monthly-'));let clock=Date.UTC(2026,10,10),settings;
 try{settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});settings.save({provider:'jsearch',apiKey:'jsearch-key-1234567890',enabled:true,dailyLimit:100});
 for(let i=0;i<100;i++)assert.equal(settings.reserve(),true);clock+=86400000;for(let i=0;i<100;i++)assert.equal(settings.reserve(),true);clock+=86400000;settings.close();settings=createProviderSettings({dataDir:dir,env:{},now:()=>clock});
 assert.equal(settings.status().usedToday,0);assert.equal(settings.status().usedThisMonth,200);assert.equal(settings.reserve(),false);settings.save({provider:'jsearch',apiKey:'another-key-1234567890',enabled:true,dailyLimit:100});assert.equal(settings.reserve(),false);
 clock=Date.UTC(2026,11,1);assert.equal(settings.reserve(),true);assert.equal(settings.status().usedThisMonth,1);
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});

test('unlimited mode removes local caps while retaining usage and credential checks across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jobdesk-unlimited-'));let settings;
 try{settings=createProviderSettings({dataDir:dir,env:{}});settings.save({provider:'jsearch',apiKey:'primary-key-12345678',enabled:true,dailyLimit:1,fallbackApiKey:'backup-key-123456789',fallbackEnabled:true,unlimited:true});
 for(let i=0;i<205;i++)assert.equal(settings.reserve(),true);
 for(let i=0;i<105;i++)assert.equal(settings.reserve('searchapi'),true);
 assert.equal(settings.getConfig().dailyLimitReached,false);assert.equal(settings.getConfig().primaryLimitReached,false);assert.equal(settings.getConfig().backupLimitReached,false);assert.equal(settings.status().usedToday,310);assert.equal(settings.status().unlimited,true);
 settings.close();settings=createProviderSettings({dataDir:dir,env:{}});assert.equal(settings.reserve(),true);assert.equal(settings.status().unlimited,true);
 settings.save({provider:'jsearch',enabled:false,dailyLimit:1});assert.equal(settings.status().unlimited,true);assert.equal(settings.reserve(),false);
 assert.throws(()=>settings.save({provider:'jsearch',enabled:true,dailyLimit:1,unlimited:'yes'}));
 settings.save({provider:'jsearch',enabled:true,dailyLimit:1,unlimited:false});assert.equal(settings.reserve(),false);
 }finally{settings?.close();await rm(dir,{recursive:true,force:true});}
});

test('web and cron connections share atomic allowances and immediately see disabled providers',async()=>{const dir=await mkdtemp(join(tmpdir(),'jobdesk-cross-process-'));let a,b;try{a=createProviderSettings({dataDir:dir,env:{}});a.save({provider:'jsearch',apiKey:'provider-key-123456789',enabled:true,dailyLimit:2});b=createProviderSettings({dataDir:dir,env:{}});assert.equal(a.reserve(),true);assert.equal(b.reserve(),true);assert.equal(a.reserve(),false);assert.equal(b.status().usedToday,2);a.save({provider:'jsearch',enabled:false,dailyLimit:3});assert.equal(b.getConfig().enabled,false);assert.equal(b.reserve(),false);assert.equal(a.status().usedToday,2);}finally{a?.close();b?.close();await rm(dir,{recursive:true,force:true});}});
