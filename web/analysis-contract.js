export const ANALYSIS_LIMITS = Object.freeze({ files: 6, fileBytes: 2_000_000, totalBytes: 2_800_000, textChars: 80_000, pages: 30, ocrPages: 8 });
export const ANALYSIS_FIELDS = Object.freeze({
  name: '프로젝트 제목', description: '목적·설명', owner: '담당자', start: '신청 시작일',
  deadlineAt: '신청 마감', event: '행사·운영 일정', location: '장소', audience: '참여 대상',
  requirements: '신청 방법·유의사항', capacity: '정원·선정 조건', applicationUrl: '신청 링크',
  confirmationMode: '신청 후 확정 방식', type: '종류',
});

export function applicableValue(field, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (['start', 'event', 'deadlineAt'].includes(field)) {
    const pattern = field === 'deadlineAt' ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
    if (!pattern.test(text)) return null;
    const date = new Date(`${text.slice(0,10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== text.slice(0,10)) return null;
    if (field === 'deadlineAt' && (+text.slice(11,13) > 23 || +text.slice(14,16) > 59)) return null;
    return text;
  }
  if (field === 'applicationUrl') {
    try { const u = new URL(text); return u.protocol === 'https:' && !u.username && !u.password ? text : null; } catch { return null; }
  }
  if (field === 'confirmationMode') return ['immediate','separate'].includes(text) ? text : null;
  if (field === 'type') return ['행사','복지','이벤트'].includes(text) ? text : null;
  return Object.hasOwn(ANALYSIS_FIELDS, field) && text.length <= 2000 ? text : null;
}
