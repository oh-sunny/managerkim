import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeApplicationSource} from '../scripts/application-source.mjs';
import {evaluateReminderTickets} from '../web/rule-engine.js';

test('Google Sheet history normalization feeds reminder decisions and retires resolved tickets', () => {
  const project = {
    id:'health', start:'2026-10-01', deadlineAt:'2026-10-09T18:00', voluntaryGoalRate:0.8,
  };
  const sourceInput = {
    knownProjectIds:['health'], knownEmployeeIds:[1, 2],
    targetRows:[
      {projectId:'health', employeeId:1, required:true},
      {projectId:'health', employeeId:2, required:false},
    ],
    eventRows:[
      {sourceEventId:'a-2', projectId:'health', employeeId:2, status:'applied', occurredAt:'2026-10-02T09:00:00+09:00'},
    ],
    lastSuccessAt:'2026-10-06T10:55:00+09:00',
  };
  const calendar = {status:'success', holidays:[]};
  const employees = [{id:1}, {id:2}];
  const policy = {maxDataAgeMinutes:60};
  const now = '2026-10-06T11:00:00+09:00';
  const firstSource = normalizeApplicationSource(sourceInput);
  const first = evaluateReminderTickets({
    project:{...project, ...firstSource.projectTargets[0]},
    applicationRecords:firstSource.applications, employees, sync:firstSource.sync, calendar, now, policy,
  });
  assert.equal(first.status, 'ready');
  const required = first.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  assert.deepEqual(required.recipientIds, [1]);
  assert.equal(first.tickets.some(ticket => ticket.kind === 'voluntary' && ticket.state === 'pending'), false);

  const nextSource = normalizeApplicationSource({...sourceInput, eventRows:[...sourceInput.eventRows,
    {sourceEventId:'a-1', projectId:'health', employeeId:1, status:'applied', occurredAt:'2026-10-06T11:01:00+09:00'},
  ], lastSuccessAt:'2026-10-06T11:02:00+09:00'});
  const next = evaluateReminderTickets({
    project:{...project, ...nextSource.projectTargets[0]},
    applicationRecords:nextSource.applications, employees, sync:nextSource.sync, calendar,
    now:'2026-10-06T11:03:00+09:00', policy, existingTickets:first.tickets,
  });
  assert.equal(next.tickets.some(ticket => ticket.key === required.key), false);
  assert.ok(next.retiredKeys.includes(required.key));
});
