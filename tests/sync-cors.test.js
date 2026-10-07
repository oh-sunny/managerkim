import test from 'node:test';
import assert from 'node:assert/strict';
import {syncCorsHeaders} from '../supabase/functions/_shared/sync-cors.mjs';

test('local and deployed browser origins receive the headers needed for manual Sheet sync', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://managerkim.vercel.app']) {
    const headers = syncCorsHeaders(origin);
    assert.equal(headers['Access-Control-Allow-Origin'], origin);
    assert.match(headers['Access-Control-Allow-Methods'], /OPTIONS/);
    assert.match(headers['Access-Control-Allow-Headers'], /authorization/);
    assert.match(headers['Access-Control-Allow-Headers'], /apikey/);
  }
});

test('unknown browser origins are not granted access', () => {
  assert.equal(syncCorsHeaders('https://unrelated.example'), null);
  assert.equal(syncCorsHeaders('https://managerkim.vercel.app.evil.example'), null);
  assert.equal(syncCorsHeaders(null), null);
  assert.equal(syncCorsHeaders('https://custom.example', 'invalid-url'), null);
  assert.equal(syncCorsHeaders('https://custom.example', 'https://custom.example/path')['Access-Control-Allow-Origin'], 'https://custom.example');
});
