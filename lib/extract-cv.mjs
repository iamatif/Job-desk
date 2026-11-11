import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const MAX_BYTES=5*1024*1024;
function invalid(message,status=400){const e=new Error(message);e.status=status;return e;}
export function validateCvUpload(payload){
 if(!payload||typeof payload.filename!=='string'||!payload.filename.trim()||payload.filename.length>240)throw invalid('Choose a CV with a filename under 240 characters.');
 const filename=payload.filename.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g,'').trim();
 if(!filename||!filename.isWellFormed())throw invalid('Choose a CV with a valid filename.');
 const type=filename.split('.').at(-1).toLowerCase();if(!['pdf','docx','txt'].includes(type))throw invalid('Choose a PDF, DOCX, or TXT CV.');
 const encoded=payload.dataBase64;if(typeof encoded!=='string'||!encoded.length)throw invalid('The uploaded file is empty.');
 if(encoded.length>Math.ceil(MAX_BYTES/3)*4)throw invalid('Choose a CV of 5 MB or smaller.',413);
 if(encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw invalid('The uploaded file encoding is invalid. Try selecting the file again.');
 const bytes=Buffer.from(encoded,'base64');if(bytes.length>MAX_BYTES)throw invalid('Choose a CV of 5 MB or smaller.',413);if(!bytes.length)throw invalid('The uploaded file is empty.');
 if(bytes.toString('base64')!==encoded)throw invalid('The uploaded file encoding is invalid. Try selecting the file again.');
 if(type==='pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw invalid('This file is not a valid PDF. Choose the original PDF or paste its text.');
 if(type==='docx'&&!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw invalid('This file is not a valid DOCX. Choose a Word DOCX document.');
 return {filename,type,bytes};
}
function checkText(text,type){if(text.length>100000)throw invalid('The extracted CV exceeds 100,000 characters. Upload a shorter CV or paste the relevant sections.');if(text.trim().length<25)throw invalid(type==='pdf'?'No readable CV text was found. This PDF may be scanned. Use a text-based PDF, DOCX, TXT, or paste the CV text.':'No readable CV text was found. Paste at least 25 characters of your CV.');return text;}
export async function extractCv(bytes,type){
 if(type==='txt'){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw invalid('TXT files must contain UTF-8 text. Save the file as UTF-8 or paste the text.');}if(text.includes('\0'))throw invalid('The TXT file contains binary data. Upload a text CV.');return checkText(text,type);}
 if(!['pdf','docx'].includes(type))throw invalid('Unsupported CV format.');
 const text=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./extract-cv-worker.mjs',import.meta.url)),type],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let size=0,output=[],settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(value);};
  const timer=setTimeout(()=>finish(invalid('CV extraction took too long. Try a smaller document or paste the CV text.')),15000);
  child.on('error',()=>finish(invalid('CV extraction could not start. Try pasting the CV text.')));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>600000)return finish(invalid('The extracted CV is too large. Upload a shorter CV.'));output.push(chunk);});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.on('close',code=>{if(settled)return;try{const data=JSON.parse(Buffer.concat(output).toString('utf8'));if(code!==0||typeof data.text!=='string')return finish(invalid(data.error||'The document could not be read. Try a different file or paste the CV text.'));finish(null,data.text);}catch{finish(invalid('The document could not be read. It may be damaged, encrypted, or unsupported. Try pasting its text.'));}});
  child.stdin.end(bytes);
 });return checkText(text,type);
}
