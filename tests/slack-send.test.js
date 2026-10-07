import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {buildSendPlan,SendPlanError} from '../scripts/send-plan.mjs';
import {createSlackDm} from '../scripts/slack-dm.mjs';
import {createSupabaseApi} from '../scripts/supabase-api.mjs';

const employee={id:1,name:'하나',team:'marketing',teamName:'마케팅팀',email:'one@example.org'};
const second={id:2,name:'둘',team:'marketing',teamName:'마케팅팀',email:'two@example.org'};
const project={id:'project-1',name:'프로젝트',dataKind:'sheet',targetIds:[1,2],requiredIds:[1],lifecycle:'active'};
const payload={schemaVersion:2,employees:[employee,second],sheetSync:{spreadsheetId:'sheet-1',lastSuccessAt:'2026-10-07T00:00:00Z'},
  projects:[project],applications:[],applicationEvents:[],tickets:[{id:'ticket-1',project:'project-1',state:'pending'}],completed:{},records:[]};
const draftPayload={body:'신청해 주세요.',mode:'dm',scope:'pending',dmSelection:'team',teams:['marketing'],selectedIds:[],resources:[],briefStale:false};
const draft={id:'ticket-1',version:2,payload:draftPayload};
const state={version:3,payload};
const plan=()=>buildSendPlan({draft,state,draftId:'ticket-1',draftVersion:2,stateVersion:3});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

async function call(handler,path,{body,headers={}}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method='POST';req.headers={host:'localhost:3000','content-type':'application/json',cookie:'sb_access=access',...headers};
  let status,output='';const res={setHeader(){},writeHead(code){status=code;},end(chunk){output=chunk?String(chunk):'';}};
  await handler(req,res,path);return {status,body:output?JSON.parse(output):null};
}

test('send plan is derived from saved state, requires email identities, and rejects stale versions',()=>{
  assert.deepEqual(plan().recipients.map(row=>row.employeeId),[1,2]);
  assert.equal(plan().body,'신청해 주세요.');
  assert.throws(()=>buildSendPlan({draft,state,draftId:'ticket-1',draftVersion:1,stateVersion:3}),error=>error instanceof SendPlanError&&error.status===409);
  const badState=structuredClone(state);badState.payload.employees[0].email='';
  assert.throws(()=>buildSendPlan({draft,state:badState,draftId:'ticket-1',draftVersion:2,stateVersion:3}),/회사 이메일/);
  const fileDraft=structuredClone(draft);fileDraft.payload.resources=[{kind:'file'}];
  assert.throws(()=>buildSendPlan({draft:fileDraft,state,draftId:'ticket-1',draftVersion:2,stateVersion:3}),/첨부/);
});

test('Slack adapter resolves account, opens DM, posts text, and treats uncertain HTTP outcome as unknown',async()=>{
  const calls=[];
  const adapter=createSlackDm({token:'xoxb-test',fetcher:async(url,options)=>{
    calls.push({url,payload:JSON.parse(options.body)});
    if(url.endsWith('/users.lookupByEmail'))return response({ok:true,user:{id:'U123'}});
    if(url.endsWith('/conversations.open'))return response({ok:true,channel:{id:'D123'}});
    return response({ok:true,ts:'123.45'});
  }});
  const result=await adapter.sendText({email:'one@example.org',body:'안내'});
  assert.equal(result.status,'success');assert.equal(result.ts,'123.45');
  assert.deepEqual(calls.map(row=>row.url.split('/').at(-1)),['users.lookupByEmail','conversations.open','chat.postMessage']);
  assert.equal(calls.at(-1).payload.text,'안내');
  const uncertain=createSlackDm({token:'xoxb-test',fetcher:async(url)=>url.endsWith('/chat.postMessage')?response({error:'unavailable'},503):url.endsWith('/users.lookupByEmail')?response({ok:true,user:{id:'U123'}}):response({ok:true,channel:{id:'D123'}})});
  assert.equal((await uncertain.sendText({email:'one@example.org',body:'안내'})).status,'unknown');
  assert.equal(createSlackDm().configured,false);
});

function apiHarness({changed=false,changedEmail=false,readError=false,slackOutcomes=['success','failed']}={}){
  const approved=new Map(),attempts=new Map(),results=[];let sheetReads=0,posts=0;
  const sheetService={configured:true,read:async()=>{
    sheetReads++;
    if(readError)throw new Error('private Sheet credential');
    return {spreadsheetId:'sheet-1',sync:{status:'success',lastSuccessAt:'2026-10-07T01:00:00Z'},
      employees:[{id:1,name:'하나',teamName:'마케팅팀',email:changedEmail?'new@example.org':'one@example.org'},
        {id:2,name:'둘',teamName:'마케팅팀',email:'two@example.org'}],
      sourceProjects:[{id:'project-1'}],projectTargets:[{projectId:'project-1',targetIds:[1,2],requiredIds:[1]}],
      applications:changed?[{projectId:'project-1',employeeId:1,status:'applied'}]:[],events:[]};
  }};
  const slackDm={configured:true,sendText:async()=>({status:slackOutcomes[posts++]||'unknown',stage:'post',reason:posts===2?'channel_not_found':null,ts:posts===1?'123.45':null})};
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
    if(path==='/auth/v1/user')return response({id:'11111111-1111-1111-1111-111111111111'});
    if(path==='/rest/v1/notice_drafts')return response([draft]);
    if(path==='/rest/v1/operator_states')return response([state]);
    if(path==='/rest/v1/send_approvals'){
      if(options.method==='POST'){assert.equal(options.headers.Authorization,'Bearer service-test');approved.set(body.id,{id:body.id,payload:body.payload});return response([{id:body.id}],201);}
      return response([approved.get(new URL(url).searchParams.get('id').slice(3))].filter(Boolean));
    }
    if(path==='/rest/v1/send_attempts'){
      const params=new URL(url).searchParams;
      if(params.has('approval_id'))return response([attempts.get(params.get('approval_id').slice(3))].filter(Boolean));
      return response([...attempts.values()].filter(row=>row.ticket_id===params.get('ticket_id').slice(3)));
    }
    if(path==='/rest/v1/send_results')return response(results.filter(row=>row.attempt_id===new URL(url).searchParams.get('attempt_id').slice(3)));
    if(path==='/rest/v1/rpc/claim_send_attempt'){
      assert.equal(options.headers.Authorization,'Bearer service-test');
      if([...attempts.values()].some(row=>row.approval_id===body.p_approval_id))return response(false);
      attempts.set(body.p_approval_id,{id:body.p_id,approval_id:body.p_approval_id,ticket_id:'ticket-1',source_checked_at:body.p_source_checked_at,created_at:'2026-10-07T01:00:00Z'});
      return response(true);
    }
    if(path==='/rest/v1/rpc/record_send_result'){
      assert.equal(options.headers.Authorization,'Bearer service-test');
      results.push({attempt_id:body.p_attempt_id,employee_id:body.p_employee_id,status:body.p_status,stage:body.p_stage,
        reason:body.p_reason,slack_ts:body.p_slack_ts});return response(true);
    }
    throw new Error(`Unexpected route: ${path}`);
  };
  return {handler:createSupabaseApi({url:'https://example.supabase.co',key:'sb_publishable_test',serviceKey:'service-test',fetcher,sheetService,slackDm}),
    counts:()=>({sheetReads,posts,results:results.length})};
}

const approvalId='11111111-1111-1111-1111-111111111112';
const requestId='11111111-1111-1111-1111-111111111113';
async function approve(handler){
  const input={draftId:'ticket-1',draftVersion:2,stateVersion:3};
  const preview=await call(handler,'/api/send/preview',{body:input});
  assert.equal(preview.status,200);
  const approval=await call(handler,'/api/send/approve',{body:{...input,approvalId,fingerprint:preview.body.fingerprint,acknowledged:true}});
  assert.equal(approval.status,201);
  return preview;
}

test('server approval requires matching preview and signed-in account; changed Sheet blocks before Slack',async()=>{
  const {handler,counts}=apiHarness({changed:true});
  assert.equal((await call(handler,'/api/send/preview',{body:{draftId:'ticket-1',draftVersion:2,stateVersion:3},headers:{cookie:''}})).status,401);
  const preview=await call(handler,'/api/send/preview',{body:{draftId:'ticket-1',draftVersion:2,stateVersion:3}});
  assert.equal((await call(handler,'/api/send/approve',{body:{draftId:'ticket-1',draftVersion:2,stateVersion:3,approvalId,fingerprint:'0'.repeat(64),acknowledged:true}})).status,409);
  assert.equal(preview.body.recipients.length,2);
  await approve(handler);
  const sent=await call(handler,'/api/send/attempts',{body:{approvalId,requestId,body:'forged',recipientIds:[999]}});
  assert.equal(sent.status,409);assert.equal(counts().posts,0);
});

test('changed recipient email blocks before Slack delivery',async()=>{
  const {handler,counts}=apiHarness({changedEmail:true});await approve(handler);
  const sent=await call(handler,'/api/send/attempts',{body:{approvalId,requestId}});
  assert.equal(sent.status,409);assert.equal(counts().posts,0);
});

test('Sheet read failure blocks before attempt claim or Slack delivery',async()=>{
  const {handler,counts}=apiHarness({readError:true});await approve(handler);
  const sent=await call(handler,'/api/send/attempts',{body:{approvalId,requestId}});
  assert.equal(sent.status,502);assert.doesNotMatch(sent.body.error,/credential/);
  assert.deepEqual(counts(),{sheetReads:1,posts:0,results:0});
});

test('uncertain Slack result is retained and never retried automatically',async()=>{
  const {handler,counts}=apiHarness({slackOutcomes:['success','unknown']});await approve(handler);
  const first=await call(handler,'/api/send/attempts',{body:{approvalId,requestId}});
  assert.equal(first.body.status,'unknown');
  assert.equal(first.body.results[1].status,'unknown');
  await call(handler,'/api/send/attempts',{body:{approvalId,requestId}});
  assert.equal(counts().posts,2);
});

test('server sends saved text once, records recipient outcomes, and replays request without duplicate delivery',async()=>{
  const {handler,counts}=apiHarness();await approve(handler);
  const input={approvalId,requestId,body:'forged',recipientIds:[999]};
  const first=await call(handler,'/api/send/attempts',{body:input});
  assert.equal(first.status,200);assert.equal(first.body.status,'partial');
  assert.deepEqual(first.body.results.map(row=>row.status),['success','failed']);
  assert.deepEqual(counts(),{sheetReads:1,posts:2,results:2});
  const replay=await call(handler,'/api/send/attempts',{body:input});
  assert.equal(replay.status,200);assert.equal(replay.body.attemptId,requestId);
  assert.deepEqual(counts(),{sheetReads:1,posts:2,results:2});
  const newRequest=await call(handler,'/api/send/attempts',{body:{approvalId,requestId:'11111111-1111-1111-1111-111111111114'}});
  assert.equal(newRequest.status,409);assert.equal(counts().posts,2);
});
