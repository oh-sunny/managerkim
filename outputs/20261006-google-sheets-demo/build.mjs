import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SpreadsheetFile, Workbook} from '@oai/artifact-tool';
import {normalizeApplicationSource} from '../../scripts/application-source.mjs';

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const workbook = Workbook.create();
const employeeSheet = workbook.worksheets.add('직원명부');
const projectSheet = workbook.worksheets.add('프로젝트');
const targetSheet = workbook.worksheets.add('대상');
const eventSheet = workbook.worksheets.add('신청이력');

const familyNames = ['김', '이', '박', '최', '정', '강', '조', '윤'];
const givenNames = ['서연', '지훈', '민지', '도윤', '하은', '시우', '유진', '현우', '지민', '수빈', '예준', '서윤', '주원', '다은', '태윤', '가은', '준서', '채원', '민준', '지아'];
const teams = ['마케팅팀', '개발팀', '운영팀', '디자인팀'];
const projects = {health:'연례 건강검진', workshop:'가을 워크숍', event:'사내 사진 공모전'};
const employeeNumber = id => `EMP-${String(id).padStart(4, '0')}`;
const person = id => ({name:`${familyNames[Math.floor((id - 1) / 20)]}${givenNames[(id - 1) % 20]}`, team:teams[(id - 1) % 4]});
const employeeRows = Array.from({length:160}, (_, i) => {
  const id = i + 1, teamIndex = i % 4, team = teams[teamIndex];
  const hireYear = 2017 + (i % 9), hireMonth = 1 + (Math.floor(i / 9) % 12);
  const isTeamLead = id === teamIndex + 1;
  return {
    employeeId:id, employeeNumber:employeeNumber(id), name:person(id).name,
    email:`employee${String(id).padStart(4, '0')}@example.com`,
    division:['사업본부','제품본부','경영지원본부','크리에이티브본부'][teamIndex], team,
    grade:isTeamLead ? '부장' : ['사원','대리','과장','차장'][Math.floor(i / 4) % 4],
    position:isTeamLead ? '팀장' : '팀원', employmentType:id % 13 === 0 ? '계약직' : '정규직',
    status:id >= 157 ? '휴직' : '재직',
    hiredAt:`${hireYear}-${String(hireMonth).padStart(2, '0')}-${String(1 + (i % 26)).padStart(2, '0')}`,
    location:teamIndex === 1 ? '판교 오피스' : '서울 본사',
    managerNumber:isTeamLead ? '' : employeeNumber(teamIndex + 1),
  };
});

const targets = [
  ...Array.from({length:12}, (_, i) => ({projectId:'health', employeeId:i + 1, required:[1, 4, 9, 12].includes(i + 1)})),
  ...Array.from({length:8}, (_, i) => ({projectId:'workshop', employeeId:i + 1, required:[2, 6].includes(i + 1)})),
  ...Array.from({length:6}, (_, i) => ({projectId:'event', employeeId:i + 5, required:false})),
];

const events = [
  ['H-001','health',1,'applied','2026-09-15T09:10:00+09:00','첫 신청'],
  ['H-002','health',1,'confirmed','2026-09-16T10:00:00+09:00','신청 확정'],
  ['H-003','health',2,'applied','2026-09-17T11:00:00+09:00','첫 신청'],
  ['H-004','health',2,'cancelled','2026-09-20T12:00:00+09:00','일정 변경'],
  ['H-005','health',2,'applied','2026-10-01T13:00:00+09:00','다시 신청'],
  ['H-006','health',2,'confirmed','2026-10-02T09:00:00+09:00','재신청 확정'],
  ['H-007','health',3,'confirmed','2026-09-18T14:00:00+09:00','신청 확정'],
  ['H-008','health',4,'applied','2026-09-19T15:00:00+09:00','첫 신청'],
  ['H-009','health',4,'cancelled','2026-10-03T10:00:00+09:00','본인 요청'],
  ['H-010','health',5,'confirmed','2026-09-22T09:20:00+09:00','신청 확정'],
  ['H-011','health',6,'confirmed','2026-09-23T10:30:00+09:00','신청 확정'],
  ['W-001','workshop',1,'confirmed','2026-09-27T10:00:00+09:00','신청 확정'],
  ['W-002','workshop',2,'applied','2026-09-29T11:00:00+09:00','신청 접수'],
  ['W-003','workshop',3,'confirmed','2026-09-30T12:00:00+09:00','신청 확정'],
  ['W-004','workshop',6,'applied','2026-10-01T09:30:00+09:00','신청 접수'],
  ['W-005','workshop',6,'cancelled','2026-10-03T16:00:00+09:00','참여 불가'],
  ['E-001','event',5,'applied','2026-10-04T10:00:00+09:00','작품 제출'],
].map(([sourceEventId, projectId, employeeId, status, occurredAt, reason]) =>
  ({sourceEventId, projectId, employeeId, status, occurredAt, reason}));

const snapshot = normalizeApplicationSource({
  targetRows:targets.map(row => ({...row, required:row.required ? 'TRUE' : 'FALSE'})),
  eventRows:events,
  knownEmployeeIds:Array.from({length:160}, (_, i) => i + 1),
  knownProjectIds:Object.keys(projects),
  lastSuccessAt:'2026-10-06T09:00:00+09:00',
});
if (snapshot.targets.length !== 26 || snapshot.events.length !== 17 || snapshot.applications.length !== 11) {
  throw new Error('예시 데이터의 대상·이력·최신 신청 건수가 예상과 다릅니다.');
}

const employeeValues = [
  ['employeeId','사번','이름','회사 이메일','본부','팀','직급','직책','고용 형태','재직 상태','입사일','근무지','관리자 사번'],
  ...employeeRows.map(row => [row.employeeId,row.employeeNumber,row.name,row.email,row.division,row.team,row.grade,
    row.position,row.employmentType,row.status,row.hiredAt,row.location,row.managerNumber]),
];
employeeSheet.getRange(`A1:M${employeeValues.length}`).values = employeeValues;
employeeSheet.getRange(`K2:K${employeeValues.length}`).setNumberFormat('yyyy-mm-dd');

const projectValues = [
  ['projectId','프로젝트명','종류','담당자 사번','신청 시작일','신청 마감 시각','운영일','확정 방식'],
  ['health',projects.health,'복지','EMP-0003','2026-09-01','2026-10-05 18:00','2026-10-31','신청 즉시 확정'],
  ['workshop',projects.workshop,'행사','EMP-0003','2026-09-01','2026-10-08 18:00','2026-10-16','신청 즉시 확정'],
  ['event',projects.event,'이벤트','EMP-0003','2026-10-01','2026-10-13 18:00','2026-10-20','별도 선정'],
];
projectSheet.getRange('A1:H4').values = projectValues;
projectSheet.getRange('E2:E4').setNumberFormat('yyyy-mm-dd');
projectSheet.getRange('F2:F4').setNumberFormat('yyyy-mm-dd hh:mm');
projectSheet.getRange('G2:G4').setNumberFormat('yyyy-mm-dd');

const targetValues = [
  ['projectId','employeeId','required','사번 (참고)','프로젝트명 (참고)','이름 (참고)','팀 (참고)'],
  ...targets.map(row => [row.projectId, row.employeeId, row.required ? 'TRUE' : 'FALSE', employeeNumber(row.employeeId),
    projects[row.projectId], person(row.employeeId).name, person(row.employeeId).team]),
];
targetSheet.getRange(`A1:G${targetValues.length}`).values = targetValues;

const eventValues = [
  ['sourceEventId','projectId','employeeId','status','occurredAt','사번 (참고)','이름 (참고)','사유 (참고)','상태 설명 (참고)'],
  ...events.map(row => [row.sourceEventId, row.projectId, row.employeeId, row.status, row.occurredAt.replace('T', ' ').replace('+09:00', ' KST'),
    employeeNumber(row.employeeId), person(row.employeeId).name, row.reason,
    ({applied:'신청 접수', confirmed:'확정', cancelled:'신청 취소'})[row.status]]),
];
eventSheet.getRange(`A1:I${eventValues.length}`).values = eventValues;

for (const [sheet, cols, rows, widths] of [
  [employeeSheet, 'M', employeeValues.length, [100,110,100,210,150,120,80,80,100,100,115,120,115]],
  [projectSheet, 'H', projectValues.length, [115,170,100,110,125,165,125,150]],
  [targetSheet, 'G', targetValues.length, [115,100,90,110,160,115,115]],
  [eventSheet, 'I', eventValues.length, [120,110,100,100,240,110,115,120,125]],
]) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRange(`A1:${cols}${rows}`).format.font = {name:'Arial', size:10, color:'#24313A'};
  sheet.getRange(`A1:${cols}1`).format = {fill:'#263D4A', font:{name:'Arial', size:10, color:'#FFFFFF', bold:true}, rowHeight:30, verticalAlignment:'center', horizontalAlignment:'center'};
  sheet.getRange(`A2:${cols}${rows}`).format.rowHeight = 24;
  sheet.getRange(`A2:${cols}${rows}`).format.verticalAlignment = 'center';
  widths.forEach((width, index) => sheet.getRangeByIndexes(0, index, rows, 1).format.columnWidthPx = width);
  sheet.getRange(`A1:${cols}${rows}`).format.borders = {bottom:{style:'thin', color:'#E2E8E7'}};
}
employeeSheet.freezePanes.freezeColumns(2);
targetSheet.getRange(`D2:G${targetValues.length}`).format.fill = '#F4F7F6';
targetSheet.getRange('D1:G1').format = {fill:'#42685E', font:{name:'Arial', size:10, color:'#FFFFFF', bold:true}, rowHeight:30, horizontalAlignment:'center'};
eventSheet.getRange(`F2:I${eventValues.length}`).format.fill = '#F4F7F6';
eventSheet.getRange('F1:I1').format = {fill:'#42685E', font:{name:'Arial', size:10, color:'#FFFFFF', bold:true}, rowHeight:30, horizontalAlignment:'center'};
eventSheet.getRange(`A2:A${eventValues.length}`).format.font = {name:'Arial', size:10, color:'#345B79'};

workbook.recalculate();
for (const [sheetName, range, fileName] of [
  ['직원명부','A1:M11','employees-preview.png'],
  ['프로젝트','A1:H4','projects-preview.png'],
  ['대상','A1:G16','targets-preview.png'],
  ['신청이력','A1:I18','events-preview.png'],
]) {
  const preview = await workbook.render({sheetName, range, scale:1.5, format:'png'});
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}
const check = await workbook.inspect({kind:'table', range:'직원명부!A1:M3', include:'values', tableMaxRows:3, tableMaxCols:13});
console.log(check.ndjson);
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(path.join(outputDir, '총무_직원명부_프로젝트_신청이력_예시.xlsx'));
console.log(JSON.stringify({employees:employeeRows.length, targets:snapshot.targets.length, events:snapshot.events.length, latest:snapshot.applications.length}));
