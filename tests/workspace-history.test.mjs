import test from 'node:test';
import assert from 'node:assert/strict';
const h = await import('../public/workspace-history.js');
const at='2026-11-10T10:00:00.000Z';
const job={id:'one',title:'CMS developer',company:'Acme',url:'https://acme.test/job'};
const workspace=()=>({jobs:[{...job}],applications:{one:{draft:'My original letter',status:'Draft',reviewed:false}}});
test('unsave preserves an application and resaving reuses its job without duplication',()=>{
 const w=workspace(); assert.equal(typeof h.unsaveJob,'function');
 h.unsaveJob(w,'one',at); assert.equal(w.jobs[0].saved,false);assert.equal(w.applications.one.draft,'My original letter');
 assert.equal(w.jobs[0].unsavedAt,at);assert.equal(h.isSavedJob(w.jobs[0]),false);
 h.saveJob(w,job,at);assert.equal(w.jobs.length,1);assert.equal(h.isSavedJob(w.jobs[0]),true);assert.equal(w.activity.length,2);
});
test('draft and application removal are separate and reversible without losing the letter',()=>{
 const w=workspace();assert.equal(typeof h.removeDraft,'function');h.removeDraft(w,'one',at);
 assert.equal(h.hasDraft(w.applications.one),false);assert.equal(h.isActiveApplication(w.applications.one),true);
 h.restoreDraft(w,'one',at);assert.equal(h.hasDraft(w.applications.one),true);
 h.removeApplication(w,'one',at);assert.equal(h.isActiveApplication(w.applications.one),false);assert.equal(h.hasDraft(w.applications.one),false);
 h.restoreApplication(w,'one',at);assert.equal(h.isActiveApplication(w.applications.one),true);assert.equal(h.hasDraft(w.applications.one),true);assert.equal(w.applications.one.draft,'My original letter');
});
test('backdated applied day stays separate from the recorded action time and history searches that day',()=>{
 const w=workspace();assert.equal(typeof h.setAppliedDate,'function');h.setAppliedDate(w,'one','2026-09-10',at);
 assert.equal(w.applications.one.appliedDate,'2026-09-10');assert.equal(w.activity[0].at,at);assert.equal(w.activity[0].effectiveDate,'2026-09-10');
 const rows=h.historyEntries(w,{query:'acme',from:'2026-09-01',to:'2026-09-30'});assert.equal(rows.length,1);assert.equal(rows[0].effectiveDate,'2026-09-10');
 assert.equal(h.historyEntries(w,{query:'unrelated'}).length,0);
 assert.throws(()=>h.setAppliedDate(w,'one','2026-02-30',at),RangeError);
});
test('ready requires review, new draft restores visibility, and edited draft invalidates review',()=>{
 const w=workspace();assert.equal(typeof h.setStatus,'function');assert.throws(()=>h.setStatus(w,'one','Ready',at));
 h.setReviewed(w,'one',true,at);h.setStatus(w,'one','Ready',at);assert.equal(w.applications.one.status,'Ready');
 h.saveDraft(w,'one','Updated letter',at,false);assert.equal(w.applications.one.reviewed,false);assert.equal(w.applications.one.status,'Draft');
 h.removeApplication(w,'one',at);h.prepareDraft(w,'one','New letter',at);assert.equal(h.hasDraft(w.applications.one),true);assert.equal(w.applications.one.draftCreatedAt,at);
});
test('legacy records show unknown dates without invented events and history retains removed jobs',()=>{
 const w=workspace();assert.equal(typeof h.historyEntries,'function');assert.equal(h.isSavedJob(w.jobs[0]),true);
 const rows=h.historyEntries(w);assert.equal(rows.length,1);assert.equal(rows[0].at,null);assert.equal(h.formatDate(undefined),'Date not recorded');assert.equal(w.activity,undefined);
 h.removeApplication(w,'one',at);assert.equal(h.historyEntries(w,{type:'application_removed'}).length,1);
});
test('activity is bounded to the latest 5000 events and output is sorted recent first',()=>{
 const w=workspace();assert.equal(typeof h.recordActivity,'function');
 for(let i=0;i<5002;i++)h.recordActivity(w,'one','draft_saved',new Date(Date.UTC(2026,0,1,0,0,i)).toISOString());
 assert.equal(w.activity.length,5000);assert.equal(h.historyEntries(w)[0].at,'2026-01-01T01:23:21.000Z');
});
test('record a past manual application without inventing a cover letter or historical action timestamp',()=>{
 const w=workspace();delete w.applications.one;assert.equal(typeof h.recordApplication,'function');
 h.recordApplication(w,'one','2026-09-10',at);
 assert.equal(w.applications.one.status,'Applied');assert.equal(w.applications.one.draft,'');assert.equal(h.hasDraft(w.applications.one),false);
 assert.equal(w.applications.one.createdAt,at);assert.equal(w.applications.one.appliedDate,'2026-09-10');assert.equal(w.activity[0].at,at);
 assert.equal(h.historyEntries(w,{from:'2026-09-01',to:'2026-09-30'}).length,1);
});
test('recording an application validates before mutation and retains an existing letter',()=>{
 const w=workspace();const before=structuredClone(w);
 assert.throws(()=>h.recordApplication(w,'one','2026-02-30',at));assert.deepEqual(w,before);
 h.recordApplication(w,'one','2026-09-10',at);assert.equal(w.applications.one.draft,'My original letter');
});
test('preparing a letter for an already applied job keeps its application stage',()=>{
 const w=workspace();w.applications.one.status='Applied';w.applications.one.draftRemovedAt=at;
 h.prepareDraft(w,'one','New cover letter',at);assert.equal(w.applications.one.status,'Applied');
});

test('restoring applications preserves independently removed drafts and never creates empty drafts',()=>{
 const w=workspace();h.removeDraft(w,'one',at);h.removeApplication(w,'one',at);h.restoreApplication(w,'one',at);assert.equal(h.hasDraft(w.applications.one),false);assert.equal(w.applications.one.draft,'My original letter');
 delete w.applications.one;h.recordApplication(w,'one','2026-09-10',at);h.removeApplication(w,'one',at);h.restoreApplication(w,'one',at);assert.equal(h.hasDraft(w.applications.one),false);
});
