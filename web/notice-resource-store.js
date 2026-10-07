// PostgREST adapter. The caller injects its authenticated request function;
// this module does not create a second auth/session implementation.
import {latestProjectResources} from './notice-resources.js';
export function resourceToRow(resource, ownerId) {
  if(!ownerId||!resource?.id||!resource?.projectId)throw new Error('자료의 저장 대상이 필요합니다.');
  return {id:resource.id,owner_id:ownerId,project_id:resource.projectId,
    ticket_id:resource.scope==='notice'?resource.ticketId:null,scope:resource.scope,
    resource_family_id:resource.resourceFamilyId,previous_resource_id:resource.previousResourceId,
    version:resource.version,kind:resource.kind,label:resource.label,
    url:resource.kind==='link'?resource.url:null,
    storage_path:resource.kind==='file'?resource.storagePath:null,
    mime_type:resource.kind==='file'?resource.mimeType:null,
    byte_size:resource.kind==='file'?resource.byteSize:null,
    sha256:resource.kind==='file'?resource.sha256:null};
}

export function resourceFromRow(row) {
  return {id:row.id,resourceFamilyId:row.resource_family_id||row.id,
    previousResourceId:row.previous_resource_id||null,version:row.version||1,
    projectId:row.project_id,ticketId:row.ticket_id||null,scope:row.scope||'notice',
    kind:row.kind,label:row.label,
    ...(row.kind==='link'?{url:row.url}:{storagePath:row.storage_path,
      mimeType:row.mime_type,byteSize:Number(row.byte_size||0),sha256:row.sha256})};
}

export function createNoticeResourceStore(request) {
  if(typeof request!=='function')throw new Error('인증된 저장 요청 함수가 필요합니다.');
  return {
    async listProject(projectId) {
      if(!projectId)throw new Error('프로젝트를 선택해주세요.');
      const rows=await request(`/rest/v1/notice_resources?project_id=eq.${encodeURIComponent(projectId)}&scope=eq.project&select=*&order=created_at.desc`);
      return latestProjectResources(rows.map(resourceFromRow),projectId);
    },
    async insert(resource,ownerId) {
      const rows=await request('/rest/v1/notice_resources',{
        method:'POST',body:resourceToRow(resource,ownerId),headers:{Prefer:'return=representation'},
      });
      if(!rows?.[0])throw new Error('자료 저장 결과를 확인하지 못했습니다.');
      return resourceFromRow(rows[0]);
    },
  };
}
