import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keywordSuggestions} from '../public/keyword-suggestions.js';
test('focusing an empty field suggests profile-related roles and excludes selected keywords',()=>{
 const p={role:'CMS Developer',skills:['Shopify','WordPress','PHP']},copy=structuredClone(p);const result=keywordSuggestions('',{profile:p,selected:['WordPress developer']});
 assert.ok(result.includes('Shopify developer'));assert.ok(!result.includes('WordPress developer'));assert.ok(result.length<=8);assert.deepEqual(p,copy);
});
test('typing finds related keyword variants and handles common misspellings',()=>{
 assert.equal(keywordSuggestions('shop',{profile:{}})[0],'Shopify developer');assert.ok(keywordSuggestions('word press').includes('WordPress developer'));assert.ok(keywordSuggestions('shopfy').includes('Shopify developer'));assert.ok(keywordSuggestions('squarespace').includes('Squarespace developer'));assert.ok(keywordSuggestions('php').includes('PHP developer'));
});
test('comma-separated input suggests only for the current fragment and excludes earlier entries',()=>{
 const result=keywordSuggestions('WordPress developer, shop',{selected:['Wix developer']});assert.equal(result[0],'Shopify developer');assert.ok(!result.includes('WordPress developer'));assert.ok(!result.includes('Wix developer'));
});
test('unrelated input returns no suggestions and a full seven-keyword search stays bounded',()=>{
 assert.deepEqual(keywordSuggestions('zzzzzzzzzz'),[]);assert.deepEqual(keywordSuggestions('',{selected:['one','two','three','four','five','six','seven']}),[]);assert.ok(keywordSuggestions('',{limit:3}).length<=3);
});
