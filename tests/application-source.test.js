import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeApplicationSource, tryNormalizeApplicationSource} from '../scripts/application-source.mjs';
import {mapSheetRows, readGoogleSheetsApplicationSource, readGoogleSheetsWorkspaceSource} from '../scripts/google-sheets-source.mjs';
import {calculateStatus} from '../web/data.js';

const base = {
  knownEmployeeIds:[1, 2], knownProjectIds:['health'], lastSuccessAt:'2026-10-06T09:00:00+09:00',
  targetRows:[{projectId:'health', employeeId:'1', required:'TRUE'},
    {projectId:'health', employeeId:2, required:false}],
  eventRows:[
    {sourceEventId:'evt-3', projectId:'health', employeeId:'1', status:'applied', occurredAt:'2026-10-06T08:00:00+09:00'},
    {sourceEventId:'evt-1', projectId:'health', employeeId:1, status:'applied', occurredAt:'2026-10-04T08:00:00+09:00'},
    {sourceEventId:'evt-2', projectId:'health', employeeId:1, status:'cancelled', occurredAt:'2026-10-05T08:00:00+09:00'},
  ],
};

test('target roster and append-only apply/cancel/reapply history become current application records', () => {
  const result = normalizeApplicationSource({...base, eventRows:[...base.eventRows, {...base.eventRows[2]}]});
  assert.deepEqual(result.projectTargets, [{projectId:'health', targetIds:[1, 2], requiredIds:[1]}]);
  assert.deepEqual(result.events.map(row => row.sourceEventId), ['evt-1', 'evt-2', 'evt-3']);
  assert.deepEqual(result.applications, [{projectId:'health', employeeId:1, status:'applied',
    checkedAt:'2026-10-05T23:00:00.000Z', sourceEventId:'evt-3'}]);
  assert.deepEqual(result.sync, {status:'success', lastSuccessAt:'2026-10-06T00:00:00.000Z', sourceVersion:null});
  const project = {id:'health', ...result.projectTargets[0]};
  assert.deepEqual(calculateStatus(project, result.applications, [{id:1}, {id:2}]).requiredPendingIds, []);
  const cancelled = normalizeApplicationSource({...base, eventRows:base.eventRows.slice(1)});
  assert.deepEqual(calculateStatus(project, cancelled.applications, [{id:1}, {id:2}]).requiredPendingIds, [1]);
});

test('duplicate event ID with changed content and simultaneous conflicting events are rejected', () => {
  const conflictingId = {...base.eventRows[0], status:'cancelled'};
  assert.throws(() => normalizeApplicationSource({...base, eventRows:[...base.eventRows, conflictingId]}),
    {code:'CONFLICTING_EVENT_ID'});
  const conflictingTime = {...base.eventRows[0], sourceEventId:'evt-4', status:'cancelled'};
  assert.throws(() => normalizeApplicationSource({...base, eventRows:[...base.eventRows, conflictingTime]}),
    {code:'CONFLICTING_EVENT_TIME'});
});

test('unknown IDs, status, missing event ID and roster conflicts fail closed', () => {
  const change = (field, value) => ({...base, eventRows:[{...base.eventRows[0], [field]:value}]});
  assert.throws(() => normalizeApplicationSource(change('employeeId', 999)), {code:'UNKNOWN_EMPLOYEE_ID'});
  assert.throws(() => normalizeApplicationSource(change('projectId', 'other')), {code:'UNKNOWN_PROJECT_ID'});
  assert.throws(() => normalizeApplicationSource(change('status', 'pending')), {code:'UNKNOWN_STATUS'});
  assert.throws(() => normalizeApplicationSource(change('sourceEventId', '')), {code:'MISSING_SOURCE_EVENT_ID'});
  assert.throws(() => normalizeApplicationSource({...base, targetRows:[...base.targetRows, {...base.targetRows[0], required:false}]}),
    {code:'CONFLICTING_TARGET'});
  assert.throws(() => normalizeApplicationSource(change('occurredAt', '2026-10-06')), {code:'INVALID_TIMESTAMP'});
});

test('failed validation retains old snapshot and explicitly marks it stale', () => {
  const previous = normalizeApplicationSource(base);
  const result = tryNormalizeApplicationSource({...base, eventRows:[{...base.eventRows[0], status:'invalid'}]}, previous);
  assert.equal(result.sync.status, 'failed');
  assert.equal(result.sync.lastSuccessAt, previous.sync.lastSuccessAt);
  assert.equal(result.sync.error.code, 'UNKNOWN_STATUS');
  assert.deepEqual(result.applications, previous.applications);
  assert.equal(tryNormalizeApplicationSource({...base, targetRows:null}).applications, null);
});

test('a later sync cannot silently remove or rewrite an accepted history event', () => {
  const previous = normalizeApplicationSource(base);
  const removed = tryNormalizeApplicationSource({...base, eventRows:base.eventRows.slice(1)}, previous);
  assert.equal(removed.sync.status, 'failed');
  assert.equal(removed.sync.error.code, 'SOURCE_HISTORY_CHANGED');
  assert.deepEqual(removed.events, previous.events);
  const rewritten = tryNormalizeApplicationSource({...base, eventRows:base.eventRows.map(row =>
    row.sourceEventId === 'evt-1' ? {...row, occurredAt:'2026-10-04T09:00:00+09:00'} : row)}, previous);
  assert.equal(rewritten.sync.error.code, 'SOURCE_HISTORY_CHANGED');
});

test('sheet adapter maps configurable headers and reads both ranges in one server-side request', async () => {
  const requests = [];
  const result = await readGoogleSheetsApplicationSource({
    spreadsheetId:'sheet-id', targetRange:'대상!A:C', eventRange:'이력!A:E', accessToken:'test-token',
    knownEmployeeIds:[1, 2], knownProjectIds:['health'],
    targetColumns:{projectId:'프로젝트', employeeId:'동료ID', required:'필수'},
    eventColumns:{sourceEventId:'사건ID', projectId:'프로젝트', employeeId:'동료ID', status:'상태', occurredAt:'발생시각'},
    now:() => new Date('2026-10-06T01:00:00Z'),
    fetchImpl:async (url, options) => {
      requests.push({url:String(url), options});
      return {ok:true, json:async () => ({valueRanges:[
        {values:[['프로젝트','동료ID','필수'], ['health','1','TRUE'], ['health','2','FALSE']]},
        {values:[['사건ID','프로젝트','동료ID','상태','발생시각'], ['evt-1','health','1','applied','2026-10-06T09:00:00+09:00']]},
      ]})};
    },
  });
  assert.equal(result.sync.status, 'success');
  assert.deepEqual(result.projectTargets[0].requiredIds, [1]);
  assert.deepEqual(result.applications.map(row => row.employeeId), [1]);
  assert.equal(requests.length, 1);
  assert.deepEqual(new URL(requests[0].url).searchParams.getAll('ranges'), ['대상!A:C', '이력!A:E']);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
});

test('Google Sheets errors never masquerade as zero applications', async () => {
  const previous = normalizeApplicationSource(base);
  const result = await readGoogleSheetsApplicationSource({
    spreadsheetId:'sheet-id', targetRange:'대상!A:C', eventRange:'이력!A:E', accessToken:'test-token',
    knownEmployeeIds:[1, 2], knownProjectIds:['health'], previous,
    fetchImpl:async () => ({ok:false, status:403}),
  });
  assert.equal(result.sync.status, 'failed');
  assert.equal(result.sync.error.code, 'SHEETS_HTTP_ERROR');
  assert.deepEqual(result.applications, previous.applications);
  assert.equal(result.sync.lastSuccessAt, previous.sync.lastSuccessAt);
});

test('missing or duplicated Sheet headers are rejected', () => {
  assert.throws(() => mapSheetRows([['projectId', 'employeeId']], ['projectId', 'employeeId', 'required']),
    {code:'INVALID_SHEET_HEADER'});
  assert.throws(() => mapSheetRows([['projectId', 'projectId']], ['projectId']), {code:'INVALID_SHEET_HEADER'});
});

test('four-tab Google Sheet joins a company directory to project targets and preserves KST history', async () => {
  let requestedRanges;
  const result=await readGoogleSheetsWorkspaceSource({spreadsheetId:'sheet-id',accessToken:'token',
    now:()=>new Date('2026-10-06T00:00:00Z'),fetchImpl:async url=>{
      requestedRanges=new URL(url).searchParams.getAll('ranges');
      return {ok:true,json:async()=>({valueRanges:[
        {values:[['employeeId','사번','이름','회사 이메일','본부','팀','직급','직책','고용 형태','재직 상태','입사일','근무지','관리자 사번'],
          ['1','EMP-0001','김서연','employee0001@example.com','사업본부','마케팅팀','부장','팀장','정규직','재직','2017-01-01','서울 본사',''],
          ['2','EMP-0002','김지훈','employee0002@example.com','제품본부','개발팀','대리','팀원','정규직','재직','2020-01-02','판교 오피스','EMP-0001']]},
        {values:[['projectId','프로젝트명'],['health','연례 건강검진']]},
        {values:[['projectId','employeeId','required'],['health','1','TRUE'],['health','2','FALSE']]},
        {values:[['sourceEventId','projectId','employeeId','status','occurredAt','사유 (참고)'],
          ['H-001','health','1','applied','2026-10-01 09:10:00 KST','첫 신청'],
          ['H-002','health','1','cancelled','2026-10-02 10:00:00 KST','본인 요청'],
          ['H-003','health','1','confirmed','2026-10-03 11:00:00 KST','재신청']]},
      ]})};
    }});
  assert.deepEqual(requestedRanges,['직원명부!A:M','프로젝트!A:H','대상!A:G','신청이력!A:I']);
  assert.equal(result.employees.length,2);
  assert.equal(result.employees[0].employeeNumber,'EMP-0001');
  assert.deepEqual(result.projectTargets[0].requiredIds,[1]);
  assert.deepEqual(result.events.map(row=>row.reason),['첫 신청','본인 요청','재신청']);
  assert.equal(result.events[0].occurredAt,'2026-10-01T00:10:00.000Z');
  assert.equal(result.applications[0].status,'confirmed');
});
