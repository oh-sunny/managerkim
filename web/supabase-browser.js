// Browser-side Supabase Auth and PostgREST. Only the publishable key is exposed.
import {draftStorageId} from './draft-storage-id.js';
const SESSION_KEY = 'office-benefits-supabase-session-v1';
let base = '';
let publishableKey = '';
let session = null;
let refreshing = null;
let authChannel = null;
let authWaiter = null;
const FILE_MIME = {pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg'};
const MAX_NOTICE_FILE = 4_000_000;

const fail = async response => {
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.msg || body.error_description || body.message || body.error || `Supabase 요청 실패 (${response.status})`);
  error.status = response.status;
  error.code = body.code;
  throw error;
};
const save = (value, broadcast = false) => {
  session = value;
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(SESSION_KEY);
  if(broadcast)authChannel?.postMessage({type:value?'session':'signed-out',session:value,base});
};

export function configureSupabase({supabaseUrl, publishableKey: key}) {
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Supabase URL을 확인해주세요.');
  base = url.origin;
  publishableKey = key;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { save(null); }
  if(!authChannel&&typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'){
    authChannel=new BroadcastChannel('office-benefits-auth-v1');
    authChannel.unref?.();
    authChannel.onmessage=event=>{
      const message=event.data;
      if(message?.base!==base)return;
      if(message?.type==='request-session'&&session)authChannel.postMessage({type:'session',session,base});
      if(message?.type==='session'&&message.session?.access_token&&(!session||Number(message.session.expires_at)>Number(session.expires_at))){
        save(message.session);
        authWaiter?.();authWaiter=null;
        window.dispatchEvent(new CustomEvent('office-benefits-auth-updated',{detail:{signedIn:true}}));
      }
      if(message?.type==='signed-out'){
        save(null);authWaiter?.();authWaiter=null;
        window.dispatchEvent(new CustomEvent('office-benefits-auth-updated',{detail:{signedIn:false}}));
      }
    };
  }
}

async function authRequest(path, options = {}) {
  const response = await fetch(`${base}/auth/v1/${path}`, {
    ...options,
    headers: {apikey: publishableKey, 'Content-Type': 'application/json', ...options.headers},
    cache: 'no-store',
  });
  if (!response.ok) await fail(response);
  return response.status === 204 ? null : response.json();
}

async function refresh() {
  if (!session?.refresh_token) throw new Error('다시 로그인해주세요.');
  if (!refreshing) refreshing = authRequest('token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({refresh_token: session.refresh_token}),
  }).then(next => { save(next,true); return next; }).catch(error => { if ([400, 401, 403].includes(error.status)) save(null,true); throw error; }).finally(() => { refreshing = null; });
  return refreshing;
}

export async function restoreSupabaseUser() {
  if(!session?.access_token&&authChannel){
    await new Promise(resolve=>{
      authWaiter=resolve;authChannel.postMessage({type:'request-session',base});
      setTimeout(()=>{if(authWaiter===resolve)authWaiter=null;resolve();},400);
    });
  }
  if (!session?.access_token) return null;
  try {
    const token = await accessToken();
    const user = await authRequest('user', {headers: {Authorization: `Bearer ${token}`}});
    return {id: user.id, email: user.email};
  } catch (error) {
    if ([400, 401, 403].includes(error.status)) { save(null,true); return null; }
    throw error;
  }
}

export async function signInSupabase(email, password) {
  const next = await authRequest('token?grant_type=password', {
    method: 'POST', body: JSON.stringify({email, password}),
  });
  save(next,true);
  return {id: next.user.id, email: next.user.email};
}

export async function signOutSupabase() {
  try { if (session?.access_token) await authRequest('logout', {method: 'POST', headers: {Authorization: `Bearer ${session.access_token}`}}); }
  finally { save(null,true); }
}

export async function accessToken() {
  if (!session?.access_token) throw Object.assign(new Error('관리자 계정으로 로그인해주세요.'), {status: 401});
  if (Date.now() + 60_000 >= (session.expires_at || 0) * 1000) await refresh();
  return session.access_token;
}

export async function supabaseRequest(path, {method = 'GET', body, headers = {}} = {}) {
  const send = async token => fetch(`${base}${path}`, {
    method,
    headers: {apikey: publishableKey, Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': body instanceof Blob ? body.type : 'application/json'}), ...headers},
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    cache: 'no-store',
  });
  let response = await send(await accessToken());
  if (response.status === 401 && session?.refresh_token) response = await send((await refresh()).access_token);
  if (!response.ok) await fail(response);
  return response.status === 204 ? null : response.json();
}

export async function readOperatorState() {
  const rows = await supabaseRequest('/rest/v1/operator_states?select=payload,version,updated_at&limit=1');
  return {state: rows[0] || null};
}

export async function saveOperatorState(expectedVersion, data) {
  try {
    const result = await supabaseRequest('/rest/v1/rpc/save_operator_state', {
      method: 'POST', body: {p_expected_version: expectedVersion, p_payload: data},
    });
    return {version: result.version, updated_at: result.updated_at};
  } catch (error) {
    if (error.message === 'operator_state_conflict') {
      error.status = 409;
      error.current = (await readOperatorState()).state;
    }
    throw error;
  }
}

export async function readSheetSnapshot() {
  const rows = await supabaseRequest('/rest/v1/sheet_sync_snapshots?select=payload,last_success_at&limit=1');
  return rows[0] || null;
}

export async function readLatestSheetSyncRun() {
  const rows = await supabaseRequest('/rest/v1/sheet_sync_runs?select=status,error_code,source_checked_at,blocked_count,evaluated_count&order=finished_at.desc,id.desc&limit=1');
  return rows[0] || null;
}

export async function readAutomationTickets() {
  return supabaseRequest('/rest/v1/automation_tickets?select=payload,state&limit=1000');
}

export async function readDrafts() {
  const drafts = await supabaseRequest('/rest/v1/notice_drafts?select=id,payload,version,updated_at&order=updated_at.desc');
  return {drafts};
}

export async function readDraft(id) {
  const storedId = await draftStorageId(id);
  const rows = await supabaseRequest(`/rest/v1/notice_drafts?id=eq.${encodeURIComponent(storedId)}&select=id,payload,version,updated_at&limit=1`);
  if (!rows[0]) throw Object.assign(new Error('저장된 초안이 없습니다.'), {status: 404});
  return rows[0];
}

export async function saveDraft(id, expectedVersion, data) {
  try {
    const storedId = await draftStorageId(id);
    return await supabaseRequest('/rest/v1/rpc/save_notice_draft', {
      method: 'POST', body: {p_id: storedId, p_expected_version: expectedVersion, p_payload: data},
    });
  } catch (error) {
    if (error.message === 'draft_conflict') {
      error.status = 409;
      error.current = await readDraft(id).catch(() => null);
    }
    throw error;
  }
}

export async function createFileUrl(id) {
  const rows = await supabaseRequest(`/rest/v1/notice_resources?id=eq.${encodeURIComponent(id)}&kind=eq.file&select=storage_path&limit=1`);
  if (!rows[0]) throw new Error('첨부 파일을 찾지 못했습니다.');
  const path = rows[0].storage_path.split('/').map(encodeURIComponent).join('/');
  const result = await supabaseRequest(`/storage/v1/object/sign/notice-files/${path}`, {method: 'POST', body: {expiresIn: 60}});
  return `${base}/storage/v1${result.signedURL}`;
}

export async function uploadNoticeResource(file, ownerId) {
  const name = String(file?.name || '').replace(/[\\/\x00-\x1f]/g, '').trim();
  const extension = name.toLowerCase().split('.').pop();
  const mimeType = FILE_MIME[extension];
  if (!name || name.length > 160 || !mimeType) throw new Error('PDF, DOCX, TXT, MD, PNG, JPG 파일만 저장할 수 있습니다.');
  if (!file.size) throw new Error('빈 파일은 저장할 수 없습니다.');
  if (file.size > MAX_NOTICE_FILE) throw new Error('4MB 이하 파일을 선택해주세요.');
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new Error('다시 로그인해주세요.');

  const id = crypto.randomUUID();
  const storagePath = `${ownerId}/${id}`;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const uploadPath = `/storage/v1/object/notice-files/${storagePath}`;
  await supabaseRequest(uploadPath, {method: 'POST', body: file, headers: {'Content-Type': mimeType, 'x-upsert': 'false'}});
  try {
    const rows = await supabaseRequest('/rest/v1/notice_resources', {
      method: 'POST',
      body: {id, owner_id: ownerId, kind: 'file', label: name, storage_path: storagePath, original_filename: name, mime_type: mimeType, byte_size: file.size, sha256},
      headers: {Prefer: 'return=representation'},
    });
    if (!rows?.[0]) throw new Error('파일 기록을 저장하지 못했습니다.');
    return rows[0];
  } catch (error) {
    await supabaseRequest(uploadPath, {method: 'DELETE'}).catch(() => {});
    throw error;
  }
}
