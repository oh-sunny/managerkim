import {mergeSheetApplications} from './sheet-application-merge.js';
import {evaluateReminderTickets} from './rule-engine.js';

export function buildScheduledSync({source, operatorState, previousTickets = [], calendar, now = new Date().toISOString()}) {
  const state = operatorState?.payload;
  if (!state || !Array.isArray(state.projects) || !Array.isArray(state.tickets)) throw new Error('운영자 프로젝트가 서버에 저장되지 않았습니다.');
  if (source?.sync?.status !== 'success' || !Array.isArray(source.events)) throw new Error('Google Sheets 읽기 결과가 올바르지 않습니다.');
  const byProject = new Map(state.projects.map(project => [project.id, project]));
  const targets = new Map(source.projectTargets.map(row => [row.projectId, row]));
  const sourceIds = new Set(source.sourceProjects.map(project => project.id));
  for (const id of sourceIds) if (!byProject.has(id)) throw new Error(`웹앱에 없는 프로젝트 ID가 시트에 있습니다: ${id}`);
  const operatorEvents = (state.applicationEvents || []).filter(event => sourceIds.has(event.projectId) && event.source !== 'sheet');
  const applications = mergeSheetApplications(source.applications, source.events, operatorEvents);
  const existingByKey = new Map(previousTickets.filter(ticket => ticket?.key).map(ticket => [ticket.key, ticket]));
  for (const ticket of state.tickets.filter(ticket => ticket?.key)) existingByKey.set(ticket.key, ticket);
  const tickets = [];
  const retiredKeys = [];
  for (const id of sourceIds) {
    const original = byProject.get(id);
    if (original.lifecycle && original.lifecycle !== 'active') continue;
    const roster = targets.get(id);
    const project = {...original, targetIds: roster?.targetIds || [], requiredIds: roster?.requiredIds || [],
      lastCheckedAt: source.sync.lastSuccessAt, dataKind: 'sheet'};
    const existing = [...existingByKey.values()].filter(ticket => ticket.project === id);
    const result = evaluateReminderTickets({project, applicationRecords: applications, employees: source.employees,
      sync: source.sync, calendar, now, policy: {maxDataAgeMinutes: 1440}, existingTickets: existing,
      sentRecords: state.records || []});
    if (result.status !== 'ready') throw new Error(`${project.name}: 티켓 평가 중단 (${result.blockedReasons.join(', ')})`);
    for (const candidate of result.tickets) {
      const old = existingByKey.get(candidate.key);
      tickets.push({...old, ...candidate, id: old?.id || `${id}-${candidate.kind}-${candidate.dueAt.replace(/\D/g, '')}`,
        project: id, purpose: candidate.triggers.join(' · '), state: candidate.state, ruleGenerated: true});
    }
    retiredKeys.push(...result.retiredKeys);
  }
  return {tickets, retiredKeys: [...new Set(retiredKeys)], applications};
}
