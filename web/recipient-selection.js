const GROUPS = [
  {key:'required-pending',label:'필수 · 미신청'},
  {key:'voluntary-pending',label:'자율 · 미신청'},
  {key:'required-applied',label:'필수 · 확정 대기'},
  {key:'voluntary-applied',label:'자율 · 확정 대기'},
  {key:'required-confirmed',label:'필수 · 확정'},
  {key:'voluntary-confirmed',label:'자율 · 확정'},
  {key:'outside',label:'프로젝트 대상 외'},
];

export function quickRecipientSelection(kind, status) {
  if (kind === 'required-pending') return {scope:'pending',selectedIds:[...status.requiredPendingIds]};
  if (kind === 'required-all') return {scope:'project',selectedIds:[...status.requiredIds]};
  throw new Error('알 수 없는 빠른 대상 선택입니다.');
}

export function recipientGroupKey(id, status) {
  if (!status.targetIds.includes(id)) return 'outside';
  const kind = status.requiredIds.includes(id) ? 'required' : 'voluntary';
  const state = status.confirmedIds.includes(id) ? 'confirmed' : status.appliedIds.includes(id) ? 'applied' : 'pending';
  return `${kind}-${state}`;
}

export function recipientGroupLabel(id, status) {
  return GROUPS.find(group => group.key === recipientGroupKey(id,status)).label;
}

export function recipientGroups(people, status) {
  const byKey = new Map(GROUPS.map(group => [group.key,{...group,people:[]}]));
  for (const person of people) byKey.get(recipientGroupKey(person.id,status)).people.push(person);
  return [...byKey.values()].filter(group => group.people.length);
}

export function recipientCounts(people, status) {
  const counts = {total:people.length,required:0,voluntary:0,outside:0,pending:0,applied:0,confirmed:0,requiredPending:0};
  for (const group of recipientGroups(people,status)) {
    const length=group.people.length;
    if (group.key === 'outside') {counts.outside+=length;continue;}
    if (group.key.startsWith('required-')) counts.required+=length;
    else counts.voluntary+=length;
    if (group.key.endsWith('-pending')) counts.pending+=length;
    else if (group.key.endsWith('-applied')) counts.applied+=length;
    else counts.confirmed+=length;
    if (group.key === 'required-pending') counts.requiredPending=length;
  }
  return counts;
}
