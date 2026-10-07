import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeOperatorPayload} from '../web/operator-merge.js';

test('separate project changes merge without replacing either edit', () => {
  const base={projects:[{id:'a',name:'A'},{id:'b',name:'B'}],tickets:[]};
  const local={...base,projects:[{id:'a',name:'A1'},{id:'b',name:'B'}]};
  const remote={...base,projects:[{id:'a',name:'A'},{id:'b',name:'B1'}]};
  const result=mergeOperatorPayload(base,local,remote);
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(result.payload.projects,[{id:'a',name:'A1'},{id:'b',name:'B1'}]);
});

test('the same changed field remains an explicit conflict', () => {
  const base={projects:[{id:'a',name:'A'}]};
  const local={projects:[{id:'a',name:'Mine'}]};
  const remote={projects:[{id:'a',name:'Theirs'}]};
  const result=mergeOperatorPayload(base,local,remote);
  assert.equal(result.payload,null);
  assert.deepEqual(result.conflicts,['projects:a.name']);
});
