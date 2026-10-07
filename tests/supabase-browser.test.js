import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSupabase,signInSupabase,signOutSupabase,restoreSupabaseUser,accessToken,readOperatorState,readDraft,saveDraft,uploadNoticeResource} from '../web/supabase-browser.js';
import {draftStorageId} from '../web/draft-storage-id.js';

test('generated ticket IDs use a stable database-safe draft ID without changing existing IDs', async t => {
  const previousFetch=globalThis.fetch,previousStorage=globalThis.sessionStorage;
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  t.after(()=>{globalThis.fetch=previousFetch;globalThis.sessionStorage=previousStorage;});
  const ticketId='local-74eaa826-7e76-4b74-9470-1b05437bd6b9:initial:2026-10-07T11:53:03.400Z';
  const storedId=await draftStorageId(ticketId);
  assert.match(storedId,/^[a-zA-Z0-9-]{1,100}$/);
  assert.equal(await draftStorageId(ticketId),storedId);
  assert.equal(await draftStorageId('health-final'),'health-final');
  assert.match(await draftStorageId(`티켓:${'x'.repeat(150)}`),/^[a-zA-Z0-9-]{1,100}$/);
  const records=new Map(),calls=[];
  globalThis.fetch=async (url,options={}) => {
    calls.push({url:String(url),options});
    if(String(url).includes('/auth/v1/token?grant_type=password'))return Response.json({
      access_token:'user-access',refresh_token:'user-refresh',expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id:'operator-1',email:'operator@example.com'},
    });
    if(String(url).endsWith('/rest/v1/rpc/save_notice_draft')){
      const input=JSON.parse(options.body);
      if(!/^[a-zA-Z0-9-]{1,100}$/.test(input.p_id))return Response.json({message:'invalid_draft'},{status:400});
      const record={id:input.p_id,payload:input.p_payload,version:1,updated_at:'2026-10-07T12:00:00Z'};
      records.set(record.id,record);return Response.json(record);
    }
    if(String(url).includes('/rest/v1/notice_drafts?')){
      const id=new URL(String(url)).searchParams.get('id')?.slice(3);
      return Response.json(records.has(id)?[records.get(id)]:[]);
    }
    return new Response(null,{status:404});
  };
  configureSupabase({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_public'});
  await signInSupabase('operator@example.com','password');
  assert.equal((await saveDraft(ticketId,0,{body:'검진 초안'})).id,storedId);
  assert.equal((await readDraft(ticketId)).payload.body,'검진 초안');
  assert.equal(calls.find(call=>call.url.endsWith('/rest/v1/rpc/save_notice_draft')).options.headers.Authorization,'Bearer user-access');
});

test('browser login reads operator state directly from Supabase with the user token', async t => {
  const previousFetch=globalThis.fetch,previousStorage=globalThis.sessionStorage;
  const values=new Map();
  globalThis.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  t.after(()=>{globalThis.fetch=previousFetch;globalThis.sessionStorage=previousStorage;});
  const calls=[];
  globalThis.fetch=async (url,options) => {
    calls.push({url:String(url),options});
    if(String(url).includes('/auth/v1/token?grant_type=password'))return Response.json({
      access_token:'user-access',refresh_token:'user-refresh',expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id:'operator-1',email:'operator@example.com'},
    });
    if(String(url).includes('/rest/v1/operator_states'))return Response.json([{payload:{projects:[]},version:2}]);
    if(String(url).includes('/auth/v1/logout'))return new Response(null,{status:204});
    return new Response(null,{status:404});
  };
  configureSupabase({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_public'});
  assert.deepEqual(await signInSupabase('operator@example.com','password'),{id:'operator-1',email:'operator@example.com'});
  assert.equal((await readOperatorState()).state.version,2);
  const read=calls.find(call=>call.url.includes('/rest/v1/operator_states'));
  assert.equal(read.options.headers.Authorization,'Bearer user-access');
  assert.equal(read.options.headers.apikey,'sb_publishable_public');
  await signOutSupabase();
  assert.equal(values.size,0);
});

test('browser uploads notice file directly to private Supabase Storage and records metadata', async t => {
  const previousFetch=globalThis.fetch,previousStorage=globalThis.sessionStorage;
  const values=new Map(),calls=[];
  globalThis.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  t.after(()=>{globalThis.fetch=previousFetch;globalThis.sessionStorage=previousStorage;});
  const ownerId='11111111-1111-1111-1111-111111111111';
  globalThis.fetch=async (url,options) => {
    calls.push({url:String(url),options});
    if(String(url).includes('/auth/v1/token?grant_type=password'))return Response.json({access_token:'user-access',refresh_token:'user-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:ownerId,email:'operator@example.com'}});
    if(String(url).includes('/storage/v1/object/notice-files/'))return Response.json({Key:'stored'});
    if(String(url).endsWith('/rest/v1/notice_resources'))return Response.json([JSON.parse(options.body)],{status:201});
    return new Response(null,{status:404});
  };
  configureSupabase({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_public'});
  await signInSupabase('operator@example.com','password');
  const file=new Blob(['hello'],{type:'text/plain'});
  Object.defineProperty(file,'name',{value:'guide.txt'});
  const resource=await uploadNoticeResource(file,ownerId);
  assert.equal(resource.label,'guide.txt');
  assert.equal(resource.sha256,'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  const storage=calls.find(call=>call.url.includes('/storage/v1/object/notice-files/'));
  assert.equal(storage.options.headers.Authorization,'Bearer user-access');
  assert.equal(storage.options.headers['Content-Type'],'text/plain');
  assert.equal(await storage.options.body.text(),'hello');
  assert.match(storage.url,/notice-files\/11111111-1111-1111-1111-111111111111\//);
  const metadata=calls.find(call=>call.url.endsWith('/rest/v1/notice_resources'));
  assert.equal(JSON.parse(metadata.options.body).storage_path,resource.storage_path);
  assert.equal(metadata.options.headers.Prefer,'return=representation');
  assert.ok(calls.every(call=>!call.url.includes('/api/files')));
});

test('browser removes an uploaded object when its metadata cannot be saved', async t => {
  const previousFetch=globalThis.fetch,previousStorage=globalThis.sessionStorage;
  const calls=[];
  globalThis.sessionStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  t.after(()=>{globalThis.fetch=previousFetch;globalThis.sessionStorage=previousStorage;});
  const ownerId='11111111-1111-1111-1111-111111111111';
  globalThis.fetch=async (url,options) => {
    calls.push({url:String(url),options});
    if(String(url).includes('/auth/v1/token?grant_type=password'))return Response.json({access_token:'user-access',refresh_token:'user-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:ownerId,email:'operator@example.com'}});
    if(String(url).endsWith('/rest/v1/notice_resources'))return Response.json({message:'database unavailable'},{status:503});
    if(String(url).includes('/storage/v1/object/notice-files/'))return Response.json({Key:'stored'});
    return new Response(null,{status:404});
  };
  configureSupabase({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_public'});
  await signInSupabase('operator@example.com','password');
  const file=new Blob(['hello'],{type:'text/plain'});
  Object.defineProperty(file,'name',{value:'guide.txt'});
  await assert.rejects(uploadNoticeResource(file,ownerId),/database unavailable/);
  assert.equal(calls.filter(call=>call.url.includes('/storage/v1/object/notice-files/')).map(call=>call.options.method).join(','),'POST,DELETE');
});

test('another same-origin tab can restore a shared session and observes sign-out', async t => {
  const previous={fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage,window:globalThis.window,
    CustomEvent:globalThis.CustomEvent,BroadcastChannel:globalThis.BroadcastChannel};
  const values=new Map(),events=[];
  globalThis.sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.window={dispatchEvent:event=>events.push(event.detail)};
  globalThis.CustomEvent=class {constructor(_name,{detail}){this.detail=detail;}};
  class FakeChannel {
    constructor(){FakeChannel.instance=this;this.messages=[];}
    postMessage(message){this.messages.push(message);}
    unref(){}
  }
  globalThis.BroadcastChannel=FakeChannel;
  globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')
    ? Response.json({id:'operator-1',email:'operator@example.com'})
    : new Response(null,{status:404});
  t.after(()=>Object.assign(globalThis,previous));
  configureSupabase({supabaseUrl:'https://example.supabase.co',publishableKey:'public-key'});
  const channel=FakeChannel.instance;
  const session={access_token:'shared-access',refresh_token:'shared-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
  channel.onmessage({data:{type:'session',base:'https://other.supabase.co',session}});
  assert.equal(values.size,0);
  channel.onmessage({data:{type:'session',base:'https://example.supabase.co',session}});
  assert.deepEqual(await restoreSupabaseUser(),{id:'operator-1',email:'operator@example.com'});
  assert.equal(await accessToken(),'shared-access');
  assert.deepEqual(events.at(-1),{signedIn:true});
  channel.onmessage({data:{type:'signed-out',base:'https://example.supabase.co'}});
  await assert.rejects(accessToken(),/로그인/);
  assert.deepEqual(events.at(-1),{signedIn:false});
});
