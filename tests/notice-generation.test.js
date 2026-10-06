import test from 'node:test';
import assert from 'node:assert/strict';
import {createNoticeGenerator,validateNoticeInput,validateNoticeBody,NOTICE_WRITING_GUIDE} from '../scripts/notice-generation.mjs';
import {noticeInput,generationSignature,acceptNoticeCandidate} from '../prototype/notice-draft.js';

const input={project:{confirmed:true,name:'가을 워크숍',description:'동료 교류 행사',start:'2026-10-01',deadlineAt:'2026-10-08T18:00',event:'2026-10-16',owner:'김총무',applicationUrl:'https://example.org/apply',confirmationMode:'separate',audience:'프로젝트 대상 동료'},purpose:'initial',tone:'friendly',recipient:{mode:'dm',label:'아직 신청하지 않은 동료 중 선택한 동료 12명',count:12}};
const context=validateNoticeInput(input);
const body=`가을 워크숍 신청을 안내해요.\n\n${context.requiredLines.slice(0,-1).join('\n')}\n위 신청 링크에서 신청해주세요.\n\n${context.requiredLines.at(-1)}`;
const configured={apiKey:'test-key',model:'gemma-test'};

test('dedicated writing and verification tasks receive only confirmed allowlisted facts',async()=>{
  const calls=[];
  const generator=createNoticeGenerator({...configured,generate:async request=>{
    calls.push(request);
    return {text:JSON.stringify(calls.length===1?{body}:{supported:true,issues:[]})};
  }});
  const result=await generator.generate({...input,secret:'private',sources:['old document'],project:{...input.project,sourceReviews:['old date']}});
  assert.equal(result.body,body);
  assert.deepEqual(result.checks,{literal:'passed',semantic:'passed'});
  assert.equal(calls.length,2);
  assert.equal(calls[0].config.systemInstruction,NOTICE_WRITING_GUIDE);
  assert.notEqual(calls[0].config.systemInstruction,calls[1].config.systemInstruction);
  assert.doesNotMatch(JSON.stringify(calls),/private|old document|old date|test-key/);
  assert.match(calls[0].contents[0].text,/첫 안내/);
  assert.equal(result.factsHash.length,64);
});

test('unreviewed, invalid and empty-recipient inputs never invoke Gemma',async()=>{
  let calls=0;
  const generator=createNoticeGenerator({...configured,generate:async()=>{calls++;}});
  const invalid=[null,{}, {...input,project:{...input.project,confirmed:false}}, {...input,purpose:'unknown'}, {...input,tone:'__proto__'}, {...input,recipient:{...input.recipient,count:0}}, {...input,project:{...input.project,deadlineAt:'2026-02-30T18:00'}}, {...input,project:{...input.project,applicationUrl:'javascript:alert(1)'}}, {...input,project:{...input.project,applicationUrl:'https://user:pass@example.org'}}];
  for(const value of invalid)await assert.rejects(generator.generate(value),error=>error.status===400);
  assert.equal(calls,0);
});

test('literal checks reject changed or omitted critical facts and added links/dates',()=>{
  assert.equal(validateNoticeBody(body,context),body);
  for(const value of [body.replace('18:00','17:00'),body.replace('신청 마감:','행사일:'),body.replace(context.requiredLines[0],'안내 대상: 모든 동료'),body.replace('https://example.org/apply','https://other.example.org'),body+'\nhttps://other.example.org',body.replace('위 신청','내일 위 신청'),body.replace('위 신청','2026-10-01 18:00에 위 신청'),body.replace('문의: 김총무','문의: 이총무')]) {
    assert.throws(()=>validateNoticeBody(value,context),error=>error.status===422);
  }
});

test('semantic hallucinations are rejected even when literal facts pass',async()=>{
  let calls=0;
  const generator=createNoticeGenerator({...configured,generate:async()=>({text:JSON.stringify(++calls===1?{body:body.replace('위 신청','전원 필수 참여입니다. 제주도에서 진행합니다. 위 신청')}:{supported:false,issues:['미확인 의무 및 장소']})})});
  await assert.rejects(generator.generate(input),error=>error.status===422);
  assert.equal(calls,2);
});

test('malformed verification, provider errors and missing configuration fail closed',async()=>{
  for(const verdict of [null,{}, {supported:'true',issues:[]},{supported:true,issues:['불일치']}]){
    let calls=0;
    const generator=createNoticeGenerator({...configured,generate:async()=>({text:JSON.stringify(++calls===1?{body}:verdict)})});
    await assert.rejects(generator.generate(input),error=>error.status===422);
  }
  await assert.rejects(createNoticeGenerator().generate(input),error=>error.status===503);
  for(const status of [402,429,500]){
    const generator=createNoticeGenerator({...configured,generate:async()=>{throw Object.assign(new Error('private-key'),{status});}});
    await assert.rejects(generator.generate(input),error=>!error.message.includes('private-key')&&error.status===(status===500?502:status));
  }
  await assert.rejects(createNoticeGenerator({...configured,generate:async()=>({text:'not json'})}).generate(input),error=>error.status===502);
});

test('missing application method remains unresolved and is surfaced to the reviewer',async()=>{
  const missing={...input,project:{...input.project,applicationUrl:''}},ctx=validateNoticeInput(missing);
  const text=`가을 워크숍 신청을 안내해요.\n${ctx.requiredLines.join('\n')}`;
  let calls=0;
  const result=await createNoticeGenerator({...configured,generate:async()=>({text:JSON.stringify(++calls===1?{body:text}:{supported:true,issues:[]})})}).generate(missing);
  assert.match(result.warnings[0],/신청 방법이 없습니다/);
  assert.throws(()=>validateNoticeBody(text.replace('신청 방법: [확인 필요]\n',''),ctx),error=>error.status===422);
});

test('additional event times in confirmed requirements remain usable without inventing times',()=>{
  const ctx=validateNoticeInput({...input,project:{...input.project,requirements:'행사 시간 10:00부터 17:00까지'}});
  const withTime=body.replace('위 신청','행사 시간 10:00부터 17:00까지\n위 신청');
  assert.equal(validateNoticeBody(withTime,ctx),withTime);
  assert.throws(()=>validateNoticeBody(withTime.replace('17:00까지','16:00까지'),ctx),error=>error.status===422);
});

test('candidate acceptance preserves edits until selection and rejects changed recipients or settings',()=>{
  const draft={body:'직접 고친 본문',purpose:'initial',tone:'friendly',scope:'pending',mode:'dm',confirmed:true,confirmedSignature:'approved'};
  const recipients={list:[{id:1,name:'private name'},{id:2}],channels:[]};
  const project={...input.project,operationalConfirmedAt:'2026-10-06T00:00:00Z'};
  const snapshot=noticeInput(project,draft,recipients),signature=generationSignature(snapshot,recipients);
  assert.doesNotMatch(JSON.stringify(snapshot),/private name/);
  const candidate={body,signature};
  draft.body='생성 중에도 편집';
  draft.tone='concise';
  assert.equal(acceptNoticeCandidate(draft,candidate,generationSignature(noticeInput(project,draft,recipients),recipients)),false);
  assert.equal(draft.body,'생성 중에도 편집');
  draft.tone='friendly';
  const changed={...recipients,list:[{id:3},{id:4}]};
  assert.equal(acceptNoticeCandidate(draft,candidate,generationSignature(snapshot,changed)),false);
  assert.equal(acceptNoticeCandidate(draft,candidate,signature),true);
  assert.equal(draft.body,body);assert.equal(draft.confirmed,false);assert.equal(draft.confirmedSignature,'');
});
