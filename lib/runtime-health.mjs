import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function installationBuild(){
 const hash=createHash('sha256');
 for(const name of ['server.mjs','public/app.js','public/keyword-search.css','lib/scheduled-jobs.mjs','public/job-schedule-ui.js','public/keyword-search.js','lib/browser-job-worker.mjs','lib/browser-job-parser.mjs','public/browser-worker-ui.js','public/browser-worker.css','public/settings-tabs.js','public/settings-tabs.css','package-lock.json','public/profile-data.js','lib/runtime-health.mjs','lib/job-search.mjs','lib/rozee-search.mjs','lib/linkedin-public-search.mjs','lib/public-feed-cache.mjs','lib/additional-job-search.mjs','lib/job-provider-settings.mjs','public/job-keywords.js','public/job-results.js','public/workspace-history.js','lib/workspace-metadata.mjs','lib/cv-parser.mjs','lib/extract-cv.mjs','lib/extract-cv-worker.mjs'])hash.update(name).update(readFileSync(resolve(root,name)));
 return hash.digest('hex').slice(0,24);
}
export function runtimeState(health,expectedBuild,savedPid){
 if(!health)return 'stopped';
 if(health.app!=='jobdesk-local')throw new Error('Port 4180 is already being used by another application.');
 if(health.buildId===expectedBuild)return 'current';
 if(!Number.isSafeInteger(health.pid)||health.pid<=0||health.pid!==savedPid)throw new Error('The running process does not match this Jobdesk installation. Stop the other copy before starting this one.');
 return 'stale';
}

