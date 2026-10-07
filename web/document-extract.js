// Conservative, local extraction from structured plain text. Every candidate keeps its source line.
const labels = [
  ['name', /^(?:프로젝트\s*(?:명|제목)|행사명|복지명|제목)\s*[:：]\s*(.+)$/i],
  ['owner', /^(?:담당자|담당)\s*[:：]\s*(.+)$/i],
  ['description', /^(?:설명|개요|목적|프로젝트\s*설명)\s*[:：]\s*(.+)$/i],
  ['start', /^(?:신청\s*시작(?:일)?|접수\s*시작(?:일)?)\s*[:：]\s*(.+)$/i],
  ['deadlineAt', /^(?:신청\s*마감(?:\s*시각)?|접수\s*마감(?:\s*시각)?)\s*[:：]\s*(.+)$/i],
  ['event', /^(?:행사일|운영\s*일정|진행일)\s*[:：]\s*(.+)$/i],
  ['applicationUrl', /^(?:신청\s*링크|신청\s*URL|신청\s*주소)\s*[:：]\s*(.+)$/i],
  ['confirmationMode', /^(?:신청\s*후\s*확정\s*방식|확정\s*방식)\s*[:：]\s*(.+)$/i],
  ['type', /^(?:종류|유형)\s*[:：]\s*(.+)$/i],
];

function datePart(raw) {
  const match=raw.match(/(20\d{2})\s*(?:년|[.\-/])\s*(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})/);
  if(!match)return null;
  const [,year,month,day]=match,date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
  const value=new Date(`${date}T00:00:00Z`);
  return Number.isNaN(value.getTime())||value.toISOString().slice(0,10)!==date?null:date;
}

function timePart(raw) {
  const colon=raw.match(/(?:(오전|오후)\s*)?(\d{1,2})\s*:\s*(\d{2})/);
  const korean=raw.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  const match=colon||korean;if(!match)return null;
  let hour=Number(match[2]),minute=Number(match[3]||0);
  if(hour>23||minute>59)return null;
  if(match[1]==='오후'&&hour<12)hour+=12;
  if(match[1]==='오전'&&hour===12)hour=0;
  return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}

function normalize(field, raw) {
  const value=raw.trim();
  if(['name','owner','description'].includes(field))return value.slice(0,500);
  if(['start','event'].includes(field))return datePart(value);
  if(field==='deadlineAt'){
    const date=datePart(value),time=timePart(value);
    return date&&time?`${date}T${time}`:null;
  }
  if(field==='applicationUrl'){
    const url=value.match(/https?:\/\/[^\s<>"']+/i)?.[0];
    try {return url&&['http:','https:'].includes(new URL(url).protocol)?url:null;} catch {return null;}
  }
  if(field==='confirmationMode')return /즉시\s*확정/.test(value)?'immediate':/별도|승인|선정|확인/.test(value)?'separate':null;
  if(field==='type')return /복지/.test(value)?'복지':/이벤트/.test(value)?'이벤트':/행사/.test(value)?'행사':null;
  return null;
}

export function extractProjectCandidates(text) {
  const candidates=[];
  for(const source of String(text).slice(0,100000).split(/\r?\n/)){
    const line=source.trim();if(!line)continue;
    for(const [field,pattern] of labels){
      const match=line.match(pattern);if(!match)continue;
      const value=normalize(field,match[1]);
      if(value&&!candidates.some(candidate=>candidate.field===field))candidates.push({field,value,source:line.slice(0,300)});
      break;
    }
  }
  return candidates;
}
