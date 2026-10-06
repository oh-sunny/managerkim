import {ApplicationSourceError, failedApplicationSource, tryNormalizeApplicationSource} from './application-source.mjs';

// Thin, read-only Google Sheets values API adapter. Inject a short-lived access token
// and fetch implementation from server code. Never put credentials in a browser bundle.
// Source headers can be remapped once the actual sheet columns are known. Timestamp
// cells must be text formatted as ISO 8601 with a timezone; IDs must be stable.
const targetFields = ['projectId', 'employeeId', 'required'];
const eventFields = ['sourceEventId', 'projectId', 'employeeId', 'status', 'occurredAt'];

export function mapSheetRows(values, fields, columns = {}) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new ApplicationSourceError('INVALID_SHEET', '시트의 헤더 행을 읽지 못했습니다.');
  const headers = values[0].map(value => String(value).trim());
  const positions = fields.map(field => {
    const header = columns[field] || field;
    const matches = headers.reduce((found, value, index) => value === header ? [...found, index] : found, []);
    if (matches.length !== 1) throw new ApplicationSourceError('INVALID_SHEET_HEADER', `${header} 열이 없거나 중복되었습니다.`);
    return [field, matches[0]];
  });
  return values.slice(1).filter(row => Array.isArray(row) && row.some(value => String(value ?? '').trim() !== '')).map(row =>
    Object.fromEntries(positions.map(([field, index]) => [field, row[index]])));
}

export async function readGoogleSheetsApplicationSource({
  spreadsheetId, targetRange, eventRange, accessToken, knownEmployeeIds, knownProjectIds,
  targetColumns, eventColumns, sourceVersion = null, previous = null,
  fetchImpl = globalThis.fetch, now = () => new Date(),
}) {
  try {
    if (![spreadsheetId, targetRange, eventRange, accessToken].every(value => typeof value === 'string' && value.trim())) {
      throw new ApplicationSourceError('MISSING_SHEET_CONFIG', '스프레드시트 ID, 두 범위, 접근 토큰이 필요합니다.');
    }
    if (typeof fetchImpl !== 'function') throw new ApplicationSourceError('MISSING_FETCH', '서버 fetch 함수가 필요합니다.');
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
    url.searchParams.append('ranges', targetRange);
    url.searchParams.append('ranges', eventRange);
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
    const response = await fetchImpl(url, {headers:{Authorization:`Bearer ${accessToken}`}});
    if (!response?.ok) throw new ApplicationSourceError('SHEETS_HTTP_ERROR', `Google Sheets 조회 실패 (HTTP ${response?.status ?? 'unknown'}).`);
    const body = await response.json();
    if (!Array.isArray(body?.valueRanges) || body.valueRanges.length !== 2) {
      throw new ApplicationSourceError('INVALID_SHEET_RESPONSE', '두 시트 범위를 모두 읽지 못했습니다.');
    }
    const targetRows = mapSheetRows(body.valueRanges[0].values, targetFields, targetColumns);
    const eventRows = mapSheetRows(body.valueRanges[1].values, eventFields, eventColumns);
    const checkedAt = now();
    if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.getTime())) {
      throw new ApplicationSourceError('INVALID_CLOCK', '조회 시각을 확인할 수 없습니다.');
    }
    return tryNormalizeApplicationSource({targetRows, eventRows, knownEmployeeIds, knownProjectIds,
      lastSuccessAt:checkedAt.toISOString(), sourceVersion}, previous);
  } catch (error) {
    return failedApplicationSource(error, previous);
  }
}
