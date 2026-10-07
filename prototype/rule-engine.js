import {calculateStatus, applicationBreakdown} from './data.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const DEFAULT_POLICY = Object.freeze({
  requiredCheckDays: [3, 1],
  requiredCheckHour: 10,
  finalHoursBefore: 4,
  voluntaryThresholds: [{daysBefore: 3, goalFraction: 0.7}, {daysBefore: 1, goalFraction: 0.9}],
  businessStartHour: 9,
  businessEndHour: 18,
});

function kstParts(instant) {
  const date = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
    weekday: date.getUTCDay(),
  };
}

function dateKey({year, month, day}) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function atKst(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

function parseInstant(value, label) {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${label} 시각에는 시간대가 필요합니다.`);
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} 시각을 확인해주세요.`);
  return date;
}

function parseProjectTime(value, label) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    const [date, time] = value.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute, second = 0] = time.split(':').map(Number);
    const result = atKst(year, month, day, hour, minute);
    result.setTime(result.getTime() + second * 1000);
    const parts = kstParts(result);
    if ([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].some((part, index) => part !== [year, month, day, hour, minute, second][index])) {
      throw new TypeError(`${label} 시각을 확인해주세요.`);
    }
    return result;
  }
  return parseInstant(value, label);
}

function parseStart(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const result = atKst(year, month, day);
    if (dateKey(kstParts(result)) !== value) throw new TypeError('신청 시작일을 확인해주세요.');
    return result;
  }
  return parseProjectTime(value, '신청 시작');
}

/**
 * A first notice is a review task, not a claim about applicants or an automatic send.
 * `createdAt` keeps the default immediate checkpoint stable across repeated evaluations.
 * Older projects without either timestamp need an operator review instead of a new key
 * on every scheduler run.
 */
export function evaluateFirstNoticeTicket({project, now, existingTickets = []}) {
  if (!project || typeof project.id !== 'string' || !project.id.trim()) {
    throw new TypeError('프로젝트 ID를 확인해주세요.');
  }
  const nowAt = parseInstant(now, '현재');
  const prior = existingTickets.filter(ticket => ticket.key?.startsWith(`${project.id}:initial:`));
  const activePrior = prior.filter(ticket => ['pending', 'scheduled', 'deferred'].includes(ticket.state));
  if (['cancelled', 'closed'].includes(project.lifecycle)) {
    return {status: 'ready', blockedReasons: [], tickets: [], retiredKeys: activePrior.map(ticket => ticket.key)};
  }
  const reviewTime = project.firstNoticeReviewAt || project.createdAt;
  if (!reviewTime) {
    return {status: 'blocked', blockedReasons: ['registration-time-missing'], tickets: [], retiredKeys: []};
  }
  const due = parseProjectTime(reviewTime, '첫 안내 검토');
  const dueAt = due.toISOString();
  const key = `${project.id}:initial:${dueAt}`;
  const previous = prior.find(ticket => ticket.key === key);
  const retiredKeys = activePrior.filter(ticket => ticket.key !== key).map(ticket => ticket.key);
  if (['done', 'dismissed'].includes(previous?.state)) {
    return {status: 'ready', blockedReasons: [], tickets: [], retiredKeys};
  }
  const state = previous?.state === 'deferred' && previous.reviewAt && Date.parse(previous.reviewAt) > nowAt.getTime()
    ? 'deferred' : due > nowAt ? 'scheduled' : 'pending';
  const ticket = {
    key, id: key, project: project.id, kind: 'initial', dueAt,
    date: dateKey(kstParts(due)), originalTimes: [dueAt], triggers: ['first-notice'],
    state, title: '첫 안내 준비', reason: '첫 안내 내용과 대상을 검토할 시점입니다.',
    recipientIds: [], sourceCheckedAt: null, metrics: null,
  };
  return {status: 'ready', blockedReasons: [], tickets: [ticket], retiredKeys};
}

function checkedCalendar(calendar) {
  if (calendar?.status !== 'success' || !Array.isArray(calendar.holidays)) return null;
  if (calendar.holidays.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || dateKey(kstParts(atKst(...day.split('-').map(Number)))) !== day)) {
    throw new TypeError('공휴일 날짜 형식을 확인해주세요.');
  }
  return new Set(calendar.holidays);
}

/** Move a checkpoint back to the most recent Korean business time. 18:00 is allowed. */
export function adjustToPreviousBusinessTime(value, calendar, policy = {}) {
  const holidays = checkedCalendar(calendar);
  if (!holidays) throw new TypeError('확인된 공휴일 달력이 필요합니다.');
  const rules = {...DEFAULT_POLICY, ...policy};
  const start = rules.businessStartHour;
  const end = rules.businessEndHour;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 23 || start >= end) {
    throw new TypeError('업무시간 설정을 확인해주세요.');
  }
  let current = parseProjectTime(value, '점검');
  for (let checked = 0; checked < 370; checked++) {
    const parts = kstParts(current);
    if (parts.weekday === 0 || parts.weekday === 6 || holidays.has(dateKey(parts))) {
      current = atKst(parts.year, parts.month, parts.day - 1, end);
      continue;
    }
    const beginning = atKst(parts.year, parts.month, parts.day, start);
    const closing = atKst(parts.year, parts.month, parts.day, end);
    if (current < beginning) {
      current = atKst(parts.year, parts.month, parts.day - 1, end);
      continue;
    }
    if (current > closing) current = closing;
    return current.toISOString();
  }
  throw new RangeError('사용 가능한 업무시간을 찾을 수 없습니다.');
}

function policyFor(project, policy) {
  const rules = {...DEFAULT_POLICY, ...project.reminderPolicy, ...policy};
  if (!Number.isFinite(rules.maxDataAgeMinutes) || rules.maxDataAgeMinutes <= 0) return null;
  if (!Array.isArray(rules.requiredCheckDays) || rules.requiredCheckDays.some(day => !Number.isInteger(day) || day < 0)) throw new TypeError('필수 점검 일정을 확인해주세요.');
  if (!Number.isInteger(rules.requiredCheckHour) || rules.requiredCheckHour < 0 || rules.requiredCheckHour > 23) throw new TypeError('필수 점검 시각을 확인해주세요.');
  if (!Number.isFinite(rules.finalHoursBefore) || rules.finalHoursBefore < 0) throw new TypeError('마지막 점검 간격을 확인해주세요.');
  if (!Array.isArray(rules.voluntaryThresholds) || rules.voluntaryThresholds.some(item => !Number.isInteger(item.daysBefore) || item.daysBefore < 0 || !Number.isFinite(item.goalFraction) || item.goalFraction < 0 || item.goalFraction > 1)) throw new TypeError('자율 점검 기준을 확인해주세요.');
  return rules;
}

function checkpoints(project, rules, calendar) {
  const deadline = parseProjectTime(project.deadlineAt, '신청 마감');
  const start = parseStart(project.start);
  if (start >= deadline) throw new TypeError('신청 시작은 마감보다 앞서야 합니다.');
  const endDay = kstParts(deadline);
  const entries = [];
  for (const daysBefore of rules.requiredCheckDays) {
    entries.push({kind: 'required', trigger: `D-${daysBefore}`, original: atKst(endDay.year, endDay.month, endDay.day - daysBefore, rules.requiredCheckHour)});
  }
  entries.push({kind: 'required', trigger: `deadline-${rules.finalHoursBefore}h`, original: new Date(deadline.getTime() - rules.finalHoursBefore * 60 * MINUTE_MS)});
  for (const {daysBefore, goalFraction} of rules.voluntaryThresholds) {
    entries.push({kind: 'voluntary', trigger: `D-${daysBefore}`, goalFraction,
      original: atKst(endDay.year, endDay.month, endDay.day - daysBefore, rules.requiredCheckHour)});
  }

  const grouped = new Map();
  const needsReview = [];
  for (const entry of entries) {
    if (entry.original >= deadline) continue;
    const dueAt = adjustToPreviousBusinessTime(entry.original, calendar, rules);
    if (Date.parse(dueAt) < start.getTime()) {
      needsReview.push({kind: entry.kind, trigger: entry.trigger, originalAt: entry.original.toISOString(), reason: 'adjusted-before-application-start'});
      continue;
    }
    const key = `${project.id}:${entry.kind}:${dueAt}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.triggers.push(entry.trigger);
      existing.originalTimes.push(entry.original.toISOString());
      if (entry.kind === 'voluntary') existing.goalFraction = Math.max(existing.goalFraction, entry.goalFraction);
    } else {
      grouped.set(key, {key, id: key, project: project.id, kind: entry.kind, dueAt,
        date: dateKey(kstParts(new Date(dueAt))), originalTimes: [entry.original.toISOString()],
        triggers: [entry.trigger], goalFraction: entry.goalFraction ?? null});
    }
  }
  return {deadline, checkpoints: [...grouped.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.key.localeCompare(b.key)), needsReview};
}

/** Evaluate reminder times when an application source has not been connected yet. */
export function evaluateReminderCheckpoints({project, calendar, now, existingTickets = [], policy = {}}) {
  if (!project || typeof project.id !== 'string' || !project.id.trim()) {
    throw new TypeError('프로젝트 ID를 확인해주세요.');
  }
  const nowAt = parseInstant(now, '현재');
  const previous = existingTickets.filter(ticket => ticket.key?.startsWith(`${project.id}:required:`)
    || ticket.key?.startsWith(`${project.id}:voluntary:`));
  const active = previous.filter(ticket => ['pending', 'scheduled', 'deferred'].includes(ticket.state));
  if (['cancelled', 'closed'].includes(project.lifecycle)) {
    return {status: 'ready', blockedReasons: [], tickets: [], needsReview: [], retiredKeys: active.map(ticket => ticket.key)};
  }
  if (!checkedCalendar(calendar)) {
    return {status: 'blocked', blockedReasons: ['calendar-unverified'], tickets: [], needsReview: [], retiredKeys: []};
  }
  // Freshness applies to source-backed proposals, not the checkpoint schedule itself.
  const rules = policyFor(project, {...policy, maxDataAgeMinutes: 1});
  const {deadline, checkpoints: schedule, needsReview} = checkpoints(project, rules, calendar);
  const byKey = new Map(previous.map(ticket => [ticket.key, ticket]));
  const tickets = [];
  for (const point of schedule) {
    if (Date.parse(point.dueAt) >= deadline.getTime() || nowAt >= deadline) continue;
    if (point.kind === 'voluntary' && project.voluntaryGoalRate == null) continue;
    if (point.kind === 'required' && Array.isArray(project.requiredIds) && project.requiredIds.length === 0) continue;
    const prior = byKey.get(point.key);
    if (['done', 'dismissed'].includes(prior?.state)) continue;
    const due = Date.parse(point.dueAt) <= nowAt.getTime();
    const state = prior?.state === 'deferred' && prior.reviewAt && Date.parse(prior.reviewAt) > nowAt.getTime()
      ? 'deferred' : due ? 'pending' : 'scheduled';
    tickets.push({...point, state,
      title: point.kind === 'required' ? '필수 대상 신청 현황 확인' : '자율 신청 목표 확인',
      reason: '신청 현황 확인 필요', recipientIds: [], sourceCheckedAt: null, metrics: null});
  }
  const keys = new Set(tickets.map(ticket => ticket.key));
  return {status: 'ready', blockedReasons: [], tickets, needsReview,
    retiredKeys: active.filter(ticket => !keys.has(ticket.key)).map(ticket => ticket.key)};
}

/**
 * Evaluate reminder checkpoints without mutating source data or issuing messages.
 * `applicationRecords` contains one latest-state row per employee (history is normalized upstream).
 * `sync` and `calendar` must be verified by their adapters. Missing or stale data blocks proposals.
 */
export function evaluateReminderTickets({project, applicationRecords, employees, sync, calendar, now, policy = {}, existingTickets = [], sentRecords = []}) {
  if (!project || !Array.isArray(applicationRecords) || !Array.isArray(employees)) throw new TypeError('프로젝트·신청 상태·동료 명단이 필요합니다.');
  if (typeof project.id !== 'string' || !Array.isArray(project.targetIds) || !Array.isArray(project.requiredIds)) {
    throw new TypeError('프로젝트 ID와 대상 명단을 확인해주세요.');
  }
  const nowAt = parseInstant(now, '현재');
  const rules = policyFor(project, policy);
  const blockedReasons = [];
  if (!rules) blockedReasons.push('freshness-policy-missing');
  if (sync?.status !== 'success') blockedReasons.push('source-sync-failed');
  const sourceAt = typeof sync?.lastSuccessAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(sync.lastSuccessAt)
    ? Date.parse(sync.lastSuccessAt) : NaN;
  if (!Number.isFinite(sourceAt) || sourceAt > nowAt.getTime()) blockedReasons.push('source-time-invalid');
  else if (rules && nowAt.getTime() - sourceAt > rules.maxDataAgeMinutes * MINUTE_MS) blockedReasons.push('source-stale');
  if (!checkedCalendar(calendar)) blockedReasons.push('calendar-unverified');
  if (blockedReasons.length) return {status: 'blocked', blockedReasons, sourceError: sync?.error ?? null, tickets: [], needsReview: [], retiredKeys: []};

  const {deadline, checkpoints: schedule, needsReview} = checkpoints(project, rules, calendar);
  const known = new Set(employees.map(employee => employee.id));
  const target = new Set(project.targetIds);
  const seen = new Set();
  for (const record of applicationRecords.filter(record => record.projectId === project.id)) {
    if (!known.has(record.employeeId) || !target.has(record.employeeId) || seen.has(record.employeeId) || !['applied', 'confirmed', 'cancelled'].includes(record.status)) {
      blockedReasons.push('source-rows-invalid');
      break;
    }
    seen.add(record.employeeId);
  }
  if (project.targetIds.some(id => !known.has(id)) || project.requiredIds.some(id => !target.has(id))) blockedReasons.push('project-roster-invalid');
  if (blockedReasons.length) return {status: 'blocked', blockedReasons, sourceError: null, tickets: [], needsReview, retiredKeys: []};

  const status = calculateStatus(project, applicationRecords, employees);
  const counts = applicationBreakdown(status);
  const voluntaryIds = status.targetIds.filter(id => !status.requiredIds.includes(id));
  const voluntaryPendingIds = voluntaryIds.filter(id => status.pendingIds.includes(id));
  const voluntaryRate = counts.voluntary.target ? counts.voluntary.applied / counts.voluntary.target : null;
  const goal = project.voluntaryGoalRate;
  if (goal != null && (!Number.isFinite(goal) || goal < 0 || goal > 1)) throw new TypeError('자율 신청 목표는 0~1 사이여야 합니다.');
  const previous = new Map(existingTickets.filter(ticket => ticket.key).map(ticket => [ticket.key, ticket]));
  const recent = sentRecords.filter(record => record.project === project.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
  const tickets = [];
  const activeKeys = new Set();
  for (const point of schedule) {
    if (Date.parse(point.dueAt) >= deadline.getTime() || nowAt >= deadline) continue;
    if (point.kind === 'required' && counts.required.target === 0) continue;
    const due = Date.parse(point.dueAt) <= nowAt.getTime();
    const recipientIds = point.kind === 'required' ? status.requiredPendingIds : voluntaryPendingIds;
    const threshold = point.kind === 'voluntary' && goal != null && voluntaryRate != null
      ? goal * point.goalFraction : null;
    const condition = point.kind === 'required' ? recipientIds.length > 0
      : threshold != null && voluntaryRate < threshold;
    // Future checkpoints remain visible even when today's count already meets the goal.
    // At the due time, only an unmet condition can become a pending proposal.
    if (due && !condition) continue;
    if (point.kind === 'voluntary' && threshold == null) continue;
    const prior = previous.get(point.key);
    if (['done', 'dismissed'].includes(prior?.state)) continue;
    const state = prior?.state === 'deferred' && prior.reviewAt && Date.parse(prior.reviewAt) > nowAt.getTime() ? 'deferred'
      : !due ? 'scheduled' : 'pending';
    const title = point.kind === 'required' ? '필수 대상 신청 현황 확인' : '자율 신청 목표 확인';
    const reason = point.kind === 'required'
      ? `필수 대상 ${counts.required.target}명 중 신청 전 ${counts.required.pending}명`
      : `자율 대상 ${counts.voluntary.target}명 중 신청 ${counts.voluntary.applied}명 · 현재 ${(voluntaryRate * 100).toFixed(1)}% / 점검 기준 ${(threshold * 100).toFixed(1)}%`;
    tickets.push({...point, state, title, reason, recipientIds, sourceCheckedAt: sync.lastSuccessAt,
      metrics: {required: counts.required, voluntary: counts.voluntary, total: counts.total,
        voluntaryRate, voluntaryGoalRate: goal ?? null, threshold}, recentNotices: recent});
    activeKeys.add(point.key);
  }
  const retiredKeys = existingTickets.filter(ticket => ticket.key && ['pending', 'scheduled', 'deferred'].includes(ticket.state) && !activeKeys.has(ticket.key)).map(ticket => ticket.key);
  return {status: 'ready', blockedReasons: [], sourceError: null, tickets, needsReview, retiredKeys,
    summary: {counts, voluntaryRate, voluntaryGoalRate: goal ?? null, sourceCheckedAt: sync.lastSuccessAt}};
}
