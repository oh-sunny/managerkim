import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeApplicationSource} from '../scripts/application-source.mjs';
import {buildScheduledSync} from '../supabase/functions/_shared/sheet-sync-core.mjs';

test('scheduled Sheet sync proposes and retires the same ticket without overwriting operator decisions', () => {
  const base = {
    knownProjectIds:['health'], knownEmployeeIds:[1,2],
    targetRows:[{projectId:'health',employeeId:1,required:true},{projectId:'health',employeeId:2,required:false}],
    eventRows:[{sourceEventId:'a-2',projectId:'health',employeeId:2,status:'applied',occurredAt:'2026-10-02T09:00:00+09:00'}],
    lastSuccessAt:'2026-10-06T10:55:00+09:00',
  };
  const operatorState = {payload:{projects:[{id:'health',name:'건강검진',start:'2026-10-01',deadlineAt:'2026-10-09T18:00',voluntaryGoalRate:0.8}],tickets:[],applicationEvents:[],records:[]}};
  const wrap = input => ({employees:[{id:1},{id:2}],sourceProjects:[{id:'health',name:'건강검진'}],...normalizeApplicationSource(input)});
  const first = buildScheduledSync({source:wrap(base),operatorState,calendar:{status:'success',holidays:[]},now:'2026-10-06T11:00:00+09:00'});
  const required = first.tickets.find(ticket => ticket.kind==='required'&&ticket.state==='pending');
  assert.deepEqual(required.recipientIds,[1]);

  const next = buildScheduledSync({source:wrap({...base,eventRows:[...base.eventRows,
    {sourceEventId:'a-1',projectId:'health',employeeId:1,status:'applied',occurredAt:'2026-10-06T11:01:00+09:00'}],lastSuccessAt:'2026-10-06T11:02:00+09:00'}),
    operatorState,previousTickets:first.tickets,calendar:{status:'success',holidays:[]},now:'2026-10-06T11:03:00+09:00'});
  assert.ok(next.retiredKeys.includes(required.key));

  operatorState.payload.tickets=[{...required,state:'dismissed'}];
  const dismissed=buildScheduledSync({source:wrap(base),operatorState,previousTickets:first.tickets,
    calendar:{status:'success',holidays:[]},now:'2026-10-06T11:00:00+09:00'});
  assert.equal(dismissed.tickets.some(ticket=>ticket.key===required.key),false);
});

test('scheduled sync ignores an old local correction outside the current Sheet roster', () => {
  const source={employees:[{id:1},{id:2},{id:3}],sourceProjects:[{id:'health',name:'건강검진'}],
    ...normalizeApplicationSource({knownProjectIds:['health'],knownEmployeeIds:[1,2,3],
      targetRows:[{projectId:'health',employeeId:1,required:true},{projectId:'health',employeeId:2,required:false}],
      eventRows:[],lastSuccessAt:'2026-10-06T10:55:00+09:00'})};
  const operatorState={payload:{projects:[{id:'health',name:'건강검진',start:'2026-10-01',
    deadlineAt:'2026-10-09T18:00'}],tickets:[],records:[],applicationEvents:[
    {id:'local-outside',projectId:'health',employeeId:3,toStatus:'applied',at:'2026-10-06T10:56:00+09:00'},
    {id:'local-inside',projectId:'health',employeeId:2,toStatus:'applied',at:'2026-10-06T10:56:00+09:00'},
  ]}};
  const result=buildScheduledSync({source,operatorState,calendar:{status:'success',holidays:[]},
    now:'2026-10-06T11:00:00+09:00'});
  assert.deepEqual(result.applications.map(row=>row.employeeId),[2]);
  assert.deepEqual(result.tickets.find(ticket=>ticket.kind==='required'&&ticket.state==='pending').recipientIds,[1]);
});
