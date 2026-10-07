// A notice points at exact resource revisions. Analysis documents are never
// converted into notice attachments by this module.
import {compareDraftProject} from './notice-draft.js';
const copy=value=>structuredClone(value);
const validKind=new Set(['link','file']);
const validScope=new Set(['project','notice']);

export function makeNoticeResource(input, {projectId, ticketId=null, id=crypto.randomUUID()}={}) {
  if(!projectId)throw new Error('자료에 연결할 프로젝트가 필요합니다.');
  const kind=input?.kind,scope=input?.scope||'notice';
  const label=String(input?.label||'').trim();
  if(!validKind.has(kind)||!validScope.has(scope)||!label||label.length>160)throw new Error('공지 자료의 종류와 이름을 확인해주세요.');
  if(scope==='notice'&&!ticketId)throw new Error('이번 안내의 티켓이 필요합니다.');
  const url=kind==='link'?String(input.url||'').trim():'';
  if(kind==='link'){
    try {if(!['https:','http:'].includes(new URL(url).protocol))throw new Error();}
    catch {throw new Error('올바른 링크 주소를 입력해주세요.');}
  }
  if(kind==='file'&&!input.storagePath)throw new Error('저장된 파일 경로가 필요합니다.');
  const version=input.version??1;
  if(!Number.isInteger(version)||version<1)throw new Error('자료 버전을 확인해주세요.');
  return {id,resourceFamilyId:input.resourceFamilyId||id,version,
    scope,projectId,ticketId:scope==='notice'?ticketId:null,kind,label,
    ...(kind==='link'?{url}:{storagePath:String(input.storagePath),mimeType:String(input.mimeType||''),byteSize:Number(input.byteSize||0),sha256:String(input.sha256||'')}),
    previousResourceId:input.previousResourceId||null};
}

export function reviseNoticeResource(previous, changes, {id=crypto.randomUUID()}={}) {
  if(!previous?.id||!Number.isInteger(previous.version)||previous.version<1)throw new Error('수정할 자료 버전을 찾지 못했습니다.');
  return makeNoticeResource({...previous,...changes,resourceFamilyId:previous.resourceFamilyId||previous.id,
    version:previous.version+1,previousResourceId:previous.id},
  {projectId:previous.projectId,ticketId:previous.ticketId,id});
}

export function selectNoticeResources(resources, {projectId,ticketId}={}) {
  const selected=[],seen=new Set();
  for(const resource of resources||[]){
    if(!resource?.id||!validKind.has(resource.kind)||resource.projectId!==projectId||
       (resource.scope==='notice'&&resource.ticketId!==ticketId)||
       (resource.scope!=='notice'&&resource.scope!=='project')||
       !Number.isInteger(resource.version)||resource.version<1)throw new Error('이번 안내에 사용할 자료를 다시 확인해주세요.');
    const key=`${resource.id}:${resource.version}`;
    if(seen.has(key))continue;
    seen.add(key);selected.push(copy(resource));
  }
  if(selected.length>20)throw new Error('자료는 20개까지 선택할 수 있습니다.');
  return selected;
}

export function latestProjectResources(resources, projectId) {
  const latest=new Map();
  for(const resource of resources||[]){
    if(resource?.scope!=='project'||resource.projectId!==projectId)continue;
    const family=resource.resourceFamilyId||resource.id;
    const previous=latest.get(family);
    if(!previous||resource.version>previous.version)latest.set(family,copy(resource));
  }
  return [...latest.values()];
}

export function snapshotSimulatedNotice({draft,project,projectId,ticketId,resources,recipientIds=[],channelIds=[],sourceCheckedAt=null,date,id}) {
  if(!draft?.body?.trim()||!id||!date||!projectId||!ticketId)throw new Error('기록할 안내 내용이 부족합니다.');
  if(draft.projectReviewRequired || !project || compareDraftProject(draft,project).reviewRequired)
    throw new Error('현재 프로젝트 정보와 이번 안내를 다시 확인해주세요.');
  const selected=selectNoticeResources(resources,{projectId,ticketId});
  return {id,project:projectId,ticket:ticketId,date,source:'simulated',body:draft.body,
    purpose:draft.purpose||null,mode:draft.mode||'dm',recipientIds:copy(recipientIds),channelIds:copy(channelIds),
    resources:selected,noticeInformation:copy(draft.brief||{}),
    projectInformation:copy(draft.projectSnapshot||{}),sourceCheckedAt};
}
