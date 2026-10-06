import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readDocuments, applyOcr } from '../scripts/document-reader.mjs';
import { validateAnalysis, createDocumentAnalyzer } from '../scripts/document-analysis.mjs';
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
  const analyzer=createDocumentAnalyzer({apiKey:'test-secret',model:'gemma-test',generate:async()=>{throw Object.assign(new Error('test-secret in request'),{status:402});}});
  await assert.rejects(analyzer.analyze(input([textFile('a.txt','행사명: 샘플')])),error=>error.status===402&&!error.message.includes('test-secret'));
  const malformed=createDocumentAnalyzer({apiKey:'test',model:'gemma-test',generate:async()=>({text:'not JSON'})});
  await assert.rejects(malformed.analyze(input([textFile('a.txt','행사명: 샘플')])),/응답 형식/);
});
