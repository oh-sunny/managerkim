export const NOTICE_PURPOSES = {initial:'첫 안내',reminder:'추가 신청 안내',deadline:'마감 알림'};

export function noticePurposeForTicket(ticket,hasInitialRecord=false) {
  const text=`${ticket.title||''} ${ticket.purpose||''}`;
  if(ticket.kind==='initial'||ticket.purpose==='첫 안내')return 'initial';
  if(['required','voluntary'].includes(ticket.kind))return ticket.triggers?.some(trigger=>trigger.startsWith('deadline-'))?'deadline':'reminder';
  if(ticket.kind==='deadline'||/D-\d|마감|마지막/.test(text))return 'deadline';
  return ticket.kind==='reminder'||/리마인드|다시|추가|한 번 더|필수 참여/.test(text)||hasInitialRecord?'reminder':'initial';
}

export const BRIEF_LABELS={what:'무엇을',audience:'대상',action:'해야 할 일',deadline:'마감',schedule:'언제·어디서',method:'신청 방법',cost:'비용·지원',exception:'예외·유의사항',contact:'문의',links:'링크·자료'};

// These are the project facts used to prepare a notice. Keep the source values,
// rather than rendered card text, so a saved draft can be compared after edits.
export const NOTICE_PROJECT_FIELDS=['name','audience','event','eventLabel','location','deadlineAt','requirements','applicationUrl','owner'];

export function noticeProjectSnapshot(project) {
  const source=project||{};
  return Object.fromEntries(NOTICE_PROJECT_FIELDS.map(key=>[key,String(source[key]??'')]));
}

export function prepareNoticeDraft(project, values={}) {
  return {
    ...values,
    brief:values.brief?structuredClone(values.brief):makeNoticeBrief(project),
    projectSnapshot:noticeProjectSnapshot(project),
    projectReviewRequired:false,
  };
}

export function compareDraftProject(draft, project) {
  const current=noticeProjectSnapshot(project);
  const stored=draft?.projectSnapshot;
  if(!stored || typeof stored!=='object')return {reviewRequired:true,legacy:true,changed:[],current};
  const changed=NOTICE_PROJECT_FIELDS.filter(key=>String(stored[key]??'')!==current[key])
    .map(key=>({field:key,previous:String(stored[key]??''),current:current[key]}));
  return {reviewRequired:changed.length>0,legacy:false,changed,current};
}

export function restoreNoticeDraft(saved, project) {
  const draft=structuredClone(saved||{});
  draft.brief=draft.brief&&typeof draft.brief==='object'?draft.brief:makeNoticeBrief(project);
  const comparison=compareDraftProject(draft,project);
  draft.projectReviewRequired=comparison.reviewRequired;
  // Approval is session-only. A loaded draft must always be confirmed again.
  draft.confirmed=false;
  draft.confirmedSignature='';
  return {draft,comparison};
}

export function acceptProjectReview(draft, project, reviewedBrief) {
  if(!reviewedBrief || typeof reviewedBrief!=='object')throw new Error('이번 안내의 정보를 확인해주세요.');
  const next=structuredClone(draft);
  next.brief=structuredClone(reviewedBrief);
  next.projectSnapshot=noticeProjectSnapshot(project);
  next.projectReviewRequired=false;
  next.confirmed=false;
  next.confirmedSignature='';
  next.briefStale=true;
  return next;
}

export function makeNoticeBrief(project) {
  const p=project||{};
  const requirements=String(p.requirements||'');
  const lines=requirements.split(/\r?\n/).map(line=>line.replace(/^[-•*]\s*/,'').trim()).filter(Boolean);
  const cost=lines.filter(line=>/비용|지원금|본인\s*부담|무료|유료/.test(line)).join('\n');
  const exception=lines.filter(line=>/취소|변경|불가|제외|주의|예외/.test(line)).join('\n');
  const method=lines.filter(line=>!cost.split('\n').includes(line)&&!exception.split('\n').includes(line)).join('\n');
  const action=method.split('\n').find(line=>/신청|제출|선택|등록|예약|참여|접수|작성|업로드|입력|응모/.test(line))||'';
  const deadline=String(p.deadlineAt||'');
  const [month,day]=deadline.slice(0,10).split('-').slice(1);
  const values={what:p.name||'',audience:p.audience||'',action,
    deadline:month&&day?`${Number(month)}월 ${Number(day)}일${deadline.length>=16?` ${deadline.slice(11,16)}`:''}까지`:'',
    schedule:[p.event&&(p.eventLabel||'운영 일정'),p.event,p.location].filter(Boolean).join(' · '),
    method,cost,exception,contact:p.owner||'',links:p.applicationUrl||''};
  const fromField={what:['name'],audience:['audience'],action:['requirements'],deadline:['deadlineAt'],schedule:['event','location'],method:['requirements'],cost:['requirements'],exception:['requirements'],contact:['owner'],links:['applicationUrl']};
  return Object.fromEntries(Object.entries(values).map(([key,raw])=>{
    const value=String(raw);
    const fields=fromField[key]||[];
    const review=p.sourceReviews?.find(row=>fields.includes(row.field));
    const issue=p.sourceIssues?.find(row=>fields.includes(row.field));
    const evidence=(review?.manuallyEdited?[]:review?.evidence||[]).slice(0,3).map(({sourceName,location,quote,method})=>({sourceName,location,quote,method}));
    const status=!value?'missing':issue?.status==='conflict'||review?.status==='conflict'?'conflict':issue?.status==='review'||review?.status==='review'||['cost','exception'].includes(key)?'needs_review':'confirmed';
    const source=review?.manuallyEdited?'담당자 수정':evidence.length?`${evidence[0].sourceName} · 자료에서 확인됨`:value?'프로젝트 정보':'확인 필요';
    return [key,{value,included:Boolean(value),status,source,evidence}];
  }));
}

export function generationSignature(input,recipients) {
  // Names stay in the browser. Changing the card or recipients invalidates a candidate.
  return JSON.stringify({input,ids:recipients.list.map(e=>e.id).sort((a,b)=>a-b),channels:recipients.channels.map(c=>c.id).sort()});
}

export function acceptNoticeCandidate(draft,candidate,currentSignature) {
  if(draft?.projectReviewRequired || !candidate || candidate.signature!==currentSignature || typeof candidate.body!=='string' || !candidate.body.trim())return false;
  draft.body=candidate.body;
  draft.generatedAt=candidate.generatedAt;
  draft.generatedModel=candidate.model;
  draft.briefStale=false;
  draft.confirmed=false;
  draft.confirmedSignature='';
  return true;
}
