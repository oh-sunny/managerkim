import {mergeSheetApplications} from './sheet-application-merge.js';

// Snapshot only the source facts that determine who receives an announcement.
export function projectSendSnapshot(project,employees,applications) {
  if(!project||!Array.isArray(project.targetIds)||!Array.isArray(project.requiredIds)||
     !Array.isArray(employees)||!Array.isArray(applications))throw new Error('신청 현황을 확인할 수 없습니다.');
  const targetIds=[...new Set(project.targetIds)].sort((a,b)=>a-b);
  const requiredIds=[...new Set(project.requiredIds)].sort((a,b)=>a-b);
  const roster=new Map(employees.map(employee=>[employee.id,employee]));
  if(roster.size!==employees.length||employees.some(({id,name,team})=>!Number.isSafeInteger(id)||typeof name!=='string'||!name.trim()||typeof team!=='string'||!team.trim())||
     targetIds.length!==project.targetIds.length||requiredIds.length!==project.requiredIds.length||
     targetIds.some(id=>!Number.isSafeInteger(id)||!roster.has(id))||
     requiredIds.some(id=>!targetIds.includes(id)))throw new Error('신청 대상 명단을 확인할 수 없습니다.');
  const latest=new Map();
  for(const row of applications.filter(item=>item.projectId===project.id)){
    if(!targetIds.includes(row.employeeId)||latest.has(row.employeeId)||
       !['applied','confirmed','cancelled'].includes(row.status))throw new Error('신청 상태를 확인할 수 없습니다.');
    latest.set(row.employeeId,row.status);
  }
  return JSON.stringify({
    targetIds,requiredIds,
    roster:employees.map(({id,name,team})=>({id,name,team})).sort((a,b)=>a.id-b.id),
    statuses:targetIds.map(id=>[id,latest.get(id)||'none']),
  });
}

export function sheetSendSnapshot(source,projectId,teamByName,operatorEvents=[]) {
  if(source?.sync?.status!=='success'||!source.sync.lastSuccessAt||
     !Array.isArray(source.employees)||!Array.isArray(source.sourceProjects)||
     !Array.isArray(source.projectTargets)||!Array.isArray(source.applications)||
     source.sourceProjects.filter(row=>row.id===projectId).length!==1)throw new Error('Google Sheets의 최신 신청 현황을 확인하지 못했습니다.');
  const targets=source.projectTargets.filter(row=>row.projectId===projectId);
  if(targets.length!==1)throw new Error('Google Sheets에 프로젝트 대상 명단이 없습니다.');
  const employees=source.employees.map(row=>{
    const team=teamByName.get(row.teamName);
    if(!team)throw new Error('Google Sheets에 웹앱에 없는 팀이 있습니다.');
    return {...row,team};
  });
  if(operatorEvents.length&&!Array.isArray(source.events))throw new Error('Google Sheets의 신청 이력을 확인하지 못했습니다.');
  const applications=operatorEvents.length?mergeSheetApplications(source.applications,source.events,operatorEvents):source.applications;
  return projectSendSnapshot({id:projectId,...targets[0]},employees,applications);
}
