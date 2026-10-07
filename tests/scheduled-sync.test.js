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

test('legacy registration time only postpones the first notice, while Sheet reminders still evaluate', () => {
  const source={employees:[{id:1},{id:2}],sourceProjects:[{id:'health',name:'건강검진'}],
    ...normalizeApplicationSource({knownProjectIds:['health'],knownEmployeeIds:[1,2],
      targetRows:[{projectId:'health',employeeId:1,required:true},{projectId:'health',employeeId:2,required:false}],
      eventRows:[],lastSuccessAt:'2026-10-06T10:55:00+09:00'})};
  const operatorState={payload:{projects:[{id:'health',name:'건강검진',start:'2026-10-01',
    deadlineAt:'2026-10-09T18:00',voluntaryGoalRate:0.8}],tickets:[],applicationEvents:[],records:[]}};
  const result=buildScheduledSync({source,operatorState,calendar:{status:'success',holidays:[]},
    now:'2026-10-06T11:00:00+09:00'});
  assert.equal(result.sourceStatus,'success');
  assert.equal(result.firstNoticeSkippedCount,1);
  assert.equal(result.blockedCount,1);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.tickets.some(ticket=>ticket.kind==='initial'),false);
  assert.equal(result.tickets.some(ticket=>ticket.kind==='required'),true);
});

const timeOnlyEvaluators = {
  evaluateFirstNoticeTicket({project, existingTickets}) {
    const dueAt = project.firstNoticeReviewAt || project.createdAt;
    const key = `${project.id}:initial:${dueAt}`;
    return {status:'ready', tickets:[{key,kind:'initial',state:'pending',dueAt,
      reason:'첫 안내 검토',recipientIds:[],sourceCheckedAt:null,metrics:null}],
      retiredKeys:existingTickets.filter(ticket=>ticket.key!==key).map(ticket=>ticket.key)};
  },
  evaluateReminderCheckpoints({project}) {
    return {status:'ready', tickets:[{key:`${project.id}:required:2026-10-08T01:00:00.000Z`,
      kind:'required',state:'scheduled',dueAt:'2026-10-08T01:00:00.000Z',
      reason:'신청 현황 확인 필요',recipientIds:[],sourceCheckedAt:null,metrics:null}],retiredKeys:[]};
  },
  evaluateReminderTickets() { throw new Error('Sheet evaluation should be blocked'); },
};

test('all owned direct projects receive stable time-only tickets without invented applicants', () => {
  const project={id:'direct',name:'직접 등록',dataKind:'local',createdAt:'2026-10-07T00:00:00.000Z',
    deadlineAt:'2026-10-12T18:00'};
  const operatorState={owner_id:'owner-1',payload:{projects:[project],tickets:[],records:[]}};
  const input={operatorState,calendar:{status:'success',holidays:[]},now:'2026-10-07T01:00:00.000Z',
    evaluators:timeOnlyEvaluators};
  const first=buildScheduledSync(input);
  const again=buildScheduledSync({...input,previousTickets:first.tickets});
  assert.equal(first.ownerId,'owner-1');
  assert.deepEqual(again.tickets.map(ticket=>ticket.key),first.tickets.map(ticket=>ticket.key));
  assert.equal(new Set(first.tickets.map(ticket=>ticket.key)).size,2);
  assert.ok(first.tickets.every(ticket=>ticket.recipientIds.length===0 &&
    ticket.sourceCheckedAt===null && ticket.metrics===null));
  assert.equal(first.sourceStatus,'not-connected');
  assert.equal(first.evaluatedCount,1);
});

test('failed Sheet read keeps a first-notice ticket but does not determine applicants', () => {
  const project={id:'sheet-one',name:'연결 프로젝트',dataKind:'sheet',createdAt:'2026-10-07T00:00:00.000Z'};
  const stale={key:'sheet-one:required:2026-10-08T01:00:00.000Z',project:'sheet-one',
    kind:'required',state:'pending',recipientIds:[7],metrics:{required:{pending:1}},
    sourceCheckedAt:'2026-10-06T00:00:00.000Z'};
  const result=buildScheduledSync({operatorState:{payload:{projects:[project],tickets:[]}},
    previousTickets:[stale],sourceError:'sheet-read-failed',calendar:{status:'success',holidays:[]},
    evaluators:timeOnlyEvaluators,now:'2026-10-07T01:00:00.000Z'});
  assert.equal(result.sourceStatus,'error');
  assert.equal(result.tickets.length,2);
  const initial=result.tickets.find(ticket=>ticket.kind==='initial');
  assert.ok(initial);
  assert.deepEqual(initial.recipientIds,[]);
  const blocked=result.tickets.find(ticket=>ticket.kind==='required');
  assert.equal(blocked.state,'deferred');
  assert.deepEqual(blocked.recipientIds,[]);
  assert.equal(blocked.metrics,null);
  assert.equal(blocked.sourceCheckedAt,null);
  assert.equal(result.blockedCount,1);
  assert.ok(result.issues.some(issue=>issue.code==='sheet-source-unavailable'));
});

test('closed projects retire open tickets without changing operator decisions', () => {
  const project={id:'closed-one',lifecycle:'closed'};
  const prior=[{key:'closed-one:initial:one',project:'closed-one',kind:'initial',state:'pending'},
    {key:'closed-one:required:two',project:'closed-one',kind:'required',state:'scheduled'},
    {key:'closed-one:required:three',project:'closed-one',kind:'required',state:'done'}];
  const result=buildScheduledSync({operatorState:{payload:{projects:[project],tickets:prior}},
    previousTickets:prior,calendar:{status:'error'},evaluators:timeOnlyEvaluators});
  assert.deepEqual(result.retiredKeys,['closed-one:initial:one','closed-one:required:two']);
  assert.deepEqual(result.tickets,[]);
});

test('server terminal state wins over a stale operator ticket', () => {
  const project={id:'direct',dataKind:'local',createdAt:'2026-10-07T00:00:00.000Z'};
  const key=`direct:initial:${project.createdAt}`;
  const result=buildScheduledSync({operatorState:{payload:{projects:[project],tickets:[{key,project:'direct',
    kind:'initial',state:'pending'}]}},previousTickets:[{key,project:'direct',kind:'initial',state:'dismissed'}],
    calendar:{status:'success',holidays:[]},evaluators:timeOnlyEvaluators});
  assert.equal(result.tickets.some(ticket=>ticket.key===key),false);
});
