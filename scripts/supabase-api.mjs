import { createHash, randomUUID } from 'node:crypto';
import {BRIEF_FIELDS} from './notice-generation.mjs';
import {buildSendPlan,SendPlanError} from './send-plan.mjs';
import {sheetSendSnapshot} from '../prototype/send-preflight.js';

const MIME = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
const MAX_JSON = 120_000;
const MAX_FILE = 4_000_000;
const draftIdOk = id => /^[a-z0-9-]{1,100}$/i.test(id);
const uuidOk = id => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
const json = (res,status,value) => {
  const body=Buffer.from(JSON.stringify(value));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(body);
};
const cookie = (req,name) => {
  const part=String(req.headers.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(`${name}=`));
  try{return part?decodeURIComponent(part.slice(name.length+1)):'';}catch{return '';}
};
const secureCookie = process.env.VERCEL ? '; Secure' : '';
const setCookies = (res,session) => {
  const maxAge=Math.max(1,Math.min(Number(session.expires_in)||3600,3600));
  res.setHeader('Set-Cookie',[
    `sb_access=${encodeURIComponent(session.access_token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secureCookie}`,
    `sb_refresh=${encodeURIComponent(session.refresh_token)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000${secureCookie}`,
  ]);
};
const clearCookies = res => res.setHeader('Set-Cookie',[
  `sb_access=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secureCookie}`,
  `sb_refresh=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secureCookie}`,
]);
async function bytes(req,max) {
  if (req.body !== undefined) {
    const body = Buffer.isBuffer(req.body) ? req.body
      : typeof req.body === 'string' ? Buffer.from(req.body)
      : req.body instanceof Uint8Array ? Buffer.from(req.body)
      : Buffer.from(JSON.stringify(req.body));
    if (body.length > max) throw Object.assign(new Error('요청 크기 제한을 넘었습니다.'), { status: 413 });
    return body;
  }
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>max)throw Object.assign(new Error('요청 크기 제한을 넘었습니다.'),{status:413});chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const validDraft = data => data && typeof data==='object' && !Array.isArray(data) &&
  typeof data.body==='string' && data.body.length<=20000 &&
  (data.purpose===undefined || ['initial','reminder','deadline'].includes(data.purpose)) &&
  ['friendly','concise','action'].includes(data.tone) && ['dm','channel'].includes(data.mode) &&
  ['pending','project','company'].includes(data.scope) && ['team','people'].includes(data.dmSelection) &&
  Array.isArray(data.teams) && data.teams.length<=20 && data.teams.every(item=>typeof item==='string') &&
  Array.isArray(data.selectedIds) && data.selectedIds.length<=160 && data.selectedIds.every(Number.isInteger) &&
  Array.isArray(data.channels) && data.channels.length<=20 && data.channels.every(item=>typeof item==='string') &&
  (!data.resources || Array.isArray(data.resources) && data.resources.length<=20) &&
  (data.briefStale===undefined||typeof data.briefStale==='boolean') &&
  (!data.brief || typeof data.brief==='object' && BRIEF_FIELDS.every(key=>
    data.brief[key] && typeof data.brief[key].value==='string' && data.brief[key].value.length<=2000 &&
    typeof data.brief[key].included==='boolean' && typeof data.brief[key].source==='string'));

export function createSupabaseApi({url='',key='',serviceKey='',fetcher=fetch,analyzer=null,noticeGenerator=null,holidayCalendar=null,sheetService=null,slackDm=null}={}) {
  const analyzing = new Set();
  const generating = new Set();
  let base='';
  try {const parsed=new URL(url);if(parsed.protocol==='https:'||parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname))base=parsed.origin;} catch {}
  const configured=Boolean(base && key && !key.includes('your_key'));
  const upstream=async(path,options={},token='')=>{
    const headers={apikey:key,...options.headers};
    if(token)headers.Authorization=`Bearer ${token}`;
    return fetcher(`${base}${path}`,{...options,headers,signal:AbortSignal.timeout(15000)});
  };
  const adminUpstream=async(path,options={})=>fetcher(`${base}${path}`,{
    ...options,headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,...options.headers},signal:AbortSignal.timeout(15000),
  });
  const readUpstream=async response=>{
    const contentType=response.headers.get('content-type')||'';
    const raw=await response.text();
    return contentType.includes('json')&&raw?JSON.parse(raw):raw;
  };
  async function authenticated(req,res) {
    let token=cookie(req,'sb_access');
    if(token){
      const response=await upstream('/auth/v1/user',{},token);
      if(response.ok)return {token,user:await readUpstream(response)};
    }
    const refresh=cookie(req,'sb_refresh');
    if(refresh){
      const response=await upstream('/auth/v1/token?grant_type=refresh_token',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refresh}),
      });
      if(response.ok){
        const session=await readUpstream(response);setCookies(res,session);token=session.access_token;
        const userResponse=await upstream('/auth/v1/user',{},token);
        if(userResponse.ok)return {token,user:await readUpstream(userResponse)};
      }
    }
    clearCookies(res);return null;
  }
  const currentDraft=async(id,token)=>{
    const response=await upstream(`/rest/v1/notice_drafts?id=eq.${encodeURIComponent(id)}&select=id,payload,version,updated_at&limit=1`,{},token);
    if(!response.ok)throw new Error(`Supabase 초안 조회 실패 (${response.status})`);
    return (await readUpstream(response))[0]||null;
  };
  const currentState=async(token)=>{
    const response=await upstream('/rest/v1/operator_states?select=payload,version,updated_at&limit=1',{},token);
    if(!response.ok)throw new Error(`Supabase 운영 상태 조회 실패 (${response.status})`);
    return (await readUpstream(response))[0]||null;
  };
  const sendRow=async(table,filter,token)=>{
    const response=await upstream(`/rest/v1/${table}?${filter}&select=*&limit=1`,{},token);
    if(!response.ok)throw new Error(`${table} 조회 실패 (${response.status})`);
    return (await readUpstream(response))[0]||null;
  };
  const sendResults=async(id,token)=>{
    const response=await upstream(`/rest/v1/send_results?attempt_id=eq.${id}&select=employee_id,status,stage,reason,slack_user_id,channel_id,slack_ts,recorded_at&order=recorded_at.asc`,{},token);
    if(!response.ok)throw new Error('발송 결과를 읽지 못했습니다.');
    return await readUpstream(response);
  };
  const sendSummary=async(attempt,approval,token)=>{
    const rows=await sendResults(attempt.id,token),recipients=approval.payload.recipients;
    const byId=new Map(rows.map(row=>[row.employee_id,row]));
    const results=recipients.map(({employeeId,name,email})=>{
      const row=byId.get(employeeId);
      return {employeeId,name,email,status:row?.status||'unknown',stage:row?.stage||'unrecorded',reason:row?.reason||null,
        slackTs:row?.slack_ts||null};
    });
    const status=results.every(row=>row.status==='success')?'full_success':results.some(row=>row.status==='unknown')?'unknown':
      results.every(row=>row.status==='failed')?'failed':'partial';
    return {attemptId:attempt.id,approvalId:approval.id,status,results,createdAt:attempt.created_at,
      sourceCheckedAt:attempt.source_checked_at};
  };
  const loadPlan=async(input,token)=>{
    if(!draftIdOk(input?.draftId)||!Number.isInteger(input?.draftVersion)||input.draftVersion<1||
       !Number.isInteger(input?.stateVersion)||input.stateVersion<1)throw new SendPlanError(400,'초안 ID와 저장 버전을 확인해주세요.');
    const [draft,state]=await Promise.all([currentDraft(input.draftId,token),currentState(token)]);
    return {plan:buildSendPlan({draft,state,draftId:input.draftId,draftVersion:input.draftVersion,stateVersion:input.stateVersion}),state};
  };
  const checkFreshSheet=async(plan,state)=>{
    if(!sheetService?.configured)throw new SendPlanError(503,'Google Sheets 연결을 설정해주세요.');
    let source;
    try{source=await sheetService.read();}catch{throw new SendPlanError(502,'Google Sheets의 최신 신청 현황을 읽지 못해 발송을 중단했습니다.');}
    if(source.spreadsheetId!==plan.spreadsheetId)throw new SendPlanError(409,'승인한 Google Sheets 원본과 현재 원본이 다릅니다.');
    const teamByName=new Map();
    for(const employee of state.payload.employees){
      if(employee.teamName&&employee.team){
        if(teamByName.has(employee.teamName)&&teamByName.get(employee.teamName)!==employee.team)throw new SendPlanError(409,'팀 정보를 확인할 수 없습니다.');
        teamByName.set(employee.teamName,employee.team);
      }
    }
    // The current client supports four known team IDs. Derive the mapping from
    // saved imported roster, never from caller-supplied names.
    if(!teamByName.size)throw new SendPlanError(409,'저장된 직원명부에 시트 팀 정보가 없습니다. 다시 가져와주세요.');
    let latest;
    try{latest=sheetSendSnapshot(source,plan.projectId,teamByName,
      (state.payload.applicationEvents||[]).filter(event=>event.projectId===plan.projectId&&event.source!=='sheet'&&!String(event.id||'').startsWith('sheet:')));}
    catch{throw new SendPlanError(409,'Google Sheets의 대상·신청 현황을 확인할 수 없습니다.');}
    if(latest!==plan.sourceSnapshot)throw new SendPlanError(409,'신청 현황이나 대상 명단이 바뀌었습니다. 시트를 다시 가져온 뒤 승인해주세요.');
    const currentEmail=new Map(source.employees.map(person=>[person.id,String(person.email||'').trim().toLowerCase()]));
    if(plan.recipients.some(person=>currentEmail.get(person.employeeId)!==person.email)){
      throw new SendPlanError(409,'수신자의 회사 이메일이 바뀌었습니다. 시트를 다시 가져온 뒤 승인해주세요.');
    }
    return source.sync.lastSuccessAt;
  };

  return async function handleApi(req,res,pathname) {
    try {
      if(pathname==='/api/status' && req.method==='GET'){json(res,200,{configured});return;}
      if(pathname==='/api/sheets/status' && req.method==='GET'){
        json(res,200,{configured:sheetService?.configured===true,spreadsheetId:sheetService?.spreadsheetId||null});return;
      }
      if(!configured){json(res,503,{error:'서버 환경 변수 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 설정해주세요.'});return;}
      if(req.method!=='GET' && req.method!=='HEAD'){
        const origin=req.headers.origin;
        const hostname=String(req.headers.host||'');
        const allowedOrigins=new Set([`https://${hostname}`]);
        if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostname)) allowedOrigins.add(`http://${hostname}`);
        if(origin && !allowedOrigins.has(origin)){json(res,403,{error:'다른 출처의 요청은 허용되지 않습니다.'});return;}
      }
      if(pathname==='/api/auth/login' && req.method==='POST'){
        const input=JSON.parse((await bytes(req,3000)).toString('utf8'));
        if(typeof input.email!=='string'||typeof input.password!=='string'||input.email.length>254||input.password.length>500){json(res,400,{error:'이메일과 비밀번호를 확인해주세요.'});return;}
        const response=await upstream('/auth/v1/token?grant_type=password',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:input.email,password:input.password}),
        });
        if(!response.ok){json(res,401,{error:'로그인에 실패했습니다. 계정과 비밀번호를 확인해주세요.'});return;}
        const session=await readUpstream(response);setCookies(res,session);
        json(res,200,{user:{id:session.user?.id,email:session.user?.email}});return;
      }
      if(pathname==='/api/auth/logout' && req.method==='POST'){
        const token=cookie(req,'sb_access');
        if(token)await upstream('/auth/v1/logout',{method:'POST'},token).catch(()=>{});
        clearCookies(res);json(res,200,{signedOut:true});return;
      }
      const auth=await authenticated(req,res);
      if(!auth){json(res,401,{error:'Supabase 계정으로 로그인해주세요.'});return;}
      if(pathname==='/api/auth/session' && req.method==='GET'){
        json(res,200,{user:{id:auth.user.id,email:auth.user.email}});return;
      }
      if(['/api/send/preview','/api/send/approve','/api/send/attempts'].includes(pathname)){
        if(req.method!=='POST'){json(res,405,{error:'POST 요청을 사용해주세요.'});return;}
        if(!String(req.headers['content-type']||'').includes('application/json')){json(res,415,{error:'JSON 요청이 필요합니다.'});return;}
        const input=JSON.parse((await bytes(req,3000)).toString('utf8'));
        if(pathname==='/api/send/preview'){
          const {plan}=await loadPlan(input,auth.token);
          json(res,200,{fingerprint:plan.fingerprint,draftId:plan.draftId,ticketId:plan.ticketId,projectId:plan.projectId,
            draftVersion:plan.draftVersion,stateVersion:plan.stateVersion,body:plan.body,recipients:plan.recipients,
            sourceCheckedAt:plan.sourceCheckedAt});return;
        }
        if(pathname==='/api/send/approve'){
          if(!serviceKey){json(res,503,{error:'Supabase 서버 키를 설정해주세요.'});return;}
          if(input.acknowledged!==true||!uuidOk(input.approvalId)||!/^[a-f0-9]{64}$/.test(input.fingerprint||'')){
            json(res,400,{error:'승인 ID와 최종 확인 내용을 확인해주세요.'});return;
          }
          const {plan}=await loadPlan(input,auth.token);
          if(plan.fingerprint!==input.fingerprint){json(res,409,{error:'본문이나 수신자가 바뀌었습니다. 미리보기를 다시 확인해주세요.'});return;}
          const response=await adminUpstream('/rest/v1/send_approvals',{
            method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},
            body:JSON.stringify({id:input.approvalId,owner_id:auth.user.id,payload:plan}),
          });
          if(!response.ok){json(res,response.status===409?409:502,{error:'발송 승인을 저장하지 못했습니다.'});return;}
          json(res,201,{approvalId:input.approvalId,fingerprint:plan.fingerprint});return;
        }
        if(!uuidOk(input?.approvalId)||!uuidOk(input?.requestId)){json(res,400,{error:'승인 ID와 요청 ID를 확인해주세요.'});return;}
        const approval=await sendRow('send_approvals',`id=eq.${input.approvalId}`,auth.token);
        if(!approval){json(res,404,{error:'저장된 발송 승인이 없습니다.'});return;}
        const existing=await sendRow('send_attempts',`approval_id=eq.${input.approvalId}`,auth.token);
        if(existing){
          if(existing.id!==input.requestId){json(res,409,{error:'이 승인은 이미 다른 요청으로 사용됐습니다. 결과를 확인해주세요.',attemptId:existing.id});return;}
          json(res,200,await sendSummary(existing,approval,auth.token));return;
        }
        const ticketAttempt=await sendRow('send_attempts',`ticket_id=eq.${encodeURIComponent(approval.ticket_id||approval.payload.ticketId)}`,auth.token);
        if(ticketAttempt){json(res,409,{error:'이 확인할 일은 이미 발송을 시도했습니다. 결과를 확인해주세요.',attemptId:ticketAttempt.id});return;}
        if(!slackDm?.configured||!serviceKey){json(res,503,{error:'Slack 봇 토큰과 Supabase 서버 키를 설정해주세요.'});return;}
        const stored=approval.payload;
        const {plan,state}=await loadPlan(stored,auth.token);
        if(plan.fingerprint!==stored.fingerprint){json(res,409,{error:'승인 후 초안이나 운영 정보가 바뀌었습니다. 다시 확인해주세요.'});return;}
        const sourceCheckedAt=await checkFreshSheet(plan,state);
        const claim=await adminUpstream('/rest/v1/rpc/claim_send_attempt',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({p_owner_id:auth.user.id,p_id:input.requestId,p_approval_id:input.approvalId,p_source_checked_at:sourceCheckedAt}),
        });
        if(!claim.ok){json(res,502,{error:'발송 요청을 기록하지 못해 전송을 시작하지 않았습니다.'});return;}
        if(await readUpstream(claim)!==true){
          const claimed=await sendRow('send_attempts',`approval_id=eq.${input.approvalId}`,auth.token);
          if(claimed?.id===input.requestId){json(res,200,await sendSummary(claimed,approval,auth.token));return;}
          const competing=claimed||await sendRow('send_attempts',`ticket_id=eq.${encodeURIComponent(plan.ticketId)}`,auth.token);
          json(res,409,{error:'이 확인할 일은 이미 다른 요청으로 발송을 시도했습니다.',attemptId:competing?.id||null});return;
        }
        // An attempt is claimed once. Never repeat an uncertain Slack call.
        for(const person of plan.recipients){
          let result;
          try{result=await slackDm.sendText({email:person.email,body:plan.body});}
          catch{result={status:'unknown',stage:'provider',reason:'provider_exception'};}
          const outcome=['success','failed','unknown'].includes(result?.status)?result:{status:'unknown',stage:'provider',reason:'invalid_result'};
          const saved=await adminUpstream('/rest/v1/rpc/record_send_result',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({p_owner_id:auth.user.id,p_attempt_id:input.requestId,p_employee_id:person.employeeId,p_status:outcome.status,
              p_stage:outcome.stage||'provider',p_reason:outcome.reason||null,p_slack_user_id:outcome.slackUserId||null,
              p_channel_id:outcome.channelId||null,p_slack_ts:outcome.ts||null}),
          });
          if(!saved.ok){json(res,502,{error:'발송 결과 저장에 실패했습니다. 누락된 결과는 불명으로 취급하고 자동 재전송하지 마세요.',attemptId:input.requestId});return;}
        }
        const attempt={id:input.requestId,created_at:new Date().toISOString(),source_checked_at:sourceCheckedAt};
        json(res,200,await sendSummary(attempt,approval,auth.token));return;
      }
      if(pathname==='/api/sheets/sync'){
        if(req.method!=='POST'){json(res,405,{error:'POST 요청을 사용해주세요.'});return;}
        if(!sheetService?.configured){json(res,503,{error:'Google Sheets 읽기 계정과 스프레드시트 ID를 서버에 설정해주세요.'});return;}
        try{json(res,200,await sheetService.read());}
        catch(error){json(res,502,{error:error?.code?error.message:'Google Sheets를 읽지 못했습니다. 시트 공유 권한과 서버 설정을 확인해주세요.'});}
        return;
      }
      if(pathname==='/api/state'){
        if(req.method==='GET'){json(res,200,{state:await currentState(auth.token)});return;}
        if(req.method!=='PUT'){json(res,405,{error:'GET 또는 PUT 요청을 사용해주세요.'});return;}
        const input=JSON.parse((await bytes(req,2_200_000)).toString('utf8'));
        const payload=input?.data;
        if(!Number.isInteger(input?.expectedVersion)||input.expectedVersion<0||!payload||typeof payload!=='object'||Array.isArray(payload)||
          !Array.isArray(payload.projects)||!Array.isArray(payload.applications)||!Array.isArray(payload.applicationEvents)||
          !Array.isArray(payload.records)||!Array.isArray(payload.tickets)||!payload.completed||typeof payload.completed!=='object'||
          payload.projects.length>100||payload.applications.length>20000||payload.records.length>1000||payload.tickets.length>1000){
          json(res,400,{error:'운영 상태 형식과 버전을 확인해주세요.'});return;
        }
        const response=await upstream('/rest/v1/rpc/save_operator_state',{
          method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({p_expected_version:input.expectedVersion,p_payload:payload}),
        },auth.token);
        const result=await readUpstream(response);
        if(!response.ok&&result?.message==='operator_state_conflict'){
          json(res,409,{error:'다른 탭에서 운영 정보가 변경되었습니다.',current:await currentState(auth.token)});return;
        }
        json(res,response.ok?200:502,response.ok?{version:result.version,updated_at:result.updated_at}:{error:'운영 정보를 서버에 저장하지 못했습니다.'});return;
      }
      if(pathname==='/api/holidays' && req.method==='POST'){
        if(!holidayCalendar?.configured){json(res,503,{error:'공휴일 달력을 사용할 수 없습니다.'});return;}
        const input=JSON.parse((await bytes(req,1000)).toString('utf8'));
        json(res,200,await holidayCalendar.get(input.years));return;
      }
      if(pathname==='/api/notices/generate'){
        if(req.method!=='POST'){json(res,405,{error:'POST 요청을 사용해주세요.'});return;}
        if(!noticeGenerator?.configured){json(res,503,{error:'Gemini API 키와 모델을 설정해주세요.'});return;}
        if(!String(req.headers['content-type']||'').includes('application/json')){json(res,415,{error:'JSON 요청이 필요합니다.'});return;}
        if(generating.has(auth.user.id)){json(res,429,{error:'이미 초안을 생성하고 있습니다. 결과를 기다려주세요.'});return;}
        generating.add(auth.user.id);
        try {
          const input=JSON.parse((await bytes(req,MAX_JSON)).toString('utf8'));
          json(res,200,await noticeGenerator.generate(input));
        } catch(error) {
          json(res,error instanceof SyntaxError?400:error.status||502,{error:error instanceof SyntaxError?'JSON 형식을 확인해주세요.':error.publicMessage||(error.status===413?'요청 크기 제한을 넘었습니다.':'초안을 생성하지 못했습니다. 다시 시도해주세요.')});
        } finally {generating.delete(auth.user.id);}
        return;
      }
      if(pathname==='/api/documents/analyze'){
        if(req.method!=='POST'){json(res,405,{error:'POST 요청을 사용해주세요.'});return;}
        if(!analyzer?.configured){json(res,503,{error:'서버에 Gemini API 키와 모델을 설정해주세요.'});return;}
        if(!String(req.headers['content-type']||'').includes('application/json')){json(res,415,{error:'JSON 요청이 필요합니다.'});return;}
        if(analyzing.has(auth.user.id)){json(res,429,{error:'이미 자료를 분석하고 있습니다. 결과를 기다려주세요.'});return;}
        analyzing.add(auth.user.id);
        try {
          const input=JSON.parse((await bytes(req,4_100_000)).toString('utf8'));
          json(res,200,await analyzer.analyze(input));
        } catch(error) {
          json(res,error instanceof SyntaxError?400:error.status||502,{error:error instanceof SyntaxError?'JSON 형식을 확인해주세요.':error.publicMessage||(error.status===413?'요청 크기 제한을 넘었습니다. 자료를 나누어 올려주세요.':'자료를 분석하지 못했습니다. 다시 시도해주세요.')});
        } finally {analyzing.delete(auth.user.id);}
        return;
      }
      if(pathname==='/api/drafts' && req.method==='GET'){
        const response=await upstream('/rest/v1/notice_drafts?select=id,payload,version,updated_at&order=updated_at.desc',{},auth.token);
        const result=await readUpstream(response);
        json(res,response.ok?200:response.status===404?503:502,response.ok?{drafts:result}:{error:response.status===404?'Supabase 마이그레이션을 먼저 적용해주세요.':'초안 목록을 읽지 못했습니다.'});return;
      }
      const draftMatch=pathname.match(/^\/api\/drafts\/([a-z0-9-]{1,100})$/i);
      if(draftMatch && draftIdOk(draftMatch[1])){
        const id=draftMatch[1];
        if(req.method==='GET'){
          const draft=await currentDraft(id,auth.token);json(res,draft?200:404,draft||{error:'저장된 초안이 없습니다.'});return;
        }
        if(req.method==='PUT' || req.method==='DELETE'){
          const input=JSON.parse((await bytes(req,MAX_JSON)).toString('utf8'));
          if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||(req.method==='PUT'&&!validDraft(input.data))){
            json(res,400,{error:'초안 형식과 버전을 확인해주세요.'});return;
          }
          const response=await upstream(req.method==='PUT'?'/rest/v1/rpc/save_notice_draft':'/rest/v1/rpc/delete_notice_draft',{
            method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify(req.method==='PUT'?{p_id:id,p_expected_version:input.expectedVersion,p_payload:input.data}:{p_id:id,p_expected_version:input.expectedVersion}),
          },auth.token);
          const result=await readUpstream(response);
          if(!response.ok && result?.message==='draft_conflict'){
            json(res,409,{error:'다른 탭에서 초안이 변경되었습니다.',current:await currentDraft(id,auth.token)});return;
          }
          json(res,response.ok?200:502,response.ok?result:{error:'Supabase에 초안을 저장하지 못했습니다.'});return;
        }
      }
      if(pathname==='/api/files' && req.method==='POST'){
        let name='';try{name=decodeURIComponent(String(req.headers['x-file-name']||''));}catch{}
        name=name.replace(/[\\/\x00-\x1f]/g,'').trim();
        const ext=name.toLowerCase().split('.').pop();
        if(!name||name.length>160||!MIME[ext]){json(res,400,{error:'PDF, DOCX, TXT, MD, PNG, JPG 파일만 저장할 수 있습니다.'});return;}
        const file=await bytes(req,MAX_FILE);
        if(!file.length){json(res,400,{error:'빈 파일은 저장할 수 없습니다.'});return;}
        const id=randomUUID(),storagePath=`${auth.user.id}/${id}`;
        const uploaded=await upstream(`/storage/v1/object/notice-files/${storagePath}`,{
          method:'POST',headers:{'Content-Type':MIME[ext],'x-upsert':'false'},body:file,
        },auth.token);
        if(!uploaded.ok){json(res,502,{error:'Supabase Storage에 파일을 저장하지 못했습니다.'});return;}
        const row={id,owner_id:auth.user.id,kind:'file',label:name,storage_path:storagePath,original_filename:name,mime_type:MIME[ext],byte_size:file.length,sha256:createHash('sha256').update(file).digest('hex')};
        const created=await upstream('/rest/v1/notice_resources',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(row)},auth.token);
        if(!created.ok){
          await upstream(`/storage/v1/object/notice-files/${storagePath}`,{method:'DELETE'},auth.token).catch(()=>{});
          json(res,502,{error:'파일 메타데이터를 저장하지 못했습니다.'});return;
        }
        json(res,201,{resource:(await readUpstream(created))[0]});return;
      }
      const fileMatch=pathname.match(/^\/api\/files\/([a-f0-9-]{36})$/i);
      if(fileMatch && req.method==='GET'){
        const response=await upstream(`/rest/v1/notice_resources?id=eq.${fileMatch[1]}&kind=eq.file&select=id,storage_path,original_filename,mime_type&limit=1`,{},auth.token);
        if(!response.ok){json(res,502,{error:'파일 정보를 읽지 못했습니다.'});return;}
        const resource=(await readUpstream(response))[0];
        if(!resource){json(res,404,{error:'파일이 없습니다.'});return;}
        const downloaded=await upstream(`/storage/v1/object/authenticated/notice-files/${resource.storage_path}`,{},auth.token);
        if(!downloaded.ok){json(res,502,{error:'파일을 읽지 못했습니다.'});return;}
        const data=Buffer.from(await downloaded.arrayBuffer());
        res.writeHead(200,{'Content-Type':resource.mime_type,'Content-Length':data.length,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(resource.original_filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(data);return;
      }
      json(res,404,{error:'요청한 API가 없습니다.'});
    } catch(error){
      if(error instanceof SyntaxError){json(res,400,{error:'JSON 형식을 확인해주세요.'});return;}
      console.error('Supabase API 오류:',error.message);
      json(res,error.status||502,{error:error.publicMessage||error.status&&error.message||'Supabase 연결에 실패했습니다.'});
    }
  };
}
