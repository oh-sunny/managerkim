import {readGoogleSheetsWorkspaceSource} from '../_shared/google-sheets-source.mjs';
import {createPublicHolidayCalendar} from '../_shared/public-holidays.mjs';
import {buildScheduledSync} from '../_shared/sheet-sync-core.mjs';
import {syncCorsHeaders} from '../_shared/sync-cors.mjs';

const json = (status: number, value: unknown, cors: Record<string, string> | null = null) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors},
});
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} 환경 변수가 없습니다.`);
  return value;
};
const serviceHeaders = (key: string) => ({apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'});

async function serviceRequest(base: string, key: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options, headers: {...serviceHeaders(key), ...options.headers}, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Supabase 저장/조회 실패 (${response.status}): ${(await response.text()).slice(0, 180)}`);
  return response.status === 204 ? null : response.json();
}

let googleToken: {value: string; expiresAt: number} | null = null;
async function googleAccessToken() {
  if (googleToken && Date.now() < googleToken.expiresAt - 60000) return googleToken.value;
  const pem = required('GOOGLE_SHEETS_PRIVATE_KEY').replace(/\\n/g, '\n');
  const bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const now = Math.floor(Date.now() / 1000);
  const content = `${encode({alg: 'RS256', typ: 'JWT'})}.${encode({iss: required('GOOGLE_SHEETS_CLIENT_EMAIL'),
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600})}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(content));
  const signed = `${content}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signed}),
    signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Google 인증 실패 (${response.status})`);
  const body = await response.json();
  googleToken = {value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
  return googleToken.value;
}

type OperatorState = {owner_id: string; version: number; payload: {projects: Array<{
  id: string; deadlineAt?: string; dataKind?: string
}>}};

async function operatorStates(base: string, key: string, ownerId: string | null): Promise<OperatorState[]> {
  if (ownerId) return await serviceRequest(base, key,
    `/rest/v1/operator_states?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id,version,payload&limit=1`);
  const states: OperatorState[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await serviceRequest(base, key,
      `/rest/v1/operator_states?select=owner_id,version,payload&order=owner_id&limit=500&offset=${offset}`);
    states.push(...page);
    if (page.length < 500) return states;
  }
}

async function automationTickets(base: string, key: string, ownerId: string) {
  const tickets = [];
  for (let offset = 0; ; offset += 500) {
    const page = await serviceRequest(base, key,
      `/rest/v1/automation_tickets?owner_id=eq.${encodeURIComponent(ownerId)}&select=payload&order=key&limit=500&offset=${offset}`);
    tickets.push(...page.map((row: {payload: unknown}) => row.payload));
    if (page.length < 500) return tickets;
  }
}

async function holidayCalendar(states: OperatorState[]) {
  const years = [...new Set(states.flatMap(state => state.payload.projects.flatMap(project => {
    const year = Number(project.deadlineAt?.slice(0, 4));
    return Number.isInteger(year) && year > 2000 ? [year - 1, year] : [];
  })))];
  try {
    const adapter = createPublicHolidayCalendar();
    const calendars = [];
    for (let index = 0; index < years.length; index += 4) calendars.push(await adapter.get(years.slice(index, index + 4)));
    return {status: 'success', holidays: [...new Set(calendars.flatMap(item => item.holidays))]};
  } catch {
    return {status: 'error', holidays: []};
  }
}

async function sourceHash(source: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(source)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function evaluateOwner(base: string, key: string, state: OperatorState, calendar: unknown) {
  const ownerId = state.owner_id;
  const sheetOwnerId = Deno.env.get('SYNC_OWNER_ID');
  let source = null;
  let sourceError: string | null = null;
  if (sheetOwnerId && ownerId === sheetOwnerId) {
    try {
      source = await readGoogleSheetsWorkspaceSource({spreadsheetId: required('GOOGLE_SHEETS_SPREADSHEET_ID'),
        accessToken: await googleAccessToken()});
      if (source?.sync?.status !== 'success') { source = null; sourceError = 'sheet-read-invalid'; }
    } catch {
      sourceError = 'sheet-read-failed';
    }
  } else if (state.payload.projects.some(project => project.dataKind === 'sheet')) {
    sourceError = 'sheet-owner-unconfigured';
  }
  const previousTickets = await automationTickets(base, key, ownerId);
  const result = buildScheduledSync({source, sourceError, operatorState: state,
    previousTickets, calendar});
  const errorCode = sourceError || result.issues[0]?.code || null;
  const saved = await serviceRequest(base, key, '/rest/v1/rpc/commit_scheduled_evaluation', {method: 'POST',
    body: JSON.stringify({p_owner_id: ownerId, p_expected_version: state.version,
      p_snapshot: source, p_source_hash: source ? await sourceHash(source) : null,
      p_tickets: result.tickets, p_retired_keys: result.retiredKeys,
      p_source_status: result.sourceStatus, p_error_code: errorCode,
      p_evaluated_count: result.evaluatedCount, p_blocked_count: result.blockedCount})});
  return {ownerId, status: errorCode ? 'error' : 'success', sourceStatus: result.sourceStatus,
    lastSuccessAt: result.sourceCheckedAt, employees: source?.employees.length ?? null,
    events: source?.events.length ?? null, evaluatedProjects: result.evaluatedCount,
    blockedDecisions: result.blockedCount, errorCode, ...saved};
}

async function run(ownerId: string | null) {
  const base = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const states = await operatorStates(base, key, ownerId);
  if (ownerId && !states.length) throw new Error('운영 정보가 없습니다. 먼저 웹앱에서 로그인해 프로젝트를 저장해주세요.');
  const calendar = await holidayCalendar(states);
  const results = [];
  for (const state of states) {
    try { results.push(await evaluateOwner(base, key, state, calendar)); }
    catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
      console.error('sync-sheets owner:', state.owner_id, code);
      try {
        await serviceRequest(base, key, '/rest/v1/sheet_sync_runs', {method: 'POST',
          headers: {'Prefer': 'return=minimal'},
          body: JSON.stringify({owner_id: state.owner_id, status: 'error', error_code: 'scheduled-commit-failed'})});
      } catch { /* The next scheduled execution will retry. */ }
      results.push({ownerId: state.owner_id, status: 'error', errorCode: 'scheduled-commit-failed'});
    }
  }
  return ownerId ? results[0] : {owners: results.length, results};
}

Deno.serve(async request => {
  const cors = syncCorsHeaders(request.headers.get('origin'),
    Deno.env.get('SYNC_BROWSER_ORIGIN') || Deno.env.get('NEXT_PUBLIC_SITE_URL'));
  if (request.method === 'OPTIONS') return new Response(null, {status: cors ? 204 : 403, headers: cors || {}});
  if (request.headers.has('origin') && !cors) return json(403, {error: '허용되지 않은 출처입니다.'});
  if (request.method !== 'POST') return json(405, {error: 'POST 요청만 허용합니다.'}, cors);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronKey = Deno.env.get('SYNC_CRON_SERVICE_KEY');
  const bearer = request.headers.get('authorization') || '';
  if (!key) return json(503, {error: '동기화 서비스 설정이 없습니다.'}, cors);
  let ownerId: string | null = null;
  if (bearer !== `Bearer ${key}` && (!cronKey || bearer !== `Bearer ${cronKey}`)) {
    const base = Deno.env.get('SUPABASE_URL');
    if (!base || !bearer.startsWith('Bearer ')) return json(401, {error: '로그인이 필요합니다.'}, cors);
    const response = await fetch(`${base}/auth/v1/user`, {headers: {apikey: key, Authorization: bearer}});
    const user = response.ok ? await response.json() : null;
    if (!user?.id) return json(403, {error: '동기화 권한이 없습니다.'}, cors);
    ownerId = user.id;
  }
  try {
    const result = await run(ownerId);
    const manualSourceFailure = ownerId && result && 'sourceStatus' in result && result.sourceStatus === 'error';
    const commitFailure = ownerId && result && 'errorCode' in result && result.errorCode === 'scheduled-commit-failed';
    return json(manualSourceFailure || commitFailure ? 503 : 200, result, cors);
  }
  catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
    console.error('sync-sheets:', code);
    return json(500, {error: '시트 동기화에 실패했습니다. Edge Function 로그를 확인해주세요.'}, cors);
  }
});
