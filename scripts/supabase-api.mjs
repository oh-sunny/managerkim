import {BRIEF_FIELDS} from './notice-generation.mjs';

const MAX_JSON = 120_000;
const draftIdOk = id => /^[a-z0-9-]{1,100}$/i.test(id);
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

export function createSupabaseApi({url='',key='',fetcher=fetch,analyzer=null,noticeGenerator=null,holidayCalendar=null,sheetService=null}={}) {
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
  const readUpstream=async response=>{
    const contentType=response.headers.get('content-type')||'';
    const raw=await response.text();
    return contentType.includes('json')&&raw?JSON.parse(raw):raw;
  };
  async function authenticated(req,res) {
    const bearer=String(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
    let token=bearer||cookie(req,'sb_access');
    if(token){
      const response=await upstream('/auth/v1/user',{},token);
      if(response.ok)return {token,user:await readUpstream(response)};
    }
    if(bearer)return null;
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

  return async function handleApi(req,res,pathname) {
    try {
      if(pathname==='/api/status' && req.method==='GET'){json(res,200,{configured,supabaseUrl:configured?base:null,publishableKey:configured?key:null});return;}
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
      if(pathname==='/api/auth/clear-legacy-cookie' && req.method==='POST'){
        clearCookies(res);json(res,200,{cleared:true});return;
      }
      const auth=await authenticated(req,res);
      if(!auth){json(res,401,{error:'Supabase 계정으로 로그인해주세요.'});return;}
      if(pathname==='/api/auth/session' && req.method==='GET'){
        json(res,200,{user:{id:auth.user.id,email:auth.user.email}});return;
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
      json(res,404,{error:'요청한 API가 없습니다.'});
    } catch(error){
      if(error instanceof SyntaxError){json(res,400,{error:'JSON 형식을 확인해주세요.'});return;}
      console.error('Supabase API 오류:',error.message);
      json(res,error.status||502,{error:error.publicMessage||error.status&&error.message||'Supabase 연결에 실패했습니다.'});
    }
  };
}
