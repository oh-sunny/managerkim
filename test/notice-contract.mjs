/** Deterministic checks for candidate notices. This is a test oracle, not a generator. */
export function evaluateNotice(testCase, text) {
  const errors = [];
  const warnings = [];
  const body = String(text ?? '').trim();
  if (!body) return {pass:false, errors:['공지 본문이 비어 있습니다.'], warnings};
  const urls = [...body.matchAll(/https?:\/\/[^\s<>"')]+/g)]
    .map(match => match[0].replace(/[.,!?。！，]+$/, ''));
  if (!urls.includes(testCase.applicationUrl)) errors.push('확정된 신청 링크가 본문에 없습니다.');
  for (const url of testCase.obsoleteUrls ?? []) {
    if (urls.includes(url)) errors.push(`이전 링크가 포함됐습니다: ${url}`);
  }
  for (const obsolete of testCase.obsoleteDeadlines ?? []) {
    const [oldYear, oldMonth, oldDay] = obsolete.split('-').map(Number);
    const patterns = [new RegExp(`${oldYear}년\\s*${oldMonth}월\\s*${oldDay}일`),
      new RegExp(`${oldMonth}월\\s*${oldDay}일`), new RegExp(`${oldYear}[-./]0?${oldMonth}[-./]0?${oldDay}`)];
    if (patterns.some(pattern => pattern.test(body))) errors.push(`이전 마감 날짜가 포함됐습니다: ${obsolete}`);
  }
  const [date, time] = testCase.deadlineAt.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const datePatterns = [new RegExp(`${year}년\\s*${month}월\\s*${day}일`),
    new RegExp(`${month}월\\s*${day}일`), new RegExp(`${year}[-./]0?${month}[-./]0?${day}`)];
  const dateMatch = datePatterns.map(pattern => body.match(pattern)).find(Boolean);
  if (!dateMatch) errors.push('신청 마감 날짜가 없습니다.');
  const timePatterns = [new RegExp(`${hour}\\s*[:시]\\s*${minute ? String(minute).padStart(2,'0') : '(?:00)?'}`),
    ...(hour > 12 ? [new RegExp(`오후\\s*${hour - 12}시`)] : [])];
  const nearDeadline = dateMatch ? body.slice(dateMatch.index + dateMatch[0].length, dateMatch.index + dateMatch[0].length + 45) : '';
  if (!timePatterns.some(pattern => pattern.test(nearDeadline))) errors.push('신청 마감 시각이 날짜 근처에 없습니다.');
  for (const phrase of testCase.noticeMustAvoid ?? []) {
    if (body.includes(phrase)) errors.push(`금지된 오래된 정보 또는 잘못된 확정 표현: ${phrase}`);
  }
  if (testCase.confirmationMode === 'separate' && /신청\s*(?:즉시|하면 바로)\s*(?:참석|예약|지원)?\s*확정/.test(body)) {
    errors.push('신청과 별도 확정을 혼동했습니다.');
  }
  if (!body.includes(testCase.owner.split(' ').at(-1))) warnings.push('문의 담당자를 확인해 주세요.');
  for (const phrase of testCase.noticeMustInclude ?? []) {
    if (!body.includes(phrase)) warnings.push(`필요한 행동 또는 절차를 확인해 주세요: ${phrase}`);
  }
  if (body.length > 1500) warnings.push('공지 길이가 길어 핵심 행동이 묻힐 수 있습니다.');
  return {pass:errors.length === 0, errors, warnings, urls};
}
