import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSupabaseApi} from '../scripts/supabase-api.mjs';

function response(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
}

async function call(handler,path,{method='GET',body,headers={},parsedBody}={}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
  req.method=method;req.headers={host:'localhost:3100',...headers};
  if (parsedBody !== undefined) req.body=parsedBody;
  let status=0,output='',responseHeaders={};
  const res={
    setHeader(name,value){responseHeaders[name.toLowerCase()]=value;},
    writeHead(code,values={}){status=code;Object.assign(responseHeaders,values);},
    end(value){output=value?String(value):'';},
  };
  await handler(req,res,path);
  return {status,body:output?JSON.parse(output):null,headers:responseHeaders};
}

const config={url:'https://example.supabase.co',key:'sb_publishable_test'};
const cookie={cookie:'sb_access=test-access'};
const draft={body:'공지',tone:'friendly',mode:'dm',scope:'pending',teams:['marketing'],dmSelection:'team',selectedIds:[],channels:[],resources:[]};

test('notice generation uses its own authenticated, bounded JSON route',async()=>{
  let calls=0;
  const noticeGenerator={configured:true,generate:async input=>{calls++;assert.deepEqual(input,{purpose:'initial'});return {body:'generated'};}};
  const handler=createSupabaseApi({...config,noticeGenerator,fetcher:async()=>response({id:'user-1'})});
  const path='/api/notices/generate',options={method:'POST',body:{purpose:'initial'},headers:{...cookie,'content-type':'application/json'}};
  assert.equal((await call(handler,path,{...options,headers:{}})).status,401);
  assert.equal((await call(handler,path,{...options,headers:{...options.headers,origin:'https://other.example'}})).status,403);
  assert.equal((await call(handler,path,{...options,method:'GET'})).status,405);
  assert.equal((await call(handler,path,{...options,headers:cookie})).status,415);
  assert.equal((await call(handler,path,{...options,body:'{'})).status,400);
  assert.equal((await call(handler,path,{...options,body:'a'.repeat(120001)})).status,413);
  assert.equal((await call(handler,path,options)).body.body,'generated');
  assert.equal(calls,1);
  const unavailable=createSupabaseApi({...config,fetcher:async()=>response({id:'user-1'})});
  assert.equal((await call(unavailable,path,options)).status,503);
});

test('notice concurrency lock is released on failure and safe errors omit provider details',async()=>{
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const noticeGenerator={configured:true,generate:async()=>{await blocked;throw new Error('secret-key');}};
  const handler=createSupabaseApi({...config,noticeGenerator,fetcher:async()=>response({id:'user-1'})});
  const options={method:'POST',body:{},headers:{...cookie,'content-type':'application/json'}};
  const first=call(handler,'/api/notices/generate',options);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call(handler,'/api/notices/generate',options)).status,429);
  release();
  const result=await first;
  assert.equal(result.status,502);assert.doesNotMatch(result.body.error,/secret-key/);
  noticeGenerator.generate=async()=>({body:'retry succeeded'});
  assert.equal((await call(handler,'/api/notices/generate',options)).status,200);
});

test('configured API requires authentication and rejects cross-origin mutations',async()=>{
  const handler=createSupabaseApi({...config,fetcher:async()=>response({},401)});
  assert.deepEqual((await call(handler,'/api/status')).body,{configured:true});
  assert.equal((await call(handler,'/api/drafts')).status,401);
  const rejected=await call(handler,'/api/drafts/health-final',{method:'PUT',body:{expectedVersion:0,data:draft},headers:{...cookie,origin:'https://other.example'}});
  assert.equal(rejected.status,403);
});

test('Vercel HTTPS origin and parsed JSON body are accepted',async()=>{
  const handler=createSupabaseApi({...config,fetcher:async(url,options)=>{
    if(url.endsWith('/auth/v1/token?grant_type=password')){
      assert.deepEqual(JSON.parse(options.body),{email:'operator@example.org',password:'secret'});
      return response({access_token:'access',refresh_token:'refresh',user:{id:'user-1',email:'operator@example.org'}});
    }
    throw new Error('Unexpected upstream call');
  }});
  const result=await call(handler,'/api/auth/login',{
    method:'POST',parsedBody:{email:'operator@example.org',password:'secret'},
    headers:{host:'demo.vercel.app',origin:'https://demo.vercel.app'},
  });
  assert.equal(result.status,200);
  assert.equal(result.body.user.email,'operator@example.org');
});

test('draft version conflict returns the current server version',async()=>{
  const calls=[];
  const handler=createSupabaseApi({...config,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return response({id:'user-1',email:'operator@example.org'});
    if(url.endsWith('/rest/v1/rpc/save_notice_draft'))return response({message:'draft_conflict'},400);
    if(url.includes('/rest/v1/notice_drafts?'))return response([{id:'health-final',version:3,payload:draft,updated_at:'2026-10-06T00:00:00Z'}]);
    throw new Error('Unexpected upstream call');
  }});
  const result=await call(handler,'/api/drafts/health-final',{method:'PUT',body:{expectedVersion:2,data:draft},headers:cookie});
  assert.equal(result.status,409);
  assert.equal(result.body.current.version,3);
  assert.ok(calls.every(item=>item.options.headers.apikey===config.key));
  assert.ok(calls.every(item=>item.options.headers.Authorization==='Bearer test-access'));
});

test('operational state save uses versioned RPC and exposes conflict without overwriting',async()=>{
  const payload={schemaVersion:1,projects:[],applications:[],applicationEvents:[],records:[],tickets:[],completed:{}};
  const calls=[];
  const handler=createSupabaseApi({...config,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return response({id:'user-1'});
    if(url.endsWith('/rest/v1/rpc/save_operator_state'))return response({message:'operator_state_conflict'},400);
    if(url.includes('/rest/v1/operator_states?'))return response([{version:3,payload,updated_at:'2026-10-06T00:00:00Z'}]);
    throw new Error('Unexpected upstream call');
  }});
  const result=await call(handler,'/api/state',{method:'PUT',body:{expectedVersion:2,data:payload},headers:cookie});
  assert.equal(result.status,409);
  assert.equal(result.body.current.version,3);
  assert.deepEqual(JSON.parse(calls.find(row=>row.url.endsWith('/rest/v1/rpc/save_operator_state')).options.body),{p_expected_version:2,p_payload:payload});
});

test('authenticated file upload stores bytes privately and records its hash',async()=>{
  const calls=[];
  const handler=createSupabaseApi({...config,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return response({id:'11111111-1111-1111-1111-111111111111',email:'operator@example.org'});
    if(url.includes('/storage/v1/object/notice-files/'))return response({Key:'stored'},200);
    if(url.endsWith('/rest/v1/notice_resources'))return response([{id:JSON.parse(options.body).id,label:'guide.txt',byte_size:5,sha256:JSON.parse(options.body).sha256,version:1}],201);
    throw new Error('Unexpected upstream call');
  }});
  const result=await call(handler,'/api/files',{method:'POST',body:'hello',headers:{...cookie,'x-file-name':'guide.txt'}});
  assert.equal(result.status,201);
  assert.equal(result.body.resource.byte_size,5);
  const storage=calls.find(item=>item.url.includes('/storage/v1/object/notice-files/'));
  assert.equal(Buffer.from(storage.options.body).toString(),'hello');
  assert.match(calls.find(item=>item.url.endsWith('/rest/v1/notice_resources')).options.body,/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824/);
});

test('document analysis is authenticated, same-origin, size-limited and passes no credentials to the model',async()=>{
  let analyzed=0;
  const analyzer={configured:true,analyze:async input=>{analyzed++;assert.deepEqual(input,{files:[],text:'행사명: 샘플',forceOcr:false});return {fields:[],sources:[]};}};
  const handler=createSupabaseApi({...config,analyzer,fetcher:async()=>response({id:'user-1'})});
  const body={files:[],text:'행사명: 샘플',forceOcr:false};
  const headers={...cookie,'content-type':'application/json',origin:'http://localhost:3100'};
  assert.equal((await call(handler,'/api/documents/analyze',{method:'POST',body})).status,401);
  assert.equal((await call(handler,'/api/documents/analyze',{method:'POST',body,headers:{...headers,origin:'https://other.example'}})).status,403);
  assert.equal((await call(handler,'/api/documents/analyze',{method:'POST',body,headers})).status,200);
  assert.equal(analyzed,1);
  assert.equal((await call(handler,'/api/documents/analyze',{method:'POST',body:'a'.repeat(4_100_001),headers})).status,413);
  assert.equal(analyzed,1);
});

test('concurrent analysis from the same user is rejected and provider failure is safe',async()=>{
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const analyzer={configured:true,analyze:async()=>{await wait;throw Object.assign(new Error('private-api-key'),{status:402,publicMessage:'크레딧 확인 필요'});}};
  const handler=createSupabaseApi({...config,analyzer,fetcher:async()=>response({id:'user-1'})});
  const options={method:'POST',body:{},headers:{...cookie,'content-type':'application/json'}};
  const first=call(handler,'/api/documents/analyze',options);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call(handler,'/api/documents/analyze',options)).status,429);
  release();
  const result=await first;
  assert.equal(result.status,402);assert.equal(result.body.error,'크레딧 확인 필요');
});
