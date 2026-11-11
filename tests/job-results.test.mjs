import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSearchJobs} from '../public/job-results.js';
const now=Date.UTC(2026,10,10,12),day=86400000;
const job=(id,age,source='Himalayas',extra={})=>({id,source,title:'WordPress Developer',company:id,posted:new Date(now-age*day).toISOString(),matchedKeywords:['WordPress developer'],...extra});
test('recent windows keep exact boundaries and hide old, undated, invalid, future and expired jobs',()=>{
 const jobs=[job('fresh',.1),job('one',1),job('week',7),job('two-weeks',14),job('month',30),job('old',30.01),job('future',-1),job('undated',0,'Himalayas',{posted:null}),job('bad-date',0,'Himalayas',{posted:'invalid'}),job('expired',0,'Himalayas',{expiresAt:new Date(now-1).toISOString()})];
 for(const [period,ids] of [['day',['fresh','one']],['week',['fresh','one','week']],['fortnight',['fresh','one','week','two-weeks']],['latest',['fresh','one','week','two-weeks']]])assert.deepEqual(selectSearchJobs(jobs,{period,now,sort:'newest'}).map(j=>j.id),ids);
});
test('balanced sources prevent a large provider from filling the first page, newest mode stays chronological',()=>{
 const jobs=[...Array.from({length:20},(_,i)=>job('h'+i,i/100)),job('indeed',1,'Indeed'),job('linkedin',2,'LinkedIn')];
 const mixed=selectSearchJobs(jobs,{now,sort:'balanced'});assert.deepEqual(mixed.slice(0,3).map(j=>j.source),['Himalayas','Indeed','LinkedIn']);assert.equal(mixed.length,22);
 assert.deepEqual(selectSearchJobs(jobs,{now,sort:'newest'}).slice(0,6).map(j=>j.source),Array(6).fill('Himalayas'));
});
test('date, keyword and alternate publisher filters compose without mutating results',()=>{
 const jobs=[job('mixed',.5,'LinkedIn',{applyOptions:[{name:'Bayt',url:'https://www.bayt.com/job/1'}]}),job('old-bayt',10,'Bayt'),job('other-keyword',0,'Bayt',{matchedKeywords:['Shopify developer']})],before=structuredClone(jobs);
 assert.deepEqual(selectSearchJobs(jobs,{now,period:'day',source:'Bayt',keyword:'WordPress developer'}).map(j=>j.id),['mixed']);assert.deepEqual(jobs,before);
});
