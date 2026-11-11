import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseKeywords,matchedKeywords,suggestedKeywords,boardSearchLinks,activeSearchJobs,resultMatchesPreferences} from '../public/job-keywords.js';
import {matchJob} from '../public/model.js';
test('keywords trim, deduplicate, and keep phrases separate',()=>{
 assert.deepEqual(normaliseKeywords(' WordPress developer, Shopify developer\nWORDPRESS developer; Wix developer '),['WordPress developer','Shopify developer','Wix developer']);
 assert.deepEqual(normaliseKeywords(Array(8).fill('CMS developer')),['CMS developer']);
 assert.throws(()=>normaliseKeywords(['one','two','three','four','five','six','seven','eight']),/seven/i);
 for(const input of [[],['x'],['x'.repeat(61)],[{}],['a\0b']])assert.throws(()=>normaliseKeywords(input));
});
test('platform developer keywords match relevant role variants, not incidental marketing mentions',()=>{
 assert.deepEqual(matchedKeywords({title:'Senior Shopify Theme Engineer',description:'Build Liquid themes'},['Shopify developer','WordPress developer']),['Shopify developer']);
 assert.deepEqual(matchedKeywords({title:'Content Marketing Manager',description:'Publish articles using WordPress and collaborate with developers'},['WordPress developer']),[]);
 assert.deepEqual(matchedKeywords({title:'Web Developer',description:'Build WordPress and Elementor websites'},['WordPress developer','Elementor developer']),['WordPress developer','Elementor developer']);
 assert.deepEqual(matchedKeywords({title:'Data Analyst',description:'Statistics and reporting'},['CMS developer']),[]);
});
test('skills generate editable CMS search suggestions without changing the profile',()=>{
 const p={role:'CMS Developer',skills:['WordPress','Shopify','Wix','Squarespace','Elementor','HTML']};const copy=structuredClone(p);const terms=suggestedKeywords(p);
 assert.ok(terms.includes('WordPress developer'));assert.ok(terms.length>=5&&terms.length<=7);assert.deepEqual(p,copy);
});
test('Pakistan board links preserve a selected keyword safely',()=>{
 const links=boardSearchLinks('Shopify developer','pakistan-remote');assert.ok(links.some(x=>x.name==='Indeed'));assert.ok(links.some(x=>x.name==='Mustakbil'));assert.ok(links.every(x=>new URL(x.url).protocol==='https:'));assert.ok(links.find(x=>x.name==='Indeed').url.includes('Shopify'));
});
test('board searches include LinkedIn and respect Pakistan versus worldwide remote intent',()=>{
 const local=boardSearchLinks('Shopify developer','pakistan-remote'),remote=boardSearchLinks('Shopify developer','remote-worldwide');
 assert.ok(local.find(b=>b.name==='LinkedIn'&&b.url.includes('Pakistan')));assert.ok(local.some(b=>b.name==='Rozee.pk'));
 const linkedin=remote.find(b=>b.name==='LinkedIn');assert.equal(new URL(linkedin.url).searchParams.get('f_WT'),'2');assert.equal(new URL(linkedin.url).searchParams.get('location'),'Worldwide');
 assert.ok(remote.some(b=>b.name==='We Work Remotely'));assert.ok(remote.some(b=>b.name==='Remote OK'));assert.equal(remote.some(b=>b.name==='NJP'),false);
 assert.equal(new URL(remote.find(b=>b.name==='Indeed').url).searchParams.get('l'),'Remote');
});
test('unknown experience does not receive an assumed experience match',()=>{
 const fit=matchJob({skills:['Shopify','Liquid'],years:0,experienceKnown:false},{skills:['Shopify'],years:3});assert.equal(fit.score,50);assert.equal(fit.experienceGap,null);assert.equal(fit.experienceKnown,false);
});
test('reused results omit expired jobs and retain their own search context',()=>{
 const now=Date.UTC(2026,10,10),result={keywords:['Shopify developer'],location:'pakistan-remote',jobs:[{id:'old',expiresAt:'2026-11-09T00:00:00Z'},{id:'current',expiresAt:'2026-11-11T00:00:00Z'},{id:'unknown',expiresAt:null}]};
 assert.deepEqual(activeSearchJobs(result,now).map(j=>j.id),['current','unknown']);assert.equal(resultMatchesPreferences(result,{keywords:['Shopify developer'],location:'pakistan-remote'}),true);assert.equal(resultMatchesPreferences(result,{keywords:['Wix developer'],location:'pakistan-remote'}),false);assert.equal(resultMatchesPreferences(result,{keywords:['Shopify developer'],location:'remote-worldwide'}),false);
});
