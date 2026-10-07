export const BRIEF_FIELDS=['what','audience','action','deadline','schedule','method','cost','exception','contact','links'];
export const BRIEF_FIELD_LABELS={what:'무엇을',audience:'대상',action:'해야 할 일',deadline:'마감',schedule:'언제·어디서',method:'신청 방법',cost:'비용·지원',exception:'예외·유의사항',contact:'문의',links:'링크·자료'};
export const NOTICE_TONE_LABELS={friendly:'밝고 친근하게',concise:'간결하고 명료하게',formal:'정중하고 차분하게',action:'행동 요청 중심으로'};
export const NOTICE_KINDS=['initial','reminder','deadline'];

// This pure contract is shared by the browser preview and the server request.
export function prepareNoticeGeneration(input){
  if(!input||typeof input!=='object'||!Object.hasOwn(NOTICE_TONE_LABELS,input.tone)||
     !NOTICE_KINDS.includes(input.kind)||typeof input.projectTitle!=='string'||
     !input.projectTitle.trim()||input.projectTitle.length>160||
     !input.card||typeof input.card!=='object')throw new Error('공지 정보 카드와 말투를 확인해주세요.');
  const card={},confirmedFacts={},preview=[];
  for(const field of BRIEF_FIELDS){
    const item=input.card[field],label=BRIEF_FIELD_LABELS[field];
    if(!item||typeof item!=='object'||typeof item.value!=='string'||item.value.length>2000||typeof item.included!=='boolean')
      throw new Error('공지 정보 카드 형식을 확인해주세요.');
    if(!['confirmed','needs_review','conflict','missing'].includes(item.status))
      throw new Error('공지 정보 카드의 확인 상태를 확인해주세요.');
    if(!item.included)continue;
    const value=item.value.trim();
    if(!value)throw new Error(`${label} 항목을 입력하거나 공지에서 제외해주세요.`);
    if(item.status!=='confirmed')throw new Error(`${label} 항목을 확인 완료하거나 공지에서 제외해주세요.`);
    card[field]=value;
    confirmedFacts[label]=value;
    preview.push({field,label,value});
  }
  if(!card.what||!card.action||!card.deadline)throw new Error('무엇을, 해야 할 일, 마감을 확인한 뒤 초안을 생성해주세요.');
  return {projectTitle:input.projectTitle.trim(),tone:input.tone,kind:input.kind,card,confirmedFacts,preview};
}
