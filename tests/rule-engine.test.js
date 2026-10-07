import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustToPreviousBusinessTime, evaluateReminderTickets} from '../web/rule-engine.js';

const employees = Array.from({length: 11}, (_, index) => ({id: index + 1}));
const project = {
  id: 'health', start: '2026-10-01', deadlineAt: '2026-10-12T18:00',
  targetIds: employees.map(person => person.id), requiredIds: [1], voluntaryGoalRate: 1,
};
const calendar = {status: 'success', holidays: []};
const policy = {maxDataAgeMinutes: 120};
const records = appliedIds => appliedIds.map(employeeId => ({projectId: 'health', employeeId, status: 'applied'}));
const run = (overrides = {}) => evaluateReminderTickets({
  project, employees, applicationRecords: records([2, 3, 4, 5, 6, 7]),
  sync: {status: 'success', lastSuccessAt: '2026-10-09T09:30:00+09:00'},
  calendar, now: '2026-10-09T10:00:00+09:00', policy, ...overrides,
});

test('Korean business-hour adjustment moves weekend and holidays backward, and keeps 18:00', () => {
  assert.equal(adjustToPreviousBusinessTime('2026-10-11T10:00:00+09:00', calendar), '2026-10-09T09:00:00.000Z');
  assert.equal(adjustToPreviousBusinessTime('2026-10-12T08:00:00+09:00', calendar), '2026-10-09T09:00:00.000Z');
  assert.equal(adjustToPreviousBusinessTime('2026-10-12T18:00:00+09:00', calendar), '2026-10-12T09:00:00.000Z');
  assert.equal(adjustToPreviousBusinessTime('2026-10-09T10:00:00+09:00', {status: 'success', holidays: ['2026-10-09']}), '2026-10-08T09:00:00.000Z');
});

test('D-3 mandatory and voluntary proposals are pending while later checkpoints stay scheduled', () => {
  const result = run();
  assert.equal(result.status, 'ready');
  const required = result.tickets.filter(ticket => ticket.kind === 'required');
  const voluntary = result.tickets.filter(ticket => ticket.kind === 'voluntary');
  assert.deepEqual(required.map(ticket => ticket.state), ['pending', 'scheduled', 'scheduled']);
  assert.deepEqual(voluntary.map(ticket => ticket.state), ['pending', 'scheduled']);
  assert.deepEqual(required[0].recipientIds, [1]);
  assert.deepEqual(voluntary[0].recipientIds, [8, 9, 10, 11]);
  assert.equal(voluntary[0].metrics.voluntaryRate, 0.6);
  assert.equal(voluntary[0].metrics.threshold, 0.7);
  assert.equal(voluntary[0].metrics.total.applied, 6);
  assert.equal(required[0].date, '2026-10-09');
  assert.equal(required[0].sourceCheckedAt, '2026-10-09T09:30:00+09:00');
});

test('voluntary goal uses only voluntary targets and exact threshold does not create a pending proposal', () => {
  const result = run({applicationRecords: records([1, 2, 3, 4, 5, 6, 7, 8])});
  assert.equal(result.summary.counts.total.applied, 8);
  assert.equal(result.summary.counts.voluntary.applied, 7);
  assert.equal(result.summary.voluntaryRate, 0.7);
  assert.equal(result.tickets.some(ticket => ticket.kind === 'voluntary' && ticket.state === 'pending'), false);
  assert.equal(result.tickets.some(ticket => ticket.kind === 'voluntary' && ticket.state === 'scheduled'), true);
  assert.equal(result.tickets.some(ticket => ticket.kind === 'required' && ticket.state === 'pending'), false);
});

test('missing goal still schedules voluntary status checks without a numeric threshold', () => {
  const noGoal = run({project: {...project, voluntaryGoalRate: null}});
  const checks = noGoal.tickets.filter(ticket => ticket.kind === 'voluntary');
  assert.equal(checks.length, 2);
  assert.ok(checks.some(ticket => ticket.state === 'pending'));
  assert.ok(checks.every(ticket => ticket.title === '자율 신청 현황 확인'));
  assert.equal(checks[0].metrics.threshold, null);
  assert.match(checks[0].reason, /목표 없이 신청 현황 확인/);
  const noVoluntary = run({project: {...project, requiredIds: project.targetIds}});
  assert.equal(noVoluntary.summary.voluntaryRate, null);
  assert.equal(noVoluntary.tickets.some(ticket => ticket.kind === 'voluntary'), false);
});

test('reminder evaluation never retires a first notice ticket', () => {
  const initial = {key: 'health:initial:2026-10-09T00:00:00.000Z',kind: 'initial',state: 'pending'};
  const result = run({existingTickets: [initial]});
  assert.deepEqual(result.retiredKeys, []);
});

test('D-1 applies the 90% voluntary threshold and final mandatory check occurs four hours before deadline', () => {
  const d1 = run({
    applicationRecords: records([2, 3, 4, 5, 6, 7, 8, 9]),
    now: '2026-10-09T18:00:00+09:00',
    sync: {status: 'success', lastSuccessAt: '2026-10-09T17:30:00+09:00'},
  });
  const voluntary = d1.tickets.filter(ticket => ticket.kind === 'voluntary' && ticket.state === 'pending');
  assert.equal(voluntary.length, 1);
  assert.deepEqual(voluntary[0].triggers, ['D-1']);
  assert.equal(voluntary[0].metrics.voluntaryRate, 0.8);
  assert.equal(voluntary[0].metrics.threshold, 0.9);
  const final = run({
    now: '2026-10-12T14:00:00+09:00',
    sync: {status: 'success', lastSuccessAt: '2026-10-12T13:30:00+09:00'},
  });
  const last = final.tickets.find(ticket => ticket.triggers.includes('deadline-4h'));
  assert.equal(last.state, 'pending');
  assert.equal(last.dueAt, '2026-10-12T05:00:00.000Z');
});

test('a recent send does not impose a 24-hour cooldown, but a completed key is not proposed again', () => {
  const sentRecords = [{project: 'health', date: '2026-10-09T09:00:00+09:00', title: '방금 보낸 안내'}];
  const first = run({sentRecords});
  const pending = first.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  assert.equal(pending.recentNotices.length, 1);
  const again = run({sentRecords, existingTickets: [{key: pending.key, state: 'done'}]});
  assert.equal(again.tickets.some(ticket => ticket.key === pending.key), false);
  assert.equal(new Set(first.tickets.map(ticket => ticket.key)).size, first.tickets.length);
});

test('adjusted checkpoints with the same kind and due time merge into one stable key', () => {
  const shifted = run({
    calendar: {status: 'success', holidays: ['2026-10-09']},
    now: '2026-10-08T18:00:00+09:00',
    sync: {status: 'success', lastSuccessAt: '2026-10-08T17:30:00+09:00'},
  });
  const required = shifted.tickets.filter(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  assert.equal(required.length, 1);
  assert.deepEqual(required[0].triggers, ['D-3', 'D-1']);
  assert.equal(required[0].date, '2026-10-08');
});

test('source failure, stale data, and unverified holiday calendar block proposals', () => {
  const failed = run({sync: {status: 'error', error: 'permission denied', lastSuccessAt: '2026-10-09T09:30:00+09:00'}});
  assert.equal(failed.status, 'blocked');
  assert.ok(failed.blockedReasons.includes('source-sync-failed'));
  assert.equal(failed.sourceError, 'permission denied');
  assert.deepEqual(failed.tickets, []);
  const stale = run({sync: {status: 'success', lastSuccessAt: '2026-10-09T07:00:00+09:00'}});
  assert.ok(stale.blockedReasons.includes('source-stale'));
  assert.ok(run({calendar: {status: 'error', holidays: []}}).blockedReasons.includes('calendar-unverified'));
  assert.ok(run({policy: {}}).blockedReasons.includes('freshness-policy-missing'));
});

test('invalid or duplicate latest-state rows block proposals; cancellation makes a required applicant pending', () => {
  const invalid = run({applicationRecords: [...records([2]), ...records([2])]});
  assert.ok(invalid.blockedReasons.includes('source-rows-invalid'));
  const cancelled = run({applicationRecords: [...records([2, 3, 4, 5, 6, 7]), {projectId: 'health', employeeId: 1, status: 'cancelled'}]});
  assert.deepEqual(cancelled.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'pending').recipientIds, [1]);
  const applied = run({applicationRecords: [...records([1, 2, 3, 4, 5, 6, 7])]});
  assert.equal(applied.tickets.some(ticket => ticket.kind === 'required' && ticket.state === 'pending'), false);
});

test('before application start and after deadline do not leave active proposals', () => {
  const short = run({project: {...project, start: '2026-10-11'}});
  assert.ok(short.needsReview.some(item => item.reason === 'adjusted-before-application-start'));
  assert.equal(short.tickets.length, 1);
  const after = run({now: '2026-10-12T18:01:00+09:00', sync: {status: 'success', lastSuccessAt: '2026-10-12T18:00:00+09:00'}});
  assert.deepEqual(after.tickets, []);
});

test('existing pending ticket is retired when its reason disappears', () => {
  const first = run();
  const pending = first.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  const next = run({applicationRecords: [...records([1, 2, 3, 4, 5, 6, 7])], existingTickets: [pending]});
  assert.deepEqual(next.retiredKeys, [pending.key]);
});

test('dismissed checkpoints stay dismissed and deferred checkpoints keep their review time', () => {
  const first = run();
  const pending = first.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  const future = first.tickets.find(ticket => ticket.kind === 'required' && ticket.state === 'scheduled');
  const next = run({existingTickets: [
    {...pending, state: 'dismissed', decisionReason: '이번에는 안내하지 않음'},
    {...future, state: 'deferred', reviewAt: '2026-10-10T09:00:00+09:00', decisionReason: '담당자 확인 대기'},
  ]});
  assert.equal(next.tickets.some(ticket => ticket.key === pending.key), false);
  assert.equal(next.tickets.find(ticket => ticket.key === future.key).state, 'deferred');
});

test('project policy changes checkpoint hour and final reminder interval', () => {
  const customized = run({project: {...project, reminderPolicy: {requiredCheckHour: 11, finalHoursBefore: 6,
    voluntaryThresholds: [{daysBefore: 3, goalFraction: 0.5}, {daysBefore: 1, goalFraction: 0.9}]}}});
  const d3 = customized.tickets.find(ticket => ticket.kind === 'required' && ticket.triggers.includes('D-3'));
  const final = customized.tickets.find(ticket => ticket.triggers.includes('deadline-6h'));
  assert.equal(d3.dueAt, '2026-10-09T02:00:00.000Z');
  assert.equal(final.dueAt, '2026-10-12T03:00:00.000Z');
  assert.equal(customized.tickets.some(ticket => ticket.kind === 'voluntary' && ticket.state === 'pending'), false);
});
