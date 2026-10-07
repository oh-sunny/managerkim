import test from 'node:test';
import assert from 'node:assert/strict';
import {configureSupabase,signInSupabase,signOutSupabase,readOperatorState} from '../prototype/supabase-browser.js';

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
