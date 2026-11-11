import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH??=join(resolve(process.env.JOBDESK_DATA_DIR||join(root,'data')),'playwright-browsers');
const {createJobdeskServer}=await import('./server.mjs');
const app=createJobdeskServer({dataDir:process.env.JOBDESK_DATA_DIR||join(root,'data'),headless:true,publicOrigin:process.env.PUBLIC_ORIGIN||''});
const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
try{const summary=await app.runScheduled({signal:controller.signal});console.log(JSON.stringify({time:new Date().toISOString(),...summary}));if(summary.runs.some(run=>run.status==='error'))process.exitCode=1;}catch{console.error('Scheduled search failed. Run hosting-check.mjs and check the private worker configuration.');process.exitCode=1;}finally{await app.close();}
