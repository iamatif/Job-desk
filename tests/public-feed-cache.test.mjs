import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPublicFeedCache} from '../lib/public-feed-cache.mjs';
test('public feed cache persists only bounded success records and keeps a previous good cache',()=>{
 const db=new DatabaseSync(':memory:'),cache=createPublicFeedCache({db});const value={status:'ok',records:[{title:'WordPress Developer',company:'Public company',location:'Pakistan',url:'https://www.linkedin.com/jobs/view/role-1',posted:'2026-11-10'}],fetchedAt:'2026-11-10T00:00:00.000Z',nextRefreshAt:'2026-11-10T01:00:00.000Z'};
 cache.saveCache('WordPress developer',value);assert.deepEqual(createPublicFeedCache({db}).loadCache('wordpress DEVELOPER'),value);
 cache.saveCache('WordPress developer',{...value,status:'error',records:[]});assert.deepEqual(cache.loadCache('wordpress developer'),value);
 cache.saveCache('oversized',{...value,records:Array(201).fill(value.records[0])});assert.equal(cache.loadCache('oversized'),null);
 for(let i=0;i<101;i++)cache.saveCache('keyword'+i,value);assert.equal(db.prepare('SELECT count(*) AS n FROM public_job_feed_cache').get().n,100);db.close();
});
