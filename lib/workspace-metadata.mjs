const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const bounded=(value,max)=>typeof value==='string'&&value.length<=max;
const TYPES=new Set(['saved','unsaved','draft_created','draft_saved','draft_rebuilt','draft_removed','draft_restored','application_removed','application_restored','status_changed','reviewed','applied_date_changed']);
const OPTIONAL_STAMPS=['createdAt','updatedAt','draftCreatedAt','draftUpdatedAt','reviewedAt','statusUpdatedAt','removedAt','draftRemovedAt'];
export function validWorkspaceMetadata(workspace){
 const jobs=Array.isArray(workspace.jobs)?workspace.jobs:[],ids=new Set(jobs.map(job=>job.id));
 if(jobs.some(job=>job.saved!==undefined&&typeof job.saved!=='boolean'||['savedAt','unsavedAt'].some(key=>job[key]!==undefined&&!stamp(job[key]))))return false;
 if(Object.values(workspace.applications||{}).some(app=>OPTIONAL_STAMPS.some(key=>app[key]!==undefined&&!stamp(app[key]))||app.appliedDate!==undefined&&!date(app.appliedDate)))return false;
 if(workspace.activity===undefined)return true;
 return Array.isArray(workspace.activity)&&workspace.activity.length<=5000&&workspace.activity.every(event=>event&&bounded(event.id,100)&&/^[a-zA-Z0-9_-]+$/.test(event.id)&&ids.has(event.jobId)&&TYPES.has(event.type)&&stamp(event.at)&&bounded(event.title,160)&&bounded(event.company,120)&&(event.status===undefined||bounded(event.status,40))&&(event.effectiveDate===undefined||date(event.effectiveDate)));
}
