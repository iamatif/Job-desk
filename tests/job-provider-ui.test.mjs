import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindJobProviderSettings,jobProviderCard} from '../public/job-provider-settings.js';

test('Rozee settings show setup and allow an independent key removal through the shared owner form',async()=>{
 const elements=Object.fromEntries(['apiKey','fallbackApiKey','rozeeApiKey','enabled','unlimited','dailyLimit','fallbackEnabled','rozeeEnabled'].map(name=>[name,{value:'',checked:false,disabled:false}]));
 const selectors=Object.fromEntries(['#remove-job-provider','#remove-backup-provider','#remove-rozee-provider','#job-provider-backup-status','#job-provider-rozee-status'].map(name=>[name,{disabled:false,textContent:''}]));
 const saveButton={disabled:false},form={elements,isConnected:true,querySelector:name=>selectors[name],querySelectorAll:()=>[saveButton,...Object.entries(selectors).filter(([name])=>name.startsWith('#remove')).map(([,value])=>value)]},status={textContent:''},feedback={textContent:''};
 const oldDocument=globalThis.document;globalThis.document={querySelector:name=>({'#job-provider-form':form,'#job-provider-status':status,'#job-provider-feedback':feedback}[name])};
 let requests=[];const config={canManage:true,configured:true,enabled:true,dailyLimit:14,unlimited:true,usedToday:0,usedThisMonth:0,backup:{configured:false},rozee:{configured:true,enabled:true}};
 try{
  await bindJobProviderSettings({api:async(path,method,body)=>{requests.push({path,method,body});return method?{...config,rozee:{configured:false,enabled:false}}:config;}});
  assert.equal(elements.rozeeEnabled.checked,true);assert.equal(selectors['#remove-rozee-provider'].disabled,false);assert.match(elements.rozeeApiKey.placeholder,/keep your saved/);
  await selectors['#remove-rozee-provider'].onclick();const saved=requests[1];assert.equal(saved.path,'/api/account/job-search');assert.equal(saved.body.removeRozeeKey,true);assert.equal(saved.body.rozeeEnabled,false);assert.equal(saved.body.enabled,true);assert.equal(saved.body.unlimited,true);assert.equal(selectors['#remove-rozee-provider'].disabled,true);assert.match(feedback.textContent,/Rozee key removed/);
  assert.match(jobProviderCard(),/1,000 free credits per month/);assert.match(jobProviderCard(),/https:\/\/app.api.sh\/signup/);assert.match(jobProviderCard(),/your CV is not sent/);
 }finally{globalThis.document=oldDocument;}
});
