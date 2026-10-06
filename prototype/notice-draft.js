export const NOTICE_PURPOSES = {initial:'첫 안내',reminder:'추가 신청 안내',deadline:'마감 알림'};

export function generationSignature(input,recipients) {
  // Names stay in the browser. Changing the card or recipients invalidates a candidate.
  return JSON.stringify({input,ids:recipients.list.map(e=>e.id).sort((a,b)=>a-b),channels:recipients.channels.map(c=>c.id).sort()});
}

export function acceptNoticeCandidate(draft,candidate,currentSignature) {
  if(!candidate || candidate.signature!==currentSignature || typeof candidate.body!=='string' || !candidate.body.trim())return false;
  draft.body=candidate.body;
  draft.generatedAt=candidate.generatedAt;
  draft.generatedModel=candidate.model;
  draft.briefStale=false;
  draft.confirmed=false;
  draft.confirmedSignature='';
  return true;
}
