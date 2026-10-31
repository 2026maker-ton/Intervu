import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeIntoInstitution} from '../../src/domain/school-analysis.js';
for(const status of ['demo_fixture','user_supplied','official_verified']) test('source provenance survives school merge: '+status,()=>{
 const analysis={talent_traits:[{id:'t',label:'탐구력',quote:'원문 근거',source_id:'s'}],interview_format:[{label:'개별 면접',quote:'개별 면접',source_id:'s'}]};
 const out=mergeIntoInstitution({},analysis,{s:{status,title:'자료'}});
 assert.equal(out.core_values[0].source_status,status);
 assert.equal(out.core_values[0].source_id,'s');
 assert.equal(out.core_values[0].basis,status==='official_verified'?'official':'user');
 assert.equal(out.formats[0].source_status,status);
});
