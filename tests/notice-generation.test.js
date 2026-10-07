import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNoticeGenerator,validateNoticeInput,BRIEF_FIELDS} from '../scripts/notice-generation.mjs';
import {prepareNoticeGeneration,NOTICE_TONE_LABELS} from '../web/notice-generation-input.js';
import {createPublicHolidayCalendar} from '../scripts/public-holidays.mjs';
import {generationSignature,acceptNoticeCandidate,makeNoticeBrief} from '../web/notice-draft.js';

const card=Object.fromEntries(BRIEF_FIELDS.map(key=>[key,{value:'',included:false,status:'missing',source:'직접 입력'}]));
card.what={value:'건강검진 신청 안내',included:true,status:'confirmed',source:'프로젝트 정보'};
card.action={value:'검진기관을 선택해 신청',included:true,status:'confirmed',source:'프로젝트 정보'};
card.deadline={value:'10월 16일 18:00',included:true,status:'confirmed',source:'프로젝트 정보'};
card.links={value:'https://example.org/apply',included:true,status:'confirmed',source:'담당자 입력'};
const input={projectTitle:'연례 건강검진',tone:'friendly',kind:'initial',card};

test('browser preview and Gemini request share exactly the confirmed included facts',async()=>{
  const mixed={...input,tone:'formal',card:{...card,
    cost:{value:'제외할 비용 정보',included:false,status:'confirmed',source:'프로젝트 정보'},
    exception:{value:'미확인 예외',included:false,status:'needs_review',source:'자료'},
  }};
  const preview=prepareNoticeGeneration(mixed);
  assert.equal(NOTICE_TONE_LABELS.formal,'정중하고 차분하게');
  assert.deepEqual(preview.preview.map(item=>item.label),['무엇을','해야 할 일','마감','링크·자료']);
  let firstRequest,calls=0;
  const generator=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async request=>{
    if(++calls===1){firstRequest=request;return {text:'건강검진을 신청해주세요. 10월 16일 18:00까지 검진기관을 선택하세요.'};}
    return {text:'{"supported":true,"issues":[]}'};
  }});
  await generator.generate(mixed);
  const sent=JSON.parse(firstRequest.contents[0].text);
  assert.deepEqual(sent.confirmedFacts,preview.confirmedFacts);
  assert.ok(!firstRequest.contents[0].text.includes('제외할 비용 정보'));
  assert.ok(!firstRequest.contents[0].text.includes('미확인 예외'));
  assert.throws(()=>prepareNoticeGeneration({...mixed,card:{...mixed.card,exception:{...mixed.card.exception,included:true}}}),/예외·유의사항 항목을 확인/);
  assert.throws(()=>prepareNoticeGeneration({...mixed,card:{...mixed.card,exception:{...mixed.card.exception,value:'',included:true}}}),/예외·유의사항 항목을 입력/);
});

test('Gemini receives only included confirmed facts and blocks invented links',async()=>{
  let request,calls=0;
  const generator=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async value=>{
    if(++calls===1){request=value;return {text:'건강검진을 신청해주세요. 10월 16일 18:00까지 검진기관을 선택하세요. https://example.org/apply'};}
    return {text:JSON.stringify({supported:true,issues:[]})};
  }});
  const result=await generator.generate(input);
  assert.match(result.body,/검진기관을 선택/);
  assert.deepEqual(request.config.thinkingConfig,{thinkingLevel:'low'});
  assert.ok(!request.contents[0].text.includes('비용·지원'));
  const bad=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async()=>({text:'https://unverified.example'})});
  await assert.rejects(()=>bad.generate(input),/확인되지 않은 링크/);
  const badDate=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async()=>({text:'10월 17일까지 신청하세요.'})});
  await assert.rejects(()=>badDate.generate(input),/확인되지 않은 날짜/);
  let reviewCalls=0;
  const unsupported=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async()=>({text:++reviewCalls===1?'건강검진을 신청해주세요. 10월 16일 18:00까지 검진기관을 선택하세요.':'{"supported":false,"issues":["자료에 없는 혜택"]}'})});
  await assert.rejects(()=>unsupported.generate(input),/정보 카드로 확인되지 않은 내용/);
  assert.throws(()=>validateNoticeInput({...input,card:{...card,action:{...card.action,included:false}}}),/해야 할 일/);
});

test('generated bold markers are removed before validation and the saved body stays plain text',async()=>{
  const requests=[];
  const generator=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async request=>{
    requests.push(request);
    return {text:requests.length===1
      ? '**[대상]**\n건강검진 신청 안내\n**[해야 할 일]**\n검진기관을 선택해 신청하세요.\n**[신청 마감]**\n10월 16일 18:00까지\nhttps://example.org/apply'
      : '{"supported":true,"issues":[]}'};
  }});
  const result=await generator.generate(input);
  assert.match(requests[0].config.systemInstruction,/일반 텍스트/);
  assert.equal(result.body,'[대상]\n건강검진 신청 안내\n[해야 할 일]\n검진기관을 선택해 신청하세요.\n[신청 마감]\n10월 16일 18:00까지\nhttps://example.org/apply');
  assert.equal(JSON.parse(requests[1].contents[0].text).body,result.body);
});

test('document facts populate separate action, method, cost and exception cards with evidence',()=>{
  const evidence=[{sourceName:'검진안내.pdf',location:'2쪽',quote:'검진기관을 선택해 신청'}];
  const project={name:'건강검진',description:'직원 건강을 챙깁니다',audience:'전 직원',deadlineAt:'2026-10-16T18:00',requirements:'- 검진기관을 선택해 신청\n- 회사 지원금 10만 원\n- 마감 후 변경 불가',sourceReviews:[{field:'requirements',status:'found',evidence}],sourceIssues:[]};
  const brief=makeNoticeBrief(project);
  assert.equal(brief.action.value,'검진기관을 선택해 신청');
  assert.equal(brief.method.value,'검진기관을 선택해 신청');
  assert.equal(brief.cost.value,'회사 지원금 10만 원');
  assert.equal(brief.exception.value,'마감 후 변경 불가');
  assert.equal(brief.action.evidence[0].location,'2쪽');
  assert.equal(brief.cost.status,'needs_review');
  assert.equal(brief.deadline.value,'10월 16일 18:00까지');
  assert.equal(makeNoticeBrief({...project,requirements:'',sourceIssues:[{field:'deadlineAt',status:'conflict'}]}).deadline.status,'conflict');
  assert.equal(makeNoticeBrief({...project,requirements:''}).action.status,'missing');
});

test('fixture projects keep the exact deadline and link and require an explicit action',()=>{
  const cases=JSON.parse(readFileSync(new URL('./fixtures/data/cases.json',import.meta.url),'utf8'));
  for(const item of cases){
    const brief=makeNoticeBrief({name:item.name,deadlineAt:item.deadlineAt,applicationUrl:item.applicationUrl,audience:item.target});
    assert.equal(brief.deadline.value,`${Number(item.deadlineAt.slice(5,7))}월 ${Number(item.deadlineAt.slice(8,10))}일 ${item.deadlineAt.slice(11,16)}까지`,item.id);
    assert.equal(brief.links.value,item.applicationUrl,item.id);
    assert.equal(brief.action.status,'missing',item.id);
    assert.throws(()=>validateNoticeInput({...input,projectTitle:item.name,card:{...brief,action:{...brief.action,included:true}}}),/해야 할 일/,item.id);
  }
});

test('unconfirmed included facts are blocked before Gemini and purpose rules differ',async()=>{
  const unconfirmed={...input,card:{...card,links:{...card.links,status:'conflict'}}};
  assert.throws(()=>validateNoticeInput(unconfirmed),/링크·자료 항목을 확인 완료/);
  const requests=[];
  const generator=createNoticeGenerator({apiKey:'test',model:'gemini-3.7-flash',generate:async request=>{
    requests.push(request);
    return {text:requests.length%2?'검진기관을 선택해 신청해주세요. 10월 16일 18:00까지 완료해주세요.':'{"supported":true,"issues":[]}'};
  }});
  for(const kind of ['initial','reminder','deadline'])await generator.generate({...input,kind});
  assert.match(requests[0].config.systemInstruction,/첫 안내:/);
  assert.match(requests[2].config.systemInstruction,/추가 신청 안내:/);
  assert.match(requests[4].config.systemInstruction,/마감 알림:/);
  assert.ok(!requests[0].contents[0].text.includes('source'));
});

test('public holiday adapter needs no key and accepts only nationwide public holidays',async()=>{
  const entries=[
    {date:'2026-10-09',global:true,types:['Public']},
    {date:'2026-10-10',global:true,types:['Observance']},
    {date:'2026-10-11',global:false,types:['Public']},
  ];
  const calendar=createPublicHolidayCalendar({fetcher:async url=>{assert.match(String(url),/publicholidays\/2026\/KR$/);return Response.json(entries);}});
  const result=await calendar.get([2026]);
  assert.deepEqual(result.holidays,['2026-10-09']);
  assert.equal(result.status,'success');
  assert.equal(calendar.configured,true);
});

test('candidate keeps edited body until the card and recipients still match',()=>{
  const recipients={list:[{id:2},{id:1}],channels:[]};
  const signature=generationSignature(input,recipients);
  const draft={body:'직접 고친 본문',confirmed:true,confirmedSignature:'approved',briefStale:true};
  const candidate={body:'새 초안',signature,model:'gemini-3.7-flash',generatedAt:'2026-10-06T00:00:00Z'};
  assert.equal(acceptNoticeCandidate(draft,candidate,generationSignature(input,{...recipients,list:[{id:3}]})),false);
  assert.equal(draft.body,'직접 고친 본문');
  assert.equal(acceptNoticeCandidate(draft,candidate,signature),true);
  assert.equal(draft.body,'새 초안');
  assert.equal(draft.briefStale,false);
  assert.equal(draft.confirmed,false);
});
