import { ANALYSIS_LIMITS as limits, ANALYSIS_FIELDS, applicableValue } from './analysis-contract.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display = value => ({immediate:'신청 즉시 확정',separate:'별도 확인·승인·선정 후 확정'}[value] || value);
const statuses = { found:'후보 찾음', conflict:'서로 다른 정보', missing:'자료에 없음', review:'근거 확인 필요' };

export function mountDocumentImport(root, { getValue, apply, loggedIn, login, saved=[] }) {
  let files = [], result = null, busy = false, version = 0, disposed = false, controller;
  root.innerHTML = `<div class="document-heading"><div><h3>기획서에서 운영 정보 가져오기</h3></div></div>
    <p class="help">자료에서 일정·대상·신청 방법을 찾습니다. 분석 결과를 확인한 뒤 적용해주세요.</p>
    <div class="document-upload"><label for="document-files">분석할 자료 추가</label><input id="document-files" type="file" multiple accept=".pdf,.docx,.txt,.md"><p class="caption muted">PDF · Word(DOCX) · TXT · MD / 최대 6개, 개별 2MB · 전체 2.8MB</p></div>
    <div id="document-file-list"></div>
    <div class="field"><label for="document-text">함께 참고할 내용 <span class="muted">선택</span></label><textarea id="document-text" class="short-textarea" maxlength="80000" placeholder="메일이나 메모의 내용을 붙여넣으세요."></textarea></div>
    <label class="ocr-choice"><input id="document-ocr" type="checkbox"> PDF 전체를 이미지로 읽기 <span class="muted">작은 글자·이미지 속 정보가 있을 때</span></label>
    <p class="caption muted">스캔 페이지는 자동으로 OCR 처리합니다. PDF 파일당 30쪽, OCR은 전체 8쪽까지 지원합니다.</p>
    <p class="document-disclosure">분석할 때 자료의 텍스트와 OCR 대상 페이지 이미지가 Google Gemma로 전송됩니다. 업로드 원본은 서버에 보관하지 않으며, 분석용 자료는 공지에 자동 첨부되지 않습니다.</p>
    <div class="actions"><button type="button" class="button primary" data-doc="analyze">자료 분석하기</button><button type="button" class="button" data-doc="cancel" hidden>분석 취소</button></div>
    <p id="document-status" role="status" aria-live="polite"></p><p id="document-error" class="error-message" role="alert" hidden></p>
    <div id="document-results"></div>
    ${saved.length ? `<details class="source-history"><summary>이전에 적용한 정보의 근거 ${saved.length}개</summary>${saved.map(row => `<p><strong>${escape(ANALYSIS_FIELDS[row.field] || row.field)}</strong>: ${escape(display(row.appliedValue))}${row.manuallyEdited?' · 적용 후 수정됨':''}</p>${(row.evidence||[]).map(e=>`<blockquote>${escape(e.sourceName)} · ${escape(e.location)}<br>${escape(e.quote)}</blockquote>`).join('')}`).join('')}</details>` : ''}`;
  const $ = selector => root.querySelector(selector);
  const error = message => { $('#document-error').textContent = message; $('#document-error').hidden = !message; };
  function setBusy(value) {
    busy = value; root.setAttribute('aria-busy',String(value));
    $('[data-doc="analyze"]').disabled = value;
    $('[data-doc="analyze"]').textContent = value ? '자료 분석 중…' : '자료 분석하기';
    $('[data-doc="cancel"]').hidden = !value;
    $('#document-files').disabled = value; $('#document-text').disabled = value; $('#document-ocr').disabled = value;
    root.querySelectorAll('[data-doc="remove"]').forEach(button => button.disabled = value);
  }
  function invalidate() { version++; result = null; $('#document-results').replaceChildren(); $('#document-status').textContent = '자료가 변경됐습니다. 분석하면 새 내용이 반영됩니다.'; error(''); }
  function showFiles() {
    $('#document-file-list').innerHTML = files.map((file, index) => `<div class="document-file"><span><strong>${escape(file.name)}</strong><small>${(file.size/1000).toFixed(1)} KB · 선택됨</small></span><button type="button" class="button compact" data-doc="remove" data-index="${index}" aria-label="${escape(file.name)} 제외">제외</button></div>`).join('');
  }
  function showResult() {
    const conflicts = result.fields.filter(row=>row.status==='conflict').length;
    const missing = result.fields.filter(row=>row.status==='missing').length;
    $('#document-status').textContent = `분석 완료 · 자료 ${result.sources.length}개 · 서로 다른 정보 ${conflicts}개 · 자료에 없는 항목 ${missing}개`;
    $('#document-results').innerHTML = `<div class="analysis-summary"><h3>공지에 필요한 핵심 정보</h3><p>항목별로 사용할 후보를 선택하세요. 현재 입력값과 비교한 뒤 적용합니다. 날짜·시각이 불완전하면 확인 후 값을 수정하세요.</p></div>
      ${result.warnings.map(message=>`<p class="help analysis-warning">${escape(message)}</p>`).join('')}
      <div class="analysis-fields">${result.fields.map(row => `<fieldset class="analysis-field ${row.status==='conflict'?'has-conflict':''}"><legend>${escape(row.label)} <span class="tag ${row.status==='conflict'?'orange':'gray'}">${statuses[row.status]}</span></legend>
        <p class="caption muted">현재 입력: ${escape(display(getValue(row.field)) || '비어 있음')}</p>
        ${row.note?`<p class="help">${escape(row.note)}</p>`:''}
        ${row.options.length ? `<label class="analysis-keep"><input type="radio" name="analysis-${row.field}" value="" checked> 현재 값 유지 · 이번에 적용하지 않음</label>${row.options.map((option,index)=>`<div class="analysis-option"><label><input type="radio" name="analysis-${row.field}" value="${index}"><strong>${escape(display(option.value))}</strong></label><label class="caption" for="analysis-edit-${row.field}-${index}">적용할 값${row.field==='deadlineAt'?' (YYYY-MM-DDTHH:mm)': ['start','event'].includes(row.field)?' (YYYY-MM-DD)':''}</label>${row.field==='confirmationMode'?`<select id="analysis-edit-${row.field}-${index}" aria-label="${escape(row.label)} 후보 ${index+1} 적용할 값"><option value="">확인 후 선택</option><option value="immediate" ${option.applyValue==='immediate'?'selected':''}>신청 즉시 확정</option><option value="separate" ${option.applyValue==='separate'?'selected':''}>별도 확인·승인·선정 후 확정</option></select>`:`<input id="analysis-edit-${row.field}-${index}" data-option-field="${row.field}" data-option-index="${index}" value="${escape(option.applyValue ?? option.value)}" maxlength="2000" aria-label="${escape(row.label)} 후보 ${index+1} 적용할 값">`}
          ${option.applyValue===null?'<p class="help">형식 또는 누락된 정보를 확인하고 적용할 값을 수정해주세요.</p>':''}
          ${option.evidence.map(e=>`<details><summary>${escape(e.sourceName)} · ${escape(e.location)}${e.method==='ocr'?' · OCR':''}</summary><blockquote>${escape(e.quote)}</blockquote></details>`).join('')}</div>`).join('')}` : '<p class="help">이 자료에서 확인하지 못했습니다. 아래 운영 정보에서 직접 입력하세요.</p>'}
      </fieldset>`).join('')}</div>
      <div class="actions"><button type="button" class="button primary" data-doc="apply">선택한 정보 적용</button></div>
      <details class="analysis-sources"><summary>자료별로 읽은 내용 확인</summary>${result.sources.map(source=>`<details><summary>${escape(source.name)}${source.ocr?' · OCR 포함':''}</summary>${source.segments.map(segment=>`<p class="caption muted">${escape(segment.location)}${segment.method==='ocr'?' · OCR':''}</p><pre>${escape(segment.text)}</pre>`).join('')}</details>`).join('')}</details>`;
  }
  async function analyze() {
    if (busy) return;
    if (!loggedIn()) { error('자료를 분석하려면 저장 설정에서 로그인해주세요.'); login(); return; }
    const text = $('#document-text').value;
    if (!files.length && !text.trim()) { error('파일을 선택하거나 내용을 붙여넣어 주세요.'); return; }
    const token = ++version; result = null; $('#document-results').replaceChildren(); error(''); setBusy(true);
    $('#document-status').textContent = '자료를 읽고 있습니다. 스캔 페이지는 OCR 후 분석하므로 시간이 더 걸릴 수 있습니다.';
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
      result = payload; showResult();
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
  root.addEventListener('input',event=>{if(event.target.id==='document-text')invalidate();});
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
  return () => { disposed=true;version++;controller?.abort(); };
}
