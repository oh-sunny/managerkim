import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {calculateStatus, applicationBreakdown, setApplication} from '../prototype/data.js';
import {extractProjectCandidates} from '../prototype/document-extract.js';
import {buildDraftMessage} from '../prototype/message-templates.js';
import {evaluateNotice} from './tools/notice-contract.mjs';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const json = name => JSON.parse(readFileSync(join(root, 'data', name), 'utf8'));
const cases = json('cases.json');
const documents = json('documents.json');
const sources = json('fact-sources.json');
const expectedExtraction = json('expected-extraction.json');
const employees = json('employees.json');
const projects = json('projects.json');
const applications = json('applications.json');
const gold = json('gold-notices.json');
const text = id => readFileSync(join(root, 'source_text', `${id}.txt`), 'utf8');

test('four multi-document cases have usable PDF/DOCX files and explicit fact sources', () => {
  assert.equal(cases.length, 4);
  assert.equal(documents.length, 12);
  assert.deepEqual(new Set(cases.map(c => c.type)), new Set(['복지', '행사', '이벤트']));
  for (const c of cases) {
    assert.equal(c.documents.length, 3, c.id);
    assert.ok(c.documents.some(id => documents.find(d => d.id === id)?.ext === 'pdf'));
    assert.ok(c.documents.some(id => documents.find(d => d.id === id)?.ext === 'docx'));
    for (const field of ['target', 'deadlineAt', 'eventDate', 'applicationUrl', 'confirmationMode']) {
      assert.ok(sources[c.id][field]?.length, `${c.id}: ${field}`);
      for (const id of sources[c.id][field]) assert.ok(c.documents.includes(id), `${c.id}: unknown source ${id}`);
    }
  }
  for (const doc of documents) {
    const path = join(root, 'documents', `${doc.id}.${doc.ext}`);
    assert.ok(statSync(path).size > 1500, path);
    const magic = readFileSync(path).subarray(0, 4);
    assert.equal(magic.toString('latin1', 0, doc.ext === 'pdf' ? 4 : 2), doc.ext === 'pdf' ? '%PDF' : 'PK');
    assert.ok(text(doc.id).includes(doc.title));
  }
});

test('employee roster has stable unique identifiers and fictional contact addresses', () => {
  assert.equal(employees.length, 160);
  assert.equal(new Set(employees.map(e => e.id)).size, 160);
  assert.equal(new Set(employees.map(e => e.employeeNo)).size, 160);
  assert.ok(employees.every(e => e.email.endsWith('@gaonlab.example')));
});

test('expected mandatory and voluntary counts reconcile for every case', () => {
  for (const c of cases) {
    const project = projects.find(p => p.id === c.id);
    const status = calculateStatus(project, applications, employees);
    const rows = applicationBreakdown(status);
    assert.equal(rows.total.target, c.targetCount, c.id);
    assert.equal(rows.required.target, c.requiredCount, c.id);
    assert.equal(rows.total.applied, c.appliedCount, c.id);
    assert.equal(rows.required.applied, c.requiredAppliedCount, c.id);
    assert.equal(rows.required.target + rows.voluntary.target, rows.total.target);
    assert.equal(rows.required.applied + rows.voluntary.applied, rows.total.applied);
    assert.equal(rows.required.pending + rows.voluntary.pending, rows.total.pending);
  }
  const health = calculateStatus(projects[0], applications, employees);
  assert.deepEqual(health.requiredPendingIds, [26, 27, 28, 29, 30]);
  assert.equal(applicationBreakdown(health).voluntary.pending, 7);
  assert.equal(health.rate, 0.9);
});

test('new application, cancellation, and confirmation waiting keep reminder recipients correct', () => {
  const project = projects[0];
  const before = calculateStatus(project, applications, employees);
  assert.ok(before.appliedIds.includes(25));
  assert.ok(!before.confirmedIds.includes(25));
  assert.ok(!before.requiredPendingIds.includes(25));
  const afterApply = calculateStatus(project, setApplication(applications, project.id, 26, 'applied', '2026-10-07T09:00'), employees);
  assert.deepEqual(afterApply.requiredPendingIds, [27, 28, 29, 30]);
  const afterCancel = calculateStatus(project, setApplication(applications, project.id, 25, 'cancelled', '2026-10-07T09:00'), employees);
  assert.deepEqual(afterCancel.requiredPendingIds, [25, 26, 27, 28, 29, 30]);
});

test('multiple source documents contribute facts and the outdated workshop link remains a conflict case', () => {
  const workshop = cases.find(c => c.id === 'workshop-2026');
  const oldText = text('workshop-plan');
  const finalText = text('workshop-rsvp-update');
  assert.ok(oldText.includes(workshop.obsoleteUrls[0]));
  assert.ok(finalText.includes(workshop.applicationUrl));
  const candidates = extractProjectCandidates(finalText);
  assert.equal(candidates.find(item => item.field === 'applicationUrl')?.value, workshop.applicationUrl);
  assert.equal(candidates.find(item => item.field === 'deadlineAt')?.value, workshop.deadlineAt);
  assert.ok(!text('workshop-logistics').includes(workshop.applicationUrl));
  const health = cases.find(c => c.id === 'health-2026');
  assert.ok(!text('health-policy').includes(health.applicationUrl));
  assert.ok(text('health-booking').includes(health.applicationUrl));
});

test('every expected extracted field has verbatim evidence in its named source document', () => {
  for (const c of cases) {
    const expected = expectedExtraction[c.id];
    for (const field of ['name', 'target', 'deadlineAt', 'eventDate', 'applicationUrl', 'confirmationMode']) {
      assert.ok(expected[field]?.value, `${c.id}: ${field} value`);
      if (field !== 'name') assert.equal(expected[field].value, c[field], `${c.id}: ${field}`);
      for (const evidence of expected[field].evidence) {
        assert.ok(c.documents.includes(evidence.documentId), `${c.id}: ${evidence.documentId}`);
        assert.ok(text(evidence.documentId).includes(evidence.quote), `${c.id}: ${field} quote`);
      }
    }
    for (const conflict of expected.conflicts ?? []) {
      assert.ok(text(conflict.documentId).includes(conflict.quote));
    }
  }
});

test('prototype template retains the exact application link for all scenarios', () => {
  for (const c of cases) {
    const draft = buildDraftMessage({title:c.name, deadline:c.deadlineAt, owner:c.owner, applicationUrl:c.applicationUrl});
    assert.ok(draft.includes(c.applicationUrl), c.id);
  }
});

test('reference notices pass factual gates; missing and obsolete links fail', () => {
  for (const item of gold) {
    const c = cases.find(c => c.id === item.caseId);
    const result = evaluateNotice(c, item.text);
    assert.deepEqual(result.errors, [], `${c.id}: ${result.errors.join('; ')}`);
  }
  const workshop = cases.find(c => c.id === 'workshop-2026');
  const good = gold.find(item => item.caseId === workshop.id).text;
  assert.equal(evaluateNotice(workshop, good.replace(workshop.applicationUrl, '')).pass, false);
  assert.equal(evaluateNotice(workshop, good.replace(workshop.applicationUrl, `${workshop.applicationUrl}.`)).pass, true);
  assert.equal(evaluateNotice(workshop, good.replace(workshop.applicationUrl, workshop.obsoleteUrls[0])).pass, false);
  assert.equal(evaluateNotice(workshop, good.replace('오후 6시', '')).pass, false);
  assert.equal(evaluateNotice(workshop, good + ' 이전 안내는 10월 18일까지 회신이라고 적었습니다.').pass, false);
  assert.equal(evaluateNotice(workshop, good + ' 신청 즉시 참석 확정됩니다.').pass, false);
});
