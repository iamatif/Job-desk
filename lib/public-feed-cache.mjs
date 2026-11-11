// Public listing metadata only. Credentials and personal workspace data never enter this cache.
export function createPublicFeedCache({db}){
 db.exec('CREATE TABLE IF NOT EXISTS public_job_feed_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
 const keyFor=keyword=>'linkedin-public|'+String(keyword).trim().toLowerCase();
 return {
  loadCache(keyword){try{const raw=db.prepare('SELECT value FROM public_job_feed_cache WHERE key=?').get(keyFor(keyword))?.value;if(!raw||raw.length>1024*1024)return null;return JSON.parse(raw);}catch{return null;}},
  saveCache(keyword,value){try{if(value?.status!=='ok'||!Array.isArray(value.records)||value.records.length>200)return;const raw=JSON.stringify(value);if(raw.length>1024*1024)return;db.prepare('INSERT INTO public_job_feed_cache VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(keyFor(keyword),raw,Date.now());db.exec('DELETE FROM public_job_feed_cache WHERE key NOT IN (SELECT key FROM public_job_feed_cache ORDER BY updated_at DESC,rowid DESC LIMIT 100)');}catch{/* Cache failures do not prevent normal source fetches. */}}
 };
}
