// Removal is reversible: job, application and letter data remain in the workspace.
export const isSavedJob = job => Boolean(job && job.saved !== false);
export const isActiveApplication = application => Boolean(application && !application.removedAt);
export const hasDraft = application => isActiveApplication(application) && !application.draftRemovedAt && Boolean(application.draft?.trim());
const now = () => new Date().toISOString();
const jobFor = (workspace,id) => {
 const job=workspace.jobs.find(job=>job.id===id);
 if(!job)throw new RangeError('Job not found.');
 return job;
};
const appFor = (workspace,id) => {
 jobFor(workspace,id);
 const application=workspace.applications[id];
 if(!application)throw new RangeError('Application not found.');
 return application;
};
export function recordActivity(workspace,jobId,type,at=now(),extra={}){
 const job=jobFor(workspace,jobId);
 const event={id:crypto.randomUUID(),jobId,type,at,title:job.title,company:job.company,...extra};
 workspace.activity=[...(workspace.activity||[]),event].slice(-5000);
 return event;
}
export function saveJob(workspace,job,at=now()){
 let existing=workspace.jobs.find(item=>item.id===job.id);
 if(!existing){existing=structuredClone(job);workspace.jobs.push(existing);}
 existing.saved=true;existing.savedAt=at;delete existing.unsavedAt;
 recordActivity(workspace,existing.id,'saved',at);
 return existing;
}
export function unsaveJob(workspace,id,at=now()){
 const job=jobFor(workspace,id);job.saved=false;job.unsavedAt=at;
 recordActivity(workspace,id,'unsaved',at);
}
export function prepareDraft(workspace,id,draft,at=now()){
 jobFor(workspace,id);
 const previous=workspace.applications[id];
 const status=previous&&!['Draft','Ready'].includes(previous.status)?previous.status:'Draft';
 const application=workspace.applications[id]={...previous,draft,status,reviewed:false,...(!previous?{createdAt:at}:{}),updatedAt:at,draftCreatedAt:at,draftUpdatedAt:at};
 delete application.removedAt;delete application.draftRemovedAt;
 recordActivity(workspace,id,'draft_created',at);
 return application;
}
export function saveDraft(workspace,id,draft,at=now(),record=true){
 const application=appFor(workspace,id);
 application.draft=draft;application.draftUpdatedAt=at;application.updatedAt=at;application.reviewed=false;
 if(application.status==='Ready')application.status='Draft';
 if(record)recordActivity(workspace,id,'draft_saved',at);
}
export function removeDraft(workspace,id,at=now()){
 const application=appFor(workspace,id);application.draftRemovedAt=at;application.updatedAt=at;
 recordActivity(workspace,id,'draft_removed',at);
}
export function restoreDraft(workspace,id,at=now()){
 const application=appFor(workspace,id);delete application.draftRemovedAt;delete application.removedAt;application.updatedAt=at;
 recordActivity(workspace,id,'draft_restored',at);
}
export function removeApplication(workspace,id,at=now()){
 const application=appFor(workspace,id);application.removedAt=at;application.updatedAt=at;
 recordActivity(workspace,id,'application_removed',at);
}
export function restoreApplication(workspace,id,at=now()){
 const application=appFor(workspace,id);delete application.removedAt;application.updatedAt=at;
 recordActivity(workspace,id,'application_restored',at);
}
export function setReviewed(workspace,id,reviewed,at=now()){
 const application=appFor(workspace,id);application.reviewed=Boolean(reviewed);application.updatedAt=at;
 if(reviewed)application.reviewedAt=at;
 if(!reviewed&&application.status==='Ready')application.status='Draft';
 recordActivity(workspace,id,'reviewed',at,{status:reviewed?'Reviewed':'Needs review'});
}
export function setStatus(workspace,id,status,at=now()){
 const application=appFor(workspace,id);
 if(!['Draft','Ready','Applied','Interview','Rejected','Archived'].includes(status))throw new RangeError('Invalid application status.');
 if(status==='Ready'&&!application.reviewed)throw new Error('Review this draft before marking it ready.');
 application.status=status;application.statusUpdatedAt=at;application.updatedAt=at;
 recordActivity(workspace,id,'status_changed',at,{status});
}
export function setAppliedDate(workspace,id,date,at=now()){
 validateAppliedDate(date);
 const application=appFor(workspace,id);application.appliedDate=date;application.updatedAt=at;
 recordActivity(workspace,id,'applied_date_changed',at,{effectiveDate:date,status:application.status});
}
export function recordApplication(workspace,id,date,at=now()){
 validateAppliedDate(date);
 jobFor(workspace,id);
 const previous=workspace.applications[id];
 workspace.applications[id]={...(previous||{draft:'',reviewed:false,createdAt:at,draftRemovedAt:at}),status:'Applied',updatedAt:at,statusUpdatedAt:at};
 delete workspace.applications[id].removedAt;
 setAppliedDate(workspace,id,date,at);
 return workspace.applications[id];
}
function validateAppliedDate(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new RangeError('Enter a valid application date.');
}
export const activityLabels={saved:'Job saved',unsaved:'Job unsaved',draft_created:'Draft prepared',draft_saved:'Draft saved',draft_rebuilt:'Draft rebuilt',draft_removed:'Draft removed',draft_restored:'Draft restored',application_removed:'Application removed',application_restored:'Application restored',status_changed:'Status changed',reviewed:'Draft review updated',applied_date_changed:'Application date recorded',existing_record:'Existing record'};
export function localDay(value){
 if(!value)return '';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function formatDate(value){
 if(!value)return 'Date not recorded';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T00:00:00Z'));
 const date=new Date(value);if(Number.isNaN(date.getTime()))return 'Date not recorded';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Karachi',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)+' PKT';
}
export function historyEntries(workspace,{query='',from='',to='',type=''}={}){
 const events=[...(workspace.activity||[])];
 for(const job of workspace.jobs){
  const application=workspace.applications[job.id];
  if(!events.some(event=>event.jobId===job.id))events.push({id:'existing-'+job.id,jobId:job.id,type:'existing_record',title:job.title,company:job.company,at:application?.updatedAt||job.savedAt||null,...(application?.appliedDate?{effectiveDate:application.appliedDate}:{}),...(application?{status:application.status}:{})});
  else if(application?.appliedDate&&!events.some(event=>event.jobId===job.id&&event.effectiveDate===application.appliedDate))events.push({id:'application-date-'+job.id,jobId:job.id,type:'applied_date_changed',title:job.title,company:job.company,at:null,effectiveDate:application.appliedDate,status:application.status});
 }
 const needle=query.trim().toLocaleLowerCase();
 return events.filter(event=>{
  const day=localDay(event.effectiveDate||event.at);
  return (!needle||`${event.title} ${event.company} ${day} ${formatDate(event.effectiveDate||event.at)}`.toLocaleLowerCase().includes(needle))&&(!type||event.type===type)&&(!from||day&&day>=from)&&(!to||day&&day<=to);
 }).sort((a,b)=>String(b.effectiveDate||b.at||'').localeCompare(String(a.effectiveDate||a.at||'')));
}
