import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
try{
 const pid=Number(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'data','server.pid'),'utf8'));
 const r=await fetch('http://localhost:4180/api/health',{signal:AbortSignal.timeout(2000)});const health=await r.json();
 if(health.app!=='jobdesk-local'||health.pid!==pid||!Number.isSafeInteger(pid))throw new Error('The running process does not match this Jobdesk installation.');
 process.kill(pid);console.log('Jobdesk stopped. Your account and saved data are unchanged.');
}catch(e){console.log('Jobdesk was not stopped: '+e.message);process.exitCode=1;}
