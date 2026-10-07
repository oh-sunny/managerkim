import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSheetApplications,operatorEventsForCurrentTargets} from '../web/sheet-application-merge.js';

const sheetApplication={projectId:'workshop',employeeId:2,status:'applied',checkedAt:'2026-09-29T02:00:00.000Z',sourceEventId:'W-002'};
const sheetEvent={projectId:'workshop',employeeId:2,status:'applied',occurredAt:'2026-09-29T02:00:00.000Z'};
const operatorEvent={id:'operator-1',projectId:'workshop',employeeId:2,fromStatus:'applied',toStatus:'confirmed',source:'operator',at:'2026-10-07T10:00'};

test('past operator actions outside the current Sheet target list remain history, not applications',()=>{
  const past={...operatorEvent,id:'operator-past',employeeId:99};
  const current=operatorEventsForCurrentTargets([past,operatorEvent],[{projectId:'workshop',targetIds:[2]}]);
  assert.deepEqual(current,[operatorEvent]);
  assert.deepEqual(mergeSheetApplications([sheetApplication],[sheetEvent],current),[
    {projectId:'workshop',employeeId:2,status:'confirmed',checkedAt:operatorEvent.at,sourceEventId:'operator-1'},
  ]);
});

test('a later operator confirmation survives another read-only Sheet import',()=>{
  assert.deepEqual(mergeSheetApplications([sheetApplication],[sheetEvent],[operatorEvent]),[
    {projectId:'workshop',employeeId:2,status:'confirmed',checkedAt:operatorEvent.at,sourceEventId:'operator-1'},
  ]);
});

test('a newer Sheet event supersedes the operator correction',()=>{
  const latest={...sheetEvent,status:'cancelled',occurredAt:'2026-10-07T02:00:00.000Z'};
  assert.deepEqual(mergeSheetApplications([{...sheetApplication,status:'cancelled',checkedAt:latest.occurredAt,sourceEventId:'W-003'}],[sheetEvent,latest],[operatorEvent]),[
    {...sheetApplication,status:'cancelled',checkedAt:latest.occurredAt,sourceEventId:'W-003'},
  ]);
});

test('an operator cancellation without a later Sheet event remains visible',()=>{
  const cancellation={...operatorEvent,id:'operator-2',toStatus:'cancelled',at:'2026-10-07T10:01'};
  assert.equal(mergeSheetApplications([sheetApplication],[sheetEvent],[operatorEvent,cancellation])[0].status,'cancelled');
});
