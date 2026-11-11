import {mountScheduleSettings} from './job-schedule-ui.js';
import {bindSettingsTabs} from './settings-tabs.js';
import {jobProviderCard,bindJobProviderSettings} from './job-provider-settings.js';
import {bindGoogleConnect, googleErrorMessage} from './google-connect.js';
import {mountKeywordSearch} from './keyword-search.js';
import {isSavedJob,saveJob,unsaveJob,historyEntries,activityLabels,formatDate} from './workspace-history.js';
import {emptyProfile,normaliseProfile} from './profile-data.js';
import {mountProfileEditor} from './profile-editor.js';
import {
  SAMPLE_PROFILE,
  SAMPLE_JOBS,
  matchJob,
  profileText,
} from "./model.js";
import { auth, api } from "./auth-state.js";
import { themeControl, bindThemeControls } from "./theme-ui.js";
import { savedSourceIds, toggleSavedSource } from "./source-bookmarks.js";

const initial = () => ({
  profile: structuredClone(SAMPLE_PROFILE),
  jobs: structuredClone(SAMPLE_JOBS),
  applications: {},
  savedSources: [],
});
const saved = await api("/api/workspace");
const needsOnboarding = !saved.workspace || saved.workspace.onboarding?.completed === false;
let state = saved.workspace || {profile:emptyProfile(auth.user),jobs:[],applications:{},savedSources:[]},
  storageAvailable = true;
state.profile=normaliseProfile(state.profile);
let persistedJobIds=new Set(state.jobs.filter(isSavedJob).map(j=>j.id));
let historyFilters={query:'',from:'',to:'',type:''};
let profileEditor;
let keywordResult=null,keywordResultPreferences=null;
let saveQueue = Promise.resolve(),
  pendingSaves = 0,
  workspaceRevision = saved.revision,
  saveConflict = false,
  lastSaveError = null;
let page = "overview",
  filter = "All jobs",
  query = "",
  location = "All locations",
  selected = null;
const root = document.querySelector("#app");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  jobs: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12c5 4 13 4 18 0M12 12v4"/>',
  review: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5"/>',
  tracker: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  profile:
    '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  sources:
    '<path d="M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-3 3M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l3-3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.jobs}</svg>`;
const names = {
  overview: "Overview",
  jobs: "Saved jobs",
  details: "Job details",
  history: "History",
  profile: "My profile",
  sources: "Job sources",
  account: "Account settings",
};
const ranked = () =>
  state.jobs
    .filter(isSavedJob)
    .map((j) => ({ ...j, fit: matchJob(j, state.profile) }))
    .sort((a, b) => b.fit.score - a.fit.score);
function persist() {
  if (saveConflict) {
    showSaveError(lastSaveError);
    return Promise.resolve(false);
  }
  const snapshot = structuredClone(state);
  pendingSaves++;
  showSaveStatus("Saving…");
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => {
      if (saveConflict) throw lastSaveError;
      return api("/api/workspace", "PUT", snapshot, {
        "if-match": String(workspaceRevision),
      });
    })
    .then((result) => {
      workspaceRevision = result.revision;
      persistedJobIds=new Set(snapshot.jobs.filter(isSavedJob).map(j=>j.id));
      refreshOverviewSummary();
      storageAvailable = true;
      lastSaveError = null;
      document.querySelector("#save-warning")?.remove();
      showSaveStatus(pendingSaves > 1 ? "Saving…" : "All changes saved");
      return true;
    })
    .catch((error) => {
      storageAvailable = false;
      saveConflict = error.status === 409 || saveConflict;
      lastSaveError = error;
      showSaveStatus("Unsaved changes", true);
      showSaveError(error);
      toast(error.message);
      return false;
    })
    .finally(() => {
      pendingSaves--;
    });
  return saveQueue;
}
function showSaveError(error) {
  let warning = document.querySelector("#save-warning");
  if (!warning) {
    warning = document.createElement("div");
    warning.id = "save-warning";
    warning.className = "storage-warning";
    document.querySelector(".main>main").before(warning);
  }
  warning.innerHTML = `<span>${escape(error?.message || "Your latest changes could not be saved.")}</span> <button class="button small" id="export-unsaved">Download my unsaved edits</button> ${saveConflict ? '<button class="button small" id="reload-workspace">Reload latest workspace</button>' : '<button class="button small" id="retry-save">Retry save</button>'}`;
  warning.querySelector("#export-unsaved").onclick = () =>
    download("jobdesk-unsaved-edits.json", JSON.stringify(state, null, 2));
  const retry = warning.querySelector("#retry-save");
  if (retry) retry.onclick = () => persist();
  const reload = warning.querySelector("#reload-workspace");
  if (reload)
    reload.onclick = async () => {
      if (
        await confirmAction(
          "Reload the saved workspace?",
          "Any edits that have not been saved will be replaced. Download your unsaved edits first if you want to keep them.",
        )
      ) {
        storageAvailable = true;
        window.location.reload();
      }
    };
}
function showSaveStatus(message, failed = false) {
  document.querySelectorAll("[data-save-status]").forEach((el) => {
    el.textContent = message;
    el.classList.toggle("failed", failed);
  });
}
window.addEventListener("beforeunload", (event) => {
  if (pendingSaves || !storageAvailable) {
    event.preventDefault();
    event.returnValue = "";
  }
});
let toastTimer;
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 4000);
}
function initials() {
  return state.profile.name
    .split(/\s+/)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function navButton(key) {
  return `<button class="nav-button ${page === key ? "active" : ""}" data-nav="${key}" ${page === key ? 'aria-current="page"' : ""}>${icon(key)}${names[key]}</button>`;
}
function render() {
  document.title = names[page] + " · Jobdesk";
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-symbol">↗</span>jobdesk<span class="brand-period">.</span></div><button class="mobile-menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="workspace-navigation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span></button><nav id="workspace-navigation" aria-label="Main navigation">${Object.keys(names).filter(key=>key!=="details").map(navButton).join("")}</nav><div class="user"><div class="avatar">${escape(
    auth.user.name
      .split(/\s+/)
      .map((n) => n[0])
      .slice(0, 2)
      .join(""),
  )}</div><div><strong>${escape(auth.user.name)}</strong><small>Personal account</small></div></div></aside><div class="main"><header class="topbar"><div class="breadcrumb">My workspace / <span>${names[page]}</span></div><div class="top-right">${themeControl()}<span class="save-indicator" data-save-status>${pendingSaves ? "Saving…" : storageAvailable ? "All changes saved" : "Could not save"}</span><button class="logout-button" id="logout">Sign out ↗</button></div></header><main id="main-content">${content()}</main></div></div>`;
  bind();
  bindThemeControls();
  const menu = document.querySelector(".mobile-menu-toggle");
  menu.onclick = () => {
    const open = document
      .querySelector(".sidebar")
      .classList.toggle("menu-open");
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
  };
  root.onkeydown = (event) => {
    if (
      event.key === "Escape" &&
      menu.getAttribute("aria-expanded") === "true"
    ) {
      menu.click();
      menu.focus();
    }
  };
  document.querySelector("#logout").onclick = async () => {
    if(profileEditor?.isBusy())return;
    if(page==='profile'&&profileEditor?.isDirty()&&!await confirmAction("Sign out without saving?","Your unsaved profile edits will be lost."))return;
    if (!storageAvailable) {
      toast("Save or export your changes before signing out.");
      return;
    }
    await saveQueue;
    if (!storageAvailable) return;
    try {
      profileEditor?.destroy();await api("/api/auth/logout", "POST", {});
      window.location.assign("/login");
    } catch (e) {
      toast(e.message);
    }
  };
  if (!storageAvailable) showSaveError(lastSaveError);
}
function heading(title, sub, action = "") {
  return `<div class="page-heading"><div><div class="eyebrow">YOUR NEXT CHAPTER</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${action}</div>`;
}
function addButton() {
  return `<button class="button primary" data-add>${icon("plus")} Add a job</button>`;
}
function content() {
  switch (page) {
    case "overview":
      return overview();
    case "jobs":
      return discovery();
    case "details":
      return jobDetails();
    case "history":
      return history();
    case "profile":
      return profile();
    case "sources":
      return sources();
    case "account":
      return account();
  }
}
function overview() {
 return `${heading('Find your next role.','Relevant jobs from the last 14 days.','<button class="button" data-nav="jobs">Saved jobs ↗</button>')}<div id="overview-keywords"></div>${footer()}`;
}
function refreshOverviewSummary(){
 const stats=document.querySelector('#overview-stats'),list=document.querySelector('#overview-shortlist');if(!stats||!list)return;
 const jobs=ranked().filter(j=>persistedJobIds.has(j.id));
 stats.innerHTML=stat('Saved jobs',jobs.length,'jobs','Your personal shortlist')+stat('Strong saved matches',jobs.filter(j=>j.fit.score>=80).length,'check','<span>80%+</span> listed skills & experience match');
 list.innerHTML=jobs.slice(0,4).map(jobCard).join('')||empty('Keep the opportunities you like.','Use the save icon on a search result to add it to your shortlist.');bindJobs();
}
function savedLiveJob(job){return state.jobs.find(j=>j.id===job.id||j.url===job.url||j.title.toLowerCase()===job.title.toLowerCase()&&j.company.toLowerCase()===job.company.toLowerCase());}
function bindOverviewKeywords(){
 const preferences=state.searchPreferences||{keywords:[],location:'pakistan-remote'};
 mountKeywordSearch(document.querySelector('#overview-keywords'),{preferences,profile:state.profile,
 initialResult:JSON.stringify(preferences)===JSON.stringify(keywordResultPreferences)?keywordResult:null,
 onResult:(response,prefs)=>{keywordResult=response;keywordResultPreferences=prefs;},
 onConfigure:()=>{page="account";render();window.scrollTo(0,0);},
 onPreferencesSave:async prefs=>{state.searchPreferences=prefs;return await persist();},
 isSaved:job=>{const existing=savedLiveJob(job);return Boolean(isSavedJob(existing)&&persistedJobIds.has(existing.id));},
 onSaveJob:async job=>{const existing=savedLiveJob(job);if(isSavedJob(existing)&&persistedJobIds.has(existing.id))return true;if(!existing&&state.jobs.length>=2000)throw new Error('Your workspace has reached its 2,000 job record limit. Existing history is kept.');saveJob(state,existing||job);const ok=await persist();if(ok)toast('Job saved to your shortlist.');return ok;},
 onUnsaveJob:async job=>{const existing=savedLiveJob(job);if(!existing)return false;unsaveJob(state,existing.id);const ok=await persist();if(ok)toast('Job unsaved. Your job history is kept.');return ok;},
 onViewSaved:job=>{const existing=savedLiveJob(job);if(!existing)return;selected=existing.id;page='details';render();window.scrollTo(0,0);}
 });
}
function stat(label, value, i, note) {
  return `<div class="stat"><div class="stat-top">${label}<span class="stat-icon">${icon(i)}</span></div><strong>${value}</strong><small>${note}</small></div>`;
}
function matchesFilter(j) {
  return (
    filter === "All jobs" ||
    j.skills.some((s) => s.toLowerCase() === filter.toLowerCase())
  );
}
function jobCard(j) {
  return `<article class="job-card"><div class="job-top"><div class="company-icon ${escape(j.color || "mint")}">${escape(j.initials || j.company.slice(0, 2).toUpperCase())}</div><div class="job-heading"><h3>${escape(j.title)}</h3><p>${escape(j.company)} · ${j.sample ? "Fictional company" : j.source&&safeUrl(j.sourceUrl)?`<a href="${escape(safeUrl(j.sourceUrl))}" target="_blank" rel="noopener noreferrer">${escape(j.source)} ↗</a>`:"Manually added"}</p></div><span class="score ${j.fit.score < 80 ? "low" : ""}" title="Skills and experience match">${j.fit.score}% match</span></div><div class="job-meta"><span>⌖ ${escape(j.location)}</span><span>◷ ${escape(j.type || "Not specified")}</span><span>${escape(j.salary || "Salary not specified")}</span></div><div class="job-tags">${j.skills.map((s) => `<span class="tag ${j.fit.missing.includes(s) ? "missing" : ""}">${escape(s)}</span>`).join("")}</div><p class="record-date">Saved: ${escape(formatDate(j.savedAt))}</p><div class="job-bottom"><span class="sample-note">${j.sample ? "Sample listing · not a live vacancy" : j.experienceKnown===false?"Experience: check listing":`${j.years}+ years requested · verify listing`}</span><div class="record-actions">${!j.sample&&safeUrl(j.url)?`<a class="button primary small" href="${escape(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">Apply Now ↗</a>`:!j.sample?'<span class="muted small">Application link unavailable</span>':''}<button class="button small" data-unsave="${escape(j.id)}">Unsave</button><button class="button small" data-view="${escape(j.id)}">View details ↗</button></div></div></article>`;
}
function profileCard() {
  const p = state.profile;
  return `<section class="card"><h3>Your search profile</h3><div class="profile-card-head"><div class="avatar">${escape(initials())}</div><div><strong>${escape(p.name)}</strong><small>${escape(p.role)}</small></div></div><div class="profile-details"><span>${p.years} years experience</span><span>${p.fictional ? "Sample CV" : "Your profile"}</span></div><div class="job-tags profile-skills">${p.skills
    .slice(0, 6)
    .map((s) => `<span class="tag">${escape(s)}</span>`)
    .join(
      "",
    )}</div><button class="button full" data-nav="profile">Edit profile & CV ↗</button></section>`;
}
function footer() {
  return `<p class="footer-note">${icon("lock")} Your search, organised. Your shortlist stays in your control.</p>`;
}
function discovery() {
  return `${heading("Your saved opportunities.", "Your personal shortlist, matched against your profile. Search for new jobs from Overview.", addButton())}<div class="notice green">Matches reflect the skills and experience in your profile. Review each role’s location, requirements, and application details before applying.</div><div class="search-row"><input id="job-search" aria-label="Search jobs" placeholder="Search title, company or skill…" value="${escape(query)}"><select id="location-filter" aria-label="Work arrangement">${["All locations", "Remote", "Hybrid", "Onsite"].map((v) => `<option ${location === v ? "selected" : ""}>${v}</option>`).join("")}</select></div><div class="filters">${["All jobs", "Shopify", "WordPress", "Wix", "Squarespace"].map((f) => `<button class="filter ${filter === f ? "active" : ""}" data-filter="${f}">${f}</button>`).join("")}</div><p class="muted small" id="result-count" style="margin-bottom:15px"></p><section class="jobs" id="job-results">${filteredJobs()}</section>${footer()}`;
}
function getFiltered() {
  return ranked()
    .filter(matchesFilter)
    .filter((j) => location === "All locations" || j.location === location)
    .filter((j) =>
      `${j.title} ${j.company} ${j.skills.join(" ")} ${j.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
}
function filteredJobs() {
  const jobs = getFiltered();
  return (
    jobs.map(jobCard).join("") ||
    empty(
      "No jobs match those filters.",
      "Try a different search or add a listing you found.",
    )
  );
}
function empty(title, text, action = "") {
  return `<div class="empty"><h2>${title}</h2><p>${text}</p>${action}</div>`;
}
function jobDetails() {
 const job=state.jobs.find(job=>job.id===selected);
 if(!job)return `${heading('Job details','Choose a saved job to view its details.')}<button class="button" data-nav="jobs">Saved jobs</button>${footer()}`;
 const fit=matchJob(job,state.profile),url=!job.sample&&safeUrl(job.url);
 return `${heading(escape(job.title),escape(job.company),'<button class="button" data-nav="jobs">Back to saved jobs</button>')}<article class="detail"><div class="section-heading"><span class="eyebrow">${job.sample?'FICTIONAL SAMPLE JOB':escape(job.source||'SAVED JOB')}</span><span class="score">${fit.score}% match</span></div><p>${escape(job.location)} · ${escape(job.type||'Not specified')}</p><p class="record-date">Saved: ${escape(formatDate(job.savedAt))}</p><section class="detail-section"><h3>About this role</h3><p>${escape(job.description)}</p></section><section class="detail-section"><h3>Skills</h3><div class="job-tags">${job.skills.map(skill=>`<span class="tag">${escape(skill)}</span>`).join('')}</div></section><div class="actions">${url?`<a class="button primary" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Apply Now ↗</a>`:''}${isSavedJob(job)?`<button class="button" data-unsave="${escape(job.id)}">Unsave job</button>`:`<button class="button" data-restore-save="${escape(job.id)}">Save job again</button>`}</div>${job.sample?'<p class="muted small mt">Fictional sample listing. No application destination.</p>':''}</article>${footer()}`;
}
function history() {
 return `${heading('Your job search history.','Find your saved-job activity and earlier records by company, position or date.')}<div class="notice green">Application dates use the day you provide. Actions show when they were recorded, in Pakistan time. Older items without stored dates show “Date not recorded”. Earlier application records are retained as read-only history.</div><form class="history-filters" id="history-filters"><label>Company, position or date<input name="query" value="${escape(historyFilters.query)}" placeholder="e.g. Acme or CMS developer"></label><label>From<input name="from" type="date" value="${escape(historyFilters.from)}"></label><label>To<input name="to" type="date" value="${escape(historyFilters.to)}"></label><label>Action<select name="type"><option value="">All actions</option>${Object.entries(activityLabels).map(([type,label])=>`<option value="${type}" ${historyFilters.type===type?'selected':''}>${escape(label)}</option>`).join('')}</select></label><button class="button primary" type="submit">Search history</button><button class="button" type="reset">Clear</button></form><div id="history-results">${historyResults()}</div>${footer()}`;
}
function historyResults(){
 const rows=historyEntries(state,historyFilters);
 return `<p class="muted small history-count">${rows.length} history ${rows.length===1?'entry':'entries'} · newest activity or application day first</p><section class="history-list">${rows.map(event=>{
  const job=state.jobs.find(job=>job.id===event.jobId),application=state.applications[event.jobId];
  return `<article class="card history-entry"><div><span class="eyebrow">${escape(activityLabels[event.type]||event.type)}</span><h3>${escape(event.title)}</h3><p>${escape(event.company)}${event.status?' · '+escape(event.status):''}</p>${event.effectiveDate?`<p class="record-date">Applied on: ${escape(formatDate(event.effectiveDate))}</p>`:''}<p class="record-date">Recorded: ${escape(formatDate(event.at))}</p>${job&&!isSavedJob(job)?'<span class="tag">Job unsaved</span>':''}${application?.removedAt?'<span class="tag">Application removed</span>':application?.draftRemovedAt?'<span class="tag">No active draft</span>':''}</div><div class="record-actions">${job?`<button class="button small" data-view="${escape(job.id)}">View details</button>${!isSavedJob(job)?`<button class="button small" data-restore-save="${escape(job.id)}">Save job again</button>`:''}`:''}</div></article>`;
 }).join('')||empty('No matching history.','Try another company, position or date range. Undated older items appear when date filters are cleared.')}</section>`;
}
function bindHistory(){
 const form=document.querySelector('#history-filters');
 const search=()=>{historyFilters=Object.fromEntries(new FormData(form));document.querySelector('#history-results').innerHTML=historyResults();bindJobs();};
 form.onsubmit=event=>{event.preventDefault();search();};
 form.onreset=()=>{historyFilters={query:'',from:'',to:'',type:''};setTimeout(()=>{for(const key of Object.keys(historyFilters))form.elements[key].value='';search();},0);};
 form.elements.query.oninput=search;
}
function bindLifecycleActions(){
 const actions=[['unsave',unsaveJob,'Unsave this job?','It will leave your shortlist. You can save it again from History.','Job unsaved. You can save it again from History.']];
 for(const [attribute,action,title,message,success] of actions)root.querySelectorAll(`[data-${attribute}]`).forEach(button=>button.onclick=async()=>{
  if(title&&!await confirmAction(title,message))return;
  action(state,button.getAttribute('data-'+attribute));
  const saving=persist();render();if(await saving)toast(success);
 });
 root.querySelectorAll('[data-restore-save]').forEach(button=>button.onclick=async()=>{
  saveJob(state,state.jobs.find(job=>job.id===button.dataset.restoreSave));const saving=persist();render();if(await saving)toast('Job saved again.');
 });

}
function profile() {
 return `${heading('Your experience. Your story.','Manage the details behind every job match.','<button class="button" id="download-cv">Download profile ↓</button>')}<div id="profile-editor"></div>${footer()}`;
}
const jobSources = [
  {
    id: "indeed",
    name: "Indeed",
    mark: "i",
    url: "https://pk.indeed.com/",
    label: "Pakistan & international roles",
    description: "Find developer roles by keyword and location.",
  },
  {
    id: "rozee",
    name: "Rozee.pk",
    mark: "R",
    url: "https://www.rozee.pk/job/jsearch/q/all/fc/1184",
    label: "Jobs across Pakistan",
    description: "Explore CMS and web development jobs across Pakistan.",
  },
  {
    id: "mustakbil",
    name: "Mustakbil",
    mark: "M",
    url: "https://www.mustakbil.com/",
    label: "Local & remote opportunities",
    description: "Find local and remote web development roles.",
  },
  {
    id: "bayt",
    name: "Bayt",
    mark: "b",
    url: "https://www.bayt.com/en/pakistan/",
    label: "Pakistan & regional careers",
    description: "Explore roles in Pakistan and across the region.",
  },
  {
    id: "njp",
    name: "National Jobs Portal",
    mark: "N",
    url: "https://njp.gov.pk/",
    label: "Government careers",
    description: "Check government vacancies and eligibility.",
  },
  {id:"linkedin",name:"LinkedIn",mark:"in",url:"https://www.linkedin.com/jobs/",label:"Pakistan & worldwide careers",description:"Search professional roles by keyword, location and remote arrangement."},
  {id:"himalayas",name:"Himalayas",mark:"H",url:"https://himalayas.app/jobs",label:"Connected remote feed",description:"Find remote opportunities with country and timezone eligibility details."},
  {id:"jobicy",name:"Jobicy",mark:"J",url:"https://jobicy.com/",label:"Connected remote feed",description:"Explore remote development and digital roles across regions."},
  {id:"remoteok",name:"Remote OK",mark:"R",url:"https://remoteok.com/",label:"Connected remote feed",description:"Browse remote roles and check each listing’s hiring restrictions."},
  {id:"wwr",name:"We Work Remotely",mark:"W",url:"https://weworkremotely.com/",label:"Connected remote feed",description:"Find programming, design and other remote opportunities."},
  {id:"remotive",name:"Remotive",mark:"r",url:"https://remotive.com/",label:"External remote board",description:"Browse remote opportunities directly on Remotive."},
  {id:"wordpress",name:"WordPress Jobs",mark:"W",url:"https://jobs.wordpress.net/",label:"Specialist CMS board",description:"Explore WordPress development, design and project opportunities."},
];
function sources() {
  return `${heading("More places. More possibilities.", "Explore the job boards you use, then keep your shortlist together.", addButton())}<p class="source-description">Run your keywords from Overview to find jobs from connected feeds and JSearch when configured. Bookmark sources here or browse their own listings. Coverage varies; check each original posting before applying.</p><div class="source-grid">${jobSources.map((source) => `<section class="card source-card"><button type="button" class="source-save" data-save-source="${source.id}" aria-pressed="${savedSourceIds(state.savedSources).includes(source.id)}" aria-label="${savedSourceIds(state.savedSources).includes(source.id) ? "Unsave" : "Save"} ${source.name} source" title="${savedSourceIds(state.savedSources).includes(source.id) ? "Unsave" : "Save"} source"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg></button><div class="source-heading"><div class="source-logo">${source.mark}</div><h2>${source.name}</h2></div><span class="tag">${source.label}</span><p>${source.description}</p><div class="actions"><a class="button primary" href="${source.url}" target="_blank" rel="noopener noreferrer">Browse ${source.name} ↗</a></div><div class="source-url">${new URL(source.url).hostname}</div></section>`).join("")}<section class="card note-card"><div class="note-title">BUILD A BETTER SHORTLIST</div><h2>Keep the roles worth your time.</h2><p class="mt">Start with CMS developer, WordPress developer, Shopify developer, Wix developer, and Squarespace developer. Check experience, location, and responsibilities before preparing an application.</p></section></div>${footer()}`;
}
function account() {
 const tabs=[['apis','Job search APIs'],['schedule','Automatic searches'],['google','Google sign-in'],...(auth.user.hasPassword?[['recovery','Account recovery']]:[])];
 return `${heading('Your account. Your workspace.','Manage your connections, sign-in and account security.')}<div class="account-layout"><section data-settings-tabs="account" class="account-settings"><div class="account-identity"><div class="avatar">${escape(auth.user.name.slice(0,2).toUpperCase())}</div><div><strong>${escape(auth.user.name)}</strong><small>${escape(auth.user.email)}</small></div></div><div class="settings-tabs account-tabs" role="tablist" aria-label="Account settings sections">${tabs.map(([id,label],index)=>`<button type="button" id="account-tab-${id}" role="tab" aria-controls="account-panel-${id}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${label}</button>`).join('')}</div><section id="account-panel-apis" role="tabpanel" aria-labelledby="account-tab-apis" class="settings-panel" tabindex="0">${jobProviderCard()}</section><section id="account-panel-schedule" role="tabpanel" aria-labelledby="account-tab-schedule" class="settings-panel" tabindex="0" hidden><div id="account-job-schedule"></div></section><section id="account-panel-google" role="tabpanel" aria-labelledby="account-tab-google" class="settings-panel card" tabindex="0" hidden><h3>Google sign-in</h3><p class="account-help" id="google-status">Checking connection…</p><details class="account-help mt" id="google-setup"><summary>Set up Google sign-in on this PC</summary><ol><li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform ↗</a> and select or create a project.</li><li>Set up the app’s branding and audience. If the app is in testing, add your Google email as a test user.</li><li>Create an OAuth client with application type <strong>Web application</strong>.</li><li>Add this JavaScript origin: <code>http://localhost:4180</code></li><li>Add this exact redirect URI: <code>http://localhost:4180/auth/google/callback</code></li><li>Copy the client ID and secret into the fields below. They stay on this PC.</li></ol></details><form id="google-form" class="mt"><label>Google client ID<input name="clientId" required maxlength="300" placeholder="Your web client ID" autocomplete="off"></label><label>Google client secret<input name="clientSecret" type="password" maxlength="1000" placeholder="Enter the client secret" autocomplete="new-password"></label><div class="google-actions"><button class="button primary" type="submit">Save Google connection</button><a class="button" href="/auth/google" id="connect-google">Connect my Google account ↗</a></div><p class="account-help mt">Connect the Google account you want to use. Confirm your Jobdesk password first to keep your workspace secure.</p><p id="google-feedback" class="account-help mt" role="status"></p></form></section>${auth.user.hasPassword?`<section id="account-panel-recovery" role="tabpanel" aria-labelledby="account-tab-recovery" class="settings-panel card" tabindex="0" hidden><h3>Account recovery</h3><p class="account-help">Create a one-time recovery code and keep it somewhere safe. It lets you reset your password without email delivery.</p><form id="recovery-form" class="mt"><label>Current password<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><button class="button" type="submit">Create recovery code</button></form><div id="recovery-result" class="account-help" role="status"></div></section>`:''}</section><aside><section class="card note-card"><div class="note-title">LOCAL & PERSONAL</div><h3>Your connections, organised.</h3><p>Manage job search keys separately from your Google sign-in and account recovery.</p><p class="mt">Your profile and saved jobs stay on this computer.</p></section></aside></div>${footer()}`;
}
async function bindAccount() {
  mountScheduleSettings(root.querySelector('#account-job-schedule'),{api});
  bindSettingsTabs(root,{initialPanel:auth.notice||new URLSearchParams(globalThis.location.search).has("error")?"account-panel-google":undefined});
  bindJobProviderSettings({api,onSaved:()=>{keywordResult=null;keywordResultPreferences=null;}});
  const status = document.querySelector("#google-status"),
    form = document.querySelector("#google-form");
  if (!auth.user.isOwner) {
    form.hidden = true;
    document.querySelector("#google-setup").hidden = true;
    status.insertAdjacentHTML(
      "afterend",
      '<p class="account-help mt">Google configuration is managed by the first account on this PC.</p><a class="button mt" id="connect-google-other" href="/auth/google">Connect my Google account ↗</a>',
    );
  }
  document.querySelectorAll("#connect-google, #connect-google-other").forEach(button => bindGoogleConnect(button, {api, user: auth.user}));
  try {
    const config = await api("/api/account/google");
    status.textContent = auth.user.googleConnected
      ? "Your Google account is connected."
      : config.available
        ? "Google is configured. Connect your account to use it for sign-in."
        : "Google is not connected yet. Email sign-in is ready to use.";
    const connectionError = googleErrorMessage(new URLSearchParams(globalThis.location.search).get("error"));
    if (connectionError) status.textContent = connectionError;
    form.elements.clientId.value = config.clientId;
    form.elements.clientSecret.placeholder = config.available
      ? "Leave blank to keep the saved secret"
      : "Enter the client secret";
  } catch (e) {
    status.textContent = e.message;
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api(
        "/api/account/google",
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      form.elements.clientSecret.value = "";
      document.querySelector("#google-feedback").textContent =
        "Google configuration saved. Use “Connect my Google account” to finish.";
      status.textContent = "Google is configured.";
    } catch (error) {
      document.querySelector("#google-feedback").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  const recovery = document.querySelector("#recovery-form");
  if (recovery)
    recovery.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const result = await api(
          "/api/account/recovery",
          "POST",
          Object.fromEntries(new FormData(recovery)),
        );
        recovery.reset();
        document.querySelector("#recovery-result").innerHTML =
          `<p class="mt">Keep this code private. Creating another code replaces this one.</p><div class="recovery-code">${escape(result.code)}</div><button class="button" id="download-recovery">Download recovery code ↓</button>`;
        document.querySelector("#download-recovery").onclick = () =>
          download(
            "jobdesk-recovery-code.txt",
            `Jobdesk recovery code for ${auth.user.email}\nKeep this private. It can be used once to reset your password.\n\n${result.code}`,
          );
      } catch (error) {
        document.querySelector("#recovery-result").textContent = error.message;
      }
    };
}
function confirmAction(title, message) {
  const dialog = document.querySelector("#confirm-dialog");
  dialog.querySelector("h2").textContent = title;
  dialog.querySelector("p").textContent = message;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true },
    ),
  );
}
function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
}
function download(name, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateResults() {
  document.querySelector("#job-results").innerHTML = filteredJobs();
  document.querySelector("#result-count").textContent =
    `${getFiltered().length} ${getFiltered().length === 1 ? "job" : "jobs"} · sorted by relevance`;
  bindJobs();
}
function bindJobs() {
  bindLifecycleActions();
  root.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.view;
        page = "details";
        render();
        window.scrollTo(0, 0);
      }),
  );
}
function bind() {
  if(page==='overview')bindOverviewKeywords();
  root.querySelectorAll("[data-save-source]").forEach(
    (button) =>
      (button.onclick = () => {
        const source = jobSources.find(
          (item) => item.id === button.dataset.saveSource,
        );
        state.savedSources = toggleSavedSource(state.savedSources, source.id);
        const active = savedSourceIds(state.savedSources).includes(source.id);
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute(
          "aria-label",
          `${active ? "Unsave" : "Save"} ${source.name} source`,
        );
        button.title = active ? "Unsave source" : "Save source";
        persist().then((ok) => {
          if (ok)
            toast(
              active
                ? `${source.name} saved to your sources.`
                : `${source.name} removed from saved sources.`,
            );
        });
      }),
  );
  root.querySelectorAll("[data-nav]").forEach(
    (b) =>
      (b.onclick = async () => {
        if(profileEditor?.isBusy()){toast("Please wait while your profile saves.");return;}
        if(page==='profile'&&profileEditor?.isDirty()&&!await confirmAction("Leave your profile edits?","Your unsaved profile edits will be lost. Save your profile first to keep them."))return;
        profileEditor?.destroy();profileEditor=null;
        page = b.dataset.nav;
        render();
        window.scrollTo(0, 0);
      }),
  );
  root
    .querySelectorAll("[data-add]")
    .forEach(
      (b) =>
        (b.onclick = () => document.querySelector("#job-dialog").showModal()),
    );
  root.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        render();
      }),
  );
  bindJobs();
  if (page === "jobs") {
    document.querySelector("#job-search").oninput = (e) => {
      query = e.target.value;
      updateResults();
    };
    document.querySelector("#location-filter").onchange = (e) => {
      location = e.target.value;
      updateResults();
    };
    document.querySelector("#result-count").textContent =
      `${getFiltered().length} ${getFiltered().length === 1 ? "job" : "jobs"} · sorted by relevance`;
  }
  if (page === "history") bindHistory();
  bindLifecycleActions();
  if (page === "profile") bindProfile();
  if (page === "account") bindAccount();
  const heroSearch = document.querySelector("#hero-search");
  if (heroSearch)
    heroSearch.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(heroSearch);
      query = String(data.get("query"));
      location = String(data.get("location"));
      filter = "All jobs";
      page = "jobs";
      render();
    };
  root.querySelectorAll("[data-popular]").forEach(
    (b) =>
      (b.onclick = () => {
        query = b.dataset.popular;
        filter = "All jobs";
        page = "jobs";
        render();
      }),
  );
}
async function saveRichProfile(profile,onboarding=false){
 state.profile=profile;
 if(onboarding)state.onboarding={completed:true,completedAt:new Date().toISOString()};
 return await persist();
}
function bindProfile(){
 profileEditor=mountProfileEditor(document.querySelector('#profile-editor'),{profile:state.profile,onSave:p=>saveRichProfile(p)});
 document.querySelector('#download-cv').onclick=()=>download('jobdesk-profile.txt',profileEditor.download());
}
function renderOnboarding(){
 document.title='Set up your profile · Jobdesk';
 root.innerHTML=`<div class="onboarding-shell"><header class="onboarding-top"><div class="brand"><span class="brand-symbol">↗</span>jobdesk<span class="brand-period">.</span></div><div class="top-right">${themeControl()}<button class="logout-button" id="onboarding-logout">Sign out ↗</button></div></header><div class="main"><main><div class="onboarding-intro"><div class="eyebrow">WELCOME TO YOUR NEXT CHAPTER</div><h1>Let’s make this workspace yours.</h1><p class="muted">Start with your CV or build your profile from scratch. You can edit every detail now and return to it anytime.</p></div><div id="onboarding-editor"></div></main></div></div>`;
 bindThemeControls();
 document.querySelector('#onboarding-logout').onclick=async()=>{if(profileEditor?.isDirty()&&!await confirmAction('Leave profile setup?','Your unsaved profile edits will be lost. Your uploaded CV will remain available when you sign in again.'))return;profileEditor?.destroy();await api('/api/auth/logout','POST',{});window.location.assign('/login');};
 profileEditor=mountProfileEditor(document.querySelector('#onboarding-editor'),{profile:state.profile,onboarding:true,onSave:p=>saveRichProfile(p,true),onDone:()=>{page='overview';render();window.scrollTo(0,0);toast('Your profile is ready. Welcome to your workspace.');}});
}

document.querySelector("[data-close]").onclick = () =>
  document.querySelector("#job-dialog").close();
function jobError(message) {
  const error = document.querySelector("#job-feedback");
  error.textContent = message;
  error.hidden = false;
}
document.querySelector("#job-form").onsubmit = (e) => {
  e.preventDefault();
  document.querySelector("#job-feedback").hidden = true;
  const d = new FormData(e.currentTarget);
  const url = String(d.get("url")).trim();
  if (url && !safeUrl(url)) {
    jobError("Use an HTTPS application URL without embedded credentials.");
    return;
  }
  const skills = [
    ...new Set(
      String(d.get("skills"))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (
    !skills.length ||
    skills.length > 200 ||
    skills.some((skill) => skill.length > 100)
  ) {
    jobError(
      "Add up to 200 skills, with no more than 100 characters per skill.",
    );
    return;
  }
  if (
    ["title", "company", "description"].some(
      (field) => !String(d.get(field)).trim(),
    )
  ) {
    jobError("Enter a job title, company, and description.");
    return;
  }
  const addedJob=saveJob(state,{
    id: crypto.randomUUID(),
    title: String(d.get("title")).trim(),
    company: String(d.get("company")).trim(),
    location: String(d.get("location")),
    years: Number(d.get("years")),
    skills,
    description: String(d.get("description")).trim(),
    url,
    sample: false,
    color: "mint",
    type: "Not specified",
    salary: "Salary not specified",
  });
  const saving = persist();
  document.querySelector("#job-dialog").close();
  e.currentTarget.reset();
  page = "jobs";
  filter = "All jobs";
  query = "";
  location = "All locations";
  render();
  saving.then((ok) => {
    if (ok) toast("Job saved to your workspace.");
  });
};
if (auth.notice) page = "account";
if(needsOnboarding)renderOnboarding();else render();
if (auth.notice) toast(auth.notice);
