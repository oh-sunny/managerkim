import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetSyncResponseNotice,sheetSyncRunNotice} from '../prototype/sheet-sync-feedback.js';

test('a saved Sheet snapshot and deferred legacy first notices stay distinct in the response and run history',()=>{
  const response={status:'success',sourceStatus:'success',firstNoticeSkippedCount:3,blockedDecisions:3};
  const run={status:'success',error_code:null,source_checked_at:'2026-10-07T09:00:00Z',blocked_count:3};
  assert.match(sheetSyncResponseNotice(response),/신청 현황은 저장했어요.*3개의 첫 안내/);
  assert.match(sheetSyncRunNotice(run),/시트 자료는 저장됐어요.*3건은.*보류/);
  assert.equal(sheetSyncResponseNotice({...response,firstNoticeSkippedCount:0,blockedDecisions:0}),'');
});

test('a failed source read is not described as a saved snapshot',()=>{
  assert.match(sheetSyncRunNotice({status:'error',error_code:'sheet-read-failed',source_checked_at:null}),/동기화가 실패/);
  assert.equal(sheetSyncResponseNotice({status:'error',sourceStatus:'error'}),'');
});
