import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {installationBuild,runtimeState} from './lib/runtime-health.mjs';
const root=dirname(fileURLToPath(import.meta.url)),url='http://localhost:4180';
const expectedBuild=installationBuild();
async function health(){let r;try{r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});}catch(e){if(e.cause?.code==='ECONNREFUSED'||e.cause?.errors?.every(x=>x.code==='ECONNREFUSED'))return null;throw new Error('Could not reach Jobdesk. Check that local connections are allowed.');}if(!r.ok)throw new Error('Port 4180 is already being used by another application.');return await r.json();}
function recordedPid(){try{return Number(readFileSync(join(root,'data','server.pid'),'utf8'));}catch{return null;}}
async function running(){return runtimeState(await health(),expectedBuild,recordedPid())==='current';}
const previous=await health();
if(runtimeState(previous,expectedBuild,recordedPid())==='stale'){
 console.log('Updating the running Jobdesk server…');
 try{process.kill(previous.pid);}catch{throw new Error('The older Jobdesk server could not be stopped. Run STOP-JOBDESK.cmd, then START-JOBDESK.cmd from your Windows desktop.');}
 let stopped=false;for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(!await health()){stopped=true;break;}}
 if(!stopped)throw new Error('The older server is still stopping. Try starting Jobdesk again in a moment.');
}
if(!await running()){
 mkdirSync(join(root,'data'),{recursive:true});const log=openSync(join(root,'data','server.log'),'a');
 const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});child.on('error',e=>console.error('Could not start Jobdesk:',e.message));child.unref();closeSync(log);
 let ready=false;for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));if(await running()){ready=true;break;}}
 if(!ready)throw new Error('Jobdesk did not start. Check data/server.log.');
}
console.log('Jobdesk is running at '+url);
if(!process.argv.includes('--no-open')){const opener=spawn('C:/Windows/System32/cmd.exe',['/d','/c','start','',url],{windowsHide:true,detached:true,stdio:'ignore'});opener.unref();}
