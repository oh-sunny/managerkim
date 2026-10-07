import test from 'node:test';
import assert from 'node:assert/strict';
import {quickRecipientSelection,recipientGroups,recipientCounts,recipientGroupLabel} from '../prototype/recipient-selection.js';

const people=Array.from({length:8},(_,index)=>({id:index+1,name:`동료 ${index+1}`}));
const status={targetIds:[1,2,3,4,5,6,7],requiredIds:[1,2,3,4],requiredPendingIds:[1,2],appliedIds:[3,4,6,7],confirmedIds:[4,7],pendingIds:[1,2,5]};

test('quick selection uses exactly the required pending or all required IDs',()=>{
  assert.deepEqual(quickRecipientSelection('required-pending',status),{scope:'pending',selectedIds:[1,2]});
  assert.deepEqual(quickRecipientSelection('required-all',status),{scope:'project',selectedIds:[1,2,3,4]});
  assert.throws(()=>quickRecipientSelection('unknown',status),/빠른 대상 선택/);
});

test('recipient groups distinguish required, voluntary and application states',()=>{
  assert.deepEqual(recipientGroups(people,status).map(group=>[group.label,group.people.map(person=>person.id)]),[
    ['필수 · 미신청',[1,2]],['자율 · 미신청',[5]],['필수 · 확정 대기',[3]],
    ['자율 · 확정 대기',[6]],['필수 · 확정',[4]],['자율 · 확정',[7]],['프로젝트 대상 외',[8]],
  ]);
  assert.equal(recipientGroupLabel(3,status),'필수 · 확정 대기');
});

test('recipient counts match the selected people rather than the whole project',()=>{
  assert.deepEqual(recipientCounts([people[0],people[2],people[4],people[7]],status),{
    total:4,required:2,voluntary:1,outside:1,pending:2,applied:1,confirmed:0,requiredPending:1,
  });
  assert.deepEqual(recipientCounts([],status),{
    total:0,required:0,voluntary:0,outside:0,pending:0,applied:0,confirmed:0,requiredPending:0,
  });
});
