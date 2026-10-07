import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSendSnapshot,sheetSendSnapshot} from '../web/send-preflight.js';

const project={id:'health',targetIds:[2,1],requiredIds:[1]};
const employees=[{id:1,name:'김가상',team:'operations'},{id:2,name:'이가상',team:'design'}];
const applications=[{projectId:'health',employeeId:1,status:'applied'}];
const source={sync:{status:'success',lastSuccessAt:'2026-10-06T01:00:00Z'},
  sourceProjects:[{id:'health'}],projectTargets:[{projectId:'health',targetIds:[1,2],requiredIds:[1]}],
  employees:[{id:1,name:'김가상',teamName:'운영팀'},{id:2,name:'이가상',teamName:'디자인팀'}],applications};
const teams=new Map([['운영팀','operations'],['디자인팀','design']]);

test('fresh Sheet snapshot matches approved recipients only when source facts are unchanged',()=>{
  const approved=projectSendSnapshot(project,employees,applications);
  assert.equal(sheetSendSnapshot(source,'health',teams),approved);
  assert.notEqual(sheetSendSnapshot({...source,applications:[{projectId:'health',employeeId:1,status:'confirmed'}]},'health',teams),approved);
  assert.notEqual(sheetSendSnapshot({...source,applications:[{projectId:'health',employeeId:1,status:'cancelled'}]},'health',teams),approved);
  assert.notEqual(sheetSendSnapshot({...source,applications:[...applications,{projectId:'health',employeeId:2,status:'applied'}]},'health',teams),approved);
  assert.notEqual(sheetSendSnapshot({...source,projectTargets:[{projectId:'health',targetIds:[1,2],requiredIds:[1,2]}]},'health',teams),approved);
  assert.notEqual(sheetSendSnapshot({...source,employees:source.employees.map(row=>row.id===2?{...row,teamName:'운영팀'}:row)},'health',teams),approved);
});

test('failed, incomplete and inconsistent source reads cannot pass preflight',()=>{
  assert.throws(()=>sheetSendSnapshot({...source,sync:{status:'failed'}},'health',teams),/최신 신청 현황/);
  assert.throws(()=>sheetSendSnapshot({...source,projectTargets:[]},'health',teams),/대상 명단/);
  assert.throws(()=>sheetSendSnapshot({...source,projectTargets:[...source.projectTargets,...source.projectTargets]},'health',teams),/대상 명단/);
  assert.throws(()=>sheetSendSnapshot({...source,employees:source.employees.slice(1)},'health',teams),/대상 명단/);
  assert.throws(()=>sheetSendSnapshot({...source,employees:[...source.employees,source.employees[0]]},'health',teams),/대상 명단/);
  assert.throws(()=>sheetSendSnapshot({...source,employees:[{...source.employees[0],teamName:'미등록팀'},source.employees[1]]},'health',teams),/없는 팀/);
  assert.throws(()=>projectSendSnapshot(project,employees,[...applications,...applications]),/신청 상태/);
});

test('preflight includes a newer operator confirmation and still detects later Sheet changes',()=>{
  const sheetEvent={projectId:'health',employeeId:1,status:'applied',occurredAt:'2026-10-06T01:00:00Z'};
  const operatorEvent={id:'manual-1',projectId:'health',employeeId:1,toStatus:'confirmed',at:'2026-10-07T10:00',source:'operator'};
  const approved=projectSendSnapshot(project,employees,[{projectId:'health',employeeId:1,status:'confirmed'}]);
  assert.equal(sheetSendSnapshot({...source,events:[sheetEvent]},'health',teams,[operatorEvent]),approved);
  const latestEvent={...sheetEvent,status:'cancelled',occurredAt:'2026-10-07T02:00:00Z'};
  assert.notEqual(sheetSendSnapshot({...source,events:[sheetEvent,latestEvent],applications:[{projectId:'health',employeeId:1,status:'cancelled'}]},'health',teams,[operatorEvent]),approved);
  assert.throws(()=>sheetSendSnapshot(source,'health',teams,[operatorEvent]),/신청 이력/);
});

test('preflight ignores a historical operator action outside the current Sheet targets',()=>{
  const past={id:'manual-old',projectId:'health',employeeId:99,toStatus:'confirmed',at:'2026-10-07T10:00',source:'operator'};
  assert.equal(sheetSendSnapshot({...source,events:undefined},'health',teams,[past]),
    projectSendSnapshot(project,employees,applications));
});
