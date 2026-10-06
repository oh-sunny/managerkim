import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoticeGenerator,validateNoticeInput,BRIEF_FIELDS} from '../scripts/notice-generation.mjs';
import {createPublicHolidayCalendar} from '../scripts/public-holidays.mjs';
import {generationSignature,acceptNoticeCandidate} from '../prototype/notice-draft.js';

const card=Object.fromEntries(BRIEF_FIELDS.map(key=>[key,{value:'',included:false,source:'직접 입력'}]));
card.what={value:'건강검진 신청 안내',included:true,source:'프로젝트 정보'};
card.action={value:'검진기관을 선택해 신청',included:true,source:'프로젝트 정보'};
card.deadline={value:'10월 16일 18:00',included:true,source:'프로젝트 정보'};
card.links={value:'https://example.org/apply',included:true,source:'담당자 입력'};
const input={projectTitle:'연례 건강검진',tone:'friendly',kind:'initial',card};

test('Gemma receives only included confirmed facts and blocks invented links',async()=>{
  let request,calls=0;
  const generator=createNoticeGenerator({apiKey:'test',model:'gemma-test',generate:async value=>{
    if(++calls===1){request=value;return {text:'건강검진을 신청해주세요. 10월 16일 18:00까지 검진기관을 선택하세요. https://example.org/apply'};}
    return {text:JSON.stringify({supported:true,issues:[]})};
  }});
  const result=await generator.generate(input);
  assert.match(result.body,/검진기관을 선택/);
  assert.ok(!request.contents[0].text.includes('비용·지원'));
  const bad=createNoticeGenerator({apiKey:'test',model:'gemma-test',generate:async()=>({text:'https://unverified.example'})});
  await assert.rejects(()=>bad.generate(input),/확인되지 않은 링크/);
  const badDate=createNoticeGenerator({apiKey:'test',model:'gemma-test',generate:async()=>({text:'10월 17일까지 신청하세요.'})});
  await assert.rejects(()=>badDate.generate(input),/확인되지 않은 날짜/);
  let reviewCalls=0;
  const unsupported=createNoticeGenerator({apiKey:'test',model:'gemma-test',generate:async()=>({text:++reviewCalls===1?'건강검진을 신청해주세요. 10월 16일 18:00까지 검진기관을 선택하세요.':'{"supported":false,"issues":["자료에 없는 혜택"]}'})});
  await assert.rejects(()=>unsupported.generate(input),/정보 카드로 확인되지 않은 내용/);
  assert.throws(()=>validateNoticeInput({...input,card:{...card,action:{...card.action,included:false}}}),/해야 할 일/);
});

test('public holiday adapter needs no key and accepts only nationwide public holidays',async()=>{
  const entries=[
    {date:'2026-10-09',global:true,types:['Public']},
    {date:'2026-10-10',global:true,types:['Observance']},
    {date:'2026-10-11',global:false,types:['Public']},
  ];
  const calendar=createPublicHolidayCalendar({fetcher:async url=>{assert.match(String(url),/PublicHolidays\/2026\/KR$/);return Response.json(entries);}});
  const result=await calendar.get([2026]);
  assert.deepEqual(result.holidays,['2026-10-09']);
  assert.equal(result.status,'success');
  assert.equal(calendar.configured,true);
});

test('candidate keeps edited body until the card and recipients still match',()=>{
  const recipients={list:[{id:2},{id:1}],channels:[]};
  const signature=generationSignature(input,recipients);
  const draft={body:'직접 고친 본문',confirmed:true,confirmedSignature:'approved',briefStale:true};
  const candidate={body:'새 초안',signature,model:'gemma-test',generatedAt:'2026-10-06T00:00:00Z'};
  assert.equal(acceptNoticeCandidate(draft,candidate,generationSignature(input,{...recipients,list:[{id:3}]})),false);
  assert.equal(draft.body,'직접 고친 본문');
  assert.equal(acceptNoticeCandidate(draft,candidate,signature),true);
  assert.equal(draft.body,'새 초안');
  assert.equal(draft.briefStale,false);
  assert.equal(draft.confirmed,false);
});
