import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareNoticeDraft,compareDraftProject,restoreNoticeDraft,acceptProjectReview,acceptNoticeCandidate,noticePurposeForTicket} from '../web/notice-draft.js';
import {makeNoticeResource,reviseNoticeResource,selectNoticeResources,latestProjectResources,snapshotSimulatedNotice} from '../web/notice-resources.js';
import {createNoticeResourceStore,resourceToRow,resourceFromRow} from '../web/notice-resource-store.js';

const project={name:'건강검진',audience:'전 직원',requirements:'검진기관을 선택해 신청',deadlineAt:'2026-10-16T18:00',applicationUrl:'https://example.org/apply'};

test('scheduled rule checkpoints start with a reminder purpose, while first and final notices stay distinct',()=>{
  assert.equal(noticePurposeForTicket({kind:'initial',title:'첫 안내 준비',purpose:'첫 안내'}),'initial');
  assert.equal(noticePurposeForTicket({kind:'voluntary',title:'자율 신청 현황 확인',purpose:'D-3',triggers:['D-3']}),'reminder');
  assert.equal(noticePurposeForTicket({kind:'required',title:'필수 대상 신청 현황 확인',purpose:'D-1',triggers:['D-1']}),'reminder');
  assert.equal(noticePurposeForTicket({kind:'required',title:'마감 직전 확인',purpose:'마감 4시간 전',triggers:['deadline-4h']}),'deadline');
});

test('new notice uses current project and an old draft preserves its work for explicit review',()=>{
  const saved=prepareNoticeDraft(project,{body:'제가 고친 본문',purpose:'initial',resources:[{id:'old-file'}],recipientIds:[1]});
  const revised={...project,deadlineAt:'2026-10-20T18:00',applicationUrl:'https://example.org/new'};
  const {draft,comparison}=restoreNoticeDraft(saved,revised);
  assert.deepEqual(comparison.changed.map(item=>item.field),['deadlineAt','applicationUrl']);
  assert.equal(draft.body,'제가 고친 본문');
  assert.equal(draft.brief.deadline.value,'10월 16일 18:00까지');
  assert.deepEqual(draft.resources,[{id:'old-file'}]);
  assert.equal(draft.projectReviewRequired,true);
  assert.equal(draft.confirmed,false);
  assert.equal(acceptNoticeCandidate(draft,{body:'AI 후보',signature:'same'},'same'),false);
  const reviewed=acceptProjectReview(draft,revised,{...draft.brief,deadline:{...draft.brief.deadline,value:'10월 20일 18:00까지'}});
  assert.equal(reviewed.body,'제가 고친 본문');
  assert.equal(reviewed.brief.deadline.value,'10월 20일 18:00까지');
  assert.equal(reviewed.projectReviewRequired,false);
  assert.equal(compareDraftProject(reviewed,revised).reviewRequired,false);
  assert.equal(draft.projectReviewRequired,true);
  assert.equal(prepareNoticeDraft(revised).brief.deadline.value,'10월 20일 18:00까지');
});

test('resource store maps owner-scoped project rows and preserves exact revisions',async()=>{
  const resource=makeNoticeResource({kind:'link',scope:'project',label:'신청 링크',url:'https://example.org'},
    {projectId:'health',id:'00000000-0000-4000-8000-000000000001'});
  const row=resourceToRow(resource,'owner-1');
  assert.equal(row.project_id,'health');
  assert.equal(row.resource_family_id,resource.id);
  assert.deepEqual(resourceFromRow(row),resource);
  const calls=[];
  const store=createNoticeResourceStore(async(path,options)=>{
    calls.push({path,options});
    return options?[options.body]:[row];
  });
  assert.deepEqual(await store.insert(resource,'owner-1'),resource);
  assert.deepEqual(await store.listProject('health'),[resource]);
  assert.match(calls[1].path,/project_id=eq.health&scope=eq.project/);
  assert.equal(calls[0].options.body.owner_id,'owner-1');
});

test('legacy saved draft requires review and keeps body, recipients and resources',()=>{
  const legacy={body:'옛 본문',brief:{what:{value:'옛 행사'}},selectedIds:[5],resources:[{kind:'link',label:'기존 링크',url:'https://example.org'}],confirmed:true};
  const {draft,comparison}=restoreNoticeDraft(legacy,project);
  assert.equal(comparison.legacy,true);
  assert.equal(draft.projectReviewRequired,true);
  assert.deepEqual(draft.brief,legacy.brief);
  assert.deepEqual(draft.resources,legacy.resources);
  assert.deepEqual(draft.selectedIds,[5]);
  assert.equal(draft.confirmed,false);
});

test('resources retain exact revision, scope and project ownership in selection and record',()=>{
  const link=makeNoticeResource({kind:'link',scope:'project',label:'신청 안내',url:'https://example.org/apply'},
    {projectId:'health',id:'family-1'});
  const revised=reviseNoticeResource(link,{url:'https://example.org/new'},{id:'revision-2'});
  const file=makeNoticeResource({kind:'file',label:'안내문',storagePath:'owner/file',mimeType:'application/pdf',byteSize:10},
    {projectId:'health',ticketId:'ticket-1',id:'file-1'});
  assert.equal(revised.resourceFamilyId,link.id);
  assert.equal(revised.version,2);
  assert.equal(revised.previousResourceId,link.id);
  assert.equal(link.url,'https://example.org/apply');
  assert.deepEqual(latestProjectResources([link,revised], 'health').map(item=>item.id),['revision-2']);
  assert.deepEqual(selectNoticeResources([link,file,link],{projectId:'health',ticketId:'ticket-1'}).map(item=>item.id),['family-1','file-1']);
  assert.throws(()=>selectNoticeResources([file],{projectId:'health',ticketId:'other'}),/다시 확인/);
  assert.throws(()=>selectNoticeResources([link],{projectId:'other',ticketId:'ticket-1'}),/다시 확인/);
  const draft=prepareNoticeDraft(project,{body:'확인한 공지',purpose:'initial',mode:'dm'});
  assert.throws(()=>snapshotSimulatedNotice({draft,project:{...project,deadlineAt:'2026-10-21T18:00'},projectId:'health',ticketId:'ticket-1',resources:[link,file],date:'2026-10-07T10:00:00Z',id:'record-stale'}),/다시 확인/);
  const record=snapshotSimulatedNotice({draft,project,projectId:'health',ticketId:'ticket-1',resources:[link,file],
    recipientIds:[1,2],date:'2026-10-07T10:00:00Z',sourceCheckedAt:'2026-10-07T09:59:00Z',id:'record-1'});
  draft.body='다른 본문';draft.brief.what.value='다른 행사';file.label='바뀐 이름';
  assert.equal(record.body,'확인한 공지');
  assert.equal(record.noticeInformation.what.value,'건강검진');
  assert.equal(record.resources[1].label,'안내문');
  assert.equal(record.resources[0].version,1);
  assert.equal(record.source,'simulated');
});
