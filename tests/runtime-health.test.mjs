import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeState} from '../lib/runtime-health.mjs';
test('a server without the new upload build is stale even when its app name matches',()=>{
 assert.equal(runtimeState({app:'jobdesk-local',pid:1234},'current-build',1234),'stale');
 assert.equal(runtimeState({app:'jobdesk-local',buildId:'old-build',pid:1234},'current-build',1234),'stale');
});
test('only the recorded installation process can be restarted',()=>{
 assert.throws(()=>runtimeState({app:'other-app',pid:1234},'current-build',1234),/another application/);
 assert.throws(()=>runtimeState({app:'jobdesk-local',pid:5678},'current-build',1234),/does not match/);
 assert.throws(()=>runtimeState({app:'jobdesk-local',pid:0},'current-build',0),/does not match/);
});
test('the current server can be reused; no server means a fresh start',()=>{
 assert.equal(runtimeState({app:'jobdesk-local',buildId:'current-build',pid:1234},'current-build',1234),'current');
 assert.equal(runtimeState(null,'current-build',null),'stopped');
});
