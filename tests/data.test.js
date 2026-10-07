import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIdList, calculateStatus, setApplication, applicationBreakdown, sortTicketsForDisplay} from '../web/data.js';

const employees=[{id:1},{id:2},{id:3}];
const project={id:'p',targetIds:[1,2],requiredIds:[2],lastCheckedAt:'2026-10-05T10:00'};

test('duplicate applications count once, and cancellation removes a valid application',()=>{
  const records=[{projectId:'p',employeeId:1,status:'applied'},
    {projectId:'p',employeeId:1,status:'confirmed'},
    {projectId:'p',employeeId:3,status:'confirmed'}];
  const before=calculateStatus(project,records,employees);
  assert.deepEqual(before.appliedIds,[1]);
  assert.deepEqual(before.confirmedIds,[1]);
  assert.equal(before.rate,0.5);
  assert.equal(before.unknown.length,1);
  const after=calculateStatus(project,setApplication(records,'p',1,'cancelled','2026-10-05T11:00'),employees);
  assert.deepEqual(after.appliedIds,[]);
  assert.deepEqual(after.requiredPendingIds,[2]);
});

test('separate confirmation keeps applicant out of the pending audience',()=>{
  const result=calculateStatus(project,[{projectId:'p',employeeId:2,status:'applied'}],employees);
  assert.deepEqual(result.appliedIds,[2]);
  assert.deepEqual(result.confirmedIds,[]);
  assert.deepEqual(result.requiredPendingIds,[]);
});

test('empty audience has no rate and invalid IDs are rejected',()=>{
  assert.equal(calculateStatus({...project,targetIds:[],requiredIds:[]},[],employees).rate,null);
  assert.deepEqual(parseIdList('1, 1 2',employees),[1,2]);
  assert.throws(()=>parseIdList('1, 4',employees),/알 수 없는/);
});

test('mandatory and voluntary rows are exclusive and add to the total after cancellation',()=>{
  const before=calculateStatus(project,[{projectId:'p',employeeId:1,status:'confirmed'},{projectId:'p',employeeId:2,status:'applied'}],employees);
  assert.deepEqual(applicationBreakdown(before),{
    required:{target:1,applied:1,pending:0},voluntary:{target:1,applied:1,pending:0},total:{target:2,applied:2,pending:0},
  });
  const after=calculateStatus(project,setApplication([{projectId:'p',employeeId:1,status:'confirmed'},{projectId:'p',employeeId:2,status:'applied'}],'p',2,'cancelled','2026-10-05T11:00'),employees);
  assert.deepEqual(applicationBreakdown(after),{
    required:{target:1,applied:0,pending:1},voluntary:{target:1,applied:1,pending:0},total:{target:2,applied:1,pending:1},
  });
});

test('unfinished tickets sort by due date and completed tickets appear last, newest first',()=>{
  const tickets=[{id:'old-done',date:'2026-09-15',state:'done'}, {id:'later-pending',date:'2026-10-07',state:'pending'},
    {id:'early-scheduled',date:'2026-10-05',state:'scheduled'}, {id:'new-done',date:'2026-10-02',state:'done'},
    {id:'early-pending',date:'2026-10-05',state:'pending'}];
  const sorted=sortTicketsForDisplay(tickets,t=>t.state,t=>t.date);
  assert.deepEqual(sorted.map(t=>t.id),['early-pending','early-scheduled','later-pending','new-done','old-done']);
});
