import test from 'node:test';
import assert from 'node:assert/strict';
import {newProjectId} from '../prototype/project-id.js';

test('new project can use the exact Sheet project ID and rejects a duplicate', () => {
  assert.equal(newProjectId(' autumn-fair ', ['health'], () => 'unused'), 'autumn-fair');
  assert.throws(() => newProjectId('health', ['health']), /이미 등록된/);
});

test('new project falls back to a local ID and rejects IDs that cannot be restored', () => {
  assert.equal(newProjectId('', [], () => 'local-123'), 'local-123');
  assert.throws(() => newProjectId('Autumn_Fair', []), /영문 소문자/);
  assert.throws(() => newProjectId('a'.repeat(81), []), /80자/);
});
