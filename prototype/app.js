/* Slack sends are simulated. Document analysis and draft storage use authenticated server APIs. */
import {calculateStatus, setApplication, applicationBreakdown, sortTicketsForDisplay} from './data.js';
import {mountDocumentImport} from './document-import.js';
import {evaluateReminderTickets} from './rule-engine.js';
import {NOTICE_PURPOSES,BRIEF_LABELS,makeNoticeBrief,generationSignature,acceptNoticeCandidate} from './notice-draft.js';
import {projectSendSnapshot,sheetSendSnapshot} from './send-preflight.js';
import {mergeSheetApplications} from './sheet-application-merge.js';
import {newProjectId} from './project-id.js';
import {quickRecipientSelection,recipientGroups,recipientCounts,recipientGroupLabel} from './recipient-selection.js';
import {configureSupabase,restoreSupabaseUser,signInSupabase,signOutSupabase,accessToken,supabaseRequest,readOperatorState,saveOperatorState as saveStateDirect,readSheetSnapshot,readAutomationTickets,readDrafts,readDraft,saveDraft,createFileUrl,uploadNoticeResource} from './supabase-browser.js';
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
let EMPLOYEES = Array.from({length:160},(_,i)=>({id:i+1,name:`${SAMPLE_FAMILY_NAMES[Math.floor(i/20)]}${SAMPLE_GIVEN_NAMES[i%20]} (예시)`,team:TEAMS[i%4].id}));
const INITIAL_EMPLOYEES=structuredClone(EMPLOYEES);
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
let TICKETS = [
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
const INITIAL_TICKETS = structuredClone(TICKETS);
const INITIAL_RECORDS = [
  {id:'health-history',project:'health',ticket:'health-d3',title:'건강검진 D-3 신청 안내',date:'2026-10-02T10:00',route:'DM · 동료 18명',body:'안녕하세요, 동료 여러분!\n\n올해 건강검진 신청이 10월 5일 오후 6시에 마감돼요. 아직 신청하지 않으셨다면 사내 신청 페이지에서 검진 일정과 기관을 선택해주세요.\n\n이미 신청하셨다면 다시 신청하지 않아도 돼요. 궁금한 점은 김총무에게 편하게 알려주세요.\n\n건강한 일상을 함께 챙겨요!',url:'',source:'sample'},
  {id:'workshop-history',project:'workshop',ticket:'workshop-d10',title:'가을 워크숍 신청 안내',date:'2026-09-28T10:00',route:'DM · 동료 80명',body:'안녕하세요! 가을 워크숍 신청을 안내해요.\n\n10월 16일, 동료들과 함께하는 가을 워크숍이 열려요. 참여하실 분은 10월 8일 오후 6시까지 사내 신청 페이지에서 신청해주세요.\n\n함께 이야기 나누고 새로운 추억을 만들어요. 자세한 일정은 워크숍 기획서를 참고해주세요.\n\n궁금한 점은 김총무에게 알려주세요. 감사합니다!',url:'',source:'sample'},
  {id:'health-first-history',project:'health',ticket:'health-first',title:'올해 건강검진 첫 안내',date:'2026-09-15T09:00',route:'#전체-공지 · 게시 1건',body:'동료 여러분, 올해 건강검진 신청이 시작됐어요.\n\n신청 마감: 10월 5일 오후 6시\n검진 운영: 10월 31일까지\n신청 방법: 사내 신청 페이지에서 기관과 일정을 선택해주세요.\n\n필수 참여 동료는 마감 전에 꼭 신청해주세요. 건강검진 안내 자료도 함께 확인해주세요.',url:'',source:'sample'},
];
const STORAGE_KEY = 'office-benefits-web-v1';
const TODAY_KST = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let records = structuredClone(INITIAL_RECORDS);
let completed = {};
let calendar = {year:Number(TODAY_KST.slice(0,4)),month:Number(TODAY_KST.slice(5,7))-1,selected:TODAY_KST,view:'calendar'};
let drafts = {};
let cloudConfigured = false;
let cloudUser = null;
const cloudState = {};
const cloudTimers = new Map();
const cloudSaves = new Map();
const noticeStates = new Map();
let activeTab = 'tickets';
let historyFilter = 'all';
let rosterSearch = '';
let rosterFilter = 'all';
let recipientPage = 0;
let recipientSearch = '';
let historyContext = null;
let cancelContext = null;
let previewContext = null;
let ticketDialogContext = null;
let toastTimeout;
let projectFormError = '';
let appliedDocumentName = '';
let appliedFieldReviews = {};
let appliedSourceIssues = null;
let disposeDocumentImport = null;
let resetArmed = false;
let sheetSourceStatus = {configured:false,spreadsheetId:null};
let sheetSync = null;
let sheetSyncBusy = false;
let sendPreflightBusy = false;
const sendPreflightErrors = new Map();
let sheetSyncError = '';
let officialCalendar = null;
let holidayError = '';
let operatorVersion = 0;
let operatorOwnerId = null;
let operatorDirty = false;
let operatorRevision = 0;
let operatorSaveTimer;
let operatorSaving = false;
let operatorConflict = null;
let operatorSaveStatus = 'local';
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
const daysLeft = p => Math.round((Date.parse(p.deadline+'T00:00:00Z')-Date.parse(TODAY_KST+'T00:00:00Z'))/86400000);
const deadlineLabel = p => daysLeft(p)<0?'마감됨':daysLeft(p)===0?'오늘 마감':`D-${daysLeft(p)}`;
const dateLabel = value => {const [y,m,d] = value.slice(0,10).split('-');return `${Number(m)}월 ${Number(d)}일`;};
const recordDate = value => `${dateLabel(value)} ${value.slice(11,16)}`;
const tag = (text,kind='gray') => `<span class="tag ${kind}">${escapeHtml(text)}</span>`;
const projectSymbol = p => `<span class="project-symbol ${p.id}">${icon(p.symbol)}</span>`;
const stateLabel = state => ({pending:'확인 기다림',scheduled:'예정',deferred:'보류',dismissed:'안내하지 않음',retired:'종료',done:'완료'}[state]);
const stateColor = state => ({pending:'orange',scheduled:'gray',deferred:'gray',dismissed:'gray',retired:'gray',done:'green'}[state]);

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
    if (!saved || ![1,2,3,4,5,6].includes(saved.version)) return;
    if(saved.operatorOwnerId&&saved.operatorOwnerId!==cloudUser?.id)return;
    operatorOwnerId=saved.operatorOwnerId||null;
    operatorVersion=Number.isInteger(saved.operatorVersion)?saved.operatorVersion:0;
    operatorDirty=saved.operatorDirty===true||saved.version<5;
    if(saved.version>=6&&Array.isArray(saved.employees)){
      const knownTeams=new Set(TEAMS.map(team=>team.id));
      const valid=saved.employees.filter(e=>e&&Number.isSafeInteger(e.id)&&e.id>0&&typeof e.name==='string'&&e.name.trim()&&knownTeams.has(e.team));
      if(valid.length&&valid.length<=5000&&new Set(valid.map(e=>e.id)).size===valid.length)EMPLOYEES=valid;
    }
    if(saved.version>=6&&saved.sheetSync&&typeof saved.sheetSync==='object')sheetSync=saved.sheetSync;
    if(saved.version>=5&&Array.isArray(saved.tickets))TICKETS=saved.tickets.filter(t=>t&&typeof t.id==='string'&&typeof t.project==='string'&&typeof t.title==='string'&&typeof t.date==='string'&&['pending','scheduled','deferred','dismissed','retired','done'].includes(t.state)).slice(0,1000);
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
    if(saved.version>=4 && saved.drafts && typeof saved.drafts==='object') {
      const knownEmployees=new Set(EMPLOYEES.map(e=>e.id)),knownTeams=new Set(TEAMS.map(t=>t.id)),knownChannels=new Set(CHANNELS.map(c=>c.id));
      TICKETS.filter(t=>ticketState(t)==='pending'&&getProject(t.project)).forEach(t=>{
        const source=saved.drafts[t.id];if(!source||typeof source!=='object')return;
        const d=getDraft(t);
        if(typeof source.body==='string'&&source.body.length<=20000)d.body=source.body;
        if(['friendly','concise','action'].includes(source.tone))d.tone=source.tone;
        if(Object.hasOwn(NOTICE_PURPOSES,source.purpose))d.purpose=source.purpose;
        if(['dm','channel'].includes(source.mode))d.mode=source.mode;
        if(['pending','project','company'].includes(source.scope))d.scope=source.scope;
        if(['team','people'].includes(source.dmSelection))d.dmSelection=source.dmSelection;
        if(Array.isArray(source.teams))d.teams=[...new Set(source.teams.filter(id=>knownTeams.has(id)))];
        if(Array.isArray(source.selectedIds))d.selectedIds=[...new Set(source.selectedIds.filter(id=>knownEmployees.has(id)))];
        if(Array.isArray(source.channels))d.channels=[...new Set(source.channels.filter(id=>knownChannels.has(id)))];
        d._cloudVersion=Number.isInteger(source._cloudVersion)?source._cloudVersion:0;
        d._cloudRevision=Number.isInteger(source._cloudRevision)?source._cloudRevision:0;
        d._cloudDirty=source._cloudDirty===true || source._cloudVersion===undefined;
        if(Array.isArray(source.resources))d.resources=source.resources.filter(item=>item && ['file','link'].includes(item.kind) && typeof item.label==='string').slice(0,20);
        if(source.brief&&typeof source.brief==='object')d.brief=source.brief;
        d.briefStale=source.briefStale===true;
      });
    }
  } catch { /* Storage is optional; retain usable defaults. */ }
}
function operatorPayload(){return {schemaVersion:2,employees:EMPLOYEES,sheetSync,projects:PROJECTS,applications,applicationEvents,records,tickets:TICKETS,completed};}
function persist({remote=true}={}) {
  try {
    const savedDrafts=Object.fromEntries(Object.entries(drafts).map(([id,{confirmed,confirmedSignature,confirmedSourceSnapshot,confirmedSpreadsheetId,...draft}])=>[id,draft]));
    if(remote){operatorDirty=true;operatorRevision++;if(cloudUser)scheduleOperatorSave();}
    localStorage.setItem(STORAGE_KEY,JSON.stringify({version:6,employees:EMPLOYEES,sheetSync,projects:PROJECTS,applications,applicationEvents,records,tickets:TICKETS,completed,calendar,drafts:savedDrafts,operatorOwnerId,operatorVersion,operatorDirty}));
    renderCloudButton();
    return true;
  }
  catch { toast('브라우저에 저장하지 못했어요. 이 화면을 열어둔 동안에는 내용을 유지해요.'); return false; }
}
function operatorLabel(){
  if(!cloudConfigured)return 'Supabase 설정 필요';
  if(!cloudUser)return 'Supabase 로그인';
  return ({saved:'운영 정보 서버 저장됨',pending:'운영 정보 저장 대기',saving:'운영 정보 저장 중',error:'운영 정보 저장 실패',conflict:'운영 정보 충돌',local:'운영 정보 확인 중'})[operatorSaveStatus];
}
function requireOperator(){if(cloudUser)return true;toast('입력한 내용을 서버에 저장하려면 먼저 Supabase에 로그인해주세요.');openCloudDialog();return false;}
function scheduleOperatorSave(){
  if(!cloudUser||operatorConflict)return;
  clearTimeout(operatorSaveTimer);operatorSaveStatus='pending';renderCloudButton();
  operatorSaveTimer=setTimeout(()=>void saveOperatorState(),650);
}
async function saveOperatorState(){
  if(!cloudUser||operatorSaving||!operatorDirty||operatorConflict)return;
  operatorSaving=true;operatorSaveStatus='saving';renderCloudButton();
  const revision=operatorRevision,payload=structuredClone(operatorPayload());
  try{
    const result=await saveStateDirect(operatorVersion,payload);
    operatorVersion=result.version;operatorOwnerId=cloudUser.id;operatorDirty=operatorRevision!==revision;
    operatorSaveStatus=operatorDirty?'pending':'saved';persist({remote:false});
  }catch(error){operatorConflict=error.status===409?error.current:null;operatorSaveStatus=error.status===409?'conflict':'error';renderCloudButton();}
  finally{operatorSaving=false;if(operatorDirty&&operatorSaveStatus==='pending')scheduleOperatorSave();}
}
function applyOperatorState(record){
  const data=record.payload;
  if(!data||!Array.isArray(data.projects)||!Array.isArray(data.applications)||!Array.isArray(data.tickets)||!Array.isArray(data.records))throw new Error('서버 운영 정보의 형식이 올바르지 않습니다.');
  if(Array.isArray(data.employees)&&data.employees.length)EMPLOYEES=structuredClone(data.employees);
  sheetSync=data.sheetSync&&typeof data.sheetSync==='object'?structuredClone(data.sheetSync):null;
  PROJECTS=structuredClone(data.projects);applications=structuredClone(data.applications);
  applicationEvents=structuredClone(data.applicationEvents||[]);records=structuredClone(data.records);
  TICKETS=structuredClone(data.tickets);completed=structuredClone(data.completed||{});
  operatorVersion=record.version;operatorOwnerId=cloudUser.id;operatorDirty=false;operatorConflict=null;operatorSaveStatus='saved';
  persist({remote:false});if(route().view!=='edit-project')render();
}
async function hydrateOperatorState(){
  const startedAtRevision=operatorRevision;
  const {state}=await readOperatorState();
  if(!state){operatorVersion=0;operatorConflict=null;operatorSaveStatus='pending';operatorDirty=true;scheduleOperatorSave();return;}
  if((operatorDirty||operatorRevision!==startedAtRevision)&&operatorVersion!==state.version){operatorConflict=state;operatorSaveStatus='conflict';renderCloudButton();return;}
  applyOperatorState(state);
}
function prepareOperatorCache(){
  let saved;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY));}catch{}
  if(saved?.operatorOwnerId&&saved.operatorOwnerId!==cloudUser?.id){
    EMPLOYEES=structuredClone(INITIAL_EMPLOYEES);sheetSync=null;PROJECTS=structuredClone(INITIAL_PROJECTS);applications=structuredClone(INITIAL_APPLICATIONS);
    applicationEvents=[];records=structuredClone(INITIAL_RECORDS);TICKETS=structuredClone(INITIAL_TICKETS);completed={};drafts={};
    operatorVersion=0;operatorOwnerId=null;operatorDirty=false;operatorConflict=null;operatorSaveStatus='local';
    localStorage.removeItem(STORAGE_KEY);
  }else restore();
}
async function refreshOperatorState(){
  if(!cloudUser||operatorSaving)return;
  try{
    const {state}=await readOperatorState();
    if(!state||state.version===operatorVersion)return;
    if(operatorDirty){operatorConflict=state;operatorSaveStatus='conflict';renderCloudButton();}
    else applyOperatorState(state);
  }catch{operatorSaveStatus='error';renderCloudButton();}
}
function checkedAtIso(value){return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value||'')?value:`${value}:00+09:00`;}
function reconcileProjectTickets(project){
  const prior=TICKETS.filter(t=>t.project===project.id&&t.key);
  if(project.lifecycle&&project.lifecycle!=='active'){
    let changed=false;
    for(const ticket of TICKETS.filter(t=>t.project===project.id))if(['pending','scheduled','deferred'].includes(ticket.state)){ticket.state='retired';ticket.lifecycleReason=project.lifecycle==='cancelled'?'프로젝트 취소':'운영 종료';changed=true;}
    return changed;
  }
  if(!officialCalendar||!project.lastCheckedAt||['sample','sheet'].includes(project.dataKind))return false;
  const output=evaluateReminderTickets({project,applicationRecords:applications,employees:EMPLOYEES,
    sync:{status:'success',lastSuccessAt:checkedAtIso(project.lastCheckedAt)},calendar:officialCalendar,
    now:new Date().toISOString(),policy:{maxDataAgeMinutes:1440},existingTickets:prior,sentRecords:records});
  if(output.status!=='ready'){holidayError=`${project.name}: 신청 현황을 새로 확인해야 티켓을 갱신할 수 있어요 (${output.blockedReasons.join(', ')}).`;return false;}
  const byKey=new Map(prior.map(t=>[t.key,t]));let changed=false;
  for(const candidate of output.tickets){
    const old=byKey.get(candidate.key),id=old?.id||`${project.id}-${candidate.kind}-${candidate.dueAt.replace(/\D/g,'')}`;
    const next={...old,...candidate,id,project:project.id,purpose:candidate.triggers.map(trigger=>trigger.startsWith('deadline-')?`마감 ${trigger.slice(9).replace('h','시간 전')}`:trigger).join(' · '),state:candidate.state,
      reason:candidate.reason,date:candidate.date,ruleGenerated:true};
    if(old){const index=TICKETS.indexOf(old);if(JSON.stringify(old)!==JSON.stringify(next)){TICKETS[index]=next;changed=true;}}
    else{TICKETS.push(next);changed=true;}
  }
  for(const key of output.retiredKeys){const ticket=byKey.get(key);if(ticket&&ticket.state!=='retired'){ticket.state='retired';ticket.lifecycleReason='신청 현황 또는 일정 변경';changed=true;}}
  return changed;
}
async function refreshOfficialCalendarAndTickets(){
  if(!cloudUser)return;
  const years=[...new Set(PROJECTS.filter(p=>p.dataKind!=='sample').flatMap(p=>[Number(p.deadlineAt?.slice(0,4))-1,Number(p.deadlineAt?.slice(0,4))]))].filter(Boolean);
  if(!years.length){holidayError='';officialCalendar=null;return;}
  try{
    const batches=[];for(let index=0;index<years.length;index+=4)batches.push(years.slice(index,index+4));
    const calendars=[];for(const batch of batches)calendars.push(await cloudRequest('/api/holidays',{method:'POST',body:{years:batch}}));
    officialCalendar={status:'success',holidays:[...new Set(calendars.flatMap(item=>item.holidays))].sort(),checkedAt:calendars.at(-1).checkedAt,source:calendars.at(-1).source};
    holidayError='';let changed=false;
    for(const project of PROJECTS.filter(p=>p.dataKind!=='sample'))changed=reconcileProjectTickets(project)||changed;
    if(changed){persist();if(route().view!=='edit-project')render();}
  }catch(error){officialCalendar=null;holidayError=error.message;if(route().view!=='edit-project')render();}
}
async function cloudRequest(path,{method='GET',body,headers={}}={}) {
  const token=path==='/api/status'||path==='/api/sheets/status'?null:await accessToken();
  const response=await fetch(path,{method,headers:{...(body && !(body instanceof Blob)?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:body instanceof Blob?body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const result=await response.json().catch(()=>({error:'서버 응답을 읽지 못했습니다.'}));
  if(!response.ok)throw Object.assign(new Error(result.error||'서버 요청에 실패했습니다.'),{status:response.status,current:result.current});
  return result;
}
async function initializeSheetSource(){sheetSourceStatus.configured=cloudConfigured;if(route().view==='home')render();}
function sheetSourcePanel(){
  const link=sheetSourceStatus.spreadsheetId?`<a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetSourceStatus.spreadsheetId)}/edit" target="_blank" rel="noopener noreferrer">예시 스프레드시트 열기 ${icon('external')}</a>`:'';
  const last=sheetSync?.lastSuccessAt?new Date(sheetSync.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):null;
  return `<section class="panel sheet-source-panel"><div><h2>Google 스프레드시트 원본</h2><p class="caption muted">Supabase에 저장된 직원명부·프로젝트·대상·신청이력을 표시합니다. 정기 작업을 설정하면 매시간 갱신하고, 지금 가져오기를 누르면 바로 다시 확인해요.</p><p class="caption">${sheetSyncError?escapeHtml(sheetSyncError):last?`마지막 가져오기: ${escapeHtml(last)} · 직원 ${sheetSync.employeeCount}명 · 이력 ${sheetSync.eventCount}건`:sheetSourceStatus.configured?'첫 동기화를 기다리고 있어요.':'Supabase 연결 설정이 필요합니다.'}</p>${link}</div><button class="button" data-action="sync-sheet" ${sheetSyncBusy||!sheetSourceStatus.configured||!cloudUser?'disabled':''}>${sheetSyncBusy?'가져오는 중…':'지금 가져오기'}</button></section>`;
}
function applySheetSource(source,{remote=true}={}){
  if(source?.sync?.status!=='success'||!Array.isArray(source.employees)||!Array.isArray(source.sourceProjects)||!Array.isArray(source.projectTargets)||!Array.isArray(source.events)||!Array.isArray(source.applications))throw new Error('시트의 데이터 형식을 확인해주세요.');
  const teamByName=new Map(TEAMS.map(team=>[team.name,team.id]));
  const importedEmployees=source.employees.map(row=>{
    const team=teamByName.get(row.teamName);
    if(!team)throw new Error(`${row.teamName}은 현재 웹앱에 등록되지 않은 팀입니다.`);
    return {...row,team};
  });
  const projectIds=new Set(source.sourceProjects.map(row=>row.id));
  if(source.sourceProjects.some(row=>!getProject(row.id)))throw new Error('시트에 웹앱에 없는 프로젝트 ID가 있습니다. 프로젝트를 먼저 등록해주세요.');
  const targetByProject=new Map(source.projectTargets.map(row=>[row.projectId,row]));
  const kstTime=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)).replace(' ','T');
  const nextProjects=PROJECTS.map(project=>projectIds.has(project.id)?{
    ...project,targetIds:targetByProject.get(project.id)?.targetIds||[],requiredIds:targetByProject.get(project.id)?.requiredIds||[],
    dataKind:'sheet',lastCheckedAt:kstTime(source.sync.lastSuccessAt),
  }:project);
  const operatorEvents=applicationEvents.filter(event=>projectIds.has(event.projectId)&&event.source!=='sheet'&&!String(event.id).startsWith('sheet:'));
  const nextApplications=[...applications.filter(row=>!projectIds.has(row.projectId)),...mergeSheetApplications(source.applications,source.events,operatorEvents)];
  const prior=new Map();
  const importedEvents=source.events.map(event=>{
    const key=`${event.projectId}:${event.employeeId}`,fromStatus=prior.get(key)||'none';
    prior.set(key,event.status);
    return {id:`sheet:${event.sourceEventId}`,projectId:event.projectId,employeeId:event.employeeId,
      fromStatus,toStatus:event.status,reason:event.reason||'',actor:'Google Sheets',source:'sheet',at:kstTime(event.occurredAt)};
  });
  for(const project of nextProjects.filter(item=>item.dataKind==='sheet')){
    projectSendSnapshot(project,importedEmployees,nextApplications);
  }
  for(const ticket of TICKETS.filter(item=>projectIds.has(item.project))){
    const d=drafts[ticket.id];if(!d?.confirmed)continue;
    const project=nextProjects.find(item=>item.id===ticket.project);
    const latest=projectSendSnapshot(project,importedEmployees,nextApplications);
    if(d.confirmedSourceSnapshot!==latest||d.confirmedSpreadsheetId!==source.spreadsheetId){d.confirmed=false;d.confirmedSignature='';d.confirmedSourceSnapshot='';d.confirmedSpreadsheetId='';}
  }
  EMPLOYEES=importedEmployees;PROJECTS=nextProjects;applications=nextApplications;
  applicationEvents=[...applicationEvents.filter(event=>!projectIds.has(event.projectId)),...importedEvents,...operatorEvents];
  TICKETS.forEach(ticket=>{if(projectIds.has(ticket.project)&&!ticket.key&&['pending','scheduled'].includes(ticket.state)){ticket.state='retired';ticket.lifecycleReason='Google Sheets 원본으로 현황 갱신';}});
  sheetSync={spreadsheetId:source.spreadsheetId,lastSuccessAt:source.sync.lastSuccessAt,employeeCount:importedEmployees.length,eventCount:source.events.length};
  persist({remote});render();if(remote)void refreshOfficialCalendarAndTickets();
}
function applyAutomationTickets(rows){
  let changed=false;
  for(const row of rows){
    const ticket=row.payload;
    if(!ticket?.key||!ticket.project)continue;
    const index=TICKETS.findIndex(item=>item.key===ticket.key);
    if(index<0){TICKETS.push(ticket);changed=true;continue;}
    const local=TICKETS[index];
    if(['done','dismissed','deferred'].includes(local.state))continue;
    if(JSON.stringify(local)!==JSON.stringify(ticket)){TICKETS[index]=ticket;changed=true;}
  }
  if(changed)persist({remote:false});
}
async function refreshAutomatedSheetState(){
  if(!cloudUser)return;
  const snapshot=await readSheetSnapshot();
  if(snapshot?.payload){
    sheetSourceStatus={configured:true,spreadsheetId:snapshot.payload.spreadsheetId};
    if(!sheetSync?.lastSuccessAt||Date.parse(snapshot.last_success_at)>Date.parse(sheetSync.lastSuccessAt))applySheetSource(snapshot.payload,{remote:false});
  }
  applyAutomationTickets(await readAutomationTickets());
  if(route().view!=='edit-project')render();
}
async function syncSheetSource(){
  if(!requireOperator()||sheetSyncBusy)return;
  sheetSyncBusy=true;sheetSyncError='';render();
  try{
    if(operatorDirty)await saveOperatorState();
    if(operatorDirty)throw new Error('프로젝트 변경을 서버에 저장한 뒤 다시 가져와주세요.');
    await supabaseRequest('/functions/v1/sync-sheets',{method:'POST'});
    await refreshAutomatedSheetState();toast('Google Sheets의 직원명부와 신청 이력을 가져왔어요.');
  }
  catch(error){sheetSyncError=error.message||'시트를 읽지 못했습니다.';render();}
  finally{sheetSyncBusy=false;render();}
}
const cloudPayload = d => ({body:d.body,purpose:d.purpose,tone:d.tone,mode:d.mode,scope:d.scope,teams:d.teams,dmSelection:d.dmSelection,selectedIds:d.selectedIds,channels:d.channels,resources:d.resources||[],brief:d.brief,briefStale:d.briefStale===true,generatedAt:d.generatedAt||null,generatedModel:d.generatedModel||null});
function cloudLabel(t) {
  const state=cloudState[t.id];
  if(!cloudConfigured)return '이 브라우저에 저장됨';
  if(!cloudUser)return '이 브라우저에 저장됨 · 로그인하면 초안을 서버에 저장할 수 있어요.';
  return ({pending:'서버 저장 대기 중…',saving:'서버에 저장 중…',saved:`서버에 저장됨 · ${state?.updatedAt?new Date(state.updatedAt).toLocaleTimeString('ko-KR'):''}`,error:'서버 저장 실패 · 다시 시도해주세요.',conflict:'다른 탭에서 이 초안을 수정했어요.'})[state?.status]||'서버 초안을 확인 중…';
}
function updateCloudView(t) {
  if(route().view!=='review'||route().id!==t.id)return;
  const label=$('#draft-save-state');if(!label)return;
  label.textContent=cloudLabel(t);
  label.dataset.state=cloudState[t.id]?.status||'local';
  $('#draft-retry').hidden=cloudState[t.id]?.status!=='error';
  $('#draft-conflict-actions').hidden=cloudState[t.id]?.status!=='conflict';
  $('#send-button').disabled=!canSend(t);
}
function setCloudState(t,status,extra={}) {
  cloudState[t.id]={...cloudState[t.id],status,...extra};
  updateCloudView(t);
}
function applyCloudDraft(t,record) {
  const d=getDraft(t),source=record.payload||{};
  noticeStates.delete(t.id);
  for(const field of ['body','purpose','tone','mode','scope','teams','dmSelection','selectedIds','channels','resources','brief','briefStale','generatedAt','generatedModel'])if(source[field]!==undefined)d[field]=structuredClone(source[field]);
  d._cloudVersion=record.version;d._cloudDirty=false;d._cloudRevision=0;
  d.confirmed=false;d.confirmedSignature='';
  d.confirmedSourceSnapshot='';
  d.confirmedSpreadsheetId='';
  setCloudState(t,'saved',{updatedAt:record.updated_at,remote:null});
  persist({remote:false});
}
async function hydrateCloudDrafts() {
  const {drafts:remote}=await readDrafts();
  const byId=new Map(remote.map(item=>[item.id,item]));
  for(const t of TICKETS.filter(item=>ticketState(item)==='pending')){
    const local=drafts[t.id],record=byId.get(t.id);
    if(record){
      if(local?._cloudDirty && local._cloudVersion!==record.version){setCloudState(t,'conflict',{remote:record});continue;}
      if(local?._cloudDirty){setCloudState(t,'pending',{remote:record});scheduleCloudSave(t,true);continue;}
      applyCloudDraft(t,record);
    } else if(local){
      if(local._cloudVersion){setCloudState(t,'conflict',{remote:null});continue;}
      scheduleCloudSave(t,true);
    }
  }
}
function scheduleCloudSave(t,keepRevision=false) {
  const d=getDraft(t);
  if(!keepRevision)d._cloudRevision=(d._cloudRevision||0)+1;
  d._cloudDirty=true;persist({remote:false});
  if(!cloudUser)return;
  if(cloudState[t.id]?.status==='conflict')return;
  clearTimeout(cloudTimers.get(t.id));setCloudState(t,'pending');
  cloudTimers.set(t.id,setTimeout(()=>saveCloudDraft(t),750));
}
async function saveCloudDraft(t) {
  clearTimeout(cloudTimers.get(t.id));cloudTimers.delete(t.id);
  if(cloudSaves.has(t.id))return cloudSaves.get(t.id);
  const d=getDraft(t);
  if(!cloudUser||!d._cloudDirty||cloudState[t.id]?.status==='conflict')return false;
  const revision=d._cloudRevision||0;
  setCloudState(t,'saving');
  const request=(async()=>{
    try {
      const result=await saveDraft(t.id,d._cloudVersion||0,cloudPayload(d));
      d._cloudVersion=result.version;d._cloudDirty=(d._cloudRevision||0)!==revision;
      persist({remote:false});setCloudState(t,d._cloudDirty?'pending':'saved',{updatedAt:result.updated_at,remote:null});return true;
    } catch(error){setCloudState(t,error.status===409?'conflict':'error',{remote:error.current||null});return false;}
  })();
  cloudSaves.set(t.id,request);
  const success=await request;cloudSaves.delete(t.id);
  if(success&&d._cloudDirty)scheduleCloudSave(t,true);
  return success;
}
async function initializeCloud() {
  try {
    const config=await cloudRequest('/api/status');
    cloudConfigured=config.configured;
    if(cloudConfigured){
      await fetch('/api/auth/clear-legacy-cookie',{method:'POST',credentials:'same-origin'}).catch(()=>{});
      configureSupabase(config);
      sheetSourceStatus.configured=true;
      try {cloudUser=await restoreSupabaseUser();}
      catch {cloudUser=null;}
      if(cloudUser){
        prepareOperatorCache();
        try {await hydrateOperatorState();}catch {operatorSaveStatus='error';renderCloudButton();}
        try {await refreshAutomatedSheetState();}catch(error){sheetSyncError=error.message;}
        try {await hydrateCloudDrafts();}catch {for(const t of TICKETS.filter(item=>ticketState(item)==='pending'))if(drafts[t.id])setCloudState(t,'error');}
        void refreshOfficialCalendarAndTickets();
      }
    }
  } catch {cloudConfigured=false;}
  renderCloudButton();if(route().view!=='edit-project')render();
}
function renderCloudButton(){
  $('#cloud-open').textContent=operatorLabel();
  $('#cloud-open').dataset.state=operatorSaveStatus;
}
function openCloudDialog() {
  $('#cloud-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">서버 저장</p><h2 id="cloud-dialog-title">Supabase 연결</h2></div><button class="button icon-button" data-action="close-cloud" aria-label="창 닫기">${icon('close')}</button></div><div class="dialog-body">${!cloudConfigured?'<p>서버에 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY 환경 변수를 설정해주세요. 로컬 실행에서는 .env를 사용합니다.</p>':cloudUser?`<p>${escapeHtml(cloudUser.email)} 계정 · ${escapeHtml(operatorLabel())}</p>${operatorSaveStatus==='conflict'?'<p class="error-message">다른 탭의 저장 내용과 현재 화면이 다릅니다. 서버 내용을 불러오거나 현재 화면을 새 버전으로 저장하세요.</p><div class="actions"><button class="button" data-action="load-operator-state">서버 내용 불러오기</button><button class="button" data-action="overwrite-operator-state">내 변경 저장</button></div>':operatorSaveStatus==='error'?'<button class="button" data-action="retry-operator-state">서버 저장 다시 시도</button>':''}${holidayError?`<p class="help">공휴일: ${escapeHtml(holidayError)}</p>`:''}<button class="button" data-action="cloud-signout">로그아웃</button>`:`<form id="cloud-login-form"><div class="field"><label for="cloud-email">이메일</label><input id="cloud-email" type="email" required autocomplete="username"></div><div class="field"><label for="cloud-password">비밀번호</label><input id="cloud-password" type="password" required autocomplete="current-password"></div><button class="button primary" type="submit">로그인</button><p class="help">Supabase에서 허용된 운영자 계정으로 로그인하세요.</p></form>`}<p id="cloud-error" class="error-message" role="alert" hidden></p></div>`;
  $('#cloud-dialog').showModal();
}
function closeCloudDialog() { $('#cloud-dialog').close(); }
async function loginCloud(event) {
  event.preventDefault();
  const submit=$('#cloud-login-form button[type="submit"]'),error=$('#cloud-error');
  submit.disabled=true;error.hidden=true;
  try {
    cloudUser=await signInSupabase($('#cloud-email').value.trim(),$('#cloud-password').value);
    prepareOperatorCache();
    await hydrateOperatorState();
    await refreshAutomatedSheetState();
    await hydrateCloudDrafts();
    void refreshOfficialCalendarAndTickets();
    closeCloudDialog();renderCloudButton();if(route().view!=='edit-project')render();toast('Supabase에 연결했습니다.');
  } catch(cause) {
    error.textContent=cause.message;error.hidden=false;
    if(cloudUser){
      for(const t of TICKETS.filter(item=>drafts[item.id]))setCloudState(t,'error');
      closeCloudDialog();renderCloudButton();if(route().view!=='edit-project')render();toast(`로그인했지만 ${cause.message}`);
    }
  } finally {if(submit.isConnected)submit.disabled=false;}
}
async function logoutCloud() {
  clearTimeout(operatorSaveTimer);
  if(operatorDirty){await saveOperatorState();if(operatorDirty){toast('저장되지 않은 운영 정보가 있어요. 저장 상태를 확인한 뒤 로그아웃해주세요.');return;}}
  for(const t of TICKETS.filter(item=>drafts[item.id]?._cloudDirty)){
    if(!await saveCloudDraft(t)){toast('저장되지 않은 초안이 있어요. 저장 상태를 확인한 뒤 로그아웃해주세요.');return;}
  }
  try {await signOutSupabase();} catch { /* Clear this browser session even if the upstream logout fails. */ }
  cloudUser=null;drafts={};noticeStates.clear();EMPLOYEES=structuredClone(INITIAL_EMPLOYEES);sheetSync=null;sheetSourceStatus.spreadsheetId=null;
  PROJECTS=structuredClone(INITIAL_PROJECTS);applications=structuredClone(INITIAL_APPLICATIONS);
  applicationEvents=[];records=structuredClone(INITIAL_RECORDS);TICKETS=structuredClone(INITIAL_TICKETS);completed={};
  operatorVersion=0;operatorOwnerId=null;operatorDirty=false;operatorConflict=null;operatorSaveStatus='local';
  for(const timer of cloudTimers.values())clearTimeout(timer);
  cloudTimers.clear();
  for(const id of Object.keys(cloudState))delete cloudState[id];
  persist({remote:false});closeCloudDialog();renderCloudButton();if(route().view!=='edit-project')render();toast('로그아웃했습니다.');
}
async function uploadNoticeFile(t,file) {
  if(!cloudUser){toast('저장 설정에서 로그인해주세요.');return;}
  setCloudState(t,'saving');
  try {
    const resource=await uploadNoticeResource(file,cloudUser.id);
    const d=getDraft(t);d.resources=[...(d.resources||[]),{kind:'file',id:resource.id,label:resource.label,byte_size:resource.byte_size,mime_type:resource.mime_type,sha256:resource.sha256,version:resource.version}];
    d.confirmed=false;render();updateApproval(t);toast('파일을 비공개 저장소에 저장했어요.');
  } catch(error){setCloudState(t,'error');toast(error.message);}
}
async function refreshCloudDraft(t) {
  if(!cloudUser||!drafts[t.id])return;
  try {
    const remote=await readDraft(t.id);
    const d=getDraft(t);
    if(remote.version===d._cloudVersion)return;
    if(d._cloudDirty)setCloudState(t,'conflict',{remote});
    else {applyCloudDraft(t,remote);render();}
  } catch(error){
    if(error.status===404 && getDraft(t)._cloudVersion)setCloudState(t,'conflict',{remote:null});
  }
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
    return `<a class="project-row" href="#project/${p.id}" aria-label="${escapeHtml(p.name)} 할 일 ${projectTickets(p.id).length}개 보기">${projectSymbol(p)}<div><div class="row-title"><h3>${escapeHtml(p.name)}</h3>${tag(deadlineLabel(p),daysLeft(p)<=3?'orange':'gray')}</div><p class="row-subtitle">${tickets.length?escapeHtml(tickets[0].title)+(tickets.length>1?` 외 ${tickets.length-1}건`:''):'지금은 확인할 일이 없어요'}</p><div class="row-meta"><span>${tickets.length}건 확인 대기</span><span>신청 ${s.registered}/${s.total}명</span><span class="row-progress" aria-hidden="true"><span style="width:${rate??0}%"></span></span><span>${rate===null?'대상 없음':rate+'%'}</span></div></div>${icon('arrow')}</a>`;
  }).join('');
}
function recentRows(list) {
  return list.map(r=>`<button class="recent-row" data-record="${escapeHtml(r.id)}" aria-label="${escapeHtml(r.title)} 원문 보기"><span class="history-symbol">${icon('message')}</span><div><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.route)}</p><div class="caption">${recordDate(r.date)} · ${r.source==='simulated'?'보내기 예시':r.source==='manual'?'직접 추가':'예시 기록'}</div></div><span class="chevron">${icon('arrow')}</span></button>`).join('');
}
function home() {
  const list=pendingProjects();
  return `${heading('오늘 확인할 일','동료들의 신청과 안내, 오늘 필요한 일부터 챙겨요.','<a class="button" href="#projects">프로젝트 둘러보기 '+icon('arrow')+'</a>',new Date().toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}))}${sheetSourcePanel()}${summary()}
    <div class="home-top"><section class="panel" aria-labelledby="today-title"><div class="panel-heading"><div><h2 id="today-title">함께 챙길 프로젝트 <span class="count">${list.length}</span></h2><p class="caption muted">프로젝트를 열면 전체 티켓을 확인할 수 있어요.</p></div>${tag('확인 기다림','orange')}</div>${list.length?projectRows(list):'<p class="empty">오늘 확인할 일을 모두 챙겼어요.<br>프로젝트에서 다음 일정을 확인할 수 있어요.</p>'}</section>
    <section class="panel home-recent" aria-labelledby="recent-title"><div class="panel-heading"><h2 id="recent-title">최근 보낸 안내</h2><a href="#history" class="caption muted">전체 보기 ${icon('arrow')}</a></div>${recentRows([...records].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3))}<div class="panel-bottom">안내를 누르면 원문과 Slack 링크를 확인해요.</div></section></div>
    <section class="panel" aria-labelledby="calendar-title"><div class="panel-heading"><div><h2 id="calendar-title">팀 행사와 복지 일정</h2><p class="caption muted">신청 마감부터 동료들과 함께할 날까지</p></div><div class="segmented" aria-label="일정 보기 방식"><button data-calendar-view="calendar" aria-pressed="${calendar.view==='calendar'}">캘린더</button><button data-calendar-view="list" aria-pressed="${calendar.view==='list'}">목록</button></div></div><div id="calendar-content">${calendar.view==='calendar'?calendarMarkup():projectTable()}</div></section>`;
}
function schedule() {
  const events=[];
  PROJECTS.forEach(p=>{
    events.push({project:p.id,date:p.deadline,kind:'deadline',label:'마감',title:`${p.short} 신청 마감`,time:p.deadlineAt.slice(11)});
    events.push({project:p.id,date:p.event,kind:'event',label:'행사',title:p.eventLabel,time:''});
    projectTickets(p.id).filter(t=>t.ruleGenerated&&t.dueAt&&['pending','scheduled','deferred'].includes(ticketState(t))).forEach(t=>events.push({project:p.id,date:t.date,kind:'reminder',label:'점검',title:t.title,time:new Date(t.dueAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}));
  });
  return events;
}
function calendarMarkup() {
  const first=new Date(Date.UTC(calendar.year,calendar.month,1)),offset=(first.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(calendar.year,calendar.month+1,0)).getUTCDate(),cells=Math.ceil((offset+days)/7)*7,events=schedule();
  return `<div class="calendar-head"><div class="actions"><h3 class="month-name">${calendar.year}년 ${calendar.month+1}월</h3><button class="button compact" data-action="calendar-today">이번 달</button></div><div class="actions"><div class="calendar-legend"><span><i class="legend-dot"></i>신청 마감</span><span><i class="legend-dot event"></i>행사</span><span><i class="legend-dot reminder"></i>안내 예정</span></div><button class="button icon-button" data-month="-1" aria-label="이전 달">${icon('back')}</button><button class="button icon-button" data-month="1" aria-label="다음 달">${icon('arrow')}</button></div></div>
    <div class="calendar-grid" aria-hidden="true">${['월','화','수','목','금','토','일'].map((label,i)=>`<div class="weekday ${i>4?'weekend':''}">${label}</div>`).join('')}</div><div class="calendar-grid" aria-label="월간 프로젝트 일정">${Array.from({length:cells},(_,i)=>{
      const day=i-offset+1,d=new Date(Date.UTC(calendar.year,calendar.month,day)),key=dayKey(d),list=events.filter(e=>e.date===key),today=key===TODAY_KST;
      if(day<1||day>days)return `<div class="day-cell outside" aria-hidden="true"><span class="day-number">${d.getUTCDate()}</span></div>`;
      return `<button class="day-cell" data-date="${key}" aria-pressed="${key===calendar.selected}" aria-label="${calendar.month+1}월 ${day}일 · ${escapeHtml(list.length?list.map(e=>e.title).join(', '):'예정된 일정 없음')}"><span class="day-number ${today?'today':''}"><span>${day}</span>${today?'<small>오늘</small>':''}</span>${list.map(e=>`<span class="day-event ${e.kind}" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}</span>`).join('')}</button>`;
    }).join('')}</div><div class="calendar-selection"><h3>${dateLabel(calendar.selected)} 일정</h3><div class="date-events">${events.filter(e=>e.date===calendar.selected).map(e=>`<div class="date-event"><span>${tag(e.label,e.kind==='deadline'?'orange':e.kind==='event'?'green':'gray')} ${escapeHtml(e.title)} <span class="muted">${e.time}</span></span><a href="#project/${e.project}">프로젝트 보기 →</a></div>`).join('')||'<p class="caption muted">이날은 예정된 일정이 없어요.</p>'}</div></div>`;
}
function projectTable() {
  return `<table class="project-table"><thead><tr><th scope="col">프로젝트</th><th scope="col">신청 마감</th><th scope="col">신청 현황</th><th scope="col">확인할 일</th></tr></thead><tbody>${PROJECTS.map(p=>`<tr><td><a href="#project/${p.id}">${escapeHtml(p.name)}</a></td><td>${dateLabel(p.deadline)}</td><td>${projectCount(p).registered}/${projectCount(p).total}명</td><td>${tag(`${pendingTickets(p.id).length}건`,pendingTickets(p.id).length?'orange':'green')}</td></tr>`).join('')}</tbody></table>`;
}
function projectsPage() {
  return `${heading('우리 팀의 프로젝트','신청 현황과 일정, 프로젝트별 전체 티켓을 살펴봐요.',`<a class="button primary" href="#edit-project/new">${icon('plus')} 프로젝트 등록</a>`)}${summary()}<section class="panel"><div class="panel-heading"><h2>진행 중인 프로젝트 <span class="count">${PROJECTS.length}</span></h2></div>${projectRows(PROJECTS)}</section><div class="actions" style="margin-top:18px;justify-content:flex-end"><button class="button compact" data-action="reset-sample">${resetArmed?'프로젝트·신청·안내 기록을 모두 지우고 초기화 확인':'예시 데이터로 초기화'}</button></div>`;
}
function employeePickerMarkup(p) {
  const target=new Set(p?.targetIds||[]),required=new Set(p?.requiredIds||[]);
  return `<div class="member-picker"><div class="member-picker-head"><div><h3>대상 동료 선택</h3><p class="caption muted">반드시 참여해야 하는 동료는 ‘필수’도 체크해주세요.</p></div><strong id="member-count" aria-live="polite"></strong></div><div class="member-filters"><div class="field"><label for="member-search">동료 찾기</label><input id="member-search" type="search" placeholder="이름 검색" autocomplete="off"></div><div class="field"><label for="member-team">팀</label><select id="member-team"><option value="all">전체 팀</option>${TEAMS.map(team=>`<option value="${team.id}">${team.name}</option>`).join('')}</select></div></div><div class="member-bulk"><span id="member-visible-count" class="caption muted"></span><div class="actions"><button type="button" class="button compact" data-action="select-visible-members">검색 결과 선택</button><button type="button" class="button compact" data-action="clear-visible-members">검색 결과 해제</button></div></div><div class="member-list">${EMPLOYEES.map(e=>`<div class="member-row" data-member-row data-team="${e.team}" data-name="${escapeHtml(e.name)}"><label class="member-name"><input type="checkbox" data-target-member="${e.id}" ${target.has(e.id)?'checked':''}><span>${escapeHtml(e.name)}<small>${TEAMS.find(team=>team.id===e.team).name}</small></span></label><label class="member-required"><input type="checkbox" data-required-member="${e.id}" aria-label="${escapeHtml(e.name)} 필수 신청" ${required.has(e.id)?'checked':''} ${target.has(e.id)?'':'disabled'}>필수</label></div>`).join('')}</div></div>`;
}
function reminderPolicyFields(p){
  const policy=p?.reminderPolicy||{},thresholds=policy.voluntaryThresholds||[];
  const number=(name,label,value,min,max,step='1',help='')=>`<div class="field"><label for="project-${name}">${label}</label><input id="project-${name}" name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" required>${help?`<p class="help">${help}</p>`:''}</div>`;
  return `<div class="field full"><h3>안내 점검 정책</h3><p class="help">공휴일·주말은 제외하고 한국 업무시간 안의 이전 시각으로 옮깁니다. 회사 자체 휴무일은 반영하지 않습니다.</p></div>${number('requiredCheckHour','D-3·D-1 점검 시각',policy.requiredCheckHour??10,0,23,'1','한국 시각 기준')}${number('finalHoursBefore','마감 전 마지막 점검 (시간)',policy.finalHoursBefore??4,0.5,72,'0.5')}${number('voluntaryD3Percent','D-3 자율 목표 기준 (%)',Math.round((thresholds.find(item=>item.daysBefore===3)?.goalFraction??0.7)*100),0,100)}${number('voluntaryD1Percent','D-1 자율 목표 기준 (%)',Math.round((thresholds.find(item=>item.daysBefore===1)?.goalFraction??0.9)*100),0,100)}${number('businessStartHour','업무 시작 시각',policy.businessStartHour??9,0,22)}${number('businessEndHour','업무 종료 시각',policy.businessEndHour??18,1,23)}`;
}
function projectFormPage(id) {
  const p=id==='new'?null:getProject(id),field=(name,label,value,type='text',required=true)=>`<div class="field"><label for="project-${name}">${label}</label><input id="project-${name}" name="${name}" type="${type}" value="${escapeHtml(value??'')}" ${required?'required':''}></div>`;
  return `<a href="${p?`#project/${p.id}`:'#projects'}" class="back-link">${icon('back')} 프로젝트로 돌아가기</a>${heading(p?'프로젝트 수정':'프로젝트 등록','')}<form id="project-form" class="panel form-panel" data-project-id="${p?.id||'new'}"><section class="document-import" id="document-import"></section><div class="form-grid">${field('name','프로젝트 제목',p?.name)}${field('owner','담당자 이름',p?.owner)}<div class="field"><label for="project-sheetProjectId">${p?'프로젝트 ID':'Google Sheets 프로젝트 ID (선택)'}</label><input id="project-sheetProjectId" name="sheetProjectId" type="text" maxlength="80" value="${escapeHtml(p?.id||'')}" ${p?'readonly':''} placeholder="시트 연동 시 입력"><p class="help">${p?'등록 후에는 ID를 변경할 수 없습니다.':'시트의 프로젝트 탭 projectId와 정확히 같게 입력하세요. 비워 두면 내부 ID를 자동 생성합니다.'}</p></div><div class="field full"><label for="project-description">프로젝트 설명</label><textarea id="project-description" name="description" class="short-textarea" required>${escapeHtml(p?.description||'')}</textarea></div>${field('start','신청 시작일',p?.start||'','date')}${field('deadlineAt','신청 마감 시각',p?.deadlineAt||'','datetime-local')}${field('event','행사·운영 일정',p?.event||'','date')}${field('applicationUrl','신청 링크',p?.applicationUrl||'','url',false)}${field('location','장소',p?.location||'','text',false)}${field('audience','문서상 참여 대상',p?.audience||'','text',false)}${field('capacity','정원·선정 조건',p?.capacity||'','text',false)}<div class="field full"><label for="project-requirements">신청 방법·유의사항·행사 시간</label><textarea id="project-requirements" name="requirements" class="short-textarea">${escapeHtml(p?.requirements||'')}</textarea><p class="help">문서상 대상은 참고 정보입니다. 실제 대상 동료는 아래 명단에서 선택하세요.</p></div><div class="field"><label for="project-confirmationMode">신청 후 확정 방식</label><select id="project-confirmationMode" name="confirmationMode" required><option value="">확인 후 선택</option><option value="immediate" ${p?.confirmationMode==='immediate'?'selected':''}>신청 즉시 확정</option><option value="separate" ${p?.confirmationMode==='separate'?'selected':''}>별도 확인·승인·선정 후 확정</option></select></div><div class="field"><label for="project-type">종류</label><select id="project-type" name="type"><option value="행사" ${p?.type==='행사'?'selected':''}>행사</option><option value="복지" ${p?.type==='복지'?'selected':''}>복지</option><option value="이벤트" ${p?.type==='이벤트'?'selected':''}>이벤트</option></select></div><div class="field"><label for="project-voluntaryGoalRate">자율 신청 목표 (%)</label><input id="project-voluntaryGoalRate" name="voluntaryGoalRate" type="number" min="1" max="100" step="1" value="${p?.voluntaryGoalRate==null?'':Math.round(p.voluntaryGoalRate*100)}" placeholder="설정하지 않음"><p class="help">설정하면 D-3·D-1에 목표 미달 여부를 확인합니다.</p></div>${reminderPolicyFields(p)}<div class="field"><label for="project-lifecycle">운영 상태</label><select id="project-lifecycle" name="lifecycle"><option value="active" ${!p?.lifecycle||p.lifecycle==='active'?'selected':''}>진행 중</option><option value="cancelled" ${p?.lifecycle==='cancelled'?'selected':''}>프로젝트 취소</option><option value="closed" ${p?.lifecycle==='closed'?'selected':''}>운영 종료</option></select></div><div class="field full"><label for="project-changeReason">마감·운영 상태 변경 사유</label><input id="project-changeReason" name="changeReason" type="text" maxlength="500" placeholder="마감 연장, 프로젝트 취소, 운영 종료 시 입력"></div><div class="field full">${employeePickerMarkup(p)}</div></div><p id="project-form-error" class="error-message" role="alert" ${projectFormError?'':'hidden'}>${escapeHtml(projectFormError)}</p><div class="actions"><button class="button primary" type="submit">${p?'변경 저장':'프로젝트 등록'}</button></div></form>`;
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
function saveProjectForm(event) {
  event.preventDefault();if(!requireOperator())return;const form=event.target,id=form.dataset.projectId,old=id==='new'?null:getProject(id),data=new FormData(form);
  try {
    const targetIds=[...form.querySelectorAll('[data-target-member]:checked')].map(input=>Number(input.dataset.targetMember));
    const requiredIds=[...form.querySelectorAll('[data-required-member]:checked')].map(input=>Number(input.dataset.requiredMember));
    if(requiredIds.some(employeeId=>!targetIds.includes(employeeId)))throw new Error('필수 신청 동료는 대상 명단에도 있어야 해요.');
    const start=data.get('start'),deadlineAt=data.get('deadlineAt'),eventDate=data.get('event');
    if(Date.parse(start)>Date.parse(deadlineAt)||Date.parse(eventDate)<Date.parse(start))throw new Error('신청 시작일·마감·운영 일정의 순서를 확인해주세요.');
    const url=data.get('applicationUrl').trim();if(url && !/^https?:\/\//i.test(url))throw new Error('신청 링크는 http 또는 https 주소를 넣어주세요.');
    const name=data.get('name').trim(),owner=data.get('owner').trim(),description=data.get('description').trim();
    if(!name||!owner||!description)throw new Error('프로젝트 제목, 설명, 담당자 이름을 입력해주세요.');
    const sourceReviews = Object.values({...Object.fromEntries((old?.sourceReviews||[]).map(row=>[row.field,row])),...appliedFieldReviews}).map(row=>({...row,manuallyEdited:row.manuallyEdited||String(data.get(row.field)||'')!==row.appliedValue,appliedValue:String(data.get(row.field)||'')}));
    const goal=data.get('voluntaryGoalRate');
    const policyValue=(key,min,max)=>{const value=Number(data.get(key));if(!Number.isFinite(value)||value<min||value>max)throw new Error('안내 점검 정책의 숫자를 확인해주세요.');return value;};
    const reminderPolicy={requiredCheckHour:policyValue('requiredCheckHour',0,23),finalHoursBefore:policyValue('finalHoursBefore',0.5,72),
      businessStartHour:policyValue('businessStartHour',0,22),businessEndHour:policyValue('businessEndHour',1,23),
      voluntaryThresholds:[{daysBefore:3,goalFraction:policyValue('voluntaryD3Percent',0,100)/100},{daysBefore:1,goalFraction:policyValue('voluntaryD1Percent',0,100)/100}]};
    if(!Number.isInteger(reminderPolicy.requiredCheckHour)||!Number.isInteger(reminderPolicy.businessStartHour)||!Number.isInteger(reminderPolicy.businessEndHour)||reminderPolicy.businessStartHour>=reminderPolicy.businessEndHour)throw new Error('점검 시각과 업무시간을 확인해주세요.');
    const lifecycle=data.get('lifecycle'),changeReason=String(data.get('changeReason')||'').trim();
    if(old&&(old.deadlineAt!==deadlineAt||(old.lifecycle||'active')!==lifecycle)&&!changeReason)throw new Error('마감이나 운영 상태를 바꿀 때는 사유를 입력해주세요.');
    const projectId=old?.id||newProjectId(data.get('sheetProjectId'),PROJECTS.map(project=>project.id));
    const next={...(old||{}),sourceReviews,sourceIssues:appliedSourceIssues??old?.sourceIssues??[],location:String(data.get('location')||''),audience:String(data.get('audience')||''),capacity:String(data.get('capacity')||''),requirements:String(data.get('requirements')||''),id:projectId,name,short:name,type:data.get('type'),symbol:old?.symbol||'folder',description,owner,start,deadlineAt,deadline:deadlineAt.slice(0,10),event:eventDate,eventLabel:old?.eventLabel||'운영 일정',applicationUrl:url,confirmationMode:data.get('confirmationMode'),targetIds,requiredIds,voluntaryGoalRate:goal===''?null:Number(goal)/100,reminderPolicy,lifecycle,changeLog:old?.changeLog||[],dataKind:'local',lastCheckedAt:checkedAt(),reference:appliedDocumentName||old?.reference||'직접 입력'};
    if(old&&changeReason)next.changeLog=[...next.changeLog,{at:new Date().toISOString(),actor:cloudUser?.email||'로컬 운영자',fromDeadlineAt:old.deadlineAt,toDeadlineAt:deadlineAt,fromLifecycle:old.lifecycle||'active',toLifecycle:lifecycle,reason:changeReason}];
    if(old){PROJECTS=PROJECTS.map(p=>p.id===id?next:p);if(old.dataKind==='sample')TICKETS.filter(t=>t.project===id&&!t.key&&['pending','scheduled'].includes(t.state)).forEach(t=>{t.state='retired';t.lifecycleReason='프로젝트 운영 정보 변경';});if(old.confirmationMode!==next.confirmationMode){applications=applications.map(r=>{if(r.projectId!==id||r.status==='cancelled')return r;const toStatus=next.confirmationMode==='immediate'?'confirmed':'applied';if(r.status!==toStatus)applicationEvents.push({id:crypto.randomUUID(),projectId:id,employeeId:r.employeeId,fromStatus:r.status,toStatus,reason:'프로젝트 확정 방식 변경',actor:cloudUser?.email||'로컬 운영자',at:checkedAt()});return {...r,status:toStatus};});}}
    else {PROJECTS.push(next);TICKETS.push({id:`${next.id}-initial`,project:next.id,title:`${next.name} 첫 안내 준비`,state:'pending',date:TODAY_KST,purpose:'첫 안내',reason:'프로젝트 등록 정보와 공지용 정보 카드를 확인하고 구성원에게 첫 안내를 준비해주세요.',ruleGenerated:true});}
    if(old)TICKETS.filter(t=>t.project===id).forEach(t=>{const d=drafts[t.id];if(!d)return;const previous=makeNoticeBrief(old),latest=makeNoticeBrief(next);for(const key of Object.keys(latest))if(d.brief?.[key]?.source!=='담당자 수정'&&d.brief?.[key]?.source!=='담당자 확인'&&d.brief[key].value===previous[key].value)d.brief[key]=latest[key];d.confirmed=false;d.briefStale=true;scheduleCloudSave(t);});
    projectFormError='';reconcileProjectTickets(next);persist();location.hash=`project/${next.id}`;render();void refreshOfficialCalendarAndTickets();toast(old?'운영 정보를 저장했어요.':'프로젝트를 등록했어요.');
  } catch(error) {projectFormError=error.message;$('#project-form-error').textContent=projectFormError;$('#project-form-error').hidden=false;}
}
function ticketMarkup(t) {
  const state=ticketState(t),recordId=completed[t.id]||t.record;
  const due=t.dueAt?new Date(t.dueAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):dateLabel(t.date);
  return `<article class="ticket" data-ticket-id="${escapeHtml(t.id)}"><div class="ticket-heading"><span class="ticket-status-icon ${state}" aria-hidden="true">${state==='done'?'✓':state==='scheduled'?'◷':'•'}</span><div class="ticket-title"><h3>${escapeHtml(t.title)}</h3><div class="caption muted">${escapeHtml(due)} · ${escapeHtml(t.purpose)} ${t.ruleGenerated?'· 규칙 생성':'· 예시 티켓'}</div></div>${tag(stateLabel(state),stateColor(state))}</div><p class="ticket-body">${escapeHtml(t.ruleGenerated?t.reason:state==='done'?'완료된 예시 티켓이에요. 당시 보낸 안내의 원문과 기록을 확인할 수 있어요.':t.reason)}${t.originalTimes?.some(time=>time!==t.dueAt)?`<br><small>원래 점검 시각 ${escapeHtml(new Date(t.originalTimes[0]).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} → 공휴일·업무시간 조정 ${escapeHtml(due)}</small>`:''}${t.decisionReason?`<br><small>운영자 사유: ${escapeHtml(t.decisionReason)}${t.reviewAt?` · 다시 확인 ${escapeHtml(t.reviewAt)}`:''}</small>`:''}</p><div class="ticket-footer"><span>${state==='pending'?'담당자 확인 후 안내해요':state==='scheduled'?'예정 시각에 신청 현황을 확인해요':state==='done'?'안내 기록과 연결되어 있어요':''}</span><div class="actions">${state==='pending'?`<a href="#review/${encodeURIComponent(t.id)}" class="button compact">보낼 내용 확인 ${icon('arrow')}</a>`:''}${t.ruleGenerated&&['pending','scheduled','deferred'].includes(state)?`<button class="button compact" data-ticket-decision="deferred" data-ticket-id="${escapeHtml(t.id)}">보류</button><button class="button compact" data-ticket-decision="dismissed" data-ticket-id="${escapeHtml(t.id)}">안내하지 않기</button>`:''}${state==='done'&&recordId?`<button class="button compact" data-record="${escapeHtml(recordId)}">보낸 안내 보기 ${icon('external')}</button>`:''}</div></div></article>`;
}
const applicationStateLabel = state => ({none:'미신청',applied:'신청 · 확정 대기',confirmed:'확정',cancelled:'신청 취소'}[state]||state);
function applicationLog(projectId) {
  const events=applicationEvents.map((event,index)=>({event,index})).filter(item=>item.event.projectId===projectId).sort((a,b)=>b.event.at.localeCompare(a.event.at)||b.index-a.index).map(item=>item.event);
  return `<details class="application-log"><summary>신청 상태 변경 기록 <span class="count">${events.length}</span></summary><p class="help">Supabase 계정의 변경 이력입니다. 저장 상태는 상단에서 확인할 수 있어요.</p>${events.length?events.map(e=>{const person=EMPLOYEES.find(item=>item.id===e.employeeId),team=TEAMS.find(item=>item.id===person?.team);return `<div class="application-log-row"><div><strong>${escapeHtml(person?.name)} · ${escapeHtml(team?.name)}</strong><span>${escapeHtml(applicationStateLabel(e.fromStatus))} → ${escapeHtml(applicationStateLabel(e.toStatus))}${e.reason?` · 사유: ${escapeHtml(e.reason)}`:''}</span></div><time datetime="${escapeHtml(e.at)}">${escapeHtml(e.at.replace('T',' '))}<small>${escapeHtml(e.actor)}</small></time></div>`;}).join(''):'<p class="help">아직 변경한 신청 상태가 없어요.</p>'}</details>`;
}
function historyRows(list) {
  return list.length?list.map(r=>`<button class="history-list-row" data-record="${escapeHtml(r.id)}"><span class="history-symbol">${icon('message')}</span><div><h3>${escapeHtml(r.title)}</h3><p>${escapeHtml(r.route)} · ${recordDate(r.date)}</p><div class="history-link-indicator">${r.source==='manual'?'직접 추가한 기록':r.source==='simulated'?'보내기 예시':'예시 원문'} · ${r.url?'Slack 연결':'원문 보기'}</div></div><span class="chevron">${icon('arrow')}</span></button>`).join(''):'<div class="empty">아직 보낸 안내가 없어요.<br>첫 안내를 보내거나 기존 안내 기록을 추가해보세요.</div>';
}
const recordKind = r => r.kind || (/D-\d|리마인드|마감 전|추가 안내|한 번 더/.test(`${r.title} ${getTicket(r.ticket)?.title||''}`)?'reminder':'initial');
function rosterMarkup(p,s) {
  return `<section class="panel roster-panel"><div class="panel-heading"><div><h2>대상자별 신청 상태</h2><p class="caption muted">${p.dataKind==='sheet'?'마지막 시트 가져오기':'최근 확인'} ${s.lastCheckedAt?escapeHtml(s.lastCheckedAt.replace('T',' ')):'없음'} · ${p.confirmationMode==='separate'?'별도 승인 후 확정':'신청 즉시 확정'}</p>${p.dataKind==='sheet'?`<p class="caption muted">마지막으로 Supabase에 저장된 시트 현황입니다. 여기서 바꾼 상태는 Supabase에 저장되며 시트에는 기록되지 않습니다.</p>`:''}</div>${p.dataKind==='sheet'?`<button class="button compact" data-action="sync-sheet" ${sheetSyncBusy||!sheetSourceStatus.configured||!cloudUser?'disabled':''}>${sheetSyncBusy?'가져오는 중…':'시트 다시 가져오기'}</button>`:''}</div>${p.confirmationMode==='immediate'&&s.appliedIds.length>s.confirmedIds.length?'<p class="error-message">신청 즉시 확정 프로젝트에 확정 대기 기록이 있습니다. 시트의 신청 상태를 확인하거나 아래에서 확정 처리해주세요.</p>':''}<div class="roster-filters"><div class="field"><label for="roster-search">이름·팀 검색</label><input id="roster-search" type="search" placeholder="이름 또는 팀" value="${escapeHtml(rosterSearch)}"></div><div class="field"><label for="roster-filter">신청 상태</label><select id="roster-filter">${[['all','전체'],['pending','미신청'],['required','필수 · 미신청'],['applied','신청 완료'],['waiting','확정 대기']].map(([value,label])=>`<option value="${value}" ${rosterFilter===value?'selected':''}>${label}</option>`).join('')}</select></div><span id="roster-count" class="caption muted" role="status"></span></div>${s.unknown.length?`<p class="error-message">대상을 확인할 수 없는 기록 ${s.unknown.length}건은 집계에서 제외했습니다.</p>`:''}<div class="roster-list">${s.targetIds.map(employeeId=>{const e=EMPLOYEES.find(item=>item.id===employeeId),applied=s.appliedIds.includes(employeeId),confirmed=s.confirmedIds.includes(employeeId),required=s.requiredIds.includes(employeeId),team=TEAMS.find(t=>t.id===e.team).name;return `<div class="roster-row" data-roster-row data-search="${escapeHtml(e.name+' '+team)}" data-applied="${applied}" data-confirmed="${confirmed}" data-required="${required}"><div><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(team)}${required?' · 필수 대상':''}</small></div>${tag(confirmed?'확정':applied?'확정 대기':'미신청',confirmed?'green':applied?'gray':'orange')}<div class="actions">${!applied?`<button class="button compact" data-application="applied" data-employee="${employeeId}" data-project="${p.id}" aria-label="${escapeHtml(e.name)} 신청 처리">신청 처리</button>`:`${!confirmed?`<button class="button compact" data-application="confirmed" data-employee="${employeeId}" data-project="${p.id}" aria-label="${escapeHtml(e.name)} 확정 처리">확정 처리</button>`:''}<button class="button compact" data-application="cancelled" data-employee="${employeeId}" data-project="${p.id}" aria-label="${escapeHtml(e.name)} 신청 취소">신청 취소</button>`}</div></div>`;}).join('')}</div><p id="roster-empty" class="empty" hidden>조건에 맞는 동료가 없습니다.</p>${applicationLog(p.id)}</section>`;
}
function filterRoster() {
  if(!$('#roster-count'))return;
  let count=0;
  document.querySelectorAll('[data-roster-row]').forEach(row=>{
    const {applied,confirmed,required,search}=row.dataset;
    const matches=rosterFilter==='all'||rosterFilter==='pending'&&applied==='false'||rosterFilter==='required'&&required==='true'&&applied==='false'||rosterFilter==='applied'&&applied==='true'||rosterFilter==='waiting'&&applied==='true'&&confirmed==='false';
    row.hidden=!matches||!search.toLowerCase().includes(rosterSearch.toLowerCase().trim());if(!row.hidden)count++;
  });
  $('#roster-count').textContent=`${count}명`;$('#roster-empty').hidden=count>0;
}
function projectPage(id) {
  const p=getProject(id),s=projectCount(p),tickets=projectTickets(id),recent=projectRecords(id),pending=pendingTickets(id).length;
  const breakdown=applicationBreakdown(s);
  const sorted=sortTicketsForDisplay(tickets,ticketState,t=>records.find(r=>r.id===(completed[t.id]||t.record))?.date);
  return `<a href="#home" class="back-link">${icon('back')} 홈으로 돌아가기</a><div class="page-heading"><div class="project-hero">${projectSymbol(p)}<div><p class="eyebrow">${escapeHtml(p.type)} 프로젝트 · ${tag(p.dataKind==='sample'?'예시 데이터':'직접 입력','gray')}</p><h1>${escapeHtml(p.name)}</h1><p class="page-description">${escapeHtml(p.description)}</p></div></div><div class="actions"><a class="button" href="#edit-project/${id}">운영 정보 수정</a><button class="button" data-action="new-record" data-project="${id}">${icon('plus')} 안내 기록 추가</button></div></div>
    ${p.lifecycle&&p.lifecycle!=='active'?`<p class="error-message">${p.lifecycle==='cancelled'?'취소된 프로젝트입니다.':'운영이 종료된 프로젝트입니다.'} 새 안내 티켓은 만들지 않습니다.</p>`:''}${holidayError&&p.dataKind!=='sample'?`<p class="error-message">자동 티켓: ${escapeHtml(holidayError)}</p>`:''}${officialCalendar&&p.dataKind!=='sample'?`<p class="caption muted">공휴일 기준: ${escapeHtml(officialCalendar.source)} · ${escapeHtml(new Date(officialCalendar.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} 조회</p>`:''}<section class="application-summary" aria-label="필수·자율 신청 현황"><div class="application-summary-heading"><div><h2>신청 현황</h2><p>필수와 자율 신청을 나눠 집계했어요. 각 행의 신청 + 신청 전 = 대상입니다.</p></div><strong>${s.rate===null?'대상 없음':Math.round(s.rate*100)+'%'}<small> 전체 신청률</small></strong></div><div class="summary-table-wrap"><table class="application-table"><thead><tr><th scope="col">구분</th><th scope="col">대상</th><th scope="col">신청</th><th scope="col">신청 전</th></tr></thead><tbody>${[['필수 신청',breakdown.required],['자율 신청',breakdown.voluntary],['합계',breakdown.total]].map(([label,row])=>`<tr${label==='합계'?' class="total-row"':''}><th scope="row">${label}</th><td>${row.target}명</td><td>${row.applied}명</td><td class="pending-count">${row.pending}명</td></tr>`).join('')}</tbody></table></div><p class="application-summary-note">신청에는 확정 대기 중인 동료도 포함됩니다. 취소한 신청은 ‘신청 전’으로 집계합니다.</p></section>
    ${rosterMarkup(p,s)}
    <div class="tabs" role="tablist" aria-label="프로젝트 내용"><button class="tab" id="tickets-tab" role="tab" data-tab="tickets" aria-selected="${activeTab==='tickets'}" aria-controls="project-content">전체 티켓 <span class="count">${tickets.length}</span></button><button class="tab" id="sent-tab" role="tab" data-tab="history" aria-selected="${activeTab==='history'}" aria-controls="project-content">보낸 안내 <span class="count">${recent.length}</span></button></div>
    <div id="project-content" role="tabpanel" aria-labelledby="${activeTab==='tickets'?'tickets-tab':'sent-tab'}">${activeTab==='history'?`<section class="panel">${historyRows(recent)}</section>`:`<div class="detail-grid"><section class="panel" aria-label="${escapeHtml(p.name)} 전체 티켓"><div class="panel-heading"><div><h2>프로젝트의 모든 티켓</h2><p class="caption muted">확인 대기 ${pending}건 · 예정 ${tickets.filter(t=>ticketState(t)==='scheduled').length}건 · 완료 ${tickets.filter(t=>ticketState(t)==='done').length}건</p></div></div>${sorted.map(ticketMarkup).join('')||'<p class="empty">현재 확인할 티켓이 없어요.</p>'}</section><aside><section class="panel schedule-panel"><h2>일정과 최근 안내</h2><div class="info-line"><span>신청 마감</span><p>${dateLabel(p.deadline)} ${escapeHtml(p.deadlineAt.slice(11))} ${tag(`D-${daysLeft(p)}`,daysLeft(p)<=3?'orange':'gray')}</p></div><div class="info-line"><span>${p.type==='행사'?'행사일':escapeHtml(p.eventLabel||'운영 일정')}</span><p>${dateLabel(p.event)}</p></div><div class="info-line"><span>담당자</span><p>${escapeHtml(p.owner)}</p></div><div class="info-line"><span>신청 링크</span><p>${p.applicationUrl?`<a href="${escapeHtml(p.applicationUrl)}" target="_blank" rel="noopener noreferrer">신청 페이지 열기</a>`:'등록 전'}</p></div><h3 style="margin:18px 0 12px">최근 보낸 안내</h3>${recent.slice(0,2).map(r=>`<button class="linked-history" data-record="${escapeHtml(r.id)}" aria-label="${escapeHtml(r.title)} 원문 보기"><div><strong>${escapeHtml(r.title)}</strong><small>${recordDate(r.date)} · ${escapeHtml(r.route)}</small></div>${icon('arrow')}</button>`).join('')||'<p class="caption muted">아직 보낸 안내가 없어요.</p>'}</section></aside></div>`}</div>`;
}
function historyPage() {
  const projects=PROJECTS.filter(p=>historyFilter==='all'||p.id===historyFilter);
  const list=records.filter(r=>projects.some(p=>p.id===r.project)).sort((a,b)=>b.date.localeCompare(a.date));
  return `${heading('보낸 안내','',`<button class="button" data-action="new-record">${icon('plus')} 안내 기록 추가</button>`)}<div class="history-toolbar"><strong>안내 ${list.length}건</strong><div class="field"><label for="history-project">프로젝트</label><select id="history-project"><option value="all">전체 프로젝트</option>${PROJECTS.map(p=>`<option value="${p.id}" ${historyFilter===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select></div></div><div class="history-projects">${projects.map(p=>{const projectList=list.filter(r=>r.project===p.id);return `<section class="panel history-project" aria-label="${escapeHtml(p.name)} 안내 기록"><div class="history-project-heading">${projectSymbol(p)}<div><span class="history-project-sticker">${escapeHtml(p.type)}</span><h2><a href="#project/${p.id}">${escapeHtml(p.name)} ${icon('arrow')}</a></h2></div><span class="count">${projectList.length}</span></div>${projectList.length?['initial','reminder'].map(kind=>{const items=projectList.filter(r=>recordKind(r)===kind);return items.length?`<div class="history-group"><h3>${kind==='initial'?'첫 안내':'추가 안내'} <span class="count">${items.length}</span></h3>${historyRows(items)}</div>`:'';}).join(''):'<p class="history-empty">아직 보낸 안내가 없습니다.</p>'}</section>`;}).join('')}</div>`;
}
function noticeCardMarkup(d){
  const labels={confirmed:'확인됨',needs_review:'확인 필요',conflict:'자료 간 충돌',missing:'내용 없음'};
  return `<section class="notice-card panel" aria-labelledby="notice-card-title"><div class="notice-card-heading"><div><p class="eyebrow">공지용 정보 카드</p><h2 id="notice-card-title">구성원이 행동할 정보</h2><p class="help">자료의 근거를 확인하고 필요한 항목만 포함하세요. 확인이 필요한 항목은 초안에 보내지 않습니다.</p>${d.briefStale?'<p class="error-message">프로젝트 정보나 카드가 바뀌었습니다. 확인한 뒤 초안을 다시 생성해주세요.</p>':''}</div><button class="button primary" data-action="generate-notice" ${cloudUser?'':'disabled'}>Gemini로 초안 생성</button></div><div class="notice-card-grid">${Object.entries(BRIEF_LABELS).map(([key,label])=>{const item=d.brief[key],status=item.status||'needs_review',evidence=item.evidence||[];return `<div class="notice-card-field ${['what','action','deadline'].includes(key)?'essential':''}"><div class="notice-card-field-head"><label for="brief-${key}">${label}</label><label class="brief-include"><input type="checkbox" data-brief-include="${key}" ${item.included?'checked':''}>공지에 포함</label></div><textarea id="brief-${key}" data-brief-field="${key}" rows="${['action','method','exception'].includes(key)?3:2}" maxlength="2000" placeholder="${['cost','exception'].includes(key)?'자료에 없으면 비워두세요':'내용을 입력하세요'}">${escapeHtml(item.value)}</textarea><div class="brief-status"><span class="tag ${status==='confirmed'?'green':'orange'}" data-brief-status="${key}">${labels[status]||labels.needs_review}</span>${status!=='confirmed'&&item.value.trim()?`<button type="button" class="button compact" data-brief-confirm="${key}">내용 확인 완료</button>`:''}</div><small data-brief-source="${key}">${escapeHtml(item.source||'확인 필요')}</small>${evidence.length?`<details class="brief-evidence"><summary>원문 근거 ${evidence.length}개</summary>${evidence.map(e=>`<blockquote><cite>${escapeHtml(e.sourceName)} · ${escapeHtml(e.location)}${e.method==='ocr'?' · OCR':''}</cite><br>${escapeHtml(e.quote)}</blockquote>`).join('')}</details>`:''}</div>`;}).join('')}</div><p class="help">무엇을·해야 할 일·마감은 확인된 값이 있어야 초안을 만들 수 있습니다. AI가 만든 본문도 보내기 전에 검토해야 합니다.</p></section>`;
}
const noticeKind = t => t.purpose==='첫 안내'?'initial':/D-\d|마감|마지막/.test(t.title)?'deadline':/리마인드|다시|추가|한 번 더/.test(t.title)?'reminder':'initial';
function getDraft(t) {
  if(!drafts[t.id])drafts[t.id]={body:'',purpose:noticeKind(t),tone:'friendly',mode:'dm',scope:t.project==='event'?'project':'pending',teams:TEAMS.map(t=>t.id),dmSelection:'team',selectedIds:[],channels:[],confirmed:false,confirmedSignature:'',confirmedSourceSnapshot:'',confirmedSpreadsheetId:'',resources:[],brief:makeNoticeBrief(getProject(t.project)),briefStale:false,_cloudVersion:0,_cloudRevision:0,_cloudDirty:false};
  const fallback=makeNoticeBrief(getProject(t.project));
  if(!drafts[t.id].brief||typeof drafts[t.id].brief!=='object')drafts[t.id].brief=fallback;
  else for(const key of Object.keys(fallback)){
    const item=drafts[t.id].brief[key];
    if(typeof item?.value!=='string'||typeof item?.included!=='boolean')drafts[t.id].brief[key]=fallback[key];
    else if(!['confirmed','needs_review','conflict','missing'].includes(item.status)){
      item.status=item.source==='담당자 수정'&&item.value.trim()?'confirmed':item.value===fallback[key].value?fallback[key].status:'needs_review';
      item.evidence=item.source==='담당자 수정'||item.value!==fallback[key].value?[]:fallback[key].evidence;
    }
  }
  return drafts[t.id];
}
function noticeContext(t){
  const d=getDraft(t),p=getProject(t.project),recipients=audience(p,d);
  const input={projectTitle:p.name,card:d.brief,tone:d.tone,kind:d.purpose};
  return {input,signature:generationSignature(input,recipients)};
}
function noticeCandidateMarkup(t){
  const state=noticeStates.get(t.id),candidate=state?.candidate;
  if(!candidate)return '<div id="notice-comparison" aria-live="polite"></div>';
  const stale=candidate.signature!==noticeContext(t).signature;
  return `<div id="notice-comparison" class="notice-candidate" aria-live="polite"><h3>새 초안과 현재 본문 비교</h3><p class="help">현재 본문은 새 초안을 선택하기 전까지 유지됩니다.${stale?' 작성 기준이나 대상이 바뀌어 이 결과는 적용할 수 없습니다.':''}</p><div class="message-original">${escapeHtml(candidate.body)}</div><div class="actions"><button class="button primary" data-action="accept-notice" ${stale?'disabled':''}>새 초안으로 교체</button><button class="button" data-action="discard-notice">현재 본문 유지</button></div></div>`;
}
function refreshNoticeCandidate(t){
  const target=$('#notice-comparison');
  if(target)target.outerHTML=noticeCandidateMarkup(t);
}
async function generateNoticeDraft(t){
  if(!cloudUser){toast('Gemini 초안을 만들려면 Supabase에 로그인해주세요.');return;}
  const d=getDraft(t);
  if(['what','action','deadline'].some(key=>!d.brief[key]?.included||!d.brief[key]?.value.trim()||d.brief[key]?.status!=='confirmed')){toast('무엇을, 해야 할 일, 마감을 카드에서 확인 완료해주세요.');return;}
  if(Object.values(d.brief).some(item=>item.included&&item.value.trim()&&item.status!=='confirmed')){toast('포함할 카드 항목의 충돌·확인 필요 상태를 먼저 해결하거나 제외해주세요.');return;}
  const {input,signature}=noticeContext(t),button=$('[data-action="generate-notice"]');
  if(button){button.disabled=true;button.textContent='Gemini가 작성 중…';}
  try{
    const result=await cloudRequest('/api/notices/generate',{method:'POST',body:input});
    if(signature!==noticeContext(t).signature){toast('정보 카드나 대상이 바뀌어 이전 생성 결과를 적용하지 않았어요.');return;}
    noticeStates.set(t.id,{candidate:{body:result.body,model:result.model,generatedAt:result.generatedAt,signature}});
    if(route().view==='review'&&route().id===t.id)refreshNoticeCandidate(t);
    toast('새 초안을 만들었어요. 현재 본문과 비교한 뒤 선택해주세요.');
  }catch(error){toast(error.message);}
  finally{if(button?.isConnected){button.disabled=false;button.textContent='Gemini로 초안 다시 생성';}}
}
function audience(p,d) {
  const s=status(p),target=new Set(s.targetIds),pending=new Set(s.pendingIds);
  const base=EMPLOYEES.filter(e=>d.scope==='company'||(d.scope==='project'?target.has(e.id):pending.has(e.id)));
  const channels=d.channels.map(id=>CHANNELS.find(c=>c.id===id)).filter(Boolean);
  const channelAudiences=channels.map(channel=>({channel,members:EMPLOYEES.filter(e=>!channel.team||e.team===channel.team)}));
  const list=d.mode==='channel'?EMPLOYEES.filter(e=>channelAudiences.some(({members})=>members.includes(e))):base.filter(e=>d.dmSelection==='people'?d.selectedIds.includes(e.id):d.teams.includes(e.team));
  return {base,list,channels,channelAudiences,counts:recipientCounts(list,s)};
}
function individualPicker(a,d,s) {
  const groups=recipientGroups(a.base,s);
  return `<div class="individual-picker"><label for="recipient-search" class="field-label">동료 이름 검색</label><input id="recipient-search" type="search" placeholder="이름이나 팀으로 찾기" value="${escapeHtml(recipientSearch)}"><div class="recipient-picker-actions"><span>현재 대상 범위 ${a.base.length}명 중 ${a.list.length}명 선택</span><button class="button compact" data-action="clear-individuals">선택 모두 해제</button></div><div class="individual-list">${groups.map(group=>`<div class="individual-group"><h3 data-individual-heading>${group.label} · <span data-group-count>${group.people.length}</span>명</h3>${group.people.map(e=>`<label class="individual-row" data-individual-row data-search="${escapeHtml(`${e.name} ${TEAMS.find(t=>t.id===e.team).name}`.toLowerCase())}"><input type="checkbox" data-individual="${e.id}" ${d.selectedIds.includes(e.id)?'checked':''}><span>${escapeHtml(e.name)}<small>${escapeHtml(TEAMS.find(t=>t.id===e.team).name)}</small></span></label>`).join('')}</div>`).join('')}</div></div>`;
}
function recipientSettings(t) {
  const p=getProject(t.project),d=getDraft(t),a=audience(p,d),s=status(p);
  const quickButtons=`<div class="recipient-quick-actions" role="group" aria-label="필수 대상 빠른 선택"><button class="button compact" data-quick-recipients="required-pending" ${s.requiredPendingIds.length?'':'disabled'}>필수 미신청자만 선택 <span>${s.requiredPendingIds.length}명</span></button><button class="button compact" data-quick-recipients="required-all" ${s.requiredIds.length?'':'disabled'}>필수 대상 전체 선택 <span>${s.requiredIds.length}명</span></button></div>`;
  return `<div class="route-choice" aria-label="보내는 방법"><button data-mode="dm" aria-pressed="${d.mode==='dm'}">${icon('message')} DM 보내기</button><button data-mode="channel" aria-pressed="${d.mode==='channel'}">${icon('people')} Slack 채널에 게시</button></div>${d.mode==='dm'?`
    <div class="field"><label for="audience-scope">누구에게 보낼까요?</label><select id="audience-scope"><option value="pending" ${d.scope==='pending'?'selected':''}>아직 신청하지 않은 동료</option><option value="project" ${d.scope==='project'?'selected':''}>프로젝트 대상 전체</option><option value="company" ${d.scope==='company'?'selected':''}>전 직원 (프로젝트 대상 외 포함)</option></select></div>${quickButtons}<div class="selection-tabs" role="group" aria-label="DM 대상 선택 방식"><button data-dm-selection="team" aria-pressed="${d.dmSelection==='team'}">팀으로 고르기</button><button data-dm-selection="people" aria-pressed="${d.dmSelection==='people'}">동료 직접 고르기</button></div>${d.dmSelection==='team'?`<fieldset class="team-select"><legend>받을 동료를 팀별로 선택</legend><label class="team-checkbox"><input id="all-teams" type="checkbox" ${d.teams.length===TEAMS.length?'checked':''}>전체 팀 선택</label>${TEAMS.map(team=>`<label class="team-checkbox"><input type="checkbox" data-team="${team.id}" ${d.teams.includes(team.id)?'checked':''}>${team.name}<small>${a.base.filter(e=>e.team===team.id).length}명</small></label>`).join('')}</fieldset>`:individualPicker(a,d,s)}
    <div class="recipient-summary"><strong>DM을 받을 동료 ${a.list.length}명</strong><p>필수 ${a.counts.required}명 · 자율 ${a.counts.voluntary}명${a.counts.outside?` · 대상 외 ${a.counts.outside}명`:''}<br>미신청 ${a.counts.pending}명 · 확정 대기 ${a.counts.applied}명 · 확정 ${a.counts.confirmed}명${d.scope!=='pending'?'<br>이미 신청한 동료도 포함될 수 있어요.':''}${d.scope==='company'?'<br>프로젝트에 참여하지 않는 동료도 포함돼요.':''}</p></div><details class="recipients-toggle"><summary>받을 동료 명단 보기</summary><div id="recipient-list">${recipientTable(a.list,p)}</div></details>${!a.list.length?'<p class="error-message">DM을 받을 동료를 선택해주세요.</p>':''}`:`
      <div class="field"><label for="posting-channel">게시할 채널 추가</label><div class="channel-add"><select id="posting-channel"><option value="">채널 선택</option>${CHANNELS.filter(c=>!d.channels.includes(c.id)).map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select><button class="button" data-action="add-channel" ${d.channels.length===CHANNELS.length?'disabled':''}>추가</button></div></div><div class="selected-channels" aria-label="게시할 채널 목록">${a.channelAudiences.map(({channel,members})=>`<div class="selected-channel"><div><strong>${escapeHtml(channel.name)}</strong><small>예시 구성원 ${members.length}명 · 프로젝트 대상 외 ${members.filter(e=>!p.targetIds.includes(e.id)).length}명</small></div><button class="button compact" data-remove-channel="${channel.id}" aria-label="${escapeHtml(channel.name)} 제거">제거</button></div>`).join('')||'<p class="history-empty">게시할 채널을 추가해주세요.</p>'}</div><div class="recipient-summary"><strong>채널 ${a.channels.length}곳에 각각 공지 1건</strong><p>예시 공개 범위의 고유 동료 ${a.list.length}명 · 프로젝트 대상 외 ${a.list.filter(e=>!p.targetIds.includes(e.id)).length}명<br>여러 채널에 속한 동료는 공지를 중복해서 볼 수 있어요.</p></div><p class="caption muted">각 채널의 모든 구성원에게 보여요. 아직 신청하지 않은 동료에게만 안내하려면 DM을 선택해주세요.</p>`}`;
}
function recipientTable(list,p) {
  const pages=Math.max(1,Math.ceil(list.length/8));recipientPage=Math.max(0,Math.min(recipientPage,pages-1));
  const s=status(p);return `<table class="recipient-table"><caption class="help">받는 사람</caption><thead><tr><th scope="col">동료</th><th scope="col">팀</th><th scope="col">신청 상태</th></tr></thead><tbody>${list.slice(recipientPage*8,recipientPage*8+8).map(e=>`<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(TEAMS.find(t=>t.id===e.team).name)}</td><td>${recipientGroupLabel(e.id,s)}</td></tr>`).join('')}</tbody></table><div class="actions"><button class="button compact" data-recipients-page="-1" aria-label="이전 동료 목록" ${recipientPage===0?'disabled':''}>이전</button><span class="caption muted">${recipientPage+1} / ${pages}</span><button class="button compact" data-recipients-page="1" aria-label="다음 동료 목록" ${recipientPage>=pages-1?'disabled':''}>다음</button></div>`;
}
function sheetReviewReminder(p) {
  if(p.dataKind!=='sheet')return '';
  const last=sheetSync?.lastSuccessAt?new Date(sheetSync.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):null;
  return `<section class="panel sheet-source-panel" aria-label="신청 현황 확인"><div><h2>발송 전 신청 현황을 확인해주세요</h2><p class="caption muted">Supabase의 마지막 성공한 동기화 시각: ${last?escapeHtml(last):'아직 가져오지 않음'}</p><p class="caption muted">보내기 직전에도 시트 원본을 다시 확인하고, 변경됐다면 본문과 대상을 다시 검토하도록 멈춥니다.</p>${!cloudUser?'<p class="caption muted">시트를 읽으려면 먼저 로그인해주세요.</p>':''}${sheetSyncError?`<p class="error-message" role="alert">${escapeHtml(sheetSyncError)}</p>`:''}</div><button type="button" class="button" data-action="sync-sheet" ${sheetSyncBusy||!sheetSourceStatus.configured||!cloudUser?'disabled':''}>${sheetSyncBusy?'가져오는 중…':'신청 현황 새로고침'}</button></section>`;
}
function reviewPage(id) {
  const t=getTicket(id),p=getProject(t.project),d=getDraft(t);
  const resources=(d.resources||[]).map((item,index)=>`<div class="draft-resource"><span>${item.kind==='file'?'📎':'🔗'} ${escapeHtml(item.label)}${item.kind==='file'?` · ${Math.ceil((item.byte_size||0)/1024)} KB`:''}</span>${item.kind==='file'&&cloudUser?`<a class="button compact" href="#" data-open-file="${encodeURIComponent(item.id)}">열기</a>`:''}<button class="button compact" data-remove-resource="${index}">제거</button></div>`).join('')||'<p class="help">이번 안내에 추가한 자료가 없어요.</p>';
  return `<a href="#project/${p.id}" class="back-link">${icon('back')} ${p.name} 전체 티켓</a>${heading('보낼 내용 확인',`${p.name} · ${t.title}`)}${sheetReviewReminder(p)}${noticeCardMarkup(d)}<div class="review-grid"><section class="panel form-panel"><h2>동료에게 보낼 메시지</h2><p class="caption muted" style="margin:7px 0 22px">정보 카드로 생성한 초안을 확인하고 다듬어주세요.</p><div class="draft-save-box" role="status" aria-live="polite"><span id="draft-save-state">${escapeHtml(cloudLabel(t))}</span><button class="button compact" id="draft-retry" data-action="retry-draft-save" ${cloudState[t.id]?.status==='error'?'':'hidden'}>다시 시도</button><span id="draft-conflict-actions" class="actions" ${cloudState[t.id]?.status==='conflict'?'':'hidden'}><button class="button compact" data-action="load-cloud-draft">서버 내용 불러오기</button><button class="button compact" data-action="overwrite-cloud-draft">내 변경 저장</button></span></div><div class="field"><label for="draft-tone">말투</label><select id="draft-tone"><option value="friendly" ${d.tone==='friendly'?'selected':''}>친근하고 밝게</option><option value="concise" ${d.tone==='concise'?'selected':''}>친근하고 간결하게</option><option value="action" ${d.tone==='action'?'selected':''}>신청 요청을 명확하게</option></select><p class="help">말투를 바꾸면 확인된 정보 카드로 Gemini가 본문을 다시 작성합니다. 직접 수정한 내용은 교체돼요.</p></div><div class="draft-area"><label class="preview-label" for="draft-body"><span>메시지 본문</span>${tag(d.generatedModel?'Gemini 초안':'직접 작성')}</label><textarea id="draft-body" maxlength="20000">${escapeHtml(d.body)}</textarea><p class="help">신청 링크와 날짜가 맞는지 보내기 전에 확인해주세요.</p></div><div class="draft-attachments"><h3>이번 안내에 포함할 자료</h3><p class="help">링크는 본문에 넣고, 파일은 로그인한 계정의 비공개 저장소에 저장해요. 실제 Slack 전송은 아직 연결되지 않았어요.</p><div id="draft-resources">${resources}</div><div class="resource-add"><input id="resource-label" type="text" maxlength="160" aria-label="링크 이름" placeholder="링크 이름"><input id="resource-url" type="url" maxlength="2000" aria-label="링크 주소" placeholder="https://…"><button class="button" data-action="add-resource-link">링크 추가</button></div><div class="field"><label for="resource-file">파일 첨부 (PDF·DOCX·TXT·MD·이미지, 4MB 이하)</label><input id="resource-file" type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" ${cloudUser?'':'disabled'}></div>${cloudUser?'':'<p class="help">파일을 저장하려면 상단의 Supabase 로그인을 완료해주세요.</p>'}</div></section><section class="panel form-panel"><h2 style="margin-bottom:22px">보내는 방법과 대상</h2><div id="recipient-settings">${recipientSettings(t)}</div></section></div><div class="approval-bar"><div><label class="confirm-row"><input type="checkbox" id="send-confirm" ${d.confirmed?'checked':''}><span id="confirmation-label">${confirmationLabel(d)}</span></label><p>체크하면 최종 본문과 대상을 확인하는 창이 열립니다.</p>${sendPreflightErrors.has(t.id)?`<p class="error-message" role="alert">${escapeHtml(sendPreflightErrors.get(t.id))}</p>`:''}</div><button class="button primary" id="send-button" data-action="simulate-send" ${canSend(t)?'':'disabled'}>${sendLabel(t)} ${icon('arrow')}</button></div>`;
}
const confirmationLabel = d => d.mode==='dm'?'보낼 내용과 DM을 받을 동료를 확인했어요.':'보낼 내용과 게시할 채널·공개 범위를 확인했어요.';
const approvalSignature = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return JSON.stringify({body:d.body,mode:d.mode,recipientIds:a.list.map(e=>e.id),channelIds:a.channels.map(c=>c.id),resources:d.resources||[]});};
const canSend = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return Boolean(!sendPreflightBusy&&ticketState(t)==='pending'&&cloudUser&&operatorSaveStatus==='saved'&&cloudState[t.id]?.status==='saved'&&!d._cloudDirty&&!d.briefStale&&d.confirmed&&d.confirmedSignature===approvalSignature(t)&&d.body.trim()&&(d.mode==='dm'?a.list.length:a.channels.length));};
const sendLabel = t => {const d=getDraft(t),a=audience(getProject(t.project),d);return d.mode==='dm'?`${a.list.length}명에게 DM 보내기 (예시)`:`${a.channels.length}개 채널에 게시 (예시)`;};
function updateApproval(t) {
  const d=getDraft(t);$('#send-confirm').checked=d.confirmed;$('#confirmation-label').textContent=confirmationLabel(d);$('#send-button').disabled=!canSend(t);$('#send-button').innerHTML=escapeHtml(sendLabel(t))+' '+icon('arrow');refreshNoticeCandidate(t);scheduleCloudSave(t);
}
function updateRecipients(t) {
  $('#recipient-settings').innerHTML=recipientSettings(t);const all=$('#all-teams');if(all)all.indeterminate=getDraft(t).teams.length>0&&getDraft(t).teams.length<TEAMS.length;filterRecipientRows();updateApproval(t);
}
function filterRecipientRows() {
  const search=recipientSearch.trim().toLowerCase();document.querySelectorAll('[data-individual-row]').forEach(row=>row.hidden=Boolean(search)&&!row.dataset.search.includes(search));
  document.querySelectorAll('.individual-group').forEach(group=>{
    const visible=group.querySelectorAll('[data-individual-row]:not([hidden])').length;
    group.hidden=visible===0;group.querySelector('[data-group-count]').textContent=visible;
  });
}
function render() {
  disposeDocumentImport?.();disposeDocumentImport=null;
  const r=route();renderNavigation(r);
  $('#content').innerHTML=r.view==='home'?home():r.view==='projects'?projectsPage():r.view==='project'?projectPage(r.id):r.view==='edit-project'?projectFormPage(r.id):r.view==='history'?historyPage():reviewPage(r.id);
  if(r.view==='project')filterRoster();
  if(r.view==='edit-project'){
    refreshMemberPicker();
    disposeDocumentImport=mountDocumentImport($('#document-import'),{
      loggedIn:()=>Boolean(cloudUser),login:openCloudDialog,
      getValue:field=>$(`#project-${field}`)?.value||'',
      saved:getProject(r.id)?.sourceReviews||[],
      apply:(rows,issues)=>{for(const row of rows){const input=$(`#project-${row.field}`);if(input){input.value=row.appliedValue;appliedFieldReviews[row.field]=row;}}appliedSourceIssues=issues;appliedDocumentName=[...new Set(rows.flatMap(row=>row.evidence.map(e=>e.sourceName)))].join(' · ');toast(`${rows.length}개 항목을 채웠어요. 확인 후 저장해주세요.`);},
    });
  }
  if(r.view==='review'){
    const t=getTicket(r.id),d=getDraft(t),all=$('#all-teams');
    if(all)all.indeterminate=d.teams.length>0&&d.teams.length<TEAMS.length;
    const toneField=$('#draft-tone')?.closest('.field');
    if(toneField){toneField.querySelector('.help').textContent='말투를 바꾸면 Gemini가 새 초안을 자동 생성합니다. 직접 고친 본문은 새 초안을 선택하기 전까지 유지돼요.';toneField.insertAdjacentHTML('afterend',`<div class="field"><label for="notice-purpose">공지 목적</label><select id="notice-purpose">${Object.entries(NOTICE_PURPOSES).map(([key,label])=>`<option value="${key}" ${d.purpose===key?'selected':''}>${label}</option>`).join('')}</select></div>`);}
    $('#draft-body')?.closest('.draft-area')?.insertAdjacentHTML('afterend',noticeCandidateMarkup(t));
    filterRecipientRows();
  }
}
function refreshCalendar() {
  $('#calendar-content').innerHTML=calendar.view==='calendar'?calendarMarkup():projectTable();
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarView===calendar.view)));
  persist({remote:false});
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
  $('#history-dialog').innerHTML=`${dialogHeading(r.title,`${recordDate(r.date)} · ${r.route}`,p.name+' / 보낸 안내')}<form id="history-form"><div class="dialog-body"><div class="preview-label"><span class="field-label" style="margin:0">안내 원문</span><div class="actions">${tag(r.source==='manual'?'직접 추가한 기록':r.source==='simulated'?'보내기 예시':'예시 원문',r.source==='simulated'?'green':'gray')}<button type="button" class="button compact" data-action="edit-history">${edit?'원문 보기':'기록 내용 수정'}</button></div></div>${edit?`<textarea id="history-body" maxlength="20000" aria-label="안내 원문">${escapeHtml(r.body)}</textarea><p class="help" style="margin-bottom:22px">이곳에 보관한 기록만 수정돼요. Slack 메시지는 변경하지 않아요.</p>`:`<div class="message-original">${escapeHtml(r.body||'원문이 아직 등록되지 않았어요. 기록 내용 수정에서 추가할 수 있어요.')}</div>`}<div class="field" style="margin-bottom:0"><label for="history-url">Slack 메시지 링크</label><input id="history-url" type="url" placeholder="https://워크스페이스.slack.com/archives/…" value="${escapeHtml(r.url)}" maxlength="2000"><p class="help">Slack에서 ‘메시지 링크 복사’로 가져온 주소를 붙여넣어주세요.</p></div><p id="history-error" class="error-message" role="alert" hidden></p></div><div class="dialog-footer"><span class="help">운영 기록을 Supabase에 저장해요.</span><div class="actions">${r.url?`<a class="button" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">Slack에서 열기 ${icon('external')}</a>`:''}<button class="button primary" type="submit">${edit?'수정 내용 저장':'링크 저장'}</button></div></div></form>`;
  $('#history-form .dialog-body').insertAdjacentHTML('afterbegin',`<div class="field"><label for="history-kind">안내 종류</label><select id="history-kind"><option value="initial" ${recordKind(r)==='initial'?'selected':''}>최초 공지</option><option value="reminder" ${recordKind(r)==='reminder'?'selected':''}>리마인드 알림</option></select></div>`);
  if(r.sourceCheckedAt&&!Number.isNaN(Date.parse(r.sourceCheckedAt)))$('#history-kind').closest('.field').insertAdjacentHTML('afterend',`<p class="help">${r.sourceRechecked?'모의 발송 직전 Sheets 확인':'마지막 신청 현황 확인'}: ${escapeHtml(new Date(r.sourceCheckedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}</p>`);
  const resources=(r.resources||[]).map(item=>{
    const link=item.kind==='link'&&/^https:\/\//i.test(item.url||'')?`<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">링크 열기</a>`:item.kind==='file'&&/^[a-f0-9-]{36}$/i.test(item.id||'')&&cloudUser?`<a href="#" data-open-file="${escapeHtml(item.id)}">파일 열기</a>`:'';
    return `<div class="draft-resource"><span>${item.kind==='file'?'첨부 파일':'본문 링크'} · ${escapeHtml(item.label)}</span>${link}</div>`;
  }).join('');
  $('#history-url').closest('.field').insertAdjacentHTML('beforebegin',`<div class="history-resources"><h3>당시 포함한 자료</h3>${resources||'<p class="help">별도로 기록된 자료가 없어요.</p>'}</div>`);
}
function newHistory(projectId) {
  historyContext={id:null,edit:true,origin:document.activeElement};
  const projectOptions=PROJECTS.map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${p.name}</option>`).join('');
  $('#history-dialog').innerHTML=`${dialogHeading('안내 기록 추가','이전에 보낸 안내를 원문 또는 Slack 링크로 남겨요.','보낸 안내')}<form id="new-history-form"><div class="dialog-body"><div class="field"><label for="record-project">프로젝트</label><select id="record-project">${projectOptions}</select></div><div class="field"><label for="record-title">안내 제목</label><input type="text" id="record-title" required maxlength="160" placeholder="예: 워크숍 첫 공지"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:15px"><div class="field"><label for="record-date">보낸 날짜와 시각</label><input type="datetime-local" id="record-date" required value="${checkedAt()}" style="width:100%;border:1px solid #dde4de;border-radius:7px;padding:10px;font-size:11px"></div><div class="field"><label for="record-route">보낸 곳</label><input type="text" id="record-route" required maxlength="200" placeholder="예: #전체-공지 또는 DM 20명"></div></div><div class="field"><label for="record-body">안내 원문</label><textarea id="record-body" maxlength="20000" placeholder="실제로 보낸 안내 내용을 붙여넣어주세요."></textarea></div><div class="field" style="margin:0"><label for="record-url">Slack 메시지 링크</label><input id="record-url" type="url" maxlength="2000" placeholder="https://워크스페이스.slack.com/archives/…"><p class="help">원문 또는 Slack 메시지 링크 중 하나 이상을 넣어주세요.</p></div><p id="history-error" class="error-message" role="alert" hidden></p></div><div class="dialog-footer"><span class="help">기록을 추가해도 메시지가 전송되지는 않아요.</span><button type="submit" class="button primary">안내 기록 저장</button></div></form>`;
  $('#record-project').closest('.field').insertAdjacentHTML('afterend','<div class="field"><label for="record-kind">안내 종류</label><select id="record-kind"><option value="initial">최초 공지</option><option value="reminder">리마인드 알림</option></select></div>');
  $('#history-dialog').showModal();
}
function historyError(text) { $('#history-error').textContent=text;$('#history-error').hidden=false; }
function closeHistory() {
  const origin=historyContext?.origin;$('#history-dialog').close();historyContext=null;
  if(origin?.isConnected)origin.focus();
}
function recordApplicationChange(project,employeeId,toStatus,reason='') {
  if(!requireOperator())return false;
  const fromStatus=applications.find(item=>item.projectId===project.id&&item.employeeId===employeeId)?.status||'none';
  if(fromStatus===toStatus)return false;
  const at=checkedAt();
  applications=setApplication(applications,project.id,employeeId,toStatus,at);
  applicationEvents.push({id:crypto.randomUUID(),projectId:project.id,employeeId,fromStatus,toStatus,reason,actor:cloudUser?.email||'로컬 운영자',source:'operator',at});
  if(project.dataKind!=='sheet'){project.lastCheckedAt=at;project.dataKind='local';}
  Object.values(drafts).forEach(d=>d.confirmed=false);
  persist();render();void refreshOfficialCalendarAndTickets();return true;
}
function openCancel(project,employeeId) {
  if(!requireOperator())return;
  const person=EMPLOYEES.find(e=>e.id===employeeId),team=TEAMS.find(t=>t.id===person?.team);
  if(!person||!team||!status(project).appliedIds.includes(employeeId))return;
  cancelContext={projectId:project.id,employeeId,origin:document.activeElement};
  $('#cancel-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">신청 상태 변경</p><h2 id="cancel-dialog-title">신청을 취소하시겠습니까?</h2></div><button class="button icon-button" data-action="close-cancel" aria-label="취소 창 닫기">${icon('close')}</button></div><form id="cancel-form"><div class="dialog-body"><p class="cancel-target"><strong>${escapeHtml(person.name)} · ${escapeHtml(team.name)}</strong><span>${escapeHtml(project.name)}</span></p><p class="caption muted">신청을 취소하면 이 동료는 대상 명단에 남고 ‘신청 전’으로 돌아갑니다. 변경 시각과 사유는 아래 기록에 남습니다.</p><div class="field cancel-reason"><label for="cancel-reason">취소 사유 <span aria-hidden="true">*</span></label><textarea id="cancel-reason" required maxlength="500" placeholder="예: 본인 요청으로 신청 취소" aria-describedby="cancel-reason-help"></textarea><p id="cancel-reason-help" class="help">사유를 입력해야 취소할 수 있습니다.</p></div></div><div class="dialog-footer"><span class="help">변경 사유를 Supabase 운영 기록에 저장합니다.</span><div class="actions"><button type="button" class="button" data-action="close-cancel">돌아가기</button><button type="submit" class="button primary">신청 취소 확정</button></div></div></form>`;
  $('#cancel-dialog').showModal();$('#cancel-reason').focus();
}
function closeCancel() {
  const origin=cancelContext?.origin;$('#cancel-dialog').close();cancelContext=null;
  if(origin?.isConnected)origin.focus();
}
function openTicketDecision(id,decision){
  if(!requireOperator())return;
  const ticket=getTicket(id);if(!ticket?.ruleGenerated||!['pending','scheduled','deferred'].includes(ticket.state))return;
  ticketDialogContext={id,decision,origin:document.activeElement};
  $('#ticket-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">티켓 상태 변경</p><h2 id="ticket-dialog-title">${decision==='deferred'?'언제 다시 확인할까요?':'이 안내를 하지 않을까요?'}</h2><p>${escapeHtml(getProject(ticket.project)?.name)} · ${escapeHtml(ticket.title)}</p></div><button class="button icon-button" data-action="close-ticket-dialog" aria-label="창 닫기">${icon('close')}</button></div><form id="ticket-decision-form"><div class="dialog-body"><div class="field"><label for="ticket-decision-reason">사유</label><textarea id="ticket-decision-reason" maxlength="500" required placeholder="판단 근거를 적어주세요."></textarea></div>${decision==='deferred'?'<div class="field"><label for="ticket-review-at">다시 확인할 시각</label><input id="ticket-review-at" type="datetime-local" required></div>':''}</div><div class="dialog-footer"><button type="button" class="button" data-action="close-ticket-dialog">돌아가기</button><button type="submit" class="button primary">상태 저장</button></div></form>`;
  $('#ticket-dialog').showModal();$('#ticket-decision-reason').focus();
}
function closeTicketDecision(){const origin=ticketDialogContext?.origin;$('#ticket-dialog').close();ticketDialogContext=null;if(origin?.isConnected)origin.focus();}
function saveTicketDecision(event){
  event.preventDefault();if(!ticketDialogContext)return;
  const ticket=getTicket(ticketDialogContext.id),reason=$('#ticket-decision-reason').value.trim();
  const reviewAt=ticketDialogContext.decision==='deferred'?$('#ticket-review-at').value:'';
  if(!ticket||!reason||ticketDialogContext.decision==='deferred'&&(!reviewAt||Date.parse(`${reviewAt}:00+09:00`)<=Date.now())){toast('사유와 앞으로의 재검토 시각을 확인해주세요.');return;}
  ticket.state=ticketDialogContext.decision;ticket.decisionReason=reason;ticket.reviewAt=reviewAt?`${reviewAt}:00+09:00`:null;
  ticket.decidedAt=new Date().toISOString();closeTicketDecision();persist();render();
}
function dmPreviewTargets(p,a) {
  const c=a.counts,groups=recipientGroups(a.list,status(p));
  return `<p class="preview-target-summary">개별 DM ${c.total}명 · 필수 ${c.required}명 · 자율 ${c.voluntary}명${c.outside?` · 대상 외 ${c.outside}명`:''}</p><p class="preview-target-breakdown">미신청 ${c.pending}명 · 확정 대기 ${c.applied}명 · 확정 ${c.confirmed}명</p><div class="preview-recipient-groups">${groups.map(group=>`<section class="preview-recipient-group"><h4>${group.label} · ${group.people.length}명</h4><ul>${group.people.map(e=>`<li><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(TEAMS.find(team=>team.id===e.team)?.name||'팀 정보 없음')} · ${group.label}</span></li>`).join('')}</ul></section>`).join('')}</div>`;
}
function openSendPreview(t) {
  sendPreflightErrors.delete(t.id);
  const d=getDraft(t),p=getProject(t.project),a=audience(p,d);
  if(!d.body.trim()){toast('메시지 본문을 입력해주세요.');return;}
  if(d.mode==='dm'&&!a.list.length){toast('DM을 받을 동료를 선택해주세요.');return;}
  if(d.mode==='channel'&&!a.channels.length){toast('게시할 채널을 추가해주세요.');return;}
  previewContext={ticketId:t.id,signature:approvalSignature(t),origin:document.activeElement};
  const targets=d.mode==='dm'?dmPreviewTargets(p,a):`<p class="preview-target-summary">채널 ${a.channels.length}곳에 각각 게시 · 고유 공개 인원 ${a.list.length}명</p><div class="preview-target-list">${a.channelAudiences.map(({channel,members})=>`<span>${escapeHtml(channel.name)} · 예시 구성원 ${members.length}명 · 프로젝트 대상 외 ${members.filter(e=>!p.targetIds.includes(e.id)).length}명</span>`).join('')}</div>`;
  const sourceCheck=`<p class="preview-source-check"><strong>${p.dataKind==='sheet'?'Google Sheets 원본 마지막 가져오기':'최근 신청 현황 확인'}</strong> ${p.lastCheckedAt?escapeHtml(p.lastCheckedAt.replace('T',' '))+' (한국시간)':'확인 시각 없음'}${p.dataKind==='sheet'?'<br>모의 발송 직전에 원본을 다시 조회하고 변경 여부를 확인합니다.':''}</p>`;
  const resources=(d.resources||[]).map(item=>`<div class="draft-resource"><span>${item.kind==='file'?'첨부 파일':'본문 링크'} · ${escapeHtml(item.label)}</span>${item.kind==='link'?`<span>${escapeHtml(item.url)}</span>`:''}</div>`).join('')||'<p class="help">선택한 자료 없음</p>';
  $('#send-preview-dialog').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">최종 확인</p><h2 id="send-preview-title">보낼 본문과 대상을 확인해주세요</h2><p>${escapeHtml(p.name)} · ${escapeHtml(t.title)}</p></div><button class="button icon-button" data-action="close-preview" aria-label="최종 확인 창 닫기">${icon('close')}</button></div><div class="dialog-body"><h3>메시지 본문</h3><div class="message-original">${escapeHtml(d.body)}</div>${d.resources?.length?`<h3>첨부 자료</h3>${resources}`:''}<h3>${d.mode==='dm'?'DM을 받을 동료':'게시할 채널과 공개 범위'}</h3>${targets}${sourceCheck}<label class="confirm-row preview-confirm"><input type="checkbox" id="preview-ack"><span>위 본문·자료와 ${d.mode==='dm'?'받을 동료':'게시할 채널'}를 확인했어요.</span></label></div><div class="dialog-footer"><span class="help">이번 프로토타입에서는 실제 메시지를 보내지 않아요.</span><div class="actions"><button class="button" data-action="close-preview">돌아가기</button><button class="button primary" data-action="confirm-preview" disabled>확인 완료</button></div></div>`;
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
  try{
    d.confirmedSourceSnapshot=getProject(t.project).dataKind==='sheet'?projectSendSnapshot(getProject(t.project),EMPLOYEES,applications):'';
    d.confirmedSpreadsheetId=d.confirmedSourceSnapshot?sheetSync?.spreadsheetId||'':'';
    if(d.confirmedSourceSnapshot&&!d.confirmedSpreadsheetId)throw new Error('승인할 Google Sheets 원본을 확인할 수 없습니다.');
  }
  catch(error){closeSendPreview();toast(error.message);return;}
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
  event.preventDefault();if(!requireOperator())return;const url=slackUrl($('#history-url').value);if(url===null){historyError('Slack 메시지 링크를 확인해주세요. HTTPS로 시작하는 Slack 메시지 주소를 넣어주세요.');return;}
  const record=records.find(r=>r.id===historyContext.id),body=historyContext.edit?$('#history-body').value.trim():record.body;
  if(!body&&!url){historyError('안내 원문 또는 Slack 메시지 링크를 넣어주세요.');return;}
  record.body=body;record.url=url;record.kind=$('#history-kind').value;const saved=persist();closeHistory();render();if(saved)toast('안내 기록을 저장했어요.');
}
function saveNewHistoryForm(event) {
  event.preventDefault();if(!requireOperator())return;const url=slackUrl($('#record-url').value),body=$('#record-body').value.trim();
  if(url===null){historyError('Slack 메시지 링크를 확인해주세요. HTTPS로 시작하는 Slack 메시지 주소를 넣어주세요.');return;}
  if(!body&&!url){historyError('안내 원문 또는 Slack 메시지 링크 중 하나를 넣어주세요.');return;}
  if(records.length>=100){historyError('프로토타입에는 안내 기록을 100개까지 저장할 수 있어요.');return;}
  const record={id:crypto.randomUUID(),project:$('#record-project').value,kind:$('#record-kind').value,title:$('#record-title').value.trim(),date:$('#record-date').value,route:$('#record-route').value.trim(),body,url,source:'manual'};
  if(!record.title||!record.route||!validRecord(record)){historyError('제목, 날짜와 보낸 곳을 확인해주세요.');return;}
  records.push(record);const saved=persist();closeHistory();render();if(saved)toast('새 안내 기록을 추가했어요.');
}
async function simulateSend(t) {
  if(!canSend(t))return;if(records.length>=100){toast('프로토타입의 안내 기록 저장 한도에 도달했어요.');return;}
  const d=getDraft(t),approvedSignature=approvalSignature(t),approvedSource=d.confirmedSourceSnapshot,approvedSpreadsheetId=d.confirmedSpreadsheetId;
  sendPreflightBusy=true;sendPreflightErrors.delete(t.id);
  const button=$('#send-button');if(button){button.disabled=true;button.textContent='최신 신청 현황 확인 중…';}
  try{
    const remote=await readDraft(t.id);
    if(remote.version!==d._cloudVersion){setCloudState(t,'conflict',{remote});throw new Error('다른 탭에서 초안이 바뀌었어요. 다시 확인해주세요.');}
    let sourceCheckedAt=getProject(t.project).lastCheckedAt||null;
    if(getProject(t.project).dataKind==='sheet'){
      if(!approvedSource)throw new Error('승인 당시 신청 현황이 없습니다. 본문과 대상을 다시 확인해주세요.');
      await supabaseRequest('/functions/v1/sync-sheets',{method:'POST'});
      const source=(await readSheetSnapshot())?.payload;
      if(!source)throw new Error('최신 시트 현황을 Supabase에서 읽지 못했습니다.');
      if(!approvedSpreadsheetId||source.spreadsheetId!==approvedSpreadsheetId)throw new Error('승인할 때 사용한 Google Sheets 원본과 현재 원본이 다릅니다. 다시 확인해주세요.');
      const latest=sheetSendSnapshot(source,t.project,new Map(TEAMS.map(team=>[team.name,team.id])),applicationEvents.filter(event=>event.projectId===t.project&&event.source!=='sheet'&&!String(event.id).startsWith('sheet:')));
      if(latest!==approvedSource){
        d.confirmed=false;d.confirmedSignature='';d.confirmedSourceSnapshot='';d.confirmedSpreadsheetId='';
        applySheetSource(source,{remote:false});
        throw new Error('신청 상태 또는 대상 명단이 바뀌었습니다. 최신 현황을 반영했으니 수신자를 다시 확인해주세요.');
      }
      if(projectSendSnapshot(getProject(t.project),EMPLOYEES,applications)!==approvedSource)throw new Error('화면의 신청 현황이 승인 이후 바뀌었습니다. 다시 확인해주세요.');
      sourceCheckedAt=source.sync.lastSuccessAt;
    }
    sendPreflightBusy=false;
    if(!canSend(t)||approvalSignature(t)!==approvedSignature)throw new Error('확인 중 본문이나 대상이 바뀌었습니다. 다시 확인해주세요.');
    const a=audience(getProject(t.project),d),id=crypto.randomUUID();
    const route=d.mode==='dm'?`DM · 동료 ${a.list.length}명 · ${d.dmSelection==='people'?'개별 선택':d.teams.length===TEAMS.length?'전체 팀':d.teams.map(id=>TEAMS.find(t=>t.id===id).name).join('·')}`:`${a.channels.map(c=>c.name).join(' · ')} · 게시 ${a.channels.length}건`;
    records.push({id,project:t.project,ticket:t.id,title:t.title,date:checkedAt(),route,body:d.body,url:'',source:'simulated',kind:recordKind({title:t.title,ticket:t.id}),recipientIds:d.mode==='dm'?a.list.map(e=>e.id):[],channelIds:d.mode==='channel'?a.channels.map(c=>c.id):[],resources:structuredClone(d.resources||[]),sourceCheckedAt,sourceRechecked:getProject(t.project).dataKind==='sheet'});
    records.at(-1).purpose=d.purpose;
    records.at(-1).kind=d.purpose==='initial'?'initial':'reminder';
    clearTimeout(cloudTimers.get(t.id));delete cloudState[t.id];
    completed[t.id]=id;delete drafts[t.id];noticeStates.delete(t.id);const saved=persist();activeTab='tickets';location.hash=`project/${t.project}`;
    if(saved)toast('안내 보내기를 완료했어요 (예시). 이 티켓의 원문을 기록했어요.');
  }catch(error){
    d.confirmed=false;d.confirmedSignature='';d.confirmedSourceSnapshot='';d.confirmedSpreadsheetId='';
    sendPreflightErrors.set(t.id,error.message||'최신 신청 현황을 확인하지 못했습니다. 다시 확인해주세요.');
    toast(sendPreflightErrors.get(t.id));
  }finally{sendPreflightBusy=false;if(route().view==='review'&&route().id===t.id)render();}
}

document.addEventListener('click',event=>{
  const fileLink=event.target.closest('[data-open-file]');
  if(fileLink){
    event.preventDefault();
    const tab=window.open('about:blank','_blank');
    void createFileUrl(fileLink.dataset.openFile).then(url=>{if(tab)tab.location.href=url;else window.location.href=url;})
      .catch(error=>{tab?.close();toast(error.message);});
    return;
  }
  if(event.target.closest('.skip-link')){event.preventDefault();$('#content').focus();return;}
  if(event.target.closest('#cloud-open')){openCloudDialog();return;}
  if(event.target.id==='send-confirm'){event.preventDefault();const r=route();if(r.view==='review')openSendPreview(getTicket(r.id));return;}
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.application){
    const p=getProject(button.dataset.project),employeeId=Number(button.dataset.employee),value=button.dataset.application;
    if(!p?.targetIds.includes(employeeId) || !['applied','confirmed','cancelled'].includes(value))return;
    if(value==='cancelled'){openCancel(p,employeeId);return;}
    if(recordApplicationChange(p,employeeId,value==='applied'&&p.confirmationMode==='immediate'?'confirmed':value))toast('신청 상태를 반영했어요.');return;
  }
  if(button.dataset.record){openHistory(button.dataset.record);return;}
  if(button.dataset.ticketDecision){openTicketDecision(button.dataset.ticketId,button.dataset.ticketDecision);return;}
  if(button.dataset.tab){activeTab=button.dataset.tab;render();$(`#${activeTab==='tickets'?'tickets-tab':'sent-tab'}`).focus();return;}
  if(button.dataset.calendarView){calendar.view=button.dataset.calendarView;refreshCalendar();return;}
  if(button.dataset.date){calendar.selected=button.dataset.date;refreshCalendar();$(`[data-date="${calendar.selected}"]`)?.focus();return;}
  if(button.dataset.month){const d=new Date(Date.UTC(calendar.year,calendar.month+Number(button.dataset.month),1));if(d.getUTCFullYear()<2000||d.getUTCFullYear()>2100)return;calendar.year=d.getUTCFullYear();calendar.month=d.getUTCMonth();calendar.selected=dayKey(d);refreshCalendar();return;}
  const r=route(),t=r.view==='review'?getTicket(r.id):null;
  if(button.dataset.briefConfirm&&t){
    const key=button.dataset.briefConfirm,d=getDraft(t),item=d.brief[key];
    if(!item?.value.trim())return;
    item.status='confirmed';item.source='담당자 확인';d.briefStale=true;d.confirmed=false;
    button.closest('.notice-card-field').querySelector(`[data-brief-status="${key}"]`).textContent='확인됨';
    button.closest('.notice-card-field').querySelector(`[data-brief-status="${key}"]`).className='tag green';
    button.closest('.notice-card-field').querySelector(`[data-brief-source="${key}"]`).textContent=item.source;
    button.remove();updateApproval(t);return;
  }
  if(button.dataset.removeResource!==undefined&&t){
    const index=Number(button.dataset.removeResource),d=getDraft(t);
    if(Number.isInteger(index)&&index>=0&&index<d.resources.length){
      const [removed]=d.resources.splice(index,1);
      if(removed.kind==='link')d.body=d.body.replace(`\n\n${removed.label}: ${removed.url}`,'');
      d.confirmed=false;render();updateApproval(t);
    }
    return;
  }
  if(button.dataset.mode&&t){const d=getDraft(t);d.mode=button.dataset.mode;d.confirmed=false;recipientPage=0;updateRecipients(t);return;}
  if(button.dataset.quickRecipients&&t){
    const d=getDraft(t),selection=quickRecipientSelection(button.dataset.quickRecipients,status(getProject(t.project)));
    d.mode='dm';d.scope=selection.scope;d.dmSelection='people';d.selectedIds=selection.selectedIds;d.confirmed=false;
    recipientSearch='';recipientPage=0;updateRecipients(t);return;
  }
  if(button.dataset.dmSelection&&t){const d=getDraft(t);d.dmSelection=button.dataset.dmSelection;d.confirmed=false;recipientPage=0;updateRecipients(t);return;}
  if(button.dataset.removeChannel&&t){const d=getDraft(t);d.channels=d.channels.filter(id=>id!==button.dataset.removeChannel);d.confirmed=false;updateRecipients(t);return;}
  if(button.dataset.recipientsPage&&t){recipientPage+=Number(button.dataset.recipientsPage);$('#recipient-list').innerHTML=recipientTable(audience(getProject(t.project),getDraft(t)).list,getProject(t.project));return;}
  if(button.dataset.action==='reset-sample'&&resetArmed)noticeStates.clear();
  switch(button.dataset.action){
    case 'close-cloud':closeCloudDialog();break;
    case 'retry-operator-state':operatorSaveStatus='pending';operatorConflict=null;void saveOperatorState();closeCloudDialog();break;
    case 'load-operator-state':if(operatorConflict){applyOperatorState(operatorConflict);closeCloudDialog();toast('서버 운영 정보를 불러왔어요.');}break;
    case 'overwrite-operator-state':if(operatorConflict){operatorVersion=operatorConflict.version;operatorConflict=null;operatorSaveStatus='pending';operatorDirty=true;scheduleOperatorSave();closeCloudDialog();}break;
    case 'close-ticket-dialog':closeTicketDecision();break;
    case 'cloud-signout':logoutCloud();break;
    case 'retry-draft-save':if(t)saveCloudDraft(t);break;
    case 'load-cloud-draft':if(t){
      const remote=cloudState[t.id]?.remote;
      if(remote){applyCloudDraft(t,remote);render();toast('서버 초안을 불러왔어요.');}
      else toast('서버에서 이 초안을 찾지 못했어요. 내 변경 저장을 선택할 수 있어요.');
    }break;
    case 'overwrite-cloud-draft':if(t){
      const d=getDraft(t),remote=cloudState[t.id]?.remote;
      d._cloudVersion=remote?.version||0;
      setCloudState(t,'pending',{remote:null});scheduleCloudSave(t,true);
    }break;
    case 'add-resource-link':if(t){
      const label=$('#resource-label').value.trim(),raw=$('#resource-url').value.trim();let url;
      try {url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}
      catch {toast('HTTPS 링크 주소를 확인해주세요.');break;}
      const d=getDraft(t);
      if(!label){toast('링크 이름을 입력해주세요.');break;}
      if(d.resources.length>=20){toast('자료는 20개까지 추가할 수 있어요.');break;}
      d.resources.push({kind:'link',id:crypto.randomUUID(),label,url:url.href});
      d.body=`${d.body.trimEnd()}\n\n${label}: ${url.href}`;
      d.confirmed=false;render();updateApproval(t);toast('링크를 본문과 자료 목록에 추가했어요.');
    }break;
    case 'select-visible-members':document.querySelectorAll('[data-member-row]:not([hidden]) [data-target-member]').forEach(input=>input.checked=true);refreshMemberPicker();break;
    case 'clear-visible-members':document.querySelectorAll('[data-member-row]:not([hidden]) [data-target-member]').forEach(input=>input.checked=false);refreshMemberPicker();break;
    case 'sync-sheet':void syncSheetSource();break;
    case 'reset-sample':if(!requireOperator())break;if(!resetArmed){resetArmed=true;render();break;}resetArmed=false;EMPLOYEES=structuredClone(INITIAL_EMPLOYEES);sheetSync=null;sheetSyncError='';PROJECTS=structuredClone(INITIAL_PROJECTS);applications=structuredClone(INITIAL_APPLICATIONS);applicationEvents=[];records=structuredClone(INITIAL_RECORDS);TICKETS=structuredClone(INITIAL_TICKETS);completed={};drafts={};calendar={year:Number(TODAY_KST.slice(0,4)),month:Number(TODAY_KST.slice(5,7))-1,selected:TODAY_KST,view:'calendar'};persist();render();toast('예시 데이터로 초기화했어요.');break;
    case 'calendar-today':calendar={year:Number(TODAY_KST.slice(0,4)),month:Number(TODAY_KST.slice(5,7))-1,selected:TODAY_KST,view:'calendar'};refreshCalendar();break;
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
    case 'generate-notice':if(t)void generateNoticeDraft(t);break;
    case 'accept-notice':if(t){
      const d=getDraft(t),candidate=noticeStates.get(t.id)?.candidate;
      if(!acceptNoticeCandidate(d,candidate,noticeContext(t).signature)){toast('작성 기준이 변경됐어요. 초안을 다시 생성해주세요.');break;}
      noticeStates.delete(t.id);$('#draft-body').value=d.body;updateApproval(t);toast('새 초안을 적용했어요. 내용을 확인한 뒤 승인해주세요.');
    }break;
    case 'discard-notice':if(t){noticeStates.delete(t.id);refreshNoticeCandidate(t);}break;
  }
});
document.addEventListener('change',async event=>{
  const r=route(),el=event.target;
  if(el.id==='history-project'){historyFilter=el.value;render();$('#history-project').focus();return;}
  if(el.id==='roster-filter'){rosterFilter=el.value;filterRoster();return;}
  if(el.id==='preview-ack'){$('[data-action="confirm-preview"]').disabled=!el.checked;return;}
  if(r.view==='edit-project'){
    if(el.id==='member-team'||el.matches('[data-target-member], [data-required-member]'))refreshMemberPicker();
    return;
  }
  if(r.view!=='review')return;const t=getTicket(r.id),d=getDraft(t);
  if(el.id==='resource-file'){const file=el.files?.[0];if(!file)return;if(d.resources.length>=20){toast('자료는 20개까지 추가할 수 있어요.');return;}await uploadNoticeFile(t,file);return;}
  if(el.id==='draft-tone'||el.id==='notice-purpose'){d[el.id==='draft-tone'?'tone':'purpose']=el.value;d.confirmed=false;updateApproval(t);void generateNoticeDraft(t);return;}
  if(el.dataset.briefInclude){d.brief[el.dataset.briefInclude].included=el.checked;d.briefStale=true;d.confirmed=false;updateApproval(t);return;}
  if(el.id==='audience-scope')d.scope=el.value;
  else if(el.id==='all-teams')d.teams=el.checked?TEAMS.map(t=>t.id):[];
  else if(el.dataset.team)d.teams=Array.from(document.querySelectorAll('[data-team]:checked')).map(input=>input.dataset.team);
  else if(el.dataset.individual){const id=Number(el.dataset.individual);d.selectedIds=el.checked?[...new Set([...d.selectedIds,id])]:d.selectedIds.filter(item=>item!==id);}
  else return;
  d.confirmed=false;recipientPage=0;updateRecipients(t);
});
document.addEventListener('input',event=>{
  if(event.target.id==='roster-search'){rosterSearch=event.target.value;filterRoster();return;}
  if(event.target.id==='member-search'){refreshMemberPicker();return;}
  if(event.target.id==='recipient-search'){recipientSearch=event.target.value;filterRecipientRows();return;}
  if(event.target.id==='draft-body'){const r=route();if(r.view!=='review')return;const t=getTicket(r.id),d=getDraft(t);d.body=event.target.value;d.confirmed=false;updateApproval(t);}
  if(event.target.dataset.briefField){const r=route();if(r.view!=='review')return;const t=getTicket(r.id),d=getDraft(t),key=event.target.dataset.briefField,item=d.brief[key];item.value=event.target.value;item.source='담당자 수정';item.status=item.value.trim()?'confirmed':'missing';item.evidence=[];const field=event.target.closest('.notice-card-field'),badge=field.querySelector(`[data-brief-status="${key}"]`);badge.textContent=item.status==='confirmed'?'확인됨':'내용 없음';badge.className=`tag ${item.status==='confirmed'?'green':'orange'}`;field.querySelector(`[data-brief-source="${key}"]`).textContent=item.source;field.querySelector('.brief-evidence')?.remove();field.querySelector('[data-brief-confirm]')?.remove();d.briefStale=true;d.confirmed=false;updateApproval(t);}
});
document.addEventListener('submit',event=>{if(event.target.id==='cloud-login-form')loginCloud(event);if(event.target.id==='history-form')saveHistoryForm(event);if(event.target.id==='new-history-form')saveNewHistoryForm(event);if(event.target.id==='project-form')saveProjectForm(event);if(event.target.id==='cancel-form')saveCancelForm(event);if(event.target.id==='ticket-decision-form')saveTicketDecision(event);});
$('#history-dialog').addEventListener('cancel',event=>{event.preventDefault();closeHistory();});
$('#cancel-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCancel();});
$('#send-preview-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSendPreview();});
$('#cloud-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCloudDialog();});
$('#ticket-dialog').addEventListener('cancel',event=>{event.preventDefault();closeTicketDecision();});
document.addEventListener('input',event=>{if(event.target.id==='cancel-reason')event.target.setCustomValidity('');});
document.addEventListener('keydown',event=>{
  const tab=event.target.closest('[role=tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();activeTab=event.key==='Home'?'tickets':event.key==='End'?'history':activeTab==='tickets'?'history':'tickets';render();$(`#${activeTab==='tickets'?'tickets-tab':'sent-tab'}`).focus();
});
let previousRoute=route();
window.addEventListener('hashchange',()=>{
  if(previousRoute.view==='review'){
    const previousDraft=drafts[previousRoute.id];
    if(previousDraft){previousDraft.confirmed=false;previousDraft.confirmedSignature='';}
  }
  previousRoute=route();
  if($('#history-dialog').open)closeHistory();if($('#cancel-dialog').open)closeCancel();if($('#send-preview-dialog').open)closeSendPreview();activeTab='tickets';rosterSearch='';rosterFilter='all';recipientPage=0;recipientSearch='';resetArmed=false;projectFormError='';appliedDocumentName='';appliedFieldReviews={};appliedSourceIssues=null;
  render();window.scrollTo({top:0,behavior:'instant'});$('#content').focus({preventScroll:true});
});
window.addEventListener('focus',()=>{void refreshOperatorState().then(()=>refreshAutomatedSheetState()).catch(()=>{});const r=route();if(r.view==='review')refreshCloudDraft(getTicket(r.id));});
setInterval(()=>{if(cloudUser&&!operatorDirty&&route().view!=='edit-project')void refreshAutomatedSheetState().catch(error=>{sheetSyncError=error.message;});},5*60*1000);
restore();render();initializeCloud();void initializeSheetSource();
