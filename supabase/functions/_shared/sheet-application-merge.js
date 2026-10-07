// Keep newer operator corrections when a read-only Sheet snapshot is imported again.
// A later event in the Sheet becomes authoritative for that person.
function eventTime(value) {
  const text=String(value||'');
  const zoned=/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)?text:`${text}${text.length===16?':00':''}+09:00`;
  const time=Date.parse(zoned);
  return Number.isNaN(time)?-Infinity:time;
}

export function mergeSheetApplications(sourceApplications, sourceEvents, operatorEvents) {
  const latestSheet=new Map();
  for(const event of sourceEvents){
    const key=`${event.projectId}:${event.employeeId}`;
    latestSheet.set(key,Math.max(latestSheet.get(key)??-Infinity,eventTime(event.occurredAt)));
  }
  const latestOperator=new Map();
  for(const event of operatorEvents){
    if(event.source==='sheet'||String(event.id||'').startsWith('sheet:'))continue;
    if(!['applied','confirmed','cancelled'].includes(event.toStatus))continue;
    const key=`${event.projectId}:${event.employeeId}`,time=eventTime(event.at);
    const current=latestOperator.get(key);
    if(time>(current?.time??-Infinity))latestOperator.set(key,{event,time});
  }
  const result=new Map(sourceApplications.map(row=>[`${row.projectId}:${row.employeeId}`,row]));
  for(const [key,{event,time}] of latestOperator){
    if(time<=(latestSheet.get(key)??-Infinity))continue;
    result.set(key,{projectId:event.projectId,employeeId:event.employeeId,status:event.toStatus,checkedAt:event.at,sourceEventId:event.id});
  }
  return [...result.values()];
}
