// Local data adapter and calculations. An external source can later produce the same records.
export const employeeIds = employees => new Set(employees.map(employee => employee.id));

export function parseIdList(value, employees) {
  const known = employeeIds(employees);
  const ids = [...new Set(String(value).split(/[\s,]+/).filter(Boolean).map(Number))];
  if (ids.some(id => !Number.isInteger(id) || !known.has(id))) throw new Error('동료 ID 목록에 알 수 없는 번호가 있어요.');
  return ids;
}

export function calculateStatus(project, applicationRecords, employees) {
  const known = employeeIds(employees);
  const target = new Set(project.targetIds.filter(id => known.has(id)));
  const required = new Set(project.requiredIds.filter(id => target.has(id)));
  const latest = new Map();
  const unknown = [];
  for (const record of applicationRecords.filter(record => record.projectId === project.id)) {
    if (!known.has(record.employeeId) || !target.has(record.employeeId)) { unknown.push(record); continue; }
    latest.set(record.employeeId, record);
  }
  const appliedIds = [...target].filter(id => ['applied', 'confirmed'].includes(latest.get(id)?.status));
  const confirmedIds = appliedIds.filter(id => latest.get(id).status === 'confirmed');
  const pendingIds = [...target].filter(id => !appliedIds.includes(id));
  return {
    targetIds:[...target], requiredIds:[...required], appliedIds, confirmedIds, pendingIds,
    requiredPendingIds:pendingIds.filter(id => required.has(id)), unknown,
    rate:target.size ? appliedIds.length / target.size : null,
    lastCheckedAt:project.lastCheckedAt || null,
  };
}

export function setApplication(records, projectId, employeeId, status, checkedAt) {
  return [...records.filter(record => !(record.projectId === projectId && record.employeeId === employeeId)),
    {projectId, employeeId, status, checkedAt}];
}

export function applicationBreakdown(status) {
  const required = new Set(status.requiredIds);
  const applied = new Set(status.appliedIds);
  const row = ids => ({target:ids.length, applied:ids.filter(id => applied.has(id)).length,
    pending:ids.filter(id => !applied.has(id)).length});
  return {
    required:row(status.targetIds.filter(id => required.has(id))),
    voluntary:row(status.targetIds.filter(id => !required.has(id))),
    total:row(status.targetIds),
  };
}

export function sortTicketsForDisplay(tickets, stateOf, completedAt) {
  return [...tickets].sort((a,b) => {
    const aState=stateOf(a), bState=stateOf(b);
    const aDone=aState==='done', bDone=bState==='done';
    if(aDone!==bDone) return aDone?1:-1;
    if(aDone) return (completedAt(b)||b.date).localeCompare(completedAt(a)||a.date) || a.id.localeCompare(b.id);
    return a.date.localeCompare(b.date) || (aState==='pending'?0:1)-(bState==='pending'?0:1) || a.id.localeCompare(b.id);
  });
}
