import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProjectCandidates} from '../prototype/document-extract.js';

test('structured plan yields candidates with the source lines',()=>{
  const result=extractProjectCandidates(`프로젝트 제목: 가을 워크숍
담당자: 김총무
설명: 팀 구성원이 함께하는 워크숍
신청 시작일: 2026-10-05
신청 마감: 2026년 10월 12일 오후 6시
행사일: 2026-10-20
신청 링크: https://example.org/apply
확정 방식: 별도 승인`);
  assert.equal(result.find(item=>item.field==='deadlineAt').value,'2026-10-12T18:00');
  assert.equal(result.find(item=>item.field==='name').source,'프로젝트 제목: 가을 워크숍');
  assert.equal(result.find(item=>item.field==='confirmationMode').value,'separate');
});

test('missing time and invalid date remain unfilled',()=>{
  const result=extractProjectCandidates('신청 마감: 2026-10-12\n행사일: 2026-02-31');
  assert.deepEqual(result,[]);
});
