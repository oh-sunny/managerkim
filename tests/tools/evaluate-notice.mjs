import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {evaluateNotice} from './notice-contract.mjs';

const input = process.argv[2];
if (!input && process.env.NODE_TEST_CONTEXT) process.exit(0);
if (!input) {
  console.error('Usage: node tests/tools/evaluate-notice.mjs candidate.json');
  console.error('candidate.json: {"caseId":"health-2026","text":"..."}');
  process.exit(2);
}
const cases = JSON.parse(await readFile(new URL('../fixtures/data/cases.json', import.meta.url), 'utf8'));
const candidate = JSON.parse(await readFile(input, 'utf8'));
const testCase = cases.find(item => item.id === candidate.caseId);
if (!testCase) throw new Error(`Unknown caseId: ${candidate.caseId}`);
const result = evaluateNotice(testCase, candidate.text);
console.log(JSON.stringify({caseId:candidate.caseId, ...result}, null, 2));
process.exitCode = result.pass ? 0 : 1;
