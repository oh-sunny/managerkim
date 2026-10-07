const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;

export function sheetSyncRunNotice(run) {
  if (!run) return '';
  if (run.status === 'error') {
    if (run.error_code === 'registration-time-missing' && run.source_checked_at) {
      const blocked = count(run.blocked_count);
      return blocked
        ? `시트 자료는 저장됐지만 기존 프로젝트 ${blocked}개의 첫 안내 티켓 평가는 등록 시각이 없어 보류됐어요.`
        : '시트 자료는 저장됐지만 기존 프로젝트의 첫 안내 티켓 평가는 등록 시각이 없어 보류됐어요.';
    }
    return run.source_checked_at
      ? '시트 자료는 저장됐지만 확인할 일 평가에 오류가 있어요.'
      : '최근 시트 동기화가 실패했어요. 마지막 저장 시각을 확인해주세요.';
  }
  const blocked = count(run.blocked_count);
  return blocked ? `시트 자료는 저장됐어요. 확인할 일 평가 ${blocked}건은 필요한 정보가 없어 보류됐어요.` : '';
}

export function sheetSyncResponseNotice(result) {
  if (result?.sourceStatus !== 'success') return '';
  const skipped = count(result.firstNoticeSkippedCount);
  if (skipped) return `신청 현황은 저장했어요. 기존 프로젝트 ${skipped}개의 첫 안내 티켓 평가는 등록 시각이 없어 보류했어요.`;
  if (result.status === 'error') return '신청 현황은 저장했지만 확인할 일 평가에 오류가 있어요.';
  const blocked = count(result.blockedDecisions);
  return blocked ? `신청 현황은 저장했어요. 확인할 일 평가 ${blocked}건은 보류했어요.` : '';
}
