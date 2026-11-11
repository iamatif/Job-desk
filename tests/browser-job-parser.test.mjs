import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBrowserJobPage,extractGoogleJobLinks} from '../lib/browser-job-parser.mjs';

const now=Date.parse('2026-11-11T12:00:00Z');
const options={source:'Indeed',keywords:['WordPress developer'],location:'pakistan-remote',now};
const posting={ '@type':'JobPosting',title:'WordPress developer',hiringOrganization:{name:'مثال Studio'},description:'<p>Build WordPress websites.</p>',datePosted:'2026-11-10',jobLocation:{address:{addressLocality:'Lahore',addressCountry:'PK'}}};
const page=(changes={})=>({url:'https://pk.indeed.com/viewjob?jk=abc123&from=google',jsonLd:[JSON.stringify({...posting,...changes})]});
test('normalizes original Indeed posting and preserves multilingual employer without inventing experience',()=>{
 const job=parseBrowserJobPage(page(),options);
 assert.equal(job.title,'WordPress developer');assert.equal(job.company,'مثال Studio');assert.equal(job.url,'https://pk.indeed.com/viewjob?jk=abc123');
 assert.equal(job.provider,'Browser search');assert.equal(job.source,'Indeed');assert.equal(job.sample,false);assert.equal(job.experienceKnown,false);assert.deepEqual(job.matchedKeywords,['WordPress developer']);assert.equal(job.posted,'2026-11-10T00:00:00.000Z');assert.match(job.location,/Lahore/);assert.match(job.eligibility,/Pakistan/);
});
test('reads LinkedIn graph JobPosting with explicit remote Pakistan eligibility',()=>{
 const json={ '@graph':[{'@type':'WebPage'},{...posting,jobLocation:undefined,jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{'@type':'Country',name:'Pakistan'}}]};
 const job=parseBrowserJobPage({url:'https://www.linkedin.com/jobs/view/wordpress-developer-123456/?trackingId=xx',jsonLd:[JSON.stringify(json)]},{...options,source:'LinkedIn'});
 assert.equal(job.url,'https://www.linkedin.com/jobs/view/123456');assert.match(job.location,/Remote/);assert.match(job.eligibility,/Pakistan/);
});
test('requires real recent posting date and rejects expired or malformed calendar dates',()=>{
 for(const changes of [{datePosted:undefined},{datePosted:'2026-09-01'},{datePosted:'2026-11-12'},{datePosted:'2026-02-30'},{validThrough:'2026-11-10'},{validThrough:'bad'}])assert.equal(parseBrowserJobPage(page(changes),options),null);
 assert.equal(parseBrowserJobPage({...page({datePosted:undefined}),text:'1 day ago',postedText:'1 day ago'},options),null);
});
test('rejects US restricted remote, unknown geography, and on-site listings for worldwide remote',()=>{
 for(const changes of [{jobLocation:undefined},{jobLocation:{address:{addressCountry:'US'}},jobLocationType:'TELECOMMUTE'},{jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'United States'}},{description:'WordPress developer. US-based applicants only.'}])assert.equal(parseBrowserJobPage(page(changes),options),null);
 assert.equal(parseBrowserJobPage(page(),{...options,location:'remote-worldwide'}),null);
 const global=page({jobLocation:undefined,jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'Worldwide'}});
 assert.match(parseBrowserJobPage(global,{...options,location:'remote-worldwide'}).eligibility,/Worldwide/);
});
test('only accepts dedicated DOM fields with reliable postedText on original LinkedIn listing',()=>{
 const dom={url:'https://www.linkedin.com/jobs/view/12345',jobTitle:'WordPress developer',company:'Acme',location:'Karachi, Pakistan',description:'WordPress builds',postedText:'3 days ago',text:'Sponsored · 1 hour ago'};
 const job=parseBrowserJobPage(dom,{...options,source:'LinkedIn'});assert.equal(job.posted,'2026-11-08T12:00:00.000Z');
 assert.equal(parseBrowserJobPage({...dom,postedText:undefined},{...options,source:'LinkedIn'}),null);
 assert.equal(parseBrowserJobPage({...dom,postedText:'30+ days ago'},{...options,source:'LinkedIn'}),null);
 assert.equal(parseBrowserJobPage({...dom,location:'Remote'},{...options,source:'LinkedIn'}),null);
 assert.equal(parseBrowserJobPage({...dom,postedText:'2026-11-10T08:00:00Z'},{...options,source:'LinkedIn'}).posted,'2026-11-10T08:00:00.000Z');
});
test('sanitizes HTML and isolates malformed or oversized JSON-LD',()=>{
 const job=parseBrowserJobPage(page({title:'<b>WordPress developer</b>',description:'<script>runSecret()</script><p>WordPress &amp; websites</p>'}),options);assert.equal(job.title,'WordPress developer');assert.equal(job.description,'WordPress & websites');
 assert.equal(parseBrowserJobPage({...page(),jsonLd:['{bad',' '.repeat(1024*1024+1)]},options),null);
 assert.equal(parseBrowserJobPage(page({title:'Accountant',description:'Accounts'}),options),null);
 for(const url of ['http://pk.indeed.com/viewjob?jk=x','https://indeed.com.evil.org/viewjob?jk=x','https://127.0.0.1/viewjob?jk=x','https://pk.indeed.com:8443/viewjob?jk=x','https://user@pk.indeed.com/viewjob?jk=x','https://www.linkedin.com/jobs/search/'])assert.equal(parseBrowserJobPage({...page(),url},options),null);
});
test('extracts bounded deduplicated original Google job links and safe Google redirects',()=>{
 const links=[{href:'https://www.google.com/url?q='+encodeURIComponent('https://www.linkedin.com/jobs/view/role-123?tracking=x')},{href:'https://www.linkedin.com/jobs/view/123'},{href:'https://pk.indeed.com/rc/clk?jk=abcd&from=google'},{href:'https://evil.org/url?q='+encodeURIComponent('https://pk.indeed.com/viewjob?jk=no')},{href:'https://www.google.com/url?q='+encodeURIComponent('https://linkedin.com.evil.org/jobs/view/123')},{href:'javascript:alert(1)'},{href:'https://www.indeed.com/jobs?q=wp'},{href:'https://pk.indeed.com/viewjob?jk=second'}];
 assert.deepEqual(extractGoogleJobLinks({url:'https://www.google.com/search?q=jobs',links},{source:'LinkedIn'}),['https://www.linkedin.com/jobs/view/123']);
 assert.deepEqual(extractGoogleJobLinks({url:'https://www.google.com/search?q=jobs',links},{source:'Indeed',limit:1}),['https://pk.indeed.com/viewjob?jk=abcd']);
});
test('rejects country-only restrictions despite worldwide metadata',()=>{
 const global={jobLocation:undefined,jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{name:'Worldwide'}};
 assert.equal(parseBrowserJobPage(page({...global,description:'WordPress work. US-only applicants.'}),{...options,location:'remote-worldwide'}),null);
 assert.equal(parseBrowserJobPage(page({...global,applicantLocationRequirements:[{name:'Worldwide'},{name:'United States'}]}),{...options,location:'remote-worldwide'}),null);
});
test('keeps displayed locations within workspace limit while preserving eligibility detail',()=>{
 const job=parseBrowserJobPage(page({jobLocation:Array.from({length:10},(_,i)=>({address:{addressLocality:`Long district number ${i}`,addressCountry:'PK'}}))}),options);
 assert.ok(job.location.length<=150);assert.ok(job.eligibility.length>150);
});
test('extracts profile matching skills only when title or description names them',()=>{
 const job=parseBrowserJobPage(page({description:'Build WordPress sites using PHP, HTML, CSS and JavaScript. Work with Git.'}),options);
 assert.deepEqual(job.skills,['WordPress','HTML','CSS','JavaScript','PHP','Git']);assert.ok(!job.skills.includes('Shopify'));assert.equal(job.experienceKnown,false);
});
