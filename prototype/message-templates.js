// Copy for newly generated drafts. Historical sent-message records are never rewritten.
export function buildDraftMessage({title, deadline, owner, applicationUrl}, tone='friendly') {
  const link=applicationUrl||'[신청 링크 확인 필요]';
  if(tone==='concise') return `안녕하세요! ${title} 신청 안내입니다.\n\n신청 마감: ${deadline}\n신청 링크: ${link}\n\n문의: ${owner}`;
  if(tone==='action') return `안녕하세요, 동료 여러분.\n\n${title} 신청 마감은 ${deadline}입니다. 참여를 원하시면 마감 전까지 아래 링크에서 신청을 완료해주세요.\n\n신청 링크: ${link}\n\n문의가 있으면 ${owner}에게 알려주세요.`;
  return `안녕하세요, 동료 여러분!\n\n${title} 신청을 안내해요.\n\n${deadline}까지 아래 링크에서 신청해주세요.\n신청 링크: ${link}\n\n궁금한 점은 ${owner}에게 편하게 알려주세요. 감사합니다!`;
}
