// cPanel Application Manager startup file; set JOBDESK_DATA_DIR and PUBLIC_ORIGIN in the panel.
import('./server.mjs').then(async({createJobdeskServer})=>{
 if(!process.env.PUBLIC_ORIGIN||!process.env.JOBDESK_DATA_DIR)throw new Error('Configure PUBLIC_ORIGIN and private JOBDESK_DATA_DIR before starting the hosted app.');
 const app=createJobdeskServer({dataDir:process.env.JOBDESK_DATA_DIR,port:Number(process.env.PORT)||4180,host:process.env.HOST||'127.0.0.1',publicOrigin:process.env.PUBLIC_ORIGIN,headless:true});await app.start();
 process.once('SIGTERM',async()=>{await app.close();process.exit(0);});
}).catch(()=>{console.error('Jobdesk hosting configuration failed. Check Node24, PUBLIC_ORIGIN and JOBDESK_DATA_DIR.');process.exitCode=1;});
