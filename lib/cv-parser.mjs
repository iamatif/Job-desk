import { randomUUID } from 'node:crypto';

const headings = {
  summary: /^(?:professional |career |personal )?(?:summary|profile|objective|about me)$/i,
  skills: /^(?:(?:technical|core|key|professional) )?(?:skills|competencies|technologies)(?: & tools)?$/i,
  work: /^(?:(?:professional|relevant|employment|work) )?(?:experience|history)$|^employment$/i,
  education: /^(?:education|academic (?:background|qualifications)|qualifications)$/i,
  certifications: /^(?:certifications?|certificates?|licenses?(?: and certifications)?)$/i,
  awards: /^(?:awards?(?: and honors)?|honou?rs|achievements)$/i,
  projects: /^(?:(?:personal|selected|key) )?projects$/i,
  languages: /^languages?(?: proficiency)?$/i,
  custom: /^(?:volunteer(?: work| experience)?|interests|hobbies|references|publications|additional information|notes)$/i,
};
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const dateToken = '(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{4}|\\d{4}[-/]\\d{1,2}|\\d{1,2}/\\d{4}|(?:19|20)\\d{2})';
const rangeRe = new RegExp(`(${dateToken})\\s*(?:[–—−-]|\\bto\\b)\\s*(${dateToken}|present|current|now|ongoing)`, 'i');
const clean = s => s.replace(/^[\s•●▪◦*\-–]+/, '').trim();
const id = () => randomUUID();
function date(s) {
  const value = s.trim();
  if (/^\d{4}$/.test(value)) return value;
  let m = value.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2,'0')}` : '';
  m = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2,'0')}` : '';
  m = value.match(/^([a-z]+)\.?\s+(\d{4})$/i);
  return m && months.includes(m[1].slice(0,3).toLowerCase()) ? `${m[2]}-${String(months.indexOf(m[1].slice(0,3).toLowerCase())+1).padStart(2,'0')}` : '';
}
function range(line) {
  const m = line.match(rangeRe);
  return m ? {startDate:date(m[1]),endDate:/^(present|current|now|ongoing)$/i.test(m[2])?'':date(m[2]),current:/^(present|current|now|ongoing)$/i.test(m[2])} : null;
}
function parts(line) { return line.split(/\s*\|\s*|\s+@\s+|\s+at\s+|\s+[–—]\s+|\s+-\s+/).map(clean).filter(Boolean); }

// Date lines anchor entries. Unrecognized text remains in the original section.
function datedEntries(lines, kind, warnings) {
  const anchors = lines.map((line,index) => ({index,period:range(line)})).filter(x=>x.period);
  const result = [];
  let consumed = 0;
  for (let n=0;n<anchors.length;n++) {
    const {index,period} = anchors[n];
    const inline = clean(lines[index].replace(rangeRe,'').replace(/^[|,\s]+|[|,\s]+$/g,''));
    const before = lines.slice(consumed,index).filter(Boolean);
    // The header immediately preceding a date usually occupies one or two lines.
    const lastLine=before.at(-1)||'';
    const headerLength=parts(lastLine).length>1 || /[.!?]$/.test(before.at(-2)||'') ? 1 : Math.min(before.length,2);
    const header = inline ? [inline] : before.slice(-headerLength);
    const previous = result.at(-1);
    if (previous && before.length > header.length) {
      const detailField = kind === 'work' ? 'responsibilities' : 'description';
      previous[detailField] = [previous[detailField],...before.slice(0,-header.length)].filter(Boolean).join('\n');
    }
    const after = n === anchors.length-1 ? lines.slice(index+1) : [];
    const headerParts = header.flatMap(parts);
    const first = headerParts.shift() || '';
    if (kind === 'work') {
      const entry = {id:id(),title:first,company:headerParts.shift()||'',location:headerParts.join(', '),...period,responsibilities:after.join('\n'),achievements:''};
      if (!entry.company) warnings.push(`Company could not be identified for ${entry.title || 'a work entry'}; review the original experience.`);
      result.push(entry);
    } else {
      const degree = /\b(?:bachelor|master|doctor|phd|bsc|msc|bs|ms|ba|mba|b\.?(?:sc|a)|m\.?(?:sc|a)|diploma|certificate|degree)\b/i;
      const qualificationFirst = degree.test(first);
      const qualification=qualificationFirst?first:headerParts.shift()||'';
      const field=qualification.replace(/^(?:bachelor(?:'s)?|master(?:'s)?|doctor)(?:\s+of)?\s+(?:science|arts|philosophy)\s*(?:in\s+)?|^(?:phd|bsc|msc|bs|ms|ba|mba|b\.?sc\.?|m\.?sc\.?)\s+(?:in\s+)?/i,'');
      result.push({id:id(),institution:qualificationFirst ? headerParts.shift()||'' : first,qualification,field:field===qualification?'':field,...period,description:after.join('\n')});
    }
    consumed = index+1;
  }
  if (lines.length && !anchors.length) warnings.push(`${kind === 'work'?'Work experience':'Education'} dates could not be identified; review and enter details manually.`);
  if(kind==='work') for(const entry of result) entry.achievements=entry.responsibilities.split('\n').filter(line=>/\b(?:reduced|increased|improved|achieved|awarded|won|saved|grew|boosted|delivered)\b/i.test(line)).join('\n');
  return result;
}

const technologyNames = ['WordPress','WooCommerce','Shopify','Webflow','Drupal','Joomla','PHP','JavaScript','TypeScript','HTML','CSS','React','Next.js','Node.js','Python','SQL','MySQL','PostgreSQL','Git','GitHub','Figma','SEO','REST API','Tailwind CSS','Bootstrap','Laravel','Elementor','Divi','ACF','Gutenberg'];
function canonical(skill) { return technologyNames.find(t=>t.toLowerCase()===skill.toLowerCase() || (t==='WordPress' && /^wordpress$/i.test(skill))) || skill; }
function simpleEntries(lines, kind) {
  return lines.filter(Boolean).map(line=>{
    const p = parts(line); const foundDate = line.match(new RegExp(dateToken,'i'));
    const when = foundDate?date(foundDate[0]):'';
    const url = line.match(/https?:\/\/[^\s|]+/i)?.[0]||'';
    if (kind==='certifications') return {id:id(),name:p[0]||'',issuer:p[1] && !new RegExp(`^${dateToken}$`,'i').test(p[1]) ? p[1]:'',issueDate:when,expiryDate:'',credentialId:'',url};
    if (kind==='awards') return {id:id(),title:p[0]||'',issuer:p[1] && !new RegExp(`^${dateToken}$`,'i').test(p[1])?p[1]:'',date:when,description:''};
    return {id:id(),name:p[0]||'',proficiency:p.slice(1).join(' - ')};
  });
}
function yearsFromRanges(entries, now, warnings) {
  const nowDate = new Date(`${now.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(+nowDate)) throw new Error('Invalid reference date.');
  const nowMonth = nowDate.getUTCFullYear()*12+nowDate.getUTCMonth();
  const periods=[];
  for (const entry of entries) {
    const start=entry.startDate, end=entry.endDate;
    if (!start || (!end && !entry.current)) continue;
    // For year-only dates use latest possible start and earliest possible end.
    const a=Number(start.slice(0,4))*12+(start.length>4?Number(start.slice(5))-1:11);
    const b=entry.current?nowMonth:Number(end.slice(0,4))*12+(end.length>4?Number(end.slice(5))-1:0);
    if (b<a || a>nowMonth || b>nowMonth) { warnings.push('A work date range is invalid or in the future and was excluded from experience years.'); continue; }
    periods.push([a,b]);
  }
  periods.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const p of periods) { const last=merged.at(-1); if(last && p[0]<=last[1]) last[1]=Math.max(last[1],p[1]); else merged.push([...p]); }
  return Math.floor(merged.reduce((sum,[a,b])=>sum+b-a,0)/12*10)/10;
}

/** Deterministic local extraction. CV content is data; no commands or instructions are evaluated. */
export function parseCvText(text,{name='',email='',now='2026-11-10'}={}) {
  if (typeof text!=='string' || text.trim().length<25) throw new Error('CV text is empty or too short to extract. Paste at least 25 characters.');
  if (text.length>100000) throw new Error('CV text exceeds the 100,000 character limit.');
  const lines=text.replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
  const sections={header:[]}; const rawSections={header:[]}; const customSections=[]; let key='header';
  for (const raw of lines) {
    const line=clean(raw); const colon=line.indexOf(':');
    const candidate=(colon>=0 ? line.slice(0,colon) : line).trim();
    const match=Object.entries(headings).find(([,re])=>re.test(candidate));
    if(match) { key=match[0]; if(key==='custom') { key=`custom${customSections.length}`; customSections.push({id:id(),title:candidate,content:''}); } sections[key]??=[]; rawSections[key]??=[]; if(colon>=0 && line.slice(colon+1).trim()) { sections[key].push(line.slice(colon+1).trim()); rawSections[key].push(line.slice(colon+1).trim()); } }
    else { sections[key].push(line); rawSections[key].push(raw); }
  }
  for (let i=0;i<customSections.length;i++) customSections[i].content=sections[`custom${i}`].join('\n');
  const warnings=['Review all extracted details against the original CV before using them. Dates and entry boundaries are inferred locally.'];
  const header=sections.header;
  const nameCandidate=header.find(s=>/^name\s*:\s*\S/i.test(s))?.replace(/^name\s*:\s*/i,'') || header.find(s=>/^[\p{L}][\p{L} .'’\-]{2,70}$/u.test(s) && s.split(/\s+/).length>=2 && s.split(/\s+/).length<=5 && !/\b(?:resume|curriculum|vitae|developer|engineer|designer|manager|consultant|specialist|experience|skills)\b/i.test(s));
  const profile={schemaVersion:2,name:name||nameCandidate||'',role:'',years:0,skills:[],summary:(sections.summary||[]).join('\n'),experience:(rawSections.work||[]).join('\n'),portfolio:'',fictional:false,email:email||text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'',phone:'',location:'',linkedin:'',github:'',workHistory:[],education:[],certifications:[],awards:[],projects:[],languages:[],customSections};
  profile.role=header.find(s=>s!==profile.name && s.length<100 && /\b(?:developer|engineer|designer|manager|consultant|specialist|analyst|administrator|writer|editor|marketer|assistant|officer|architect|student)\b/i.test(s) && !/@|https?:|\bexperience\b/i.test(s))||'';
  profile.phone=text.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){9,14}\d/)?.[0].trim()||'';
  profile.location=header.find(s=>/^location\s*:/i.test(s))?.replace(/^location\s*:\s*/i,'')||'';
  const urls=text.match(/(?:https?:\/\/|www\.)(?:[^\s<>|]+)/gi)||[];
  for(const raw of urls) { const url=raw.replace(/[),.;]+$/,''); if(/linkedin\.com\//i.test(url)) profile.linkedin=url; else if(/github\.com\//i.test(url)) profile.github=url; }
  profile.portfolio=header.find(s=>/^(?:portfolio|website)\s*:/i.test(s))?.match(/(?:https?:\/\/|www\.)[^\s|]+/)?.[0]||'';
  const skills=(sections.skills||[]).flatMap(s=>s.replace(/^[^:]{1,35}:\s*/, '').split(/[,;|•●▪]/)).map(clean).filter(Boolean);
  for(const t of technologyNames) { const escaped=t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); if(new RegExp(`(?<![\\w])${escaped}(?![\\w])`,'i').test(text)) skills.push(t); }
  profile.skills=[...new Map(skills.map(s=>[canonical(s).toLowerCase(),canonical(s)])).values()];
  profile.workHistory=datedEntries(sections.work||[],'work',warnings);
  profile.education=datedEntries(sections.education||[],'education',warnings);
  profile.certifications=simpleEntries(sections.certifications||[],'certifications');
  profile.awards=simpleEntries(sections.awards||[],'awards');
  profile.languages=simpleEntries(sections.languages||[],'languages');
  const projectLines=sections.projects||[];
  for(const line of projectLines) {
    if (!profile.projects.length || /\||https?:\/\//.test(line)) { const p=parts(line); profile.projects.push({id:id(),name:p[0],role:'',url:line.match(/https?:\/\/[^\s|]+/)?.[0]||'',description:'',technologies:''}); }
    else { const project=profile.projects.at(-1); project.description=[project.description,line].filter(Boolean).join('\n'); }
  }
  profile.years=yearsFromRanges(profile.workHistory,now,warnings);
  if(!profile.workHistory.length) { const explicit=text.match(/\b(\d{1,2}(?:\.\d+)?)\+?\s*years?(?:\s+of)?\s+(?:professional\s+|work\s+)?experience\b/i); if(explicit) profile.years=Number(explicit[1]); }
  if(!profile.name) warnings.push('Name could not be identified. Enter it manually.');
  if(!profile.email) warnings.push('No email address was identified.');
  if(!profile.workHistory.length) warnings.push('No structured work experience was identified; review the original CV.');
  if(!profile.education.length && sections.education?.length) profile.customSections.push({id:id(),title:'Unparsed education',content:sections.education.join('\n')});
  return {profile,warnings};
}
