import { ANALYSIS_LIMITS as limits, ANALYSIS_FIELDS, applicableValue } from './analysis-contract.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display = value => ({immediate:'신청 즉시 확정',separate:'별도 확인·승인·선정 후 확정'}[value] || (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value) ? value.replaceAll('-','.').replace('T',' · ') : value));
const statuses = { found:'정리 완료', conflict:'선택 필요', missing:'자료에 없음', review:'확인 필요' };

export function mountDocumentImport(root, { getValue, apply, loggedIn, login, saved=[] }) {
  let files = [], result = null, busy = false, version = 0, disposed = false, controller, progressTimer;
  root.innerHTML = `<div class="document-heading"><div><p class="eyebrow">자료 → 공지 준비</p><h2>공지에 쓸 핵심 정보만 정리하세요</h2></div></div>
    <p class="help">여러 문서의 대상, 일정, 신청 방법을 짧게 정리합니다. 내용을 검토한 뒤 운영 정보에 반영하세요.</p>
    <details id="document-inputs" open><summary>자료 선택 · 변경</summary>
    <div class="document-upload"><label for="document-files">분석할 자료 추가</label><input id="document-files" type="file" multiple accept=".pdf,.docx,.txt,.md"><p class="caption muted">PDF · Word(DOCX) · TXT · MD / 최대 6개, 개별 2MB · 전체 2.8MB</p></div>
    <div id="document-file-list"></div>
    <details class="document-extra"><summary>메모 추가 · 스캔 설정</summary><div class="field"><label for="document-text">함께 참고할 내용</label><textarea id="document-text" class="short-textarea" maxlength="80000" placeholder="메일이나 메모의 내용을 붙여넣으세요."></textarea></div>
    <label class="ocr-choice"><input id="document-ocr" type="checkbox"> 모든 PDF 페이지를 이미지로 다시 읽기</label>
    <p class="caption muted">스캔은 자동 인식합니다. 위 옵션은 이미지 속 정보가 누락될 때만 켜세요. OCR 단계가 추가되어 시간이 더 걸립니다. PDF당 30쪽 · OCR 전체 8쪽까지.</p></details>
    <p class="document-disclosure">분석 시 텍스트·스캔 이미지가 Google Gemma로 전송됩니다. 원본은 서버에 보관하지 않고 공지에 자동 첨부하지 않습니다.</p></details>
    <div class="actions"><button type="button" class="button primary" data-doc="analyze">자료 분석하기</button><button type="button" class="button" data-doc="cancel" hidden>분석 취소</button></div>
    <p id="document-status" role="status" aria-live="polite"></p><p id="document-error" class="error-message" role="alert" hidden></p>
    <div id="document-results"></div>
    ${saved.length ? `<details class="source-history"><summary>이전에 적용한 정보의 근거 ${saved.length}개</summary>${saved.map(row => `<p><strong>${escape(ANALYSIS_FIELDS[row.field] || row.field)}</strong>: ${escape(display(row.appliedValue))}${row.manuallyEdited?' · 적용 후 수정됨':''}</p>${(row.evidence||[]).map(e=>`<blockquote>${escape(e.sourceName)} · ${escape(e.location)}<br>${escape(e.quote)}</blockquote>`).join('')}`).join('')}</details>` : ''}`;
  const $ = selector => root.querySelector(selector);
  const error = message => { $('#document-error').textContent = message; $('#document-error').hidden = !message; };
  function setBusy(value) {
    if (!value) clearInterval(progressTimer);
    busy = value; root.setAttribute('aria-busy',String(value));
    $('[data-doc="analyze"]').disabled = value;
    $('[data-doc="analyze"]').textContent = value ? '자료 분석 중…' : '자료 분석하기';
    $('[data-doc="cancel"]').hidden = !value;
    $('#document-files').disabled = value; $('#document-text').disabled = value; $('#document-ocr').disabled = value;
    root.querySelectorAll('[data-doc="remove"]').forEach(button => button.disabled = value);
  }
  function invalidate() { version++; result = null; $('#document-results').replaceChildren(); $('#document-status').textContent = '자료를 선택했습니다. 공지용 핵심 정보를 정리할 수 있습니다.'; error(''); }
  function showFiles() {
    $('#document-file-list').innerHTML = files.map((file, index) => `<div class="document-file"><span><strong>${escape(file.name)}</strong><small>${(file.size/1000).toFixed(1)} KB · 선택됨</small></span><button type="button" class="button compact" data-doc="remove" data-index="${index}" aria-label="${escape(file.name)} 제외">제외</button></div>`).join('');
  }
  function optionEditor(row,option,index) {
    const id='analysis-edit-'+row.field+'-'+index;
    const attrs='id="'+id+'" aria-label="'+escape(row.label)+' 수정"';
    const value=escape(option.applyValue ?? option.value);
    const control=row.field==='confirmationMode'
      ? '<select '+attrs+'><option value="">확인 후 선택</option><option value="immediate" '+(option.applyValue==='immediate'?'selected':'')+'>신청 즉시 확정</option><option value="separate" '+(option.applyValue==='separate'?'selected':'')+'>별도 확인 후 확정</option></select>'
      : ['description','requirements','audience'].includes(row.field)
        ? '<textarea '+attrs+' maxlength="2000" rows="4">'+value+'</textarea>'
        : '<input '+attrs+' value="'+value+'" maxlength="2000">';
    return '<div class="analysis-edit"><label for="'+id+'">'+escape(row.label)+' 수정</label>'+control+
      (option.applyValue===null?'<p class="help">날짜는 YYYY-MM-DD, 마감은 YYYY-MM-DDTHH:mm 형식으로 확인해주세요.</p>':'')+
      '<details><summary>원문 근거 '+option.evidence.length+'개</summary>'+option.evidence.map(e=>'<blockquote><cite>'+escape(e.sourceName)+' · '+escape(e.location)+(e.method==='ocr'?' · OCR':'')+'</cite>'+escape(e.quote)+'</blockquote>').join('')+'</details></div>';
  }
  function resultRow(row) {
    const current=String(getValue(row.field)||'');
    const review=row.status!=='found'||row.options.some(o=>o.applyValue===null);
    return '<article class="brief-row '+(review?'needs-review':'')+'"><div class="brief-label">'+escape(row.label)+(review?' <span class="tag orange">'+statuses[row.status]+'</span>':'')+'</div><div class="brief-body">'+
      (row.note?'<p class="help">'+escape(row.note)+'</p>':'')+
      (row.options.length>1?'<label class="analysis-keep"><input type="radio" name="analysis-'+row.field+'" value="" checked>이번에는 반영하지 않음</label>':'')+
      row.options.map((option,index)=>{
        const selected=!review&&row.options.length===1&&(!current||current===option.applyValue);
        return '<div class="brief-option"><label class="brief-value"><input type="'+(row.options.length===1?'checkbox':'radio')+'" name="analysis-'+row.field+'" value="'+index+'" '+(selected?'checked':'')+'><span>'+(row.options.length>1?'후보 '+(index+1)+' 사용':'이 정보 반영')+'</span></label>'+
          (current&&current!==option.applyValue?'<p class="brief-current">현재 값: '+escape(display(current))+'</p>':'')+optionEditor(row,option,index)+'</div>';
      }).join('')+'</div></article>';
  }
  function showResult() {
    const available=result.fields.filter(row=>row.options.length);
    const missing=result.fields.filter(row=>!row.options.length);
    const review=available.filter(row=>row.status!=='found'||row.options.some(o=>o.applyValue===null));
    const order=['name','description','audience','deadlineAt','event','requirements','applicationUrl','owner','location','start','confirmationMode','capacity','type'];
    const sorted=[...available].sort((a,b)=>order.indexOf(a.field)-order.indexOf(b.field));
    $('#document-inputs').open=false;
    $('#document-inputs').querySelector('summary').textContent='자료 '+result.sources.length+'개 · 변경하기';
    $('#document-status').textContent='정리 완료 · '+Math.round((result.durationMs||0)/1000)+'초'+(result.ocrPages?' · OCR '+result.ocrPages+'쪽':'');
    $('#document-results').innerHTML='<div class="analysis-summary"><div><p class="eyebrow">공지 준비 노트</p><h3>핵심 정보가 준비됐어요</h3></div><span class="tag green">'+available.length+'개 항목</span></div>'+
      '<p class="brief-intro">카드에서 값을 바로 수정하세요. 반영할 항목만 선택하면 됩니다.</p>'+
      (review.length?'<div class="brief-attention"><strong>확인할 정보 '+review.length+'개</strong><span>'+review.map(row=>escape(row.label)).join(' · ')+'</span></div>':'')+
      (result.ocrPages?'<p class="analysis-warning">스캔 인식 '+result.ocrPages+'쪽 포함 · 날짜와 링크를 원본과 대조하세요.</p>':'')+
      '<div class="brief-fields">'+sorted.map(resultRow).join('')+'</div>'+
      (missing.length?'<p class="brief-missing"><strong>자료에서 확인하지 못했어요</strong> '+missing.map(row=>escape(row.label)+(row.status==='review'?' (근거 확인 필요)':'')).join(' · ')+'</p>':'')+
      '<div class="brief-actions"><p>체크된 정보만 반영합니다.<br>자료가 다른 항목은 직접 선택해주세요.</p><button type="button" class="button primary" data-doc="apply">검토한 정보 반영</button></div>'+
      '<details class="analysis-sources"><summary>원문 '+result.sources.length+'개 확인</summary>'+result.warnings.map(w=>'<p class="help">'+escape(w)+'</p>').join('')+result.sources.map(source=>'<details><summary>'+escape(source.name)+(source.ocr?' · OCR 포함':'')+'</summary>'+source.segments.map(segment=>'<p class="caption muted">'+escape(segment.location)+'</p><pre>'+escape(segment.text)+'</pre>').join('')+'</details>').join('')+'</details>';
    $('#document-results').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function analyze() {
    if (busy) return;
    if (!loggedIn()) { error('자료를 분석하려면 저장 설정에서 로그인해주세요.'); login(); return; }
    const text = $('#document-text').value;
    if (!files.length && !text.trim()) { error('파일을 선택하거나 내용을 붙여넣어 주세요.'); return; }
    const token = ++version; result = null; $('#document-results').replaceChildren(); error(''); setBusy(true);
    const started=Date.now();
    const progress=()=>{ $('#document-status').textContent=`공지용 핵심 정보를 정리하고 있어요 · ${Math.floor((Date.now()-started)/1000)}초 경과${$('#document-ocr').checked?' · 전체 PDF 이미지 인식 포함':''}${Date.now()-started>25000?' · 스캔 인식이나 AI 응답 지연으로 더 걸릴 수 있어요.':''}`; };
    progress(); progressTimer=setInterval(progress,1000);
    controller = new AbortController(); const timer = setTimeout(()=>controller?.abort(),155_000);
    try {
      const encoded = [];
      for (const file of files) {
        const buffer = new Uint8Array(await file.arrayBuffer()); let binary = '';
        for (let i=0;i<buffer.length;i+=16000) binary += String.fromCharCode(...buffer.subarray(i,i+16000));
        encoded.push({name:file.name,data:btoa(binary)});
      }
      const response = await fetch('/api/documents/analyze',{ method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({files:encoded,text,forceOcr:$('#document-ocr').checked}) });
      const payload = await response.json().catch(()=>({error:'서버 응답을 읽지 못했습니다.'}));
      if (!response.ok) throw new Error(payload.error || '자료 분석에 실패했습니다.');
      if (disposed || token !== version) return;
      clearInterval(progressTimer); result = payload; showResult();
    } catch (cause) {
      if (!disposed && token === version) { $('#document-status').textContent = '분석을 완료하지 못했습니다. 선택한 자료는 유지됩니다.'; error(cause.name==='AbortError'?'응답 대기 시간이 지났습니다. 잠시 후 다시 시도해주세요.':cause.message); }
    } finally { clearTimeout(timer); if (!disposed && token === version) setBusy(false); }
  }
  root.addEventListener('change',event => {
    if (event.target.id==='document-files') {
      const next = [...files];
      for (const file of event.target.files) if (!next.some(old=>old.name===file.name&&old.size===file.size&&old.lastModified===file.lastModified)) next.push(file);
      event.target.value = '';
      if (next.length>limits.files || next.some(file=>file.size>limits.fileBytes || !file.size || !/\.(pdf|docx|txt|md)$/i.test(file.name)) || next.reduce((sum,file)=>sum+file.size,0)>limits.totalBytes) { error('PDF·DOCX·TXT·MD 최대 6개, 개별 2MB·전체 2.8MB 안에서 선택해주세요. 빈 파일은 사용할 수 없습니다.'); return; }
      files=next; invalidate(); showFiles();
    } else if (event.target.id==='document-ocr') invalidate();
  });
  root.addEventListener('input',event=>{
    if(event.target.id==='document-text')invalidate();
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-doc]'); if(!button)return;
    if (button.dataset.doc==='analyze') void analyze();
    if (button.dataset.doc==='remove'&&!busy) { files.splice(Number(button.dataset.index),1);invalidate();showFiles(); }
    if (button.dataset.doc==='cancel') { version++;controller?.abort();setBusy(false);$('#document-status').textContent='분석 대기를 취소했습니다. 이미 시작된 서버 처리는 잠시 계속될 수 있습니다.'; }
    if (button.dataset.doc==='apply'&&result) {
      const selected=[];
      for (const row of result.fields) {
        const choice=root.querySelector(`input[name="analysis-${row.field}"]:checked`);
        if (!choice || choice.value==='') continue;
        const option=row.options[Number(choice.value)], input=root.querySelector(`#analysis-edit-${row.field}-${choice.value}`);
        const value=applicableValue(row.field,input.value);
        if (value===null) { error(`${row.label}: 적용할 값의 형식 또는 누락된 정보를 확인해주세요.`);input.focus();return; }
        selected.push({ field:row.field,appliedValue:value,originalValue:option.value,manuallyEdited:value!==option.applyValue,evidence:option.evidence,analysisId:result.id,analyzedAt:result.analyzedAt,appliedAt:new Date().toISOString(),model:result.model });
      }
      if (!selected.length) { error('적용할 후보를 먼저 선택해주세요.');return; }
      apply(selected); error(''); $('#document-status').textContent=`${selected.length}개 항목을 채웠습니다. 아래 운영 정보를 확인하고 프로젝트를 저장하세요.`;
    }
  });
  return () => { disposed=true;version++;clearInterval(progressTimer);controller?.abort(); };
}
