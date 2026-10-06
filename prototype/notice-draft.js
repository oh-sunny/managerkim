export const NOTICE_PURPOSES = {initial:'첫 안내',reminder:'추가 신청 안내',deadline:'마감 알림'};

export function noticeInput(project,draft,recipients) {
  const facts=Object.fromEntries(['name','description','start','deadlineAt','event','owner','applicationUrl','location','audience','capacity','requirements','confirmationMode'].map(key=>[key,project[key]||'']));
  const scope={pending:'아직 신청하지 않은 동료',project:'프로젝트 대상 동료',company:'전체 동료'}[draft.scope];
  const label=draft.mode==='channel'?`${recipients.channels.map(c=>c.name).join(', ')} 구성원`:`${scope} 중 선택한 동료 ${recipients.list.length}명`;
  return {project:{...facts,confirmed:Boolean(project.operationalConfirmedAt)},purpose:draft.purpose,tone:draft.tone,recipient:{mode:draft.mode,label,count:recipients.list.length}};
}

export function generationSignature(input,recipients) {
  // IDs stay in the browser, but changing recipients invalidates a pending result.
  return JSON.stringify({input,ids:recipients.list.map(e=>e.id).sort((a,b)=>a-b),channels:recipients.channels.map(c=>c.id).sort()});
}

export function acceptNoticeCandidate(draft,candidate,currentSignature) {
  if(!candidate || candidate.signature!==currentSignature || typeof candidate.body!=='string' || !candidate.body.trim())return false;
  draft.body=candidate.body;
  draft.confirmed=false;
  draft.confirmedSignature='';
  return true;
}
