import {ApplicationSourceError, failedApplicationSource, normalizeApplicationSource, tryNormalizeApplicationSource} from './application-source.mjs';

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

const directoryFields = ['employeeId','employeeNumber','name','email','division','team','grade','position','employmentType','employmentStatus','hiredAt','location','managerEmployeeNumber'];
const directoryColumns = {employeeNumber:'사번',name:'이름',email:'회사 이메일',division:'본부',team:'팀',grade:'직급',position:'직책',employmentType:'고용 형태',employmentStatus:'재직 상태',hiredAt:'입사일',location:'근무지',managerEmployeeNumber:'관리자 사번'};
const projectFields = ['projectId','name'];
const projectColumns = {name:'프로젝트명'};

export function normalizeSheetTimestamp(value) {
  const text=String(value??'').trim();
  const kst=text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) KST$/);
  return kst?`${kst[1]}T${kst[2]}+09:00`:text;
}

// Reads the four tabs of the fictional company example as one consistent snapshot.
// The directory is independent of project membership; the target tab selects only
// employees eligible for each project. IDs, not row positions or names, join tabs.
export async function readGoogleSheetsWorkspaceSource({
  spreadsheetId, accessToken, directoryRange='직원명부!A:M', projectRange='프로젝트!A:H',
  targetRange='대상!A:G', eventRange='신청이력!A:I',
  fetchImpl=globalThis.fetch, now=()=>new Date(),
}) {
  if(!spreadsheetId||!accessToken)throw new ApplicationSourceError('MISSING_SHEET_CONFIG','스프레드시트 ID와 접근 토큰이 필요합니다.');
  const url=new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
  [directoryRange,projectRange,targetRange,eventRange].forEach(range=>url.searchParams.append('ranges',range));
  url.searchParams.set('majorDimension','ROWS');
  url.searchParams.set('valueRenderOption','FORMATTED_VALUE');
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(15000)});
  if(!response?.ok)throw new ApplicationSourceError('SHEETS_HTTP_ERROR',`Google Sheets 조회 실패 (HTTP ${response?.status??'unknown'}).`);
  const body=await response.json();
  if(!Array.isArray(body?.valueRanges)||body.valueRanges.length!==4)throw new ApplicationSourceError('INVALID_SHEET_RESPONSE','직원명부·프로젝트·대상·신청이력 탭을 모두 읽지 못했습니다.');
  const [directoryValues,projectValues,targetValues,eventValues]=body.valueRanges.map(item=>item?.values);
  const employeeRows=mapSheetRows(directoryValues,directoryFields,directoryColumns);
  const projectRows=mapSheetRows(projectValues,projectFields,projectColumns);
  const targetRows=mapSheetRows(targetValues,targetFields);
  const reasonIndex=eventValues?.[0]?.indexOf('사유 (참고)')??-1;
  const eventRows=mapSheetRows(eventValues,reasonIndex>=0?[...eventFields,'reason']:eventFields,
    reasonIndex>=0?{reason:'사유 (참고)'}:{}).map(row=>({...row,occurredAt:normalizeSheetTimestamp(row.occurredAt)}));
  if(eventRows.some(row=>row.status==='cancelled'&&!String(row.reason??'').trim())){
    throw new ApplicationSourceError('MISSING_CANCELLATION_REASON','신청 취소 이력에는 사유가 필요합니다.');
  }
  if(employeeRows.length>5000||projectRows.length>100||targetRows.length>20000||eventRows.length>50000){
    throw new ApplicationSourceError('SOURCE_TOO_LARGE','예시 시트의 행 수 제한을 넘었습니다.');
  }
  const employees=[];const employeeIds=new Set();const employeeNumbers=new Set();
  for(const [index,row] of employeeRows.entries()){
    const id=Number(row.employeeId),employeeNumber=String(row.employeeNumber??'').trim();
    if(!Number.isSafeInteger(id)||id<=0||employeeIds.has(id)||!employeeNumber||employeeNumbers.has(employeeNumber)||
      !String(row.name??'').trim()||!String(row.team??'').trim()){
      throw new ApplicationSourceError('INVALID_EMPLOYEE_DIRECTORY',`직원명부 ${index+2}행의 식별자·이름·팀을 확인해주세요.`);
    }
    employeeIds.add(id);employeeNumbers.add(employeeNumber);
    employees.push({id,employeeNumber,name:String(row.name).trim(),email:String(row.email??'').trim(),
      division:String(row.division??'').trim(),teamName:String(row.team).trim(),grade:String(row.grade??'').trim(),
      position:String(row.position??'').trim(),employmentType:String(row.employmentType??'').trim(),
      employmentStatus:String(row.employmentStatus??'').trim(),hiredAt:String(row.hiredAt??'').trim(),
      location:String(row.location??'').trim(),managerEmployeeNumber:String(row.managerEmployeeNumber??'').trim()});
  }
  const projects=[];const projectIds=new Set();
  for(const [index,row] of projectRows.entries()){
    const id=String(row.projectId??'').trim(),name=String(row.name??'').trim();
    if(!id||!name||projectIds.has(id))throw new ApplicationSourceError('INVALID_PROJECT_DIRECTORY',`프로젝트 ${index+2}행의 ID·제목을 확인해주세요.`);
    projectIds.add(id);projects.push({id,name});
  }
  const checkedAt=now();
  if(!(checkedAt instanceof Date)||Number.isNaN(checkedAt.getTime()))throw new ApplicationSourceError('INVALID_CLOCK','조회 시각을 확인할 수 없습니다.');
  const applicationSource=normalizeApplicationSource({targetRows,eventRows,
    knownEmployeeIds:employees.map(row=>row.id),knownProjectIds:projects.map(row=>row.id),
    lastSuccessAt:checkedAt.toISOString()});
  return {spreadsheetId,employees,sourceProjects:projects,...applicationSource};
}
