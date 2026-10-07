import {mergeSheetApplications} from './sheet-application-merge.js';
import * as rules from './rule-engine.js';

const openStates = new Set(['pending', 'scheduled', 'deferred']);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function storedTicket(candidate, existingByKey, projectId) {
  if (!candidate?.key || !openStates.has(candidate.state)) return null;
  const old = existingByKey.get(candidate.key);
  if (old && !openStates.has(old.state)) return null;
  return {...old, ...candidate, id: old?.id || candidate.id || candidate.key,
    project: projectId, purpose: candidate.purpose || candidate.triggers?.join(' · ') || candidate.reason || '',
    state: candidate.state, sourceStatus: candidate.sourceCheckedAt ? 'verified' : 'unverified',
    ruleGenerated: true};
}

/**
 * Prepare server-owned tickets for one operator. Sheet failures still allow time-only
 * tickets, but never turn an unverified roster into a count or recipient list.
 * The two time-only evaluators are provided by W1's generated rule-engine copy.
 */
export function buildScheduledSync({source = null, sourceError = null, operatorState,
  previousTickets = [], calendar, now = new Date().toISOString(), evaluators = rules}) {
  const state = operatorState?.payload;
  if (!state || !Array.isArray(state.projects) || !Array.isArray(state.tickets)) {
    throw new Error('운영자 프로젝트가 서버에 저장되지 않았습니다.');
  }
  const ownerId = operatorState.owner_id || operatorState.ownerId || null;
  const sourceReady = source?.sync?.status === 'success' && Array.isArray(source.events) &&
    Array.isArray(source.applications) && Array.isArray(source.employees) &&
    Array.isArray(source.projectTargets) && Array.isArray(source.sourceProjects) &&
    validTime(source.sync.lastSuccessAt);
  const sourceIds = new Set(sourceReady ? source.sourceProjects.map(project => project.id) : []);
  const targets = new Map(sourceReady ? source.projectTargets.map(row => [row.projectId, row]) : []);
  const existingByKey = new Map(state.tickets.filter(ticket => ticket?.key).map(ticket => [ticket.key, ticket]));
  // An operator decision can live in either state while the two stores reconcile.
  // A terminal decision in either store must never become a new proposal.
  for (const ticket of previousTickets.filter(ticket => ticket?.key)) {
    const stateTicket = existingByKey.get(ticket.key);
    if (stateTicket && !openStates.has(stateTicket.state) && openStates.has(ticket.state)) continue;
    existingByKey.set(ticket.key, ticket);
  }
  const tickets = [];
  const retiredKeys = new Set();
  const issues = [];
  let evaluatedCount = 0;
  let blockedCount = 0;
  let applications = [];

  if (sourceReady) {
    const known = new Set(state.projects.map(project => project.id));
    for (const id of sourceIds) if (!known.has(id)) issues.push({projectId: id, code: 'sheet-project-unknown'});
    const operatorEvents = (state.applicationEvents || []).filter(event =>
      sourceIds.has(event.projectId) && event.source !== 'sheet' &&
      targets.get(event.projectId)?.targetIds.includes(event.employeeId));
    applications = mergeSheetApplications(source.applications, source.events, operatorEvents);
  } else if (sourceError) {
    issues.push({projectId: null, code: 'sheet-source-unavailable'});
  }

  for (const project of state.projects) {
    const existing = [...existingByKey.values()].filter(ticket => ticket.project === project.id);
    if (project.lifecycle && project.lifecycle !== 'active') {
      for (const ticket of existing) if (openStates.has(ticket.state)) retiredKeys.add(ticket.key);
      continue;
    }
    evaluatedCount++;
    if (project.firstNoticeReviewAt || project.createdAt) {
      if (typeof evaluators.evaluateFirstNoticeTicket !== 'function') {
        throw new Error('첫 안내 규칙이 Edge 공통 코드에 없습니다. npm run build:edge를 실행해주세요.');
      }
      try {
        const initial = evaluators.evaluateFirstNoticeTicket({project, now,
          existingTickets: existing.filter(ticket => ticket.kind === 'initial')});
        if (initial.status === 'ready') {
          for (const candidate of initial.tickets) {
            const ticket = storedTicket(candidate, existingByKey, project.id);
            if (ticket) tickets.push(ticket);
          }
          for (const key of initial.retiredKeys) retiredKeys.add(key);
        } else {
          blockedCount++;
          issues.push({projectId: project.id, code: 'first-notice-blocked'});
        }
      } catch {
        blockedCount++;
        issues.push({projectId: project.id, code: 'first-notice-invalid'});
      }
    } else {
      // A legacy project has no stable registration time. Do not invent a key.
      blockedCount++;
      issues.push({projectId: project.id, code: 'registration-time-missing'});
    }

    const reminderExisting = existing.filter(ticket => ticket.kind !== 'initial');
    let result;
    if (sourceReady && sourceIds.has(project.id)) {
      const roster = targets.get(project.id);
      const sheetProject = {...project, targetIds: roster?.targetIds || [],
        requiredIds: roster?.requiredIds || [], lastCheckedAt: source.sync.lastSuccessAt, dataKind: 'sheet'};
      try {
        result = evaluators.evaluateReminderTickets({project: sheetProject,
          applicationRecords: applications, employees: source.employees, sync: source.sync,
          calendar, now, policy: {maxDataAgeMinutes: 1440}, existingTickets: reminderExisting,
          sentRecords: state.records || []});
      } catch {
        result = {status: 'blocked', blockedReasons: ['sheet-project-invalid']};
      }
    } else if (project.dataKind === 'sheet') {
      // A Sheet project that disappeared from a successful read, or a failed read,
      // cannot be treated as a locally verified application source.
      result = {status: 'blocked', blockedReasons: [sourceReady ? 'sheet-project-missing' : 'sheet-source-unavailable']};
    } else {
      if (typeof evaluators.evaluateReminderCheckpoints !== 'function') {
        throw new Error('원본 미연결 점검 규칙이 Edge 공통 코드에 없습니다. npm run build:edge를 실행해주세요.');
      }
      try {
        result = evaluators.evaluateReminderCheckpoints({project, calendar, now,
          existingTickets: reminderExisting});
      } catch {
        result = {status: 'blocked', blockedReasons: ['reminder-schedule-invalid']};
      }
    }
    if (result.status !== 'ready') {
      blockedCount++;
      issues.push({projectId: project.id, code: result.blockedReasons?.[0] || 'reminder-blocked'});
      if (project.dataKind === 'sheet' || sourceIds.has(project.id)) {
        for (const old of reminderExisting.filter(ticket => openStates.has(ticket.state))) {
          // Existing Sheet proposals also lose their old counts and recipients
          // while the source is unavailable or stale.
          const ticket = storedTicket({...old, state:'deferred',
            reason:'신청 현황 확인 필요', recipientIds:[], metrics:null,
            recentNotices:[], sourceCheckedAt:null, sourceStatus:'unverified'},
          existingByKey, project.id);
          if (ticket) tickets.push(ticket);
        }
      }
      continue;
    }
    for (const candidate of result.tickets) {
      const ticket = storedTicket(candidate, existingByKey, project.id);
      if (ticket) tickets.push(ticket);
    }
    for (const key of result.retiredKeys) retiredKeys.add(key);
  }

  const currentKeys = new Set(tickets.map(ticket => ticket.key));
  for (const key of currentKeys) retiredKeys.delete(key);
  return {ownerId, tickets, retiredKeys: [...retiredKeys], applications,
    sourceStatus: sourceReady ? 'success' : sourceError ? 'error' : 'not-connected',
    sourceCheckedAt: sourceReady ? source.sync.lastSuccessAt : null,
    evaluatedCount, blockedCount, issues};
}
