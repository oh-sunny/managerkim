import {createHash} from 'node:crypto';
import {calculateStatus} from '../prototype/data.js';
import {projectSendSnapshot} from '../prototype/send-preflight.js';

export class SendPlanError extends Error {
  constructor(status,message){super(message);this.status=status;this.publicMessage=message;}
}

const fail=(status,message)=>{throw new SendPlanError(status,message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The database is the sole source of body, audience settings and roster. Client IDs
// identify a saved draft/ticket only; they never specify a recipient or message.
export function buildSendPlan({draft,state,draftId,draftVersion,stateVersion}) {
  const data=draft?.payload,operating=state?.payload;
  if(!data||!operating)fail(404,'저장된 초안과 운영 정보를 먼저 준비해주세요.');
  if(draft.version!==draftVersion||state.version!==stateVersion)fail(409,'초안이나 운영 정보가 변경됐습니다. 다시 확인해주세요.');
  const ticket=operating.tickets?.find(row=>row.id===draftId);
  const project=operating.projects?.find(row=>row.id===ticket?.project);
  if(!ticket||!project||ticket.state!=='pending'||operating.completed?.[ticket.id])fail(409,'발송 가능한 확인할 일이 아닙니다.');
  if(project.dataKind!=='sheet')fail(409,'실제 DM은 Google Sheets와 연결된 프로젝트에서만 사용할 수 있습니다.');
  if(project.lifecycle&&project.lifecycle!=='active')fail(409,'종료되거나 취소된 프로젝트는 발송할 수 없습니다.');
  if(data.mode!=='dm'||!['pending','project','company'].includes(data.scope)||!['team','people'].includes(data.dmSelection))fail(400,'텍스트 DM 초안만 발송할 수 있습니다.');
  if(data.resources?.length)fail(400,'자료 첨부 발송은 아직 지원하지 않습니다. 본문만 확인해주세요.');
  if(data.briefStale)fail(409,'정보 카드를 다시 확인해주세요.');
  if(typeof data.body!=='string'||!data.body.trim()||data.body.length>20000)fail(400,'메시지 본문을 확인해주세요.');
  if(!Array.isArray(operating.employees)||!Array.isArray(operating.applications))fail(409,'직원명부와 신청 현황을 확인할 수 없습니다.');
  let sourceSnapshot;
  try{sourceSnapshot=projectSendSnapshot(project,operating.employees,operating.applications);}
  catch{fail(409,'저장된 신청 현황이 올바르지 않습니다. 다시 가져와주세요.');}
  if(!operating.sheetSync?.spreadsheetId)fail(409,'Google Sheets 원본 정보를 확인할 수 없습니다.');
  const status=calculateStatus(project,operating.applications,operating.employees);
  const target=new Set(status.targetIds),pending=new Set(status.pendingIds);
  const selected=new Set(data.selectedIds||[]),teams=new Set(data.teams||[]);
  const recipients=operating.employees.filter(person=>
    (data.scope==='company'||(data.scope==='project'?target.has(person.id):pending.has(person.id)))&&
    (data.dmSelection==='people'?selected.has(person.id):teams.has(person.team))
  ).map(person=>({employeeId:person.id,name:person.name,team:person.team,email:String(person.email||'').trim().toLowerCase()}));
  if(!recipients.length||recipients.length>10)fail(400,'이번 발송에서는 DM 수신자를 1~10명 선택해주세요.');
  if(recipients.some(person=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))||
     new Set(recipients.map(person=>person.email)).size!==recipients.length)fail(409,'수신자의 회사 이메일이 없거나 중복됐습니다.');
  const plan={draftId,ticketId:ticket.id,projectId:project.id,draftVersion,stateVersion,
    spreadsheetId:operating.sheetSync.spreadsheetId,sourceSnapshot,body:data.body,
    recipients,sourceCheckedAt:operating.sheetSync.lastSuccessAt||null};
  return {...plan,fingerprint:hash(plan)};
}
