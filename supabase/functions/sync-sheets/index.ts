import {readGoogleSheetsWorkspaceSource} from '../_shared/google-sheets-source.mjs';
import {createPublicHolidayCalendar} from '../_shared/public-holidays.mjs';
import {buildScheduledSync} from '../_shared/sheet-sync-core.mjs';

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'},
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

async function run() {
  const base = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const owner = required('SYNC_OWNER_ID');
  const spreadsheetId = required('GOOGLE_SHEETS_SPREADSHEET_ID');
  const states = await serviceRequest(base, key, `/rest/v1/operator_states?owner_id=eq.${encodeURIComponent(owner)}&select=payload&limit=1`);
  if (!states[0]) throw new Error('SYNC_OWNER_ID 계정의 운영 정보가 없습니다. 먼저 웹앱에서 로그인해 프로젝트를 저장해주세요.');
  const source = await readGoogleSheetsWorkspaceSource({spreadsheetId, accessToken: await googleAccessToken()});
  const years = [...new Set(source.sourceProjects.flatMap(item => {
    const year = Number(states[0].payload.projects.find((project: {id: string}) => project.id === item.id)?.deadlineAt?.slice(0, 4));
    return Number.isInteger(year) && year > 2000 ? [year - 1, year] : [];
  }))];
  const holidayAdapter = createPublicHolidayCalendar();
  const calendars = [];
  for (let index = 0; index < years.length; index += 4) calendars.push(await holidayAdapter.get(years.slice(index, index + 4)));
  const calendar = {status: 'success', holidays: [...new Set(calendars.flatMap(item => item.holidays))]};
  const rows = await serviceRequest(base, key, `/rest/v1/automation_tickets?owner_id=eq.${encodeURIComponent(owner)}&select=payload&limit=1000`);
  const result = buildScheduledSync({source, operatorState: states[0], previousTickets: rows.map((row: {payload: unknown}) => row.payload), calendar});
  const sourceContent = JSON.stringify([source.employees, source.sourceProjects, source.projectTargets, source.events]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceContent));
  const sourceHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const saved = await serviceRequest(base, key, '/rest/v1/rpc/commit_sheet_sync', {method: 'POST',
    body: JSON.stringify({p_owner_id: owner, p_snapshot: source, p_source_hash: sourceHash,
      p_tickets: result.tickets, p_retired_keys: result.retiredKeys})});
  return {lastSuccessAt: source.sync.lastSuccessAt, employees: source.employees.length,
    events: source.events.length, ...saved};
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, {error: 'POST 요청만 허용합니다.'});
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = request.headers.get('authorization') || '';
  if (!key) return json(503, {error: '동기화 서비스 설정이 없습니다.'});
  if (bearer !== `Bearer ${key}`) {
    const base = Deno.env.get('SUPABASE_URL');
    if (!base || !bearer.startsWith('Bearer ')) return json(401, {error: '로그인이 필요합니다.'});
    const response = await fetch(`${base}/auth/v1/user`, {headers: {apikey: key, Authorization: bearer}});
    const user = response.ok ? await response.json() : null;
    if (!user?.id || user.id !== Deno.env.get('SYNC_OWNER_ID')) return json(403, {error: '동기화 권한이 없습니다.'});
  }
  try { return json(200, await run()); }
  catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
    console.error('sync-sheets:', code);
    try {
      const base = required('SUPABASE_URL');
      await serviceRequest(base, key, '/rest/v1/sheet_sync_runs', {method: 'POST', headers: {'Prefer': 'return=minimal'},
        body: JSON.stringify({owner_id: required('SYNC_OWNER_ID'), status: 'error', error_code: code})});
    } catch (logError) { console.error('sync-sheets log:', logError); }
    return json(500, {error: '시트 동기화에 실패했습니다. Edge Function 로그를 확인해주세요.'});
  }
});
