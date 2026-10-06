// Adapter-independent contract for a target roster and append-only application history.
// targetRows: {projectId, employeeId, required}; eventRows:
// {sourceEventId, projectId, employeeId, status, occurredAt}.
// IDs in the source must be stable; occurredAt/lastSuccessAt must include a timezone.
const STATUSES = new Set(['applied', 'confirmed', 'cancelled']);

export class ApplicationSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApplicationSourceError';
    this.code = code;
  }
}

function invalid(code, message) { throw new ApplicationSourceError(code, message); }

function projectId(value, context) {
  if (typeof value !== 'string' || !value.trim()) invalid('INVALID_PROJECT_ID', `${context}: projectId가 필요합니다.`);
  return value.trim();
}

function employeeId(value, context) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) invalid('INVALID_EMPLOYEE_ID', `${context}: employeeId가 양의 정수여야 합니다.`);
  return normalized;
}

function requiredFlag(value, context) {
  if (value === true || value === false) return value;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  invalid('INVALID_REQUIRED_FLAG', `${context}: required는 TRUE 또는 FALSE여야 합니다.`);
}

function timestamp(value, context) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    invalid('INVALID_TIMESTAMP', `${context}: 시간은 시간대가 포함된 ISO 형식이어야 합니다.`);
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) invalid('INVALID_TIMESTAMP', `${context}: 올바르지 않은 시각입니다.`);
  return date.toISOString();
}

function knownIds(ids, normalize, label) {
  if (!Array.isArray(ids)) invalid('INVALID_KNOWN_IDS', `${label} 목록이 필요합니다.`);
  return new Set(ids.map((id, index) => normalize(id, `${label} ${index + 1}`)));
}

function stableEventId(value, context) {
  if (typeof value !== 'string' || !value.trim()) invalid('MISSING_SOURCE_EVENT_ID', `${context}: sourceEventId가 필요합니다.`);
  return value.trim();
}

export function normalizeApplicationSource({targetRows, eventRows, knownEmployeeIds, knownProjectIds, lastSuccessAt, sourceVersion = null}) {
  if (!Array.isArray(targetRows) || !Array.isArray(eventRows)) invalid('INVALID_ROWS', '대상 목록과 사건 이력은 배열이어야 합니다.');
  const employees = knownIds(knownEmployeeIds, employeeId, '동료');
  const projects = knownIds(knownProjectIds, projectId, '프로젝트');
  const syncTime = timestamp(lastSuccessAt, '마지막 정상 조회');
  const targetMap = new Map();
  for (const [index, row] of targetRows.entries()) {
    const context = `대상 ${index + 1}행`;
    if (!row || typeof row !== 'object') invalid('INVALID_TARGET_ROW', `${context}: 행 형식이 올바르지 않습니다.`);
    const p = projectId(row.projectId, context);
    const e = employeeId(row.employeeId, context);
    const required = requiredFlag(row.required, context);
    if (!projects.has(p)) invalid('UNKNOWN_PROJECT_ID', `${context}: 알 수 없는 프로젝트 ID입니다.`);
    if (!employees.has(e)) invalid('UNKNOWN_EMPLOYEE_ID', `${context}: 알 수 없는 동료 ID입니다.`);
    const key = JSON.stringify([p, e]);
    const old = targetMap.get(key);
    if (old && old.required !== required) invalid('CONFLICTING_TARGET', `${context}: 같은 동료의 필수 여부가 충돌합니다.`);
    targetMap.set(key, {projectId:p, employeeId:e, required});
  }

  const eventIds = new Map();
  const eventTimes = new Map();
  for (const [index, row] of eventRows.entries()) {
    const context = `이력 ${index + 1}행`;
    if (!row || typeof row !== 'object') invalid('INVALID_EVENT_ROW', `${context}: 행 형식이 올바르지 않습니다.`);
    const event = {
      sourceEventId:stableEventId(row.sourceEventId, context),
      projectId:projectId(row.projectId, context),
      employeeId:employeeId(row.employeeId, context),
      status:row.status,
      occurredAt:timestamp(row.occurredAt, context),
    };
    if (!projects.has(event.projectId)) invalid('UNKNOWN_PROJECT_ID', `${context}: 알 수 없는 프로젝트 ID입니다.`);
    if (!employees.has(event.employeeId)) invalid('UNKNOWN_EMPLOYEE_ID', `${context}: 알 수 없는 동료 ID입니다.`);
    if (!STATUSES.has(event.status)) invalid('UNKNOWN_STATUS', `${context}: 알 수 없는 신청 상태입니다.`);
    const previous = eventIds.get(event.sourceEventId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(event)) invalid('CONFLICTING_EVENT_ID', `${context}: 같은 사건 ID의 내용이 충돌합니다.`);
      continue;
    }
    const timeKey = JSON.stringify([event.projectId, event.employeeId, event.occurredAt]);
    const atSameTime = eventTimes.get(timeKey);
    if (atSameTime && atSameTime !== event.status) invalid('CONFLICTING_EVENT_TIME', `${context}: 같은 시각의 상태가 충돌합니다.`);
    eventTimes.set(timeKey, event.status);
    eventIds.set(event.sourceEventId, event);
  }

  const events = [...eventIds.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceEventId.localeCompare(b.sourceEventId));
  const latest = new Map();
  for (const event of events) latest.set(JSON.stringify([event.projectId, event.employeeId]), {
    projectId:event.projectId, employeeId:event.employeeId, status:event.status, checkedAt:event.occurredAt,
    sourceEventId:event.sourceEventId,
  });
  const targets = [...targetMap.values()].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.employeeId - b.employeeId);
  const projectTargets = [...projects].sort().map(id => ({
    projectId:id,
    targetIds:targets.filter(row => row.projectId === id).map(row => row.employeeId),
    requiredIds:targets.filter(row => row.projectId === id && row.required).map(row => row.employeeId),
  }));
  return {
    targets, projectTargets, events, applications:[...latest.values()].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.employeeId - b.employeeId),
    sync:{status:'success', lastSuccessAt:syncTime, sourceVersion},
  };
}

// A failed fetch or invalid snapshot never becomes an empty applicant set. Callers must
// check sync.status before using applications for a decision or a send.
export function failedApplicationSource(error, previous = null) {
  return {
    targets:previous?.targets ?? null,
    projectTargets:previous?.projectTargets ?? null,
    events:previous?.events ?? null,
    applications:previous?.applications ?? null,
    sync:{status:'failed', lastSuccessAt:previous?.sync?.lastSuccessAt ?? null,
      sourceVersion:previous?.sync?.sourceVersion ?? null,
      error:{code:error?.code || 'SOURCE_ERROR', message:error?.message || '원본을 읽지 못했습니다.'}},
  };
}

export function tryNormalizeApplicationSource(input, previous = null) {
  try {
    const next = normalizeApplicationSource(input);
    if (Array.isArray(previous?.events)) {
      const currentEvents = new Map(next.events.map(event => [event.sourceEventId, event]));
      for (const oldEvent of previous.events) {
        const current = currentEvents.get(oldEvent.sourceEventId);
        if (!current || JSON.stringify(current) !== JSON.stringify(oldEvent)) {
          invalid('SOURCE_HISTORY_CHANGED', '이전에 확인한 신청 이력이 삭제되거나 변경되었습니다.');
        }
      }
    }
    return next;
  }
  catch (error) { return failedApplicationSource(error, previous); }
}
