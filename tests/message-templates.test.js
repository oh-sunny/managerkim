import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDraftMessage} from '../web/message-templates.js';

const details={title:'연례 건강검진',deadline:'10월 5일 18:00',owner:'김총무',applicationUrl:'https://example.org/apply'};

test('all tones use the same confirmed fields without the removed duplicate-application phrase',()=>{
  const messages=['friendly','concise','action'].map(tone=>buildDraftMessage(details,tone));
  for(const message of messages){
    for(const field of Object.values(details))assert.ok(message.includes(field));
    assert.ok(!message.includes('이미 신청하셨다면'));
  }
  assert.equal(new Set(messages).size,3);
});

test('a missing application link stays visibly unresolved',()=>{
  assert.match(buildDraftMessage({...details,applicationUrl:''}),/신청 링크 확인 필요/);
});
