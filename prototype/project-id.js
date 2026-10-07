export function newProjectId(sheetProjectId, existingIds, localId = () => `local-${crypto.randomUUID()}`) {
  const requested = String(sheetProjectId ?? '').trim();
  if (!requested) return localId();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(requested)) {
    throw new Error('시트 프로젝트 ID는 영문 소문자·숫자·하이픈만 사용하고 80자 이내로 입력해주세요.');
  }
  if (existingIds.includes(requested)) throw new Error('이미 등록된 프로젝트 ID입니다.');
  return requested;
}
