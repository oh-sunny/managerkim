import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRegistrationSummary} from '../prototype/registration-summary.js';
import {evaluateFirstNoticeTicket, evaluateReminderCheckpoints} from '../prototype/rule-engine.js';

const project = {
  id: 'new-event', name: '가을 행사', createdAt: '2026-10-07T01:00:00.000Z',
  start: '2026-10-07', deadlineAt: '2026-10-12T18:00', event: '2026-10-15',
  requirements: '신청서를 제출하세요.\n참가비는 무료입니다.', owner: '총무팀',
  targetIds: [1, 2], requiredIds: [1], voluntaryGoalRate: 1,
};
const calendar = {status: 'success', holidays: []};

test('empty first review time makes one immediate and stable review ticket without applicant claims', () => {
  const input = {project, now: '2026-10-07T10:01:00+09:00'};
  const first = evaluateFirstNoticeTicket(input);
  const again = evaluateFirstNoticeTicket(input);
  assert.equal(first.status, 'ready');
  assert.equal(first.tickets[0].state, 'pending');
  assert.equal(first.tickets[0].dueAt, project.createdAt);
  assert.equal(first.tickets[0].key, again.tickets[0].key);
  assert.deepEqual(first.tickets[0].recipientIds, []);
  assert.equal(first.tickets[0].sourceCheckedAt, null);
  assert.equal(first.tickets[0].metrics, null);
  assert.deepEqual(evaluateFirstNoticeTicket({...input, existingTickets: [{key: first.tickets[0].key, state: 'done'}]}).tickets, []);
});

test('chosen Korean review time is scheduled, then due; changed time retires an unhandled ticket', () => {
  const chosen = {...project, firstNoticeReviewAt: '2026-10-08T10:00'};
  const first = evaluateFirstNoticeTicket({project: chosen, now: '2026-10-07T12:00:00+09:00'});
  assert.equal(first.tickets[0].state, 'scheduled');
  assert.equal(first.tickets[0].dueAt, '2026-10-08T01:00:00.000Z');
  const due = evaluateFirstNoticeTicket({project: chosen, now: '2026-10-08T10:00:00+09:00'});
  assert.equal(due.tickets[0].state, 'pending');
  const moved = evaluateFirstNoticeTicket({project: {...chosen, firstNoticeReviewAt: '2026-10-09T10:00'},
    now: '2026-10-08T10:00:00+09:00', existingTickets: due.tickets});
  assert.deepEqual(moved.retiredKeys, [due.tickets[0].key]);
  assert.equal(moved.tickets[0].state, 'scheduled');
});

test('legacy project with no registration time requires review instead of inventing a moving key', () => {
  const result = evaluateFirstNoticeTicket({project: {...project, createdAt: undefined}, now: '2026-10-07T12:00:00+09:00'});
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockedReasons, ['registration-time-missing']);
  assert.deepEqual(result.tickets, []);
  assert.throws(() => evaluateFirstNoticeTicket({project: {...project, firstNoticeReviewAt: '2026-02-30T10:00'}, now: '2026-10-07T12:00:00+09:00'}), /시각/);
});

test('source-free reminder checkpoints retain D-3, D-1 and final rules without invented counts', () => {
  const result = evaluateReminderCheckpoints({project, calendar, now: '2026-10-09T10:00:00+09:00'});
  assert.equal(result.status, 'ready');
  assert.equal(result.tickets.length, 5);
  const d3 = result.tickets.find(ticket => ticket.kind === 'required' && ticket.triggers.includes('D-3'));
  assert.equal(d3.state, 'pending');
  assert.equal(d3.reason, '신청 현황 확인 필요');
  assert.deepEqual(d3.recipientIds, []);
  assert.equal(d3.metrics, null);
  assert.equal(d3.sourceCheckedAt, null);
  assert.ok(result.tickets.some(ticket => ticket.triggers.includes('deadline-4h')));
  const blocked = evaluateReminderCheckpoints({project, calendar: {status: 'error'}, now: '2026-10-09T10:00:00+09:00'});
  assert.deepEqual(blocked.blockedReasons, ['calendar-unverified']);
  assert.deepEqual(blocked.tickets, []);
});

test('voluntary-only project can preview D-3 and D-1 status checks without a goal', () => {
  const result = evaluateReminderCheckpoints({project: {...project, requiredIds: [], voluntaryGoalRate: null},
    calendar, now: '2026-10-07T10:00:00+09:00'});
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.tickets.map(ticket => ticket.kind), ['voluntary', 'voluntary']);
  assert.ok(result.tickets.every(ticket => ticket.title === '자율 신청 현황 확인'));
  assert.ok(result.tickets.every(ticket => ticket.state === 'scheduled' && ticket.recipientIds.length === 0 && ticket.metrics === null));
});

test('holiday and weekend checkpoints merge before the deadline while preserving original times', () => {
  const result = evaluateReminderCheckpoints({project,
    calendar: {status: 'success', holidays: ['2026-10-09']},
    now: '2026-10-08T18:00:00+09:00'});
  const required = result.tickets.filter(ticket => ticket.kind === 'required' && ticket.state === 'pending');
  assert.equal(required.length, 1);
  assert.deepEqual(required[0].triggers, ['D-3', 'D-1']);
  assert.equal(required[0].originalTimes.length, 2);
  assert.equal(required[0].dueAt, '2026-10-08T09:00:00.000Z');
});

test('registration summary reports current values, evidence and unresolved facts', () => {
  const summary = buildRegistrationSummary({...project,
    applicationUrl: 'https://example.test/apply', audience: '전 직원',
    sourceReviews: [{field: 'name', status: 'found', evidence: [{sourceName: '기획안', location: '1쪽', quote: '가을 행사'}]},
      {field: 'audience', status: 'conflict', appliedValue: '전 직원', evidence: []}],
    sourceIssues: [{field: 'applicationUrl', status: 'conflict'}],
  });
  assert.deepEqual(summary.rows.map(row => row.label), ['무엇을', '대상', '해야 할 일', '마감', '언제·어디서', '신청 방법', '비용·지원', '예외·유의사항', '문의', '링크·자료']);
  assert.equal(summary.rows.find(row => row.key === 'what').source, '기획안 · 자료에서 확인됨');
  assert.equal(summary.rows.find(row => row.key === 'audience').status, 'confirmed');
  assert.equal(summary.rows.find(row => row.key === 'links').status, 'conflict');
  assert.ok(summary.needsReview.some(row => row.key === 'links'));
  assert.equal(summary.rows.find(row => row.key === 'deadline').value, '10월 12일 18:00까지');
});
