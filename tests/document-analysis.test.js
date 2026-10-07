import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDocuments, applyOcr } from '../scripts/document-reader.mjs';
import { evidenceIndex, parseModelJson, validateAnalysis, createDocumentAnalyzer } from '../scripts/document-analysis.mjs';
import { applicableValue } from '../prototype/analysis-contract.js';
import { scannedPdf } from './helpers/scanned-pdf.mjs';

const textFile = (name,text) => ({name,data:Buffer.from(text).toString('base64')});
const input = files => ({files,text:'',forceOcr:false});
const file = async name => ({name,data:(await readFile(new URL(`./fixtures/documents/${name}`,import.meta.url))).toString('base64')});

test('reads actual PDF and DOCX fixtures together with source locations', async()=>{
  const {sources,images} = await readDocuments(input(await Promise.all(['workshop-plan.docx','workshop-logistics.pdf','workshop-rsvp-update.docx'].map(file))));
  assert.equal(sources.length,3);assert.equal(images.length,0);
  assert.ok(sources[0].segments.some(s=>s.text.includes('10월 18일')));
  assert.ok(sources[1].segments.some(s=>s.location.includes('1쪽')));
  assert.ok(sources[2].segments.some(s=>s.text.includes('/rsvp')));
});

test('image fallback renders PDF pages and requires complete OCR results',async()=>{
  const {sources,images}=await readDocuments({...input([await file('workshop-logistics.pdf')]),forceOcr:true});
  assert.ok(images.length>0);assert.equal(sources[0].segments.length,0);
  assert.equal(Buffer.from(images[0].data,'base64').subarray(1,4).toString(),'PNG');
  assert.throws(()=>applyOcr(sources,images,{pages:[]}),/페이지 수/);
  applyOcr(sources,images,{pages:images.map(image=>({id:image.id,text:'행사명: OCR로 읽은 가상 행사'}))});
  assert.ok(sources[0].segments.every(s=>s.method==='ocr'));
});

test('image-only PDF automatically takes the OCR path and blank OCR does not succeed',async()=>{
  const {sources,images}=await readDocuments(input([{name:'scan.pdf',data:scannedPdf().toString('base64')}]));
  assert.equal(images.length,1);assert.equal(sources[0].segments.length,0);
  assert.throws(()=>applyOcr(sources,images,{pages:[{id:images[0].id,text:''}]}),/글자를 읽지/);
});

test('rejects disguised files, invalid UTF-8, too many files and oversize text',async()=>{
  await assert.rejects(readDocuments(input([textFile('bad.pdf','not a pdf')])),/PDF/);
  await assert.rejects(readDocuments(input([{name:'bad.txt',data:Buffer.from([255,254]).toString('base64')}])),/파일을 읽지/);
  await assert.rejects(readDocuments(input(Array.from({length:7},(_,i)=>textFile(`${i}.txt`,'text')))),/개수/);
  await assert.rejects(readDocuments({...input([]),text:'a'.repeat(80001)}),/길이/);
});

test('rejects invented evidence and retains explicit conflicting deadlines and links',async()=>{
  const {sources}=await readDocuments(input([
    textFile('old.txt','신청 마감: 2026년 11월 8일 오후 6시\n신청 링크: https://example.org/old'),
    textFile('new.txt','신청 마감: 2026년 11월 10일 오후 6시\n신청 링크: https://example.org/new'),
  ]));
  const fields=validateAnalysis({fields:[{field:'owner',options:[{value:'없는 담당자',evidence:[{sourceId:'source-1',segmentId:'source-1-s1',quote:'담당자는 김총무입니다.'}]}]}]},sources);
  assert.equal(fields.find(row=>row.field==='owner').status,'review');
  assert.equal(fields.find(row=>row.field==='owner').options.length,0);
  assert.equal(fields.find(row=>row.field==='deadlineAt').status,'conflict');
  assert.equal(fields.find(row=>row.field==='applicationUrl').options.length,2);
  assert.equal(fields.find(row=>row.field==='location').status,'missing');
});

test('incomplete dates, invalid dates and unsafe URLs cannot fill operating fields',()=>{
  assert.equal(applicableValue('deadlineAt','2026-11-08'),null);
  assert.equal(applicableValue('deadlineAt','2026-02-30T18:00'),null);
  assert.equal(applicableValue('applicationUrl','javascript:alert(1)'),null);
  assert.equal(applicableValue('deadlineAt','2026-11-08T18:00'),'2026-11-08T18:00');
});

test('model failures and invalid JSON return safe actionable errors without exposing credentials',async()=>{
  const analyzer=createDocumentAnalyzer({apiKey:'test-secret',model:'gemini-3.7-flash',generate:async()=>{throw Object.assign(new Error('test-secret in request'),{status:402});}});
  await assert.rejects(analyzer.analyze(input([textFile('a.txt','행사명: 샘플')])),error=>error.status===402&&!error.message.includes('test-secret'));
  const malformed=createDocumentAnalyzer({apiKey:'test',model:'gemini-3.7-flash',generate:async()=>({text:'not JSON'})});
  await assert.rejects(malformed.analyze(input([textFile('a.txt','행사명: 샘플')])),/응답 형식/);
});

test('accepts a complete JSON object with Markdown/prose but rejects ambiguous or incomplete output',()=>{
  const raw={fields:[{field:'name',options:[]}]};
  for (const text of [JSON.stringify(raw),'```json\n'+JSON.stringify(raw)+'\n```','분석 결과입니다.\n```json\n'+JSON.stringify(raw)+'\n```\n검토해주세요.']) assert.deepEqual(parseModelJson(text),raw);
  for (const text of ['{"fields":[{"field":"name","options":[]}',JSON.stringify(raw)+'\n'+JSON.stringify(raw),'[ '+JSON.stringify(raw),'설명 {"fields":[]} trailing }']) assert.throws(()=>parseModelJson(text),error=>error.code==='MODEL_JSON');
  assert.throws(()=>parseModelJson(' '),error=>error.code==='MODEL_EMPTY');
  assert.throws(()=>parseModelJson('x'.repeat(150001)),error=>error.code==='MODEL_SIZE');
});

test('retries malformed output once using original documents and still rejects invented evidence',async()=>{
  const requests=[],diagnostics=[];
  const valid={fields:[{field:'name',options:[{value:'샘플',evidence:[{sourceId:'source-1',segmentId:'source-1-s1',quote:'행사명: 샘플'}]}]},{field:'owner',options:[{value:'없는 담당자',evidence:[{sourceId:'source-1',segmentId:'source-1-s1',quote:'없는 근거'}]}]}]};
  const analyzer=createDocumentAnalyzer({apiKey:'test-secret',model:'gemini-3.7-flash',onDiagnostic:e=>diagnostics.push(e),generate:async request=>{requests.push(request);return {text:requests.length===1?'invalid secret output':JSON.stringify(valid),candidates:[{finishReason:'STOP'}]};}});
  const result=await analyzer.analyze(input([textFile('a.txt','행사명: 샘플')]));
  assert.equal(requests.length,2);assert.deepEqual(requests[0].contents,requests[1].contents);
  assert.deepEqual(requests[0].config.thinkingConfig,{thinkingLevel:'low'});
  assert.match(requests[1].config.systemInstruction,/이전 응답/);
  assert.ok(requests[1].config.httpOptions.timeout<=65000);
  assert.equal(result.fields.find(f=>f.field==='name').options[0].value,'샘플');
  assert.equal(result.fields.find(f=>f.field==='owner').status,'review');
  assert.equal(diagnostics[0].code,'MODEL_JSON');assert.equal(diagnostics[0].retry,true);
  assert.doesNotMatch(JSON.stringify(diagnostics),/test-secret|invalid secret output|행사명/);
});

test('never accepts a truncated or blocked response even if its text is valid JSON',async()=>{
  for (const [reason,code,calls] of [['MAX_TOKENS','MODEL_TRUNCATED',2],['SAFETY','MODEL_BLOCKED',1]]) {
    let count=0;
    const analyzer=createDocumentAnalyzer({apiKey:'test',model:'gemini-3.7-flash',onDiagnostic:()=>{},generate:async()=>{count++;return {text:'{"fields":[{"field":"name","options":[]}]}',candidates:[{finishReason:reason}]};}});
    await assert.rejects(analyzer.analyze(input([textFile('a.txt','행사명: 샘플')])),error=>error.code===code);
    assert.equal(count,calls);
  }
});

test('OCR and extraction share one retry budget for the whole analysis',async()=>{
  let count=0;
  const analyzer=createDocumentAnalyzer({apiKey:'test',model:'gemini-3.7-flash',onDiagnostic:()=>{},reader:async()=>({sources:[{id:'source-1',name:'a.pdf',segments:[],warnings:[]}],images:[{id:'source-1-p1',sourceId:'source-1',page:1,data:''}]}),generate:async()=>{count++;return {text:count===2?JSON.stringify({pages:[{id:'source-1-p1',text:'행사명: 샘플'}]}):'invalid'};}});
  await assert.rejects(analyzer.analyze(input([])),error=>error.code==='MODEL_JSON');
  assert.equal(count,3);
});

test('compact evidence IDs resolve to literal source excerpts and reject invented IDs',async()=>{
  const {sources}=await readDocuments(input([textFile('health.txt','대상: 임직원 120명\n신청: 로그인 → 기관 선택 → 제출\n예약 확정은 별도 안내합니다.\nhttps://example.org/health/apply')]));
  const refs=evidenceIndex(sources);
  assert.ok(refs.every(ref=>sources[0].segments.find(s=>s.id===ref.segmentId).text.includes(ref.quote)));
  assert.ok(refs.some(ref=>ref.quote.includes('https://example.org/health/apply')));
  const applyRef=refs.find(ref=>ref.quote.includes('로그인'));
  const fields=validateAnalysis({fields:[{field:'requirements',options:[{value:'로그인 → 기관 선택 → 제출',evidence:[applyRef.id]}]},{field:'owner',options:[{value:'가짜 담당자',evidence:['e99999']}]}]},sources,refs);
  assert.equal(fields.find(f=>f.field==='requirements').options[0].evidence[0].quote,applyRef.quote);
  assert.equal(fields.find(f=>f.field==='owner').status,'review');
  assert.equal(fields.find(f=>f.field==='owner').options.length,0);
});
