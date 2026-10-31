import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withApp,B} from '../helpers/app.mjs';
test('UI context: provider status rejects foreign profile and ambiguous context',async()=>{
 await withApp({},async c=>{
 const p=await c('/api/v1/profiles',{method:'POST',body:{org_type:'university',school_name:'가상 대학',target_name:'가상 대학',role:'과학',application_text:'저는 동아리 활동을 정리했습니다.'}});
 assert.equal(p.status,201);
 const other=await c('/api/v1/providers/status?profile_id='+p.data.id,{token:B});assert.equal(other.status,404);
 const both=await c('/api/v1/providers/status?profile_id='+p.data.id+'&session_id=x');assert.equal(both.status,422);
 const own=await c('/api/v1/providers/status?profile_id='+p.data.id);assert.equal(own.status,200);assert.equal(own.data.summary,'mock');
 const stt=await c('/api/v1/stt/status?profile_id='+p.data.id);assert.notEqual(stt.data.real_data_allowed,true);
 });
});
