// Untrusted documents are parsed in a short-lived, memory-bounded child process.
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const buffer=Buffer.concat(chunks);
try{
 let text='';
 if(process.argv[2]==='pdf'){
  const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false});
  try{const result=await parser.getText();text=result.pages.map(p=>p.text).join('\n\n');}finally{await parser.destroy();}
 }else{
  const mammoth=await import('mammoth');const result=await mammoth.extractRawText({buffer});text=result.value;
 }
 if(text.length>100000)throw new Error('too-large');process.stdout.write(JSON.stringify({text}));
}catch(error){process.stdout.write(JSON.stringify({error:error.message==='too-large'?'The extracted CV exceeds 100,000 characters. Upload a shorter document.':'The document could not be read. It may be damaged, encrypted, or unsupported. Try pasting its text.'}));process.exitCode=1;}
