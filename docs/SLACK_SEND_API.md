# Slack 텍스트 DM 발송 API (첫 시범 범위)

이 기능은 Google Sheets에서 가져온 프로젝트의 **텍스트 DM을 한 번에 최대 10명**에게 보내는 시범 범위입니다. 11명 이상은 미리보기 단계에서 거절합니다. 전체 직원 대상 대량 발송, 채널 게시, 파일·링크 자료 첨부, 자동 재시도는 아직 구현하지 않았습니다. 화면의 기존 ‘보내기 (예시)’ 버튼은 이 API에 연결되지 않았습니다.

서버 설정은 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`, `SLACK_BOT_TOKEN`이 필요합니다. `SUPABASE_SERVICE_ROLE_KEY`와 `SLACK_BOT_TOKEN`은 서버 환경에만 두고 브라우저에 전달하지 않습니다. `supabase/migrations/20261007120000_slack_dm_delivery.sql`을 먼저 적용해야 합니다. Slack 앱에는 사용자 이메일 조회와 DM 열기·메시지 보내기에 필요한 권한이 있어야 합니다.

모든 경로는 Supabase 로그인 쿠키가 필요하며, 변경 요청은 동일 출처 JSON POST입니다. 브라우저가 보낸 본문이나 수신자 ID는 사용하지 않습니다. 버전은 `/api/drafts/{ticketId}`와 `/api/state`에서 받은 현재 값을 사용합니다.

1. `POST /api/send/preview` — `{ "draftId":"ticket-id", "draftVersion":2, "stateVersion":3 }`. 저장된 초안과 운영 상태에서 본문·수신자·`fingerprint`를 계산해 반환합니다. 이 응답을 사용자에게 그대로 보여줍니다.
2. `POST /api/send/approve` — 위 필드에 `approvalId`(새 UUID), `fingerprint`, `acknowledged:true`를 추가합니다. 서버가 내용을 다시 계산해 일치할 때만 변경 불가 승인 행을 저장합니다.
3. `POST /api/send/attempts` — `{ "approvalId":"UUID", "requestId":"UUID" }`. 서버가 저장 버전과 최신 시트 대상·신청 상태·수신자 이메일을 재확인하고, 발송 시도를 한 번만 기록한 뒤 수신자마다 Slack DM을 보냅니다. 응답에는 `status`(`full_success`, `partial`, `failed`, `unknown`)와 `results`(수신자별 `success`, `failed`, `unknown`), `sourceCheckedAt`이 들어갑니다.

같은 `requestId`로 다시 요청하면 저장된 결과를 조회하며 Slack을 재호출하지 않습니다. 하나의 확인할 일에 이미 시도가 있으면 새로운 승인·요청 ID로도 재발송하지 않습니다. 응답을 받지 못했거나 `unknown`이 있으면 자동 재전송하지 말고 Slack 및 저장 결과를 직접 확인해야 합니다. 서버가 종료된 뒤 기록되지 않은 수신자 결과는 `unknown`으로 표시됩니다.

현재 발송 경로는 운영 상태의 완료 표시를 변경하지 않습니다. UI를 연결할 때 **전체 성공 여부와 결과 목록을 표시하고**, 완료 처리는 발송 결과에 맞춰 별도로 설계해야 합니다.
