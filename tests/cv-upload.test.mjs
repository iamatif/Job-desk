import {test,before,after,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJobdeskServer} from '../server.mjs';
import {emptyProfile} from '../public/profile-data.js';
import {extractCv,validateCvUpload} from '../lib/extract-cv.mjs';
let app,base,dir,a,b;
const source='Ayesha Khan\nCMS Developer\nSummary\nBuilding accessible CMS websites.\nSkills\nWordPress, PHP\nWork Experience\nDeveloper | Studio\n2022–2024\nBuilt client websites.';
async function request(path,method='GET',body,auth={},extra={}){return fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...auth,...extra},body:body===undefined?undefined:JSON.stringify(body)});}
async function signup(email){const r=await request('/api/auth/signup','POST',{name:'Account Name',email,password:'Example Password 2026!'});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^jobdesk_cv_qa=/);const me=await(await request('/api/auth/me','GET',undefined,{cookie})).json();return {cookie,'x-csrf-token':me.csrf};}
describe('CV HTTP integration',()=>{
before(async()=>{dir=await mkdtemp(join(tmpdir(),'jobdesk-cv-'));app=createJobdeskServer({dataDir:dir,port:0,testMode:true,cookieName:'jobdesk_cv_qa',oauthCookieName:'jobdesk_cv_qa_oauth'});await app.start();base=`http://localhost:${app.port}`;a=await signup('one@example.test');b=await signup('two@example.test');});
after(async()=>{await app?.close();if(dir)await rm(dir,{recursive:true,force:true});});
test('CV uploads are authenticated, CSRF protected and isolated; originals download and remove',async()=>{
 const payload={filename:'my-cv.txt',dataBase64:Buffer.from(source).toString('base64')};
 assert.equal((await request('/api/cv/import','POST',payload)).status,401);
 assert.equal((await request('/api/cv/import','POST',payload,{cookie:a.cookie})).status,403);
 const r=await request('/api/cv/import','POST',payload,a);assert.equal(r.status,200);const imported=await r.json();assert.equal(imported.profile.name,'Ayesha Khan');assert.equal(imported.document.filename,'my-cv.txt');assert.equal(imported.document.size,Buffer.byteLength(source));
 assert.equal((await(await request('/api/cv','GET',undefined,b)).json()).document,null);
 assert.equal((await request('/api/cv/download','GET',undefined,b)).status,404);
 const download=await request('/api/cv/download','GET',undefined,a);assert.equal(await download.text(),source);assert.match(download.headers.get('content-disposition'),/attachment/);
 assert.equal((await request('/api/cv/remove','POST',{},a)).status,200);assert.equal((await(await request('/api/cv','GET',undefined,a)).json()).document,null);
});
test('failed uploads preserve the previous original and pasted text does not overwrite it',async()=>{
 const payload={filename:'original.txt',dataBase64:Buffer.from(source).toString('base64')};await request('/api/cv/import','POST',payload,a);
 for(const invalid of [{filename:'fake.pdf',dataBase64:payload.dataBase64},{filename:'cv.exe',dataBase64:payload.dataBase64},{filename:'cv.txt',dataBase64:'%%%'}])assert.equal((await request('/api/cv/import','POST',invalid,a)).status,400);
 const parsed=await request('/api/cv/parse-text','POST',{text:source},a);assert.equal(parsed.status,200);
 assert.equal((await(await request('/api/cv','GET',undefined,a)).json()).document.filename,'original.txt');
 assert.equal((await request('/api/cv/parse-text','POST',{text:'hi'},a)).status,400);
 assert.equal((await request('/api/cv/import','POST',{filename:'large.txt',dataBase64:Buffer.alloc(5*1024*1024+1,65).toString('base64')},a)).status,413);
});
test('workspace rich profile validation rejects invalid dates and URLs without rejecting legacy profiles',async()=>{
 const profile=emptyProfile({name:'CMS Tester'});profile.workHistory=[{id:'one',title:'Developer',company:'Studio',startDate:'2025-01',endDate:'2024-01',current:false}];
 const workspace={profile,jobs:[],applications:{}};assert.equal((await request('/api/workspace','PUT',workspace,a,{'if-match':'0'})).status,400);
 profile.workHistory=[];profile.linkedin='javascript:alert(1)';assert.equal((await request('/api/workspace','PUT',workspace,a,{'if-match':'0'})).status,400);
 profile.linkedin='';profile.fictional='false';assert.equal((await request('/api/workspace','PUT',workspace,a,{'if-match':'0'})).status,400);
 profile.fictional=false;assert.equal((await request('/api/workspace','PUT',workspace,a,{'if-match':'0'})).status,200);
});
});
test('upload signature and size validation never trusts file extensions',async()=>{
 assert.throws(()=>validateCvUpload({filename:'cv.pdf',dataBase64:Buffer.from(source).toString('base64')}),/PDF/i);
 assert.throws(()=>validateCvUpload({filename:'cv.docx',dataBase64:Buffer.from(source).toString('base64')}),/DOCX/i);
 assert.throws(()=>validateCvUpload({filename:'bad\ud800.txt',dataBase64:Buffer.from(source).toString('base64')}),/filename/i);
 assert.throws(()=>validateCvUpload({filename:'cv.txt',dataBase64:Buffer.alloc(5*1024*1024+1).toString('base64')}),/5 MB/);
 assert.equal(await extractCv(Buffer.from(source),'txt'),source);
});

// A real, minimal uncompressed ZIP; no extraction library is mocked.
function zip(files){const locals=[],central=[];let offset=0;for(const[name,text]of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(text);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);locals.push(local,n,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=local.length+n.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);}
function pdf(text){const stream=`BT /F1 12 Tf 40 760 Td (${text}) Tj ET`;const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let output='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(output);output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(output);}
test('real PDF and DOCX text extraction runs through bounded subprocesses',async()=>{
 const docx=zip({'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Ayesha Khan CMS Developer building WordPress websites</w:t></w:r></w:p></w:body></w:document>'});
 assert.match(await extractCv(docx,'docx'),/Ayesha Khan CMS Developer/);
 assert.match(await extractCv(pdf('Ayesha Khan CMS Developer building WordPress websites'),'pdf'),/Ayesha Khan CMS Developer/);
 await assert.rejects(extractCv(pdf(''),'pdf'),/scanned/i);
 await assert.rejects(extractCv(Buffer.from('%PDF-not-a-document'),'pdf'),/could not be read/i);
});
