import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validWorkspaceMetadata} from '../lib/workspace-metadata.mjs';
test('workspace metadata accepts legacy records and validates dated action history without fabricated dates',()=>{
 const w={jobs:[{id:'job1'}],applications:{job1:{}}};assert.equal(validWorkspaceMetadata(w),true);
 w.jobs[0].saved=false;w.jobs[0].unsavedAt='2026-11-10T12:00:00.000Z';w.applications.job1.appliedDate='2026-09-10';w.activity=[{id:'event-1',jobId:'job1',type:'applied_date_changed',at:'2026-11-10T12:00:00.000Z',title:'CMS developer',company:'Acme',effectiveDate:'2026-09-10',status:'Applied'}];assert.equal(validWorkspaceMetadata(w),true);
 for(const mutate of [v=>v.jobs[0].saved='no',v=>v.jobs[0].savedAt='invalid',v=>v.applications.job1.appliedDate='2026-02-30',v=>v.activity[0].jobId='missing',v=>v.activity[0].at=null,v=>v.activity[0].type='unknown',v=>v.activity=Array(5001).fill(v.activity[0])]){const invalid=structuredClone(w);mutate(invalid);assert.equal(validWorkspaceMetadata(invalid),false);}
});
