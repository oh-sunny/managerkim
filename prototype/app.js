/* Local prototype. All send actions are simulated; no Slack/API requests are made. */
import {calculateStatus, setApplication, applicationBreakdown, sortTicketsForDisplay} from './data.js';
import {extractProjectCandidates} from './document-extract.js';
import {buildDraftMessage} from './message-templates.js';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  folder:'<path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  message:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/><path d="M7 8h9M7 12h6"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>', back:'<path d="m14 5-7 7 7 7"/>',
  check:'<path d="m5 12 4 4L19 6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', link:'<path d="m9 15 6-6m-7 5-2 2a3 3 0 0 0 4 4l4-4m-4-8 4-4a3 3 0 0 1 4 4l-2 2"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/>',
  heart:'<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 5 1 9 8 15 7-6 12-10 8-15Z"/><path d="M4 12h4l2-4 3 7 2-3h5"/>',
  camera:'<path d="M8 5 6 8H3v12h18V8h-3l-2-3Z"/><circle cx="12" cy="13" r="3"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.folder}</svg>`;
let PROJECTS = [
  {id:'health',name:'연례 건강검진',short:'건강검진',type:'복지',symbol:'heart',total:120,registered:108,required:5,deadline:'2026-10-05',event:'2026-10-31',eventLabel:'검진 운영 종료',owner:'김총무',description:'올해 건강검진 신청을 함께 챙겨요.',reference:'건강검진 안내 템플릿'},
  {id:'workshop',name:'가을 워크숍',short:'워크숍',type:'행사',symbol:'people',total:100,registered:38,required:8,deadline:'2026-10-08',event:'2026-10-16',eventLabel:'가을 워크숍',owner:'김총무',description:'동료들과 함께하는 가을 워크숍을 준비해요.',reference:'워크숍 기획서 · 지난해 안내 템플릿'},
  {id:'event',name:'사내 사진 공모전',short:'사진 공모전',type:'이벤트',symbol:'camera',total:80,registered:0,required:0,deadline:'2026-10-13',event:'2026-10-20',eventLabel:'공모전 결과 발표',owner:'김총무',description:'일상 속 멋진 순간을 함께 나누는 사진 공모전이에요.',reference:'사진 공모전 기획서'},
];
const TEAMS = [{id:'marketing',name:'마케팅팀'},{id:'engineering',name:'개발팀'},{id:'operations',name:'운영팀'},{id:'design',name:'디자인팀'}];
const SAMPLE_FAMILY_NAMES=['김','이','박','최','정','강','조','윤'];
const SAMPLE_GIVEN_NAMES=['서연','지훈','민지','도윤','하은','시우','유진','현우','지민','수빈','예준','서윤','주원','다은','태윤','가은','준서','채원','민준','지아'];
const EMPLOYEES = Array.from({length:160},(_,i)=>({id:i+1,name:`${SAMPLE_FAMILY_NAMES[Math.floor(i/20)]}${SAMPLE_GIVEN_NAMES[i%20]} (예시)`,team:TEAMS[i%4].id}));
const INITIAL_PROJECTS = structuredClone(PROJECTS).map(p=>({
  ...p, start:'2026-09-01', deadlineAt:`${p.deadline}T18:00`, applicationUrl:'',
  confirmationMode:'immediate', targetIds:EMPLOYEES.slice(0,p.total).map(e=>e.id),
  requiredIds:EMPLOYEES.slice(p.registered,p.registered+p.required).map(e=>e.id),
  dataKind:'sample', lastCheckedAt:'2026-10-03T10:00'
}));
PROJECTS = structuredClone(INITIAL_PROJECTS);
const INITIAL_APPLICATIONS = PROJECTS.flatMap(p=>EMPLOYEES.slice(0,p.registered).map(e=>({projectId:p.id,employeeId:e.id,status:'confirmed',checkedAt:p.lastCheckedAt})));
let applications = structuredClone(INITIAL_APPLICATIONS);
let applicationEvents = [];
const CHANNELS = [{id:'announcements',name:'#전체-공지',team:null},...TEAMS.map(t=>({id:t.id,name:`#${t.name.replace('팀','')}-공지`,team:t.id}))];
const TICKETS = [
  {id:'health-required',project:'health',title:'필수 참여 동료에게 신청 안내',state:'pending',date:'2026-10-03',purpose:'필수 참여 안내',reason:'필수 참여 동료 5명이 아직 신청하지 않았어요. 마감이 이틀 남아 신청할 수 있도록 한 번 더 안내하면 좋겠어요.'},
  {id:'health-final',project:'health',title:'마감 전 마지막 안내 내용 확인',state:'pending',date:'2026-10-03',purpose:'D-1 안내 준비',reason:'내일 보낼 D-1 안내 초안을 준비했어요. 아직 신청하지 않은 동료 12명에게 보낼 내용과 대상을 확인해주세요.'},
  {id:'health-d1',project:'health',title:'D-1 신청 현황 확인',state:'scheduled',date:'2026-10-04',purpose:'정기 확인',reason:'마감 하루 전 신청 현황을 확인할 예정이에요. 확인 후 안내가 필요하면 새로 제안해요.'},
  {id:'health-d3',project:'health',title:'D-3 신청 안내',state:'done',date:'2026-10-02',purpose:'신청 안내',record:'health-history',reason:'아직 신청하지 않은 동료 18명에게 신청 안내를 보냈어요.'},
  {id:'health-first',project:'health',title:'건강검진 첫 안내',state:'done',date:'2026-09-15',purpose:'첫 안내',record:'health-first-history',reason:'건강검진 일정과 신청 방법을 전체 공지 채널에 안내했어요.'},
  {id:'workshop-extra',project:'workshop',title:'신청 안내 한 번 더',state:'pending',date:'2026-10-03',purpose:'추가 신청 안내',reason:'현재 신청률은 38%로, 비슷한 워크숍 3건의 D-5 평균 64%보다 26%p 낮아요. 아직 신청하지 않은 동료 62명에게 한 번 더 안내하면 좋겠어요.'},
  {id:'workshop-d3',project:'workshop',title:'D-3 신청 현황 확인',state:'scheduled',date:'2026-10-05',purpose:'정기 확인',reason:'마감 3일 전 신청 현황과 필수 참여 동료의 신청 여부를 확인할 예정이에요.'},
  {id:'workshop-d1',project:'workshop',title:'D-1 신청 현황 확인',state:'scheduled',date:'2026-10-07',purpose:'정기 확인',reason:'마감 하루 전 아직 신청하지 않은 동료가 있는지 확인할 예정이에요.'},
  {id:'workshop-d10',project:'workshop',title:'워크숍 신청 안내',state:'done',date:'2026-09-28',purpose:'신청 안내',record:'workshop-history',reason:'아직 신청하지 않은 동료 80명에게 워크숍 신청을 안내했어요.'},
  {id:'event-first',project:'event',title:'사진 공모전 첫 공지 확인',state:'pending',date:'2026-10-03',purpose:'첫 안내',reason:'동료 80명에게 보낼 첫 공지 초안을 준비했어요. 공모전 일정과 참여 방법을 확인해주세요.'},
  {id:'event-d7',project:'event',title:'D-7 신청 현황 확인',state:'scheduled',date:'2026-10-06',purpose:'정기 확인',reason:'마감 7일 전 참여 현황을 확인할 예정이에요.'},
  {id:'event-d3',project:'event',title:'D-3 신청 현황 확인',state:'scheduled',date:'2026-10-10',purpose:'정기 확인',reason:'마감 3일 전 참여 현황을 확인할 예정이에요.'},
  {id:'event-d1',project:'event',title:'D-1 신청 현황 확인',state:'scheduled',date:'2026-10-12',purpose:'정기 확인',reason:'마감 하루 전 참여 현황을 확인할 예정이에요.'},
];
const INITIAL_RECORDS = [
  {id:'health-history',project:'health',ticket:'health-d3',title:'건강검진 D-3 신청 안내',date:'2026-10-02T10:00',route:'DM · 동료 18명',body:'안녕하세요, 동료 여러분!\n\n올해 건강검진 신청이 10월 5일 오후 6시에 마감돼요. 아직 신청하지 않으셨다면 사내 신청 페이지에서 검진 일정과 기관을 선택해주세요.\n\n이미 신청하셨다면 다시 신청하지 않아도 돼요. 궁금한 점은 김총무에게 편하게 알려주세요.\n\n건강한 일상을 함께 챙겨요!',url:'',source:'sample'},
  {id:'workshop-history',project:'workshop',ticket:'workshop-d10',title:'가을 워크숍 신청 안내',date:'2026-09-28T10:00',route:'DM · 동료 80명',body:'안녕하세요! 가을 워크숍 신청을 안내해요.\n\n10월 16일, 동료들과 함께하는 가을 워크숍이 열려요. 참여하실 분은 10월 8일 오후 6시까지 사내 신청 페이지에서 신청해주세요.\n\n함께 이야기 나누고 새로운 추억을 만들어요. 자세한 일정은 워크숍 기획서를 참고해주세요.\n\n궁금한 점은 김총무에게 알려주세요. 감사합니다!',url:'',source:'sample'},
  {id:'health-first-history',project:'health',ticket:'health-first',title:'올해 건강검진 첫 안내',date:'2026-09-15T09:00',route:'#전체-공지 · 게시 1건',body:'동료 여러분, 올해 건강검진 신청이 시작됐어요.\n\n신청 마감: 10월 5일 오후 6시\n검진 운영: 10월 31일까지\n신청 방법: 사내 신청 페이지에서 기관과 일정을 선택해주세요.\n\n필수 참여 동료는 마감 전에 꼭 신청해주세요. 건강검진 안내 자료도 함께 확인해주세요.',url:'',source:'sample'},
];
const STORAGE_KEY = 'office-benefits-web-v1';
let records = structuredClone(INITIAL_RECORDS);
let completed = {};
let calendar = {year:2026,month:9,selected:'2026-10-03',view:'calendar'};
let drafts = {};
let activeTab = 'tickets';
let recipientPage = 0;
let recipientSearch = '';
let historyContext = null;
let cancelContext = null;
let previewContext = null;
let toastTimeout;
let projectFormError = '';
let documentCandidates = [];
let documentName = '';
let appliedDocumentName = '';
let resetArmed = false;
const status = p => calculateStatus(p,applications,EMPLOYEES);
const projectCount = p => {const s=status(p);return {...s,total:s.targetIds.length,registered:s.appliedIds.length,required:s.requiredPendingIds.length};};
const checkedAt = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date()).replace(' ','T');
const getProject = id => PROJECTS.find(p=>p.id===id);
const getTicket = id => TICKETS.find(t=>t.id===id);
const ticketState = t => completed[t.id] ? 'done' : t.state;
const projectTickets = id => TICKETS.filter(t=>t.project===id);
const projectRecords = id => records.filter(r=>r.project===id).sort((a,b)=>b.date.localeCompare(a.date));
const pendingTickets = id => TICKETS.filter(t=>(!id || t.project===id) && ticketState(t)==='pending');
const pendingProjects = () => PROJECTS.filter(p=>pendingTickets(p.id).length);
const dayKey = d => d.toISOString().slice(0,10);
const daysLeft = p => Math.round((Date.parse(p.deadline+'T00:00:00Z')-Date.parse('2026-10-03T00:00:00Z'))/86400000);
const dateLabel = value => {const [y,m,d] = value.slice(0,10).split('-');return `${Number(m)}월 ${Number(d)}일`;};
const recordDate = value => `${dateLabel(value)} ${value.slice(11,16)}`;
const tag = (text,kind='gray') => `<span class="tag ${kind}">${escapeHtml(text)}</span>`;
const projectSymbol = p => `<span class="project-symbol ${p.id}">${icon(p.symbol)}</span>`;
const stateLabel = state => ({pending:'확인 기다림',scheduled:'예정',done:'완료'}[state]);
const stateColor = state => ({pending:'orange',scheduled:'gray',done:'green'}[state]);

function slackUrl(value) {
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const hostOk = url.hostname === 'app.slack.com' || /^[a-z0-9-]+\.slack\.com$/i.test(url.hostname);
    const pathOk = url.hostname === 'app.slack.com' ? /^\/client\//.test(url.pathname) : /^\/archives\/[^/]+\/p\d+/.test(url.pathname);
    return hostOk && pathOk ? url.href : null;
  } catch { return null; }
}
function validRecord(r) {
  return r && typeof r.id==='string' && getProject(r.project) && typeof r.title==='string' && r.title.length<=160 && typeof r.body==='string' && r.body.length<=20000 && typeof r.route==='string' && r.route.length<=200 && typeof r.date==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.date) && !Number.isNaN(Date.parse(r.date)) && typeof r.url==='string' && slackUrl(r.url)!==null && ['sample','manual','simulated'].includes(r.source) && (r.kind===undefined||['initial','reminder'].includes(r.kind));
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || ![1,2,3].includes(saved.version)) return;
    if (saved.version>=2 && Array.isArray(saved.projects) && Array.isArray(saved.applications)) {
      const validProjects=saved.projects.filter(p=>p && typeof p.id==='string' && /^[a-z0-9-]+$/.test(p.id) && typeof p.name==='string' && p.name.trim() && typeof p.description==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.deadlineAt||'') && !Number.isNaN(Date.parse(p.deadlineAt)) && /^\d{4}-\d{2}-\d{2}$/.test(p.event||'') && Array.isArray(p.targetIds) && Array.isArray(p.requiredIds) && ['immediate','separate'].includes(p.confirmationMode));
      if (validProjects.length) {
        const known=new Set(EMPLOYEES.map(e=>e.id));
        PROJECTS=validProjects.slice(0,30).map(p=>({...p,deadline:p.deadlineAt.slice(0,10),targetIds:[...new Set(p.targetIds.filter(id=>known.has(id)))],requiredIds:[...new Set(p.requiredIds.filter(id=>known.has(id)))]}));
        applications=saved.applications.filter(r=>r && PROJECTS.some(p=>p.id===r.projectId) && Number.isInteger(r.employeeId) && ['applied','confirmed','cancelled'].includes(r.status) && typeof r.checkedAt==='string').slice(0,10000);
      }
    }
    if (Array.isArray(saved.applicationEvents)) {
      applicationEvents=saved.applicationEvents.filter(e=>e && typeof e.id==='string' && getProject(e.projectId) && Number.isInteger(e.employeeId) && EMPLOYEES.some(person=>person.id===e.employeeId) && ['none','applied','confirmed','cancelled'].includes(e.fromStatus) && ['applied','confirmed','cancelled'].includes(e.toStatus) && typeof e.reason==='string' && e.reason.length<=500 && (e.toStatus!=='cancelled'||e.reason.trim()) && typeof e.at==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.at) && typeof e.actor==='string');
    }
    if (Array.isArray(saved.records)) {
      const unique = new Map();
      saved.records.filter(validRecord).slice(0,100).forEach(r=>unique.set(r.id,{...r,url:slackUrl(r.url)}));
      INITIAL_RECORDS.forEach(r=>{if(!unique.has(r.id))unique.set(r.id,structuredClone(r));});
      records = [...unique.values()];
    }
    if (saved.completed && typeof saved.completed==='object') {
      TICKETS.forEach(t=>{const recordId=saved.completed[t.id];if(records.some(r=>r.id===recordId&&r.ticket===t.id&&r.project===t.project&&r.source==='simulated'))completed[t.id]=recordId;});
    }
    const c=saved.calendar;
    if(c && Number.isInteger(c.year)&&c.year>=2000&&c.year<=2100&&Number.isInteger(c.month)&&c.month>=0&&c.month<=11){
      const prefix=`${c.year}-${String(c.month+1).padStart(2,'0')}-`;
      const days=new Date(Date.UTC(c.year,c.month+1,0)).getUTCDate();
      calendar={year:c.year,month:c.month,view:c.view==='list'?'list':'calendar',selected:typeof c.selected==='string'&&c.selected.startsWith(prefix)&&/^\d{4}-\d{2}-\d{2}$/.test(c.selected)&&Number(c.selected.slice(8))>=1&&Number(c.selected.slice(8))<=days?c.selected:prefix+'01'};
    }
  } catch { /* Storage is optional; retain usable defaults. */ }
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify({version:3,projects:PROJECTS,applications,applicationEvents,records,completed,calendar})); return true; }
  catch { toast('브라우저에 저장하지 못했어요. 이 화면을 열어둔 동안에는 내용을 유지해요.'); return false; }
}
function toast(message) {
  clearTimeout(toastTimeout);$('#toast').textContent=message;$('#toast').hidden=false;
  toastTimeout=setTimeout(()=>$('#toast').hidden=true,4500);
}
function route() {
  const [view,id] = location.hash.replace(/^#/,'').split('/');
  if(view==='project'&&getProject(id)) return {view,id};
  if(view==='edit-project' && (id==='new'||getProject(id))) return {view,id};
  if(view==='review'&&getTicket(id)&&ticketState(getTicket(id))==='pending')return {view,id};
  if(['projects','history'].includes(view))return {view};
  return {view:'home'};
}
function renderNavigation(r) {
  const active=r.view==='review'||r.view==='project'||r.view==='edit-project'?'projects':r.view;
  $('#navigation').innerHTML=[['home','home','홈'],['projects','folder','프로젝트'],['history','message','보낸 안내']].map(([view,symbol,label])=>`<a class="nav-item ${active===view?'active':''}" href="#${view}" ${active===view?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${view==='home'&&pendingTickets().length?`<span class="nav-count">${pendingTickets().length}</span>`:''}</a>`).join('');
  const projectId=r.view==='project'?r.id:r.view==='review'?getTicket(r.id).project:r.view==='edit-project'&&r.id!=='new'?r.id:null;
  $('#sidebar-projects').innerHTML=PROJECTS.map(p=>`<a href="#project/${p.id}" class="project-shortcut ${projectId===p.id?'active':''}" ${projectId===p.id?'aria-current="page"':''}><span class="project-dot ${p.id}"></span>${p.name}</a>`).join('');
  const title=r.view==='home'?'홈':r.view==='projects'?'프로젝트':r.view==='history'?'보낸 안내':r.view==='project'?getProject(r.id).name:r.view==='edit-project'?(r.id==='new'?'프로젝트 등록':'프로젝트 수정'):`${getProject(getTicket(r.id).project).name} / 보낼 내용 확인`;
  $('#breadcrumb').textContent=`운영 공간 / ${title}`;
  document.title=`${title} | 팀 행사·복지`;
}
function heading(title,description,actions='',eyebrow='') {
  return `<div class="page-heading"><div>${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:''}<h1>${title}</h1>${description?`<p class="page-description">${description}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;
}
function summary() {
  return `<div class="summary-strip">${[['진행 중인 프로젝트',PROJECTS.length,'개'],['확인을 기다리는 일',pendingTickets().length,'건','orange'],['7일 안에 신청 마감',PROJECTS.filter(p=>daysLeft(p)>=0&&daysLeft(p)<=7).length,'개'],['보낸 안내',records.length,'건']].map(([label,value,unit,color])=>`<div class="summary-item"><div class="summary-label">${label}</div><div class="summary-value ${color||''}">${value}<small>${unit}</small></div></div>`).join('')}</div>`;
}
function projectRows(list) {
  return list.map(p=>{
    const tickets=pendingTickets(p.id),s=projectCount(p),rate=s.rate===null?null:Math.round(s.rate*100);
    return `<a class="project-row" href="#project/${p.id}" aria-label="${escapeHtml(p.name)} 전체 티켓 ${projectTickets(p.id).length}개 보기">${projectSymbol(p)}<div><div class="row-title"><h3>${escapeHtml(p.name)}</h3>${tag(`D-${daysLeft(p)}`,daysLeft(p)<=3?'orange':'gray')}</div><p class="row-subtitle">${tickets.length?escapeHtml(tickets[0].title)+(tickets.length>1?` 외 ${tickets.length-1}건`:''):'지금은 확인할 일이 없어요'}</p><div class="row-meta"><span>${tickets.length}건 확인 대기</span><span>신청 ${s.registered}/${s.total}명</span><span class="row-progress" aria-hidden="true"><span style="width:${rate??0}%"></span></span><span>${rate===null?'대상 없음':rate+'%'}</span></div></div>${icon('arrow')}</a>`;
  }).join('');
}
function recentRows(list) {
  return list.map(r=>`<button class="recent-row" data-record="${escapeHtml(r.id)}" aria-label="${escapeHtml(r.title)} 원문 보기"><span class="history-symbol">${icon('message')}</span><div><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.route)}</p><div class="caption">${recordDate(r.date)} · ${r.source==='simulated'?'보내기 예시':r.source==='manual'?'직접 추가':'예시 기록'}</div></div><span class="chevron">${icon('arrow')}</span></button>`).join('');
}
function home() {
  const list=pendingProjects();
  return `${heading('오늘 확인할 일','동료들의 신청과 안내, 오늘 필요한 일부터 챙겨요.','<a class="button" href="#projects">프로젝트 둘러보기 '+icon('arrow')+'</a>','10월 3일 토요일')}${summary()}
    <div class="home-top"><section class="panel" aria-labelledby="today-title"><div class="panel-heading"><div><h2 id="today-title">함께 챙길 프로젝트 <span class="count">${list.length}</span></h2><p class="caption muted">프로젝트를 열면 전체 티켓을 확인할 수 있어요.</p></div>${tag('확인 기다림','orange')}</div>${list.length?projectRows(list):'<p class="empty">오늘 확인할 일을 모두 챙겼어요.<br>프로젝트에서 다음 일정을 확인할 수 있어요.</p>'}</section>
    <section class="panel home-recent" aria-labelledby="recent-title"><div class="panel-heading"><h2 id="recent-title">최근 보낸 안내</h2><a href="#history" class="caption muted">전체 보기 ${icon('arrow')}</a></div>${recentRows([...records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3))}<div class="panel-bottom">안내를 누르면 원문과 Slack 링크를 확인해요.</div></section></div>
    <section class="panel" aria-labelledby="calendar-title"><div class="panel-heading"><div><h2 id="calendar-title">팀 행사와 복지 일정</h2><p class="caption muted">신청 마감부터 동료들과 함께할 날까지</p></div><div class="segmented" aria-label="일정 보기 방식"><button data-calendar-view="calendar" aria-pressed="${calendar.view==='calendar'}">캘린더</button><button data-calendar-view="list" aria-pressed="${calendar.view==='list'}">목록</button></div></div><div id="calendar-content">${calendar.view==='calendar'?calendarMarkup():projectTable()}</div></section>`;
}
function schedule() {
  const events=[];
  PROJECTS.forEach(p=>{
    events.push({project:p.id,date:p.deadline,kind:'deadline',label:'마감',title:`${p.short} 신청 마감`,time:p.deadlineAt.slice(11)});
    events.push({project:p.id,date:p.event,kind:'event',label:'행사',title:p.eventLabel,time:''});
    [7,3,1].forEach(days=>{const d=new Date(p.deadline+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);events.push({project:p.id,date:dayKey(d),kind:'reminder',label:'안내',title:`${p.short} D-${days} 확인`,time:'시간 미정'});});
  });
  return events;
}
function calendarMarkup() {
  const first=new Date(Date.UTC(calendar.year,calendar.month,1)),offset=(first.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(calendar.year,calendar.month+1,0)).getUTCDate(),cells=Math.ceil((offset+days)/7)*7,events=schedule();
  return `<div class="calendar-head"><div class="actions"><h3 class="month-name">${calendar.year}년 ${calendar.month+1}월</h3><button class="button compact" data-action="calendar-today">이번 달</button></div><div class="actions"><div class="calendar-legend"><span><i class="legend-dot"></i>신청 마감</span><span><i class="legend-dot event"></i>행사</span><span><i class="legend-dot reminder"></i>안내 예정</span></div><button class="button icon-button" data-month="-1" aria-label="이전 달">${icon('back')}</button><button class="button icon-button" data-month="1" aria-label="다음 달">${icon('arrow')}</button></div></div>
    <div class="calendar-grid" aria-hidden="true">${['월','화','수','목','금','토','일'].map((label,i)=>`<div class="weekday ${i>4?'weekend':''}">${label}</div>`).join('')}</div><div class="calendar-grid" aria-label="월간 프로젝트 일정">${Array.from({length:cells},(_,i)=>{
      const day=i-offset+1,d=new Date(Date.UTC(calendar.year,calendar.month,day)),key=dayKey(d),list=events.filter(e=>e.date===key),today=key==='2026-10-03';
      if(day<1||day>days)return `<div class="day-cell outside" aria-hidden="true"><span class="day-number">${d.getUTCDate()}</span></div>`;
      return `<button class="day-cell" data-date="${key}" aria-pressed="${key===calendar.selected}" aria-label="${calendar.month+1}월 ${day}일 · ${escapeHtml(list.length?list.map(e=>e.title).join(', '):'예정된 일정 없음')}"><span class="day-number ${today?'today':''}"><span>${day}</span>${today?'<small>오늘</small>':''}</span>${list.map(e=>`<span class="day-event ${e.kind}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</span>`).join('')}</button>`;
    }).join('')}</div><div class="calendar-selection"><h3>${dateLabel(calendar.selected)} 일정</h3><div class="date-events">${events.filter(e=>e.date===calendar.selected).map(e=>`<div class="date-event"><span>${tag(e.label,e.kind==='deadline'?'orange':e.kind==='event'?'green':'gray')} ${escapeHtml(e.title)} <span class="muted">${e.time}</span></span><a href="#project/${e.project}">프로젝트 보기 →</a></div>`).join('')||'<p class="caption muted">이날은 예정된 일정이 없어요.</p>'}</div></div>`;
}
function projectTable() {
  return `<table class="project-table"><thead><tr><th scope="col">프로젝트</th><th scope="col">신청 마감</th><th scope="col">신청 현황</th><th scope="col">확인할 일</th></tr></thead><tbody>${PROJECTS.map(p=>`<tr><td><a href="#project/${p.id}">${escapeHtml(p.name)}</a></td><td>${dateLabel(p.deadline)}</td><td>${projectCount(p).registered}/${projectCount(p).total}명</td><td>${tag(`${pendingTickets(p.id).length}건`,pendingTickets(p.id).length?'orange':'green')}</td></tr>`).join('')}</tbody></table>`;
}
function projectsPage() {
  return `${heading('우리 팀의 프로젝트','신청 현황과 일정, 프로젝트별 전체 티켓을 살펴봐요.',`<a class="button primary" href="#edit-project/new">${icon('plus')} 프로젝트 등록</a>`)}${summary()}<section class="panel"><div class="panel-heading"><h2>진행 중인 프로젝트 <span class="count">${PROJECTS.length}</span></h2></div>${projectRows(PROJECTS)}</section><div class="actions" style="margin-top:18px;justify-content:flex-end"><button class="button compact" data-action="reset-sample">${resetArmed?'프로젝트·신청·안내 기록을 모두 지우고 초기화 확인':'이 브라우저의 예시 데이터로 초기화'}</button></div>`;
}
function employeePickerMarkup(p) {
  const target=new Set(p?.targetIds||[]),required=new Set(p?.requiredIds||[]);
  return `<div class="member-picker"><div class="member-picker-head"><div><h2>대상 동료</h2><p class="caption muted">이름으로 찾거나 팀을 골라 선택하세요.</p></div><strong id="member-count" aria-live="polite"></strong></div><div class="member-filters"><div class="field"><label for="member-search">동료 찾기</label><input id="member-search" type="search" placeholder="이름 검색" autocomplete="off"></div><div class="field"><label for="member-team">팀</label><select id="member-team"><option value="all">전체 팀</option>${TEAMS.map(team=>`<option value="${team.id}">${team.name}</option>`).join('')}</select></div></div><div class="member-bulk"><span id="member-visible-count" class="caption muted"></span><div class="actions"><button type="button" class="button compact" data-action="select-visible-members">검색 결과 선택</button><button type="button" class="button compact" data-action="clear-visible-members">검색 결과 해제</button></div></div><div class="member-list">${EMPLOYEES.map(e=>`<div class="member-row" data-member-row data-team="${e.team}" data-name="${escapeHtml(e.name)}"><label class="member-name"><input type="checkbox" data-target-member="${e.id}" ${target.has(e.id)?'checked':''}><span>${escapeHtml(e.name)}<small>${TEAMS.find(team=>team.id===e.team).name}</small></span></label><label class="member-required"><input type="checkbox" data-required-member="${e.id}" aria-label="${escapeHtml(e.name)} 필수 신청" ${required.has(e.id)?'checked':''} ${target.has(e.id)?'':'disabled'}>필수</label></div>`).join('')}</div></div>`;
}
function projectFormPage(id) {
  const p=id==='new'?null:getProject(id),field=(name,label,value,type='text',required=true)=>`<div class="field"><label for="project-${name}">${label}</label><input id="project-${name}" name="${name}" type="${type}" value="${escapeHtml(value??'')}" ${required?'required':''}></div>`;
  return `<a href="${p?`#project/${p.id}`:'#projects'}" class="back-link">${icon('back')} 프로젝트로 돌아가기</a>${heading(p?'프로젝트 수정':'프로젝트 등록','')}<form id="project-form" class="panel form-panel" data-project-id="${p?.id||'new'}"><section class="document-import"><h2>기획서에서 채우기</h2><p class="caption muted">텍스트 파일(.txt·.md)을 선택하거나 내용을 붙여넣으세요. 찾은 항목을 확인한 뒤 적용할 수 있어요.</p><div class="field"><label for="document-file">기획서 파일</label><input id="document-file" type="file" accept=".txt,.md,text/plain,text/markdown"></div><div class="field"><label for="document-source">또는 기획서 내용 붙여넣기</label><textarea id="document-source" class="short-textarea" placeholder="프로젝트 제목: ...&#10;담당자: ...&#10;신청 마감: 2026-10-12 18:00"></textarea></div><button type="button" class="button" data-action="extract-document">내용에서 항목 찾기</button><div id="document-candidates" aria-live="polite"></div></section><div class="form-grid">${field('name','프로젝트 제목',p?.name)}${field('owner','담당자 이름',p?.owner)}<div class="field full"><label for="project-description">프로젝트 설명</label><textarea id="project-description" name="description" class="short-textarea" required>${escapeHtml(p?.description||'')}</textarea></div>${field('start','신청 시작일',p?.start||'2026-10-05','date')}${field('deadlineAt','신청 마감 시각',p?.deadlineAt||'2026-10-12T18:00','datetime-local')}${field('event','행사·운영 일정',p?.event||'2026-10-20','date')}${field('applicationUrl','신청 링크',p?.applicationUrl||'','url',false)}<div class="field"><label for="project-confirmationMode">신청 후 확정 방식</label><select id="project-confirmationMode" name="confirmationMode"><option value="immediate" ${p?.confirmationMode!=='separate'?'selected':''}>신청 즉시 확정</option><option value="separate" ${p?.confirmationMode==='separate'?'selected':''}>별도 확인·승인·선정 후 확정</option></select></div><div class="field"><label for="project-type">종류</label><select id="project-type" name="type"><option value="행사" ${p?.type==='행사'?'selected':''}>행사</option><option value="복지" ${p?.type==='복지'?'selected':''}>복지</option><option value="이벤트" ${p?.type==='이벤트'?'selected':''}>이벤트</option></select></div><div class="field full">${employeePickerMarkup(p)}</div></div><p id="project-form-error" class="error-message" role="alert" ${projectFormError?'':'hidden'}>${escapeHtml(projectFormError)}</p><div class="actions"><button class="button primary" type="submit">${p?'변경 저장':'프로젝트 등록'}</button></div></form>`;
}
function refreshMemberPicker() {
  const search=$('#member-search')?.value.trim().toLowerCase()||'',team=$('#member-team')?.value||'all';
  if(!$('#member-count'))return;
  let visible=0;
  document.querySelectorAll('[data-member-row]').forEach(row=>{
    row.hidden=Boolean((team!=='all'&&row.dataset.team!==team)||(search&&!row.dataset.name.toLowerCase().includes(search)));
    if(!row.hidden)visible++;
    const target=row.querySelector('[data-target-member]'),required=row.querySelector('[data-required-member]');
    required.disabled=!target.checked;if(!target.checked)required.checked=false;
  });
  $('#member-visible-count').textContent=`검색 결과 ${visible}명`;
  $('#member-count').textContent=`대상 ${document.querySelectorAll('[data-target-member]:checked').length}명 · 필수 ${document.querySelectorAll('[data-required-member]:checked').length}명`;
}
const candidateLabels={name:'프로젝트 제목',owner:'담당자 이름',description:'프로젝트 설명',start:'신청 시작일',deadlineAt:'신청 마감 시각',event:'행사·운영 일정',applicationUrl:'신청 링크',confirmationMode:'신청 후 확정 방식',type:'종류'};
function showDocumentCandidates() {
  const box=$('#document-candidates');if(!box)return;
  if(!documentCandidates.length){box.innerHTML='<p class="help">항목을 찾지 못했어요. “프로젝트 제목: …”처럼 항목 이름이 적힌 텍스트에서 후보를 찾을 수 있어요.</p>';return;}
  box.innerHTML=`<h3>찾은 항목 ${documentCandidates.length}개</h3><p class="caption muted">적용할 항목을 선택하세요. 문서에 없는 값은 직접 확인해야 해요.</p>${documentCandidates.map((candidate,index)=>`<label class="candidate-row"><input type="checkbox" data-candidate="${index}" checked><span><strong>${candidateLabels[candidate.field]}: ${escapeHtml(candidate.value)}</strong><small>근거: ${escapeHtml(candidate.source)}</small></span></label>`).join('')}<button type="button" class="button" data-action="apply-document">선택한 항목 채우기</button>`;
}
function findDocumentCandidates() {
  const text=$('#document-source').value;
  documentCandidates=extractProjectCandidates(text);
  showDocumentCandidates();
}
function saveProjectForm(event) {
  event.preventDefault();const form=event.target,id=form.dataset.projectId,old=id==='new'?null:getProject(id),data=new FormData(form);
  try {
    const targetIds=[...form.querySelectorAll('[data-target-member]:checked')].map(input=>Number(input.dataset.targetMember));
    const requiredIds=[...form.querySelectorAll('[data-required-member]:checked')].map(input=>Number(input.dataset.requiredMember));
    if(requiredIds.some(employeeId=>!targetIds.includes(employeeId)))throw new Error('필수 신청 동료는 대상 명단에도 있어야 해요.');
    const start=data.get('start'),deadlineAt=data.get('deadlineAt'),eventDate=data.get('event');
    if(Date.parse(start)>Date.parse(deadlineAt)||Date.parse(eventDate)<Date.parse(start))throw new Error('신청 시작일·마감·운영 일정의 순서를 확인해주세요.');
    const url=data.get('applicationUrl').trim();if(url && !/^https?:\/\//i.test(url))throw new Error('신청 링크는 http 또는 https 주소를 넣어주세요.');
    const name=data.get('name').trim(),owner=data.get('owner').trim(),description=data.get('description').trim();
    if(!name||!owner||!description)throw new Error('프로젝트 제목, 설명, 담당자 이름을 입력해주세요.');
    const next={...(old||{}),id:old?.id||`local-${crypto.randomUUID()}`,name,short:name,type:data.get('type'),symbol:old?.symbol||'folder',description,owner,start,deadlineAt,deadline:deadlineAt.slice(0,10),event:eventDate,eventLabel:old?.eventLabel||'운영 일정',applicationUrl:url,confirmationMode:data.get('confirmationMode'),targetIds,requiredIds,dataKind:'local',lastCheckedAt:old?.lastCheckedAt||null,reference:appliedDocumentName||old?.reference||'직접 입력'};
    if(old){PROJECTS=PROJECTS.map(p=>p.id===id?next:p);if(old.confirmationMode!==next.confirmationMode){applications=applications.map(r=>r.projectId===id&&r.status!=='cancelled'?{...r,status:next.confirmationMode==='immediate'?'confirmed':'applied'}:r);}}
    else PROJECTS.push(next);
    projectFormError='';persist();location.hash=`project/${next.id}`;render();toast(old?'운영 정보를 저장했어요.':'새 행사·복지를 등록했어요.');
  } catch(error) {projectFormError=error.message;$('#project-form-error').textContent=projectFormError;$('#project-form-error').hidden=false;}
}
function ticketMarkup(t) {
  const state=ticketState(t),recordId=completed[t.id]||t.record;
  return `<article class="ticket" data-ticket-id="${t.id}"><div class="ticket-heading"><span class="ticket-status-icon ${state}" aria-hidden="true">${state==='done'?'✓':state==='scheduled'?'◷':'•'}</span><div class="ticket-title"><h3>${escapeHtml(t.title)}</h3><div class="caption muted">${dateLabel(t.date)} · ${escapeHtml(t.purpose)} · 예시 티켓</div></div>${tag(stateLabel(state),stateColor(state))}</div><p class="ticket-body">${escapeHtml(state==='done'?'완료된 예시 티켓이에요. 당시 보낸 안내의 원문과 기록을 확인할 수 있어요.':`현재 신청 ${projectCount(getProject(t.project)).registered}/${projectCount(getProject(t.project)).total}명 · 필수 신청 전 ${projectCount(getProject(t.project)).required}명. 이 티켓의 제안 시점과 이유는 아직 예시이며, 다음 단계에서 규칙으로 갱신돼요.`)}</p><div class="ticket-footer"><span>${state==='pending'?'담당자 확인 후 안내해요':state==='scheduled'?'신청 현황을 확인한 뒤 안내를 제안해요':'안내 기록과 연결되어 있어요'}</span>${state==='pending'?`<a href="#review/${t.id}" class="button ${t.id==='workshop-extra'||t.id==='health-required'?'primary':''} compact">보낼 내용 확인 ${icon('arrow')}</a>`:state==='done'&&recordId?`<button class="button compact" data-record="${escapeHtml(recordId)}">보낸 안내 보기 ${icon('external')}</button>`:''}</div></article>`;
}
const applicationStateLabel = state => ({none:'신청 전',applied:'신청 · 확정 대기',confirmed:'확정',cancelled:'신청 취소'}[state]||state);
function applicationLog(projectId) {
  const events=applicationEvents.map((event,index)=>({event,index})).filter(item=>item.event.projectId===projectId).sort((a,b)=>b.event.at.localeCompare(a.event.at)||b.index-a.index).map(item=>item.event);
  return `<details class="application-log"><summary>신청 상태 변경 기록 <span class="count">${events.length}</span></summary><p class="help">이 브라우저에서 변경한 이력입니다. 다른 기기와 공유되지 않아요.</p>${events.length?events.map(e=>{const person=EMPLOYEES.find(item=>item.id===e.employeeId),team=TEAMS.find(item=>item.id===person?.team);return `<div class="application-log-row"><div><strong>${escapeHtml(person?.name)} · ${escapeHtml(team?.name)}</strong><span>${escapeHtml(applicationStateLabel(e.fromStatus))} → ${escapeHtml(applicationStateLabel(e.toStatus))}${e.reason?` · 사유: ${escapeHtml(e.reason)}`:''}</span></div><time datetime="${escapeHtml(e.at)}">${escapeHtml(e.at.replace('T',' '))}<small>${escapeHtml(e.actor)}</small></time></div>`;}).join(''):'<p class="help">아직 이 브라우저에서 바꾼 신청 상태가 없어요.</p>'}</details>`;
}
function historyRows(list) {
  return list.length?list.map(r=>`<button class="history-list-row" data-record="${escapeHtml(r.id)}"><span class="history-symbol">${icon('message')}</span><div><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(getProject(r.project).name)} · ${escapeHtml(r.route)} · ${recordDate(r.date)}</p><div class="history-link-indicator">${r.source==='manual'?'직접 추가한 기록':r.source==='simulated'?'보내기 예시':'예시 원문'} · ${r.url?'Slack 링크 연결됨':'Slack 링크 추가 가능'}</div></div><span class="chevron">${icon('arrow')}</span></button>`).join(''):'<div class="empty">아직 보낸 안내가 없어요.<br>첫 안내를 보내거나 기존 안내 기록을 추가해보세요.</div>';
}
const recordKind = r => r.kind || (/D-\d|리마인드|마감 전|추가 안내|한 번 더/.test(`${r.title} ${getTicket(r.ticket)?.title||''}`)?'reminder':'initial');
function projectPage(id) {
  const p=getProject(id),s=projectCount(p),tickets=projectTickets(id),recent=projectRecords(id),pending=pendingTickets(id).length;
  const breakdown=applicationBreakdown(s);
  const sorted=sortTicketsForDisplay(tickets,ticketState,t=>records.find(r=>r.id===(completed[t.id]||t.record))?.date);
  return `<a href="#home" class="back-link">${icon('back')} 홈으로 돌아가기</a><div class="page-heading"><div class="project-hero">${projectSymbol(p)}<div><p class="eyebrow">${escapeHtml(p.type)} 프로젝트 · ${tag(p.dataKind==='sample'?'예시 데이터':'직접 입력','gray')}</p><h1>${escapeHtml(p.name)}</h1><p class="page-description">${escapeHtml(p.description)}</p></div></div><div class="actions"><a class="button" href="#edit-project/${id}">운영 정보 수정</a><button class="button" data-action="new-record" data-project="${id}">${icon('plus')} 안내 기록 추가</button></div></div>
    <section class="application-summary" aria-label="필수·자율 신청 현황"><div class="application-summary-heading"><div><h2>신청 현황</h2><p>필수와 자율 신청을 나눠 집계했어요. 각 행의 신청 + 신청 전 = 대상입니다.</p></div><strong>${s.rate===null?'대상 없음':Math.round(s.rate*100)+'%'}<small> 전체 신청률</small></strong></div><div class="summary-table-wrap"><table class="application-table"><thead><tr><th scope="col">구분</th><th scope="col">대상</th><th scope="col">신청</th><th scope="col">신청 전</th></tr></thead><tbody>${[['필수 신청',breakdown.required],['자율 신청',breakdown.voluntary],['합계',breakdown.total]].map(([label,row])=>`<tr${label==='합계'?' class="total-row"':''}><th scope="row">${label}</th><td>${row.target}명</td><td>${row.applied}명</td><td class="pending-count">${row.pending}명</td></tr>`).join('')}</tbody></table></div><p class="application-summary-note">신청에는 확정 대기 중인 동료도 포함됩니다. 취소한 신청은 ‘신청 전’으로 집계합니다.</p></section>
    <section class="panel roster-panel"><div class="panel-heading"><div><h2>동료별 신청 상태</h2><p class="caption muted">마지막 확인: ${escapeHtml(s.lastCheckedAt||'확인 전')} · 신청 ${s.registered}명 / 확정 ${s.confirmedIds.length}명 · ${p.confirmationMode==='separate'?'별도 확인 후 확정':'신청 즉시 확정'}</p></div></div>${s.unknown.length?`<p class="error-message" style="padding:0 22px">대상에 없거나 식별할 수 없는 신청 기록 ${s.unknown.length}건은 집계에서 제외했어요.</p>`:''}${s.total?`<div class="roster-list">${s.targetIds.map(employeeId=>{const e=EMPLOYEES.find(item=>item.id===employeeId),applied=s.appliedIds.includes(employeeId),confirmed=s.confirmedIds.includes(employeeId),required=s.requiredIds.includes(employeeId);return `<div class="roster-row"><span>${escapeHtml(e.name)} · ${escapeHtml(TEAMS.find(team=>team.id===e.team).name)} ${required?'· 필수':''}</span><span>${confirmed?'확정':applied?'신청 · 확정 대기':'신청 전'}</span><div class="actions">${!applied?`<button class="button compact" data-application="applied" data-employee="${employeeId}" data-project="${id}">신청</button>`:`${p.confirmationMode==='separate'&&!confirmed?`<button class="button compact" data-application="confirmed" data-employee="${employeeId}" data-project="${id}">확정</button>`:''}<button class="button compact" data-application="cancelled" data-employee="${employeeId}" data-project="${id}">신청 취소</button>`}</div></div>`;}).join('')}</div>`:'<p class="empty">대상 명단이 비어 있어 신청률을 계산하지 않아요. 운영 정보에서 동료를 선택해주세요.</p>'}${applicationLog(id)}</section>
    <div class="tabs" role="tablist" aria-label="프로젝트 내용"><button class="tab" id="tickets-tab" role="tab" data-tab="tickets" aria-selected="${activeTab==='tickets'}" aria-controls="project-content">전체 티켓 <span class="count">${tickets.length}</span></button><button class="tab" id="sent-tab" role="tab" data-tab="history" aria-selected="${activeTab==='history'}" aria-controls="project-content">보낸 안내 <span class="count">${recent.length}</span></button></div>
    <div id="project-content" role="tabpanel" aria-labelledby="${activeTab==='tickets'?'tickets-tab':'sent-tab'}">${activeTab==='history'?`<section class="panel">${historyRows(recent)}</section>`:`<div class="detail-grid"><section class="panel" aria-label="${escapeHtml(p.name)} 전체 티켓"><div class="panel-heading"><div><h2>프로젝트의 모든 티켓</h2><p class="caption muted">확인 대기 ${pending}건 · 예정 ${tickets.filter(t=>ticketState(t)==='scheduled').length}건 · 완료 ${tickets.filter(t=>ticketState(t)==='done').length}건</p></div></div>${sorted.map(ticketMarkup).join('')||'<p class="empty">이 행사에 연결된 확인할 일은 아직 없어요. 규칙 기반 생성은 다음 단계에서 구현해요.</p>'}</section><aside><section class="panel schedule-panel"><h2>일정과 최근 안내</h2><div class="info-line"><span>신청 마감</span><p>${dateLabel(p.deadline)} ${escapeHtml(p.deadlineAt.slice(11))} ${tag(`D-${daysLeft(p)}`,daysLeft(p)<=3?'orange':'gray')}</p></div><div class="info-line"><span>${p.type==='행사'?'행사일':escapeHtml(p.eventLabel||'운영 일정')}</span><p>${dateLabel(p.event)}</p></div><div class="info-line"><span>담당자</span><p>${escapeHtml(p.owner)}</p></div><div class="info-line"><span>신청 링크</span><p>${p.applicationUrl?`<a href="${escapeHtml(p.applicationUrl)}" target="_blank" rel="noopener noreferrer">신청 페이지 열기</a>`:'등록 전'}</p></div><h3 style="margin:18px 0 12px">최근 보낸 안내</h3>${recent.slice(0,2).map(r=>`<button class="linked-history" data-record="${escapeHtml(r.id)}" aria-label="${escapeHtml(r.title)} 원문 보기"><div><strong>${escapeHtml(r.title)}</strong><small>${recordDate(r.date)} · ${escapeHtml(r.route)}</small></div>${icon('arrow')}</button>`).join('')||'<p class="caption muted">아직 보낸 안내가 없어요.</p>'}</section></aside></div>`}</div>`;
}
function historyPage() {
  const list=[...records].sort((a,b)=>b.date.localeCompare(a.date));
  return `${heading('보낸 안내','프로젝트별 첫 공지와 리마인드 기록을 확인해요.',`<button class="button" data-action="new-record">${icon('plus')} 안내 기록 추가</button>`)}<div class="history-overview"><strong>전체 안내 ${list.length}건</strong><span>프로젝트 ${PROJECTS.length}개 · 각 프로젝트 안에서는 최근 날짜순</span></div><div class="history-projects">${PROJECTS.map(p=>{const projectList=list.filter(r=>r.project===p.id),initial=projectList.filter(r=>recordKind(r)==='initial'),reminders=projectList.filter(r=>recordKind(r)==='reminder');return `<section class="panel history-project" aria-label="${escapeHtml(p.name)} 안내 기록"><div class="history-project-heading">${projectSymbol(p)}<div><span class="history-project-sticker">${escapeHtml(p.type)} 프로젝트</span><h2>${escapeHtml(p.name)}</h2></div><span class="count">${projectList.length}</span></div><div class="history-group"><h3>최초 공지 <span class="count">${initial.length}</span></h3>${initial.length?historyRows(initial):'<p class="history-empty">아직 첫 안내 기록이 없어요.</p>'}</div><div class="history-group"><h3>리마인드 알림 <span class="count">${reminders.length}</span></h3>${reminders.length?historyRows(reminders):'<p class="history-empty">아직 리마인드 기록이 없어요.</p>'}</div></section>`;}).join('')}</div>`;
}
function draftText(t,tone='friendly') {
  const p=getProject(t.project);
  return buildDraftMessage({title:p.name,deadline:`${dateLabel(p.deadline)} ${p.deadlineAt.slice(11)}`,owner:p.owner,applicationUrl:p.applicationUrl},tone);
}
function getDraft(t) {
  if(!drafts[t.id])drafts[t.id]={body:draftText(t),tone:'friendly',mode:'dm',scope:t.project==='event'?'project':'pending',teams:TEAMS.map(t=>t.id),dmSelection:'team',selectedIds:[],channels:[],confirmed:false};
  return drafts[t.id];
}
function audience(p,d) {
  const s=status(p),target=new Set(s.targetIds),pending=new Set(s.pendingIds);
  const base=EMPLOYEES.filter(e=>d.scope==='company'||(d.scope==='project'?target.has(e.id):pending.has(e.id)));
  const channels=d.channels.map(id=>CHANNELS.find(c=>c.id===id)).filter(Boolean);
  const channelAudiences=channels.map(channel=>({channel,members:EMPLOYEES.filter(e=>!channel.team||e.team===channel.team)}));
  const list=d.mode==='channel'?EMPLOYEES.filter(e=>channelAudiences.some(({members})=>members.includes(e))):base.filter(e=>d.dmSelection==='people'?d.selectedIds.includes(e.id):d.teams.includes(e.team));
  return {base,list,channels,channelAudiences,required:list.filter(e=>s.requiredPendingIds.includes(e.id)).length};
}
function individualPicker(a,d) {
  return `<div class="individual-picker"><label for="recipient-search" class="field-label">동료 이름 검색</label><input id="recipient-search" type="search" placeholder="이름이나 팀으로 찾기" value="${escapeHtml(recipientSearch)}"><div class="recipient-picker-actions"><span>현재 대상 범위 ${a.base.length}명 중 ${a.list.length}명 선택</span><button class="button compact" data-action="clear-individuals">선택 모두 해제</button></div><div class="individual-list">${a.base.map(e=>`<label class="individual-row" data-individual-row data-search="${escapeHtml(`${e.name} ${TEAMS.find(t=>t.id===e.team).name}`.toLowerCase())}"><input type="checkbox" data-individual="${e.id}" ${d.selectedIds.includes(e.id)?'checked':''}><span>${escapeHtml(e.name)}<small>${escapeHtml(TEAMS.find(t=>t.id===e.team).name)}</small></span></label>`).join('')}</div></div>`;
}
function recipientSettings(t) {
  const p=getProject(t.project),d=getDraft(t),a=audience(p,d);
  return `<div class="route-choice" aria-label="보내는 방법"><button data-mode="dm" aria-pressed="${d.mode==='dm'}">${icon('message')} DM 보내기</button><button data-mode="channel" aria-pressed="${d.mode==='channel'}">${icon('people')} Slack 채널에 게시</button></div>${d.mode==='dm'?`
    <div class="field"><label for="audience-scope">누구에게 보낼까요?</label><select id="audience-scope"><option value="pending" ${d.scope==='pending'?'selected':''}>아직 신청하지 않은 동료</option><option value="project" ${d.scope==='project'?'selected':''}>프로젝트에 함께할 모든 동료</option><option value="company" ${d.scope==='company'?'selected':''}>모든 동료</option></select></div><div class="selection-tabs" role="group" aria-label="DM 대상 선택 방식"><button data-dm-selection="team" aria-pressed="${d.dmSelection==='team'}">팀으로 고르기</button><button data-dm-selection="people" aria-pressed="${d.dmSelection==='people'}">동료 직접 고르기</button></div>${d.dmSelection==='team'?`<fieldset class="team-select"><legend>받을 동료를 팀별로 선택</legend><label class="team-checkbox"><input id="all-teams" type="checkbox" ${d.teams.length===TEAMS.length?'checked':''}>전체 팀 선택</label>${TEAMS.map(team=>`<label class="team-checkbox"><input type="checkbox" data-team="${team.id}" ${d.teams.includes(team.id)?'checked':''}>${team.name}<small>${a.base.filter(e=>e.team===team.id).length}명</small></label>`).join('')}</fieldset>`:individualPicker(a,d)}
    <div class="recipient-summary"><strong>DM을 받을 동료 ${a.list.length}명</strong><p>필수 참여 · 신청 전 ${a.required}명 포함<br>선택한 동료에게 각각 DM을 보내요.${d.scope!=='pending'?'<br>이미 신청한 동료도 포함될 수 있어요.':''}${d.scope==='company'?'<br>프로젝트에 참여하지 않는 동료도 포함돼요.':''}</p></div><details class="recipients-toggle"><summary>받을 동료 명단 보기</summary><div id="recipient-list">${recipientTable(a.list,p)}</div></details>${!a.list.length?'<p class="error-message">DM을 받을 동료를 선택해주세요.</p>':''}`:`
      <div class="field"><label for="posting-channel">게시할 채널 추가</label><div class="channel-add"><select id="posting-channel"><option value="">채널 선택</option>${CHANNELS.filter(c=>!d.channels.includes(c.id)).map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select><button class="button" data-action="add-channel" ${d.channels.length===CHANNELS.length?'disabled':''}>추가</button></div></div><div class="selected-channels" aria-label="게시할 채널 목록">${a.channelAudiences.map(({channel,members})=>`<div class="selected-channel"><div><strong>${escapeHtml(channel.name)}</strong><small>예시 구성원 ${members.length}명 · 프로젝트 대상 외 ${members.filter(e=>!p.targetIds.includes(e.id)).length}명</small></div><button class="button compact" data-remove-channel="${channel.id}" aria-label="${escapeHtml(channel.name)} 제거">제거</button></div>`).join('')||'<p class="history-empty">게시할 채널을 추가해주세요.</p>'}</div><div class="recipient-summary"><strong>채널 ${a.channels.length}곳에 각각 공지 1건</strong><p>예시 공개 범위의 고유 동료 ${a.list.length}명 · 프로젝트 대상 외 ${a.list.filter(e=>!p.targetIds.includes(e.id)).length}명<br>여러 채널에 속한 동료는 공지를 중복해서 볼 수 있어요.</p></div><p class="caption muted">각 채널의 모든 구성원에게 보여요. 아직 신청하지 않은 동료에게만 안내하려면 DM을 선택해주세요.</p>`}`;
}
function recipientTable(list,p) {
  const pages=Math.max(1,Math.ceil(list.length/8));recipientPage=Math.max(0,Math.min(recipientPage,pages-1));
  const s=status(p);return `<table class="recipient-table"><caption class="help">DM을 받을 동료 · 로컬 명단</caption><thead><tr><th scope="col">동료</th><th scope="col">팀</th><th scope="col">신청 상태</th></tr></thead><tbody>${list.slice(recipientPage*8,recipientPage*8+8).map(e=>`<tr><td>${e.name}</td><td>${TEAMS.find(t=>t.id===e.team).name}</td><td>${!s.targetIds.includes(e.id)?'대상 외':s.confirmedIds.includes(e.id)?'확정':s.appliedIds.includes(e.id)?'신청 · 확정 대기':s.requiredIds.includes(e.id)?'필수 · 신청 전':'신청 전'}</td></tr>`).join('')}</tbody></table><div class="actions"><button class="button compact" data-recipients-page="-1" aria-label="이전 동료 목록" ${recipientPage===0?'disabled':''}>이전</button><span class="caption muted">${recipientPage+1} / ${pages}</span><button class="button compact" data-recipients-page="1" aria-label="다음 동료 목록" ${recipientPage>=pages-1?'disabled':''}>다음</button></div>`;
}
function reviewPage(id) {
  const t=getTicket(id),p=getProject(t.project),d=getDraft(t);
  return `<a href="#project/${p.id}" class="back-link">${icon('back')} ${p.name} 전체 티켓</a>${heading('보낼 내용 확인',`${p.name} · ${t.title}`)}<div class="review-grid"><section class="panel form-panel"><h2>동료에게 보낼 메시지</h2><p class="caption muted" style="margin:7px 0 22px">준비된 초안이에요. 일정과 내용을 확인하고 다듬어주세요.</p><div class="field"><label for="draft-tone">말투</label><select id="draft-tone"><option value="friendly" ${d.tone==='friendly'?'selected':''}>친근하고 밝게</option><option value="concise" ${d.tone==='concise'?'selected':''}>친근하고 간결하게</option><option value="action" ${d.tone==='action'?'selected':''}>신청 요청을 명확하게</option></select><p class="help">말투를 바꾸면 아래 본문이 바로 새 초안으로 바뀝니다. 직접 수정한 내용도 교체돼요.</p></div><div class="draft-area"><label class="preview-label" for="draft-body"><span>메시지 본문</span>${tag('예시 초안')}</label><textarea id="draft-body" maxlength="20000">${escapeHtml(d.body)}</textarea><p class="help">신청 링크는 예시예요. 실제 연결 전에 사내 신청 URL로 바꿔주세요.</p></div></section><section class="panel form-panel"><h2 style="margin-bottom:22px">보내는 방법과 대상</h2><div id="recipient-settings">${recipientSettings(t)}</div></section></div><div class="approval-bar"><div><label class="confirm-row"><input type="checkbox" id="send-confirm" ${d.confirmed?'checked':''}><span id="confirmation-label">${confirmationLabel(d)}</span></label><p>체크하면 최종 본문과 대상을 확인하는 창이 열립니다.</p></div><button class="button primary" id="send-button" data-action="simulate-send" ${canSend(t)?'':'disabled'}>${sendLabel(t)} ${icon('arrow')}</button></div>`;
}
const confirmationLabel = d => d.mode==='dm'?'보낼 내용과 DM을 받을 동료를 확인했어요.':'보낼 내용과 게시할 채널·공개 범위를 확인했어요.';
const approvalSignature = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return JSON.stringify({body:d.body,mode:d.mode,recipientIds:a.list.map(e=>e.id),channelIds:a.channels.map(c=>c.id)});};
const canSend = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return ticketState(t)==='pending'&&d.confirmed&&d.confirmedSignature===approvalSignature(t)&&d.body.trim()&&(d.mode==='dm'?a.list.length:a.channels.length);};
const sendLabel = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return d.mode==='dm'?`${a.list.length}명에게 DM 보내기 (예시)`:`${a.channels.length}개 채널에 게시 (예시)`;};
function updateApproval(t) {
  const d=getDraft(t);$('#send-confirm').checked=d.confirmed;$('#confirmation-label').textContent=confirmationLabel(d);$('#send-button').disabled=!canSend(t);$('#send-button').innerHTML=escapeHtml(sendLabel(t))+' '+icon('arrow');
}
function updateRecipients(t) {
  $('#recipient-settings').innerHTML=recipientSettings(t);const all=$('#all-teams');if(all)all.indeterminate=getDraft(t).teams.length>0&&getDraft(t).teams.length<TEAMS.length;filterRecipientRows();updateApproval(t);
}
function filterRecipientRows() {
  const search=recipientSearch.trim().toLowerCase();document.querySelectorAll('[data-individual-row]').forEach(row=>row.hidden=Boolean(search)&&!row.dataset.search.includes(search));
}
function render() {
  const r=route();renderNavigation(r);
  $('#content').innerHTML=r.view==='home'?home():r.view==='projects'?projectsPage():r.view==='project'?projectPage(r.id):r.view==='edit-project'?projectFormPage(r.id):r.view==='history'?historyPage():reviewPage(r.id);
  if(r.view==='edit-project')refreshMemberPicker();
  if(r.view==='review'){const all=$('#all-teams');if(all)all.indeterminate=getDraft(getTicket(r.id)).teams.length>0&&getDraft(getTicket(r.id)).teams.length<TEAMS.length;filterRecipientRows();}
}
function refreshCalendar() {
  $('#calendar-content').innerHTML=calendar.view==='calendar'?calendarMarkup():projectTable();
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarView===calendar.view)));
  persist();
}
function dialogHeading(title,subtitle,eyebrow) {
  return `<div class="dialog-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="history-dialog-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="button icon-button" data-action="close-dialog" aria-label="안내 기록 닫기">${icon('close')}</button></div>`;
}
function openHistory(id) {
  const record=records.find(r=>r.id===id);if(!record)return;
  historyContext={id,edit:false,origin:document.activeElement};renderHistoryDialog();$('#history-dialog').showModal();
}
function renderHistoryDialog() {
  const r=records.find(r=>r.id===historyContext.id),p=getProject(r.project),edit=historyContext.edit;
  $('#history-dialog').innerHTML=`${dialogHeading(r.title,`${recordDate(r.date)} · ${r.route}`,p.name+' / 보낸 안내')}<form id="history-form"><div class="dialog-body"><div class="preview-label"><span class="field-label" style="margin:0">안내 원문</span><div class="actions">${tag(r.source==='manual'?'직접 추가한 기록':r.source==='simulated'?'보내기 예시':'예시 원문',r.source==='simulated'?'green':'gray')}<button type="button" class="button compact" data-action="edit-history">${edit?'원문 보기':'기록 내용 수정'}</button></div></div>${edit?`<textarea id="history-body" maxlength="20000" aria-label="안내 원문">${escapeHtml(r.body)}</textarea><p class="help" style="margin-bottom:22px">이곳에 보관한 기록만 수정돼요. Slack 메시지는 변경하지 않아요.</p>`:`<div class="message-original">${escapeHtml(r.body||'원문이 아직 등록되지 않았어요. 기록 내용 수정에서 추가할 수 있어요.')}</div>`}<div class="field" style="margin-bottom:0"><label for="history-url">Slack 메시지 링크</label><input id="history-url" type="url" placeholder="https://워크스페이스.slack.com/archives/…" value="${escapeHtml(r.url)}" maxlength="2000"><p class="help">Slack에서 ‘메시지 링크 복사’로 가져온 주소를 붙여넣어주세요.</p></div><p id="history-error" class="error-message" role="alert" hidden></p></div><div class="dialog-footer"><span class="help">이 브라우저에 기록을 저장해요.</span><div class="actions">${r.url?`<a class="button" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">Slack에서 열기 ${icon('external')}</a>`:''}<button class="button primary" type="submit">${edit?'수정 내용 저장':'링크 저장'}</button></div></div></form>`;
  $('#history-form .dialog-body').insertAdjacentHTML('afterbegin',`<div class="field"><label for="history-kind">안내 종류</label><select id="history-kind"><option value="initial" ${recordKind(r)==='initial'?'selected':''}>최초 공지</option><option value="reminder" ${recordKind(r)==='reminder'?'selected':''}>리마인드 알림</option></select></div>`);
}
function newHistory(projectId) {
  historyContext={id:null,edit:true,origin:document.activeElement};
  const projectOptions=PROJECTS.map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${p.name}</option>`).join('');
  $('#history-dialog').innerHTML=`${dialogHeading('안내 기록 추가','이전에 보낸 안내를 원문 또는 Slack 링크로 남겨요.','보낸 안내')}<form id="new-history-form"><div class="dialog-body"><div class="field"><label for="record-project">프로젝트</label><select id="record-project">${projectOptions}</select></div><div class="field"><label for="record-title">안내 제목</label><input type="text" id="record-title" required maxlength="160" placeholder="예: 워크숍 첫 공지"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:15px"><div class="field"><label for="record-date">보낸 날짜와 시각</label><input type="datetime-local" id="record-date" required value="2026-10-03T10:00" style="width:100%;border:1px solid #dde4de;border-radius:7px;padding:10px;font-size:11px"></div><div class="field"><label for="record-route">보낸 곳</label><input type="text" id="record-route" required maxlength="200" placeholder="예: #전체-공지 또는 DM 20명"></div></div><div class="field"><label for="record-body">안내 원문</label><textarea id="record-body" maxlength="20000" placeholder="실제로 보낸 안내 내용을 붙여넣어주세요."></textarea></div><div class="field" style="margin:0"><label for="record-url">Slack 메시지 링크</label><input id="record-url" type="url" maxlength="2000" placeholder="https://워크스페이스.slack.com/archives/…"><p class="help">원문 또는 Slack 메시지 링크 중 하나 이상을 넣어주세요.</p></div><p id="history-error" class="error-message" role="alert" hidden></p></div><div class="dialog-footer"><span class="help">기록을 추가해도 메시지가 전송되지는 않아요.</span><button type="submit" class="button primary">안내 기록 저장</button></div></form>`;
  $('#record-project').closest('.field').insertAdjacentHTML('afterend','<div class="field"><label for="record-kind">안내 종류</label><select id="record-kind"><option value="initial">최초 공지</option><option value="reminder">리마인드 알림</option></select></div>');
  $('#history-dialog').showModal();
}
function historyError(text) { $('#history-error').textContent=text;$('#history-error').hidden=false; }
function closeHistory() {
  const origin=historyContext?.origin;$('#history-dialog').close();historyContext=null;
  if(origin?.isConnected)origin.focus();
}
function recordApplicationChange(project,employeeId,toStatus,reason='') {
  const fromStatus=applications.find(item=>item.projectId===project.id&&item.employeeId===employeeId)?.status||'none';
  if(fromStatus===toStatus)return false;
  const at=checkedAt();
  applications=setApplication(applications,project.id,employeeId,toStatus,at);
  applicationEvents.push({id:crypto.randomUUID(),projectId:project.id,employeeId,fromStatus,toStatus,reason,actor:'로컬 운영자',at});
  project.lastCheckedAt=at;project.dataKind='local';
  Object.values(drafts).forEach(d=>d.confirmed=false);
  persist();render();return true;
}
function openCancel(project,employeeId) {
  const person=EMPLOYEES.find(e=>e.id===employeeId),team=TEAMS.find(t=>t.id===person?.team);
  if(!person||!team||!status(project).appliedIds.includes(employeeId))return;
  cancelContext={projectId:project.id,employeeId,origin:document.activeElement};
  $('#cancel-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">신청 상태 변경</p><h2 id="cancel-dialog-title">신청을 취소하시겠습니까?</h2></div><button class="button icon-button" data-action="close-cancel" aria-label="취소 창 닫기">${icon('close')}</button></div><form id="cancel-form"><div class="dialog-body"><p class="cancel-target"><strong>${escapeHtml(person.name)} · ${escapeHtml(team.name)}</strong><span>${escapeHtml(project.name)}</span></p><p class="caption muted">신청을 취소하면 이 동료는 대상 명단에 남고 ‘신청 전’으로 돌아갑니다. 변경 시각과 사유는 아래 기록에 남습니다.</p><div class="field cancel-reason"><label for="cancel-reason">취소 사유 <span aria-hidden="true">*</span></label><textarea id="cancel-reason" required maxlength="500" placeholder="예: 본인 요청으로 신청 취소" aria-describedby="cancel-reason-help"></textarea><p id="cancel-reason-help" class="help">사유를 입력해야 취소할 수 있습니다.</p></div></div><div class="dialog-footer"><span class="help">기록은 이 브라우저에 저장됩니다.</span><div class="actions"><button type="button" class="button" data-action="close-cancel">돌아가기</button><button type="submit" class="button primary">신청 취소 확정</button></div></div></form>`;
  $('#cancel-dialog').showModal();$('#cancel-reason').focus();
}
function closeCancel() {
  const origin=cancelContext?.origin;$('#cancel-dialog').close();cancelContext=null;
  if(origin?.isConnected)origin.focus();
}
function openSendPreview(t) {
  const d=getDraft(t),p=getProject(t.project),a=audience(p,d);
  if(!d.body.trim()){toast('메시지 본문을 입력해주세요.');return;}
  if(d.mode==='dm'&&!a.list.length){toast('DM을 받을 동료를 선택해주세요.');return;}
  if(d.mode==='channel'&&!a.channels.length){toast('게시할 채널을 추가해주세요.');return;}
  previewContext={ticketId:t.id,signature:approvalSignature(t),origin:document.activeElement};
  const targets=d.mode==='dm'?`<p class="preview-target-summary">개별 DM ${a.list.length}명 · 필수 참여 중 신청 전 ${a.required}명</p><div class="preview-target-list">${a.list.map(e=>`<span>${escapeHtml(e.name)} · ${escapeHtml(TEAMS.find(team=>team.id===e.team).name)}</span>`).join('')}</div>`:`<p class="preview-target-summary">채널 ${a.channels.length}곳에 각각 게시 · 고유 공개 인원 ${a.list.length}명</p><div class="preview-target-list">${a.channelAudiences.map(({channel,members})=>`<span>${escapeHtml(channel.name)} · 예시 구성원 ${members.length}명 · 프로젝트 대상 외 ${members.filter(e=>!p.targetIds.includes(e.id)).length}명</span>`).join('')}</div>`;
  $('#send-preview-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">최종 확인</p><h2 id="send-preview-title">보낼 본문과 대상을 확인해주세요</h2><p>${escapeHtml(p.name)} · ${escapeHtml(t.title)}</p></div><button class="button icon-button" data-action="close-preview" aria-label="최종 확인 창 닫기">${icon('close')}</button></div><div class="dialog-body"><h3>메시지 본문</h3><div class="message-original">${escapeHtml(d.body)}</div><h3>${d.mode==='dm'?'DM을 받을 동료':'게시할 채널과 공개 범위'}</h3>${targets}<label class="confirm-row preview-confirm"><input type="checkbox" id="preview-ack"><span>위 본문과 ${d.mode==='dm'?'받을 동료':'게시할 채널'}를 확인했어요.</span></label></div><div class="dialog-footer"><span class="help">이번 프로토타입에서는 실제 메시지를 보내지 않아요.</span><div class="actions"><button class="button" data-action="close-preview">돌아가기</button><button class="button primary" data-action="confirm-preview" disabled>확인 완료</button></div></div>`;
  $('#send-preview-dialog').showModal();
}
function closeSendPreview() {
  const origin=previewContext?.origin;$('#send-preview-dialog').close();previewContext=null;
  if(origin?.isConnected)origin.focus();
}
function confirmSendPreview() {
  if(!previewContext||!$('#preview-ack').checked)return;
  const t=getTicket(previewContext.ticketId),d=getDraft(t);
  if(approvalSignature(t)!==previewContext.signature){closeSendPreview();toast('본문이나 대상이 바뀌었어요. 다시 확인해주세요.');return;}
  d.confirmed=true;d.confirmedSignature=previewContext.signature;
  closeSendPreview();updateApproval(t);
}
function saveCancelForm(event) {
  event.preventDefault();if(!cancelContext)return;
  const reason=$('#cancel-reason').value.trim(),project=getProject(cancelContext.projectId),employeeId=cancelContext.employeeId;
  if(!reason){$('#cancel-reason').setCustomValidity('취소 사유를 입력해주세요.');$('#cancel-reason').reportValidity();return;}
  if(!project?.targetIds.includes(employeeId)||!status(project).appliedIds.includes(employeeId)){closeCancel();toast('신청 상태가 바뀌었어요. 다시 확인해주세요.');return;}
  closeCancel();if(recordApplicationChange(project,employeeId,'cancelled',reason))toast('신청을 취소하고 사유를 기록했어요.');
}
function saveHistoryForm(event) {
  event.preventDefault();const url=slackUrl($('#history-url').value);if(url===null){historyError('Slack 메시지 링크를 확인해주세요. HTTPS로 시작하는 Slack 메시지 주소를 넣어주세요.');return;}
  const record=records.find(r=>r.id===historyContext.id),body=historyContext.edit?$('#history-body').value.trim():record.body;
  if(!body&&!url){historyError('안내 원문 또는 Slack 메시지 링크를 넣어주세요.');return;}
  record.body=body;record.url=url;record.kind=$('#history-kind').value;const saved=persist();closeHistory();render();if(saved)toast('안내 기록을 저장했어요.');
}
function saveNewHistoryForm(event) {
  event.preventDefault();const url=slackUrl($('#record-url').value),body=$('#record-body').value.trim();
  if(url===null){historyError('Slack 메시지 링크를 확인해주세요. HTTPS로 시작하는 Slack 메시지 주소를 넣어주세요.');return;}
  if(!body&&!url){historyError('안내 원문 또는 Slack 메시지 링크 중 하나를 넣어주세요.');return;}
  if(records.length>=100){historyError('프로토타입에는 안내 기록을 100개까지 저장할 수 있어요.');return;}
  const record={id:crypto.randomUUID(),project:$('#record-project').value,kind:$('#record-kind').value,title:$('#record-title').value.trim(),date:$('#record-date').value,route:$('#record-route').value.trim(),body,url,source:'manual'};
  if(!record.title||!record.route||!validRecord(record)){historyError('제목, 날짜와 보낸 곳을 확인해주세요.');return;}
  records.push(record);const saved=persist();closeHistory();render();if(saved)toast('새 안내 기록을 추가했어요.');
}
function simulateSend(t) {
  if(!canSend(t))return;if(records.length>=100){toast('프로토타입의 안내 기록 저장 한도에 도달했어요.');return;}
  const d=getDraft(t),a=audience(getProject(t.project),d),id=crypto.randomUUID();
  const route=d.mode==='dm'?`DM · 동료 ${a.list.length}명 · ${d.dmSelection==='people'?'개별 선택':d.teams.length===TEAMS.length?'전체 팀':d.teams.map(id=>TEAMS.find(t=>t.id===id).name).join('·')}`:`${a.channels.map(c=>c.name).join(' · ')} · 게시 ${a.channels.length}건`;
  records.push({id,project:t.project,ticket:t.id,title:t.title,date:'2026-10-03T10:00',route,body:d.body,url:'',source:'simulated',kind:recordKind({title:t.title,ticket:t.id}),recipientIds:d.mode==='dm'?a.list.map(e=>e.id):[],channelIds:d.mode==='channel'?a.channels.map(c=>c.id):[]});
  completed[t.id]=id;d.confirmed=false;const saved=persist();activeTab='tickets';location.hash=`project/${t.project}`;
  if(saved)toast('안내 보내기를 완료했어요 (예시). 이 티켓의 원문을 기록했어요.');
}

document.addEventListener('click',event=>{
  if(event.target.closest('.skip-link')){event.preventDefault();$('#content').focus();return;}
  if(event.target.id==='send-confirm'){event.preventDefault();const r=route();if(r.view==='review')openSendPreview(getTicket(r.id));return;}
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.application){
    const p=getProject(button.dataset.project),employeeId=Number(button.dataset.employee),value=button.dataset.application;
    if(!p?.targetIds.includes(employeeId) || !['applied','confirmed','cancelled'].includes(value))return;
    if(value==='cancelled'){openCancel(p,employeeId);return;}
    if(recordApplicationChange(p,employeeId,value==='applied'&&p.confirmationMode==='immediate'?'confirmed':value))toast('신청 상태를 반영했어요.');return;
  }
  if(button.dataset.record){openHistory(button.dataset.record);return;}
  if(button.dataset.tab){activeTab=button.dataset.tab;render();$(`#${activeTab==='tickets'?'tickets-tab':'sent-tab'}`).focus();return;}
  if(button.dataset.calendarView){calendar.view=button.dataset.calendarView;refreshCalendar();return;}
  if(button.dataset.date){calendar.selected=button.dataset.date;refreshCalendar();$(`[data-date="${calendar.selected}"]`)?.focus();return;}
  if(button.dataset.month){const d=new Date(Date.UTC(calendar.year,calendar.month+Number(button.dataset.month),1));if(d.getUTCFullYear()<2000||d.getUTCFullYear()>2100)return;calendar.year=d.getUTCFullYear();calendar.month=d.getUTCMonth();calendar.selected=dayKey(d);refreshCalendar();return;}
  const r=route(),t=r.view==='review'?getTicket(r.id):null;
  if(button.dataset.mode&&t){const d=getDraft(t);d.mode=button.dataset.mode;d.confirmed=false;recipientPage=0;updateRecipients(t);return;}
  if(button.dataset.dmSelection&&t){const d=getDraft(t);d.dmSelection=button.dataset.dmSelection;d.confirmed=false;recipientPage=0;updateRecipients(t);return;}
  if(button.dataset.removeChannel&&t){const d=getDraft(t);d.channels=d.channels.filter(id=>id!==button.dataset.removeChannel);d.confirmed=false;updateRecipients(t);return;}
  if(button.dataset.recipientsPage&&t){recipientPage+=Number(button.dataset.recipientsPage);$('#recipient-list').innerHTML=recipientTable(audience(getProject(t.project),getDraft(t)).list,getProject(t.project));return;}
  switch(button.dataset.action){
    case 'select-visible-members':document.querySelectorAll('[data-member-row]:not([hidden]) [data-target-member]').forEach(input=>input.checked=true);refreshMemberPicker();break;
    case 'clear-visible-members':document.querySelectorAll('[data-member-row]:not([hidden]) [data-target-member]').forEach(input=>input.checked=false);refreshMemberPicker();break;
    case 'extract-document':findDocumentCandidates();break;
    case 'apply-document':{
      const selected=[...document.querySelectorAll('[data-candidate]:checked')].map(input=>documentCandidates[Number(input.dataset.candidate)]);
      selected.forEach(candidate=>{const input=$(`#project-${candidate.field}`);if(input)input.value=candidate.value;});
      if(selected.length){appliedDocumentName=documentName||'붙여넣은 기획서';toast(`${selected.length}개 항목을 채웠어요. 내용을 확인하고 저장해주세요.`);}
      break;
    }
    case 'reset-sample':if(!resetArmed){resetArmed=true;render();break;}resetArmed=false;PROJECTS=structuredClone(INITIAL_PROJECTS);applications=structuredClone(INITIAL_APPLICATIONS);applicationEvents=[];records=structuredClone(INITIAL_RECORDS);completed={};drafts={};calendar={year:2026,month:9,selected:'2026-10-03',view:'calendar'};persist();render();toast('예시 데이터로 초기화했어요.');break;
    case 'calendar-today':calendar={year:2026,month:9,selected:'2026-10-03',view:'calendar'};refreshCalendar();break;
    case 'new-record':newHistory(button.dataset.project);break;
    case 'close-dialog':closeHistory();break;
    case 'close-cancel':closeCancel();break;
    case 'close-preview':closeSendPreview();break;
    case 'confirm-preview':confirmSendPreview();break;
    case 'clear-individuals':if(t){const d=getDraft(t);d.selectedIds=[];d.confirmed=false;updateRecipients(t);}break;
    case 'add-channel':if(t){const channelId=$('#posting-channel')?.value,d=getDraft(t);if(!channelId){toast('추가할 채널을 선택해주세요.');break;}if(CHANNELS.some(c=>c.id===channelId)&&!d.channels.includes(channelId)){d.channels.push(channelId);d.confirmed=false;updateRecipients(t);}}break;
    case 'edit-history':{
      const pendingUrl=$('#history-url').value,pendingKind=$('#history-kind').value;historyContext.edit=!historyContext.edit;renderHistoryDialog();$('#history-url').value=pendingUrl;$('#history-kind').value=pendingKind;break;
    }
    case 'simulate-send':if(t)simulateSend(t);break;
  }
});
document.addEventListener('change',async event=>{
  const r=route(),el=event.target;
  if(el.id==='preview-ack'){$('[data-action="confirm-preview"]').disabled=!el.checked;return;}
  if(r.view==='edit-project'){
    if(el.id==='document-file'){
      const file=el.files?.[0];if(!file)return;
      if(!/\.(txt|md)$/i.test(file.name)||file.size>2_000_000){$('#document-candidates').innerHTML='<p class="error-message">2MB 이하의 .txt 또는 .md 파일을 선택해주세요.</p>';return;}
      documentName=file.name;$('#document-source').value=await file.text();findDocumentCandidates();return;
    }
    if(el.id==='member-team'||el.matches('[data-target-member], [data-required-member]'))refreshMemberPicker();
    return;
  }
  if(r.view!=='review')return;const t=getTicket(r.id),d=getDraft(t);
  if(el.id==='draft-tone'){d.tone=el.value;d.body=draftText(t,d.tone);d.confirmed=false;$('#draft-body').value=d.body;updateApproval(t);return;}
  if(el.id==='audience-scope')d.scope=el.value;
  else if(el.id==='all-teams')d.teams=el.checked?TEAMS.map(t=>t.id):[];
  else if(el.dataset.team)d.teams=Array.from(document.querySelectorAll('[data-team]:checked')).map(input=>input.dataset.team);
  else if(el.dataset.individual){const id=Number(el.dataset.individual);d.selectedIds=el.checked?[...new Set([...d.selectedIds,id])]:d.selectedIds.filter(item=>item!==id);}
  else return;
  d.confirmed=false;recipientPage=0;updateRecipients(t);
});
document.addEventListener('input',event=>{
  if(event.target.id==='member-search'){refreshMemberPicker();return;}
  if(event.target.id==='recipient-search'){recipientSearch=event.target.value;filterRecipientRows();return;}
  if(event.target.id==='document-source'){documentName='';return;}
  if(event.target.id==='draft-body'){const r=route();if(r.view!=='review')return;const t=getTicket(r.id),d=getDraft(t);d.body=event.target.value;d.confirmed=false;updateApproval(t);}
});
document.addEventListener('submit',event=>{if(event.target.id==='history-form')saveHistoryForm(event);if(event.target.id==='new-history-form')saveNewHistoryForm(event);if(event.target.id==='project-form')saveProjectForm(event);if(event.target.id==='cancel-form')saveCancelForm(event);});
$('#history-dialog').addEventListener('cancel',event=>{event.preventDefault();closeHistory();});
$('#cancel-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCancel();});
$('#send-preview-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSendPreview();});
document.addEventListener('input',event=>{if(event.target.id==='cancel-reason')event.target.setCustomValidity('');});
document.addEventListener('keydown',event=>{
  const tab=event.target.closest('[role=tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();activeTab=event.key==='Home'?'tickets':event.key==='End'?'history':activeTab==='tickets'?'history':'tickets';render();$(`#${activeTab==='tickets'?'tickets-tab':'sent-tab'}`).focus();
});
window.addEventListener('hashchange',()=>{
  if($('#history-dialog').open)closeHistory();if($('#cancel-dialog').open)closeCancel();if($('#send-preview-dialog').open)closeSendPreview();activeTab='tickets';recipientPage=0;recipientSearch='';resetArmed=false;projectFormError='';documentCandidates=[];documentName='';appliedDocumentName='';
  const r=route();if(r.view==='review')getDraft(getTicket(r.id)).confirmed=false;
  render();window.scrollTo({top:0,behavior:'instant'});$('#content').focus({preventScroll:true});
});
restore();render();
