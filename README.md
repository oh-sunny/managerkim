# 사내 행사·복리후생 운영 AI 에이전트

행사·복지의 **신청 현황·일정·이전 안내를 연결해 누구에게 언제 무엇을 안내할지 결정하고 실행하는 도구**입니다. 운영 정보를 등록하고 신청 현황을 확인한 뒤, 안내 초안과 대상을 검토해 팀별 개별 DM 또는 지정 Slack 채널로 안내하는 흐름을 목표로 합니다.

## 현재 프로토타입

HTML·CSS·JavaScript와 Node.js 정적 서버로 실행합니다. 현재 가능한 동작은 다음과 같습니다.

- 프로젝트 등록·수정, 이름·팀 검색을 통한 대상·필수 동료 선택
- 로컬 신청·취소·확정 상태 변경과 현황·DM 대상 재계산
- 홈·프로젝트별 티켓·캘린더 확인
- 안내 초안 수정, 팀별 DM 대상 또는 채널 선택, 모의 발송
- 보내기 전 초안·대상 선택의 브라우저 저장·복원. 발송 확인 체크는 복원하지 않음
- 안내 원문·Slack 링크 기록과 브라우저 저장·복원
- `.txt`·`.md` 기획서 또는 붙여넣은 텍스트에서 명시적 항목 후보를 찾아 검토 후 적용

동료 명단과 화면의 기존 티켓은 예시 데이터이며, 티켓·캘린더의 예시 기준일은 2026년 10월 3일입니다. 별도 모듈에 규칙 기반 티켓 평가기와 Google Sheets 이력 조회·정규화 기능을 구현했지만, 화면과 실제 시트 인증에는 아직 연결하지 않았습니다. Slack 연결, 프로젝트·발송 이력의 서버 저장·주기 실행, PDF·Word·AI 문서 해석도 남아 있습니다. 메시지는 실제로 보내지 않습니다.

## 로컬 실행

Node.js 20 이상이 필요합니다. 추가 패키지 설치 없이, 이 README와 `package.json`이 있는 저장소 루트에서 실행합니다.

```powershell
npm run dev
```

[프로토타입 열기](http://localhost:3000). 종료하려면 실행 중인 터미널에서 Ctrl+C를 누릅니다. 다른 포트가 필요하면 다음처럼 실행합니다.

```powershell
$env:PORT = '3001'
npm run dev
```

계산과 텍스트 추출의 자동 검증은 `npm test`로 실행합니다.

운영 정보·신청 상태·안내 기록·모의 발송 결과는 브라우저의 로컬 저장소에 보관합니다. 초안은 복원하지만 발송 확인 체크는 저장하지 않습니다. 새로고침 뒤 보내려면 최종 확인 창을 다시 거쳐야 합니다. 브라우저·기기·접속 포트가 바뀌거나 사이트 데이터를 지우면 공유되지 않습니다. Slack 링크는 직접 붙여넣어 기록합니다.

## Supabase 초안·파일 저장 설정

1. [`.env.example`](.env.example)을 참고해 Git에서 제외되는 `.env`에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 입력합니다. secret/service role 키는 넣지 않습니다.
2. 현재 연결된 Supabase 프로젝트에는 [`supabase/migrations/20261006015431_notice_drafts_and_resources.sql`](supabase/migrations/20261006015431_notice_drafts_and_resources.sql)이 2026-10-06 적용됐습니다. 다른 Supabase 프로젝트를 연결할 때는 해당 프로젝트에도 이 마이그레이션을 적용해야 합니다.
3. Supabase Authentication에 운영자 계정을 준비하고 `npm run dev`로 서버를 다시 시작합니다. 상단 **Supabase 로그인**에서 그 계정으로 로그인합니다.

로그인 후 안내 초안의 본문·대상 선택·링크는 `notice_drafts`에 자동 저장되며 저장 상태와 버전 충돌을 화면에 표시합니다. 첨부 파일은 비공개 `notice-files` 버킷과 `notice_resources`에 저장됩니다. 모의 발송 시 선택한 자료 정보는 브라우저의 보낸 안내 기록에 남습니다. 실제 Slack 파일 전송, 서버 발송 기록, 프로젝트·신청 상태의 서버 저장은 후속 작업입니다.

## Vercel 배포

이 저장소는 [`vercel.json`](vercel.json)에서 정적 화면을 `prototype/`에서 제공하고, `/api/*` 요청을 [`api/index.js`](api/index.js) 함수로 연결합니다. 로컬 Node 서버를 Vercel에서 실행하지 않습니다.

1. 이 저장소의 배포할 변경을 Git에 커밋하고 GitHub `main`에 푸시합니다. 로컬 `.env`는 Git에 포함하지 않습니다.
2. Vercel에서 **Add New → Project**로 GitHub 저장소를 가져옵니다. Root Directory는 저장소 루트로 둡니다. `vercel.json`의 **Framework Preset: Other**, **Output Directory: prototype** 설정을 사용하고 별도 Build Command는 지정하지 않습니다.
3. Supabase를 사용할 경우 Vercel 프로젝트의 **Settings → Environment Variables**에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 Preview와 Production 환경용으로 입력합니다. 운영자 Auth 계정으로 로그인할 수 있어야 합니다. 환경 변수 변경 후 새 배포를 생성합니다.
4. Preview 배포에서 화면과 `/api/status`를 확인합니다. Supabase 설정을 했다면 `{ "configured": true }`가 나와야 합니다. 로그인, 초안 저장, 파일 업로드도 확인한 뒤 Production에 배포합니다.

Vercel 함수의 요청·응답 크기 제한에 맞춰 첨부 파일은 4MB 이하입니다. 프로젝트·신청 상태·보낸 기록은 브라우저 `localStorage`에 남으므로 기기 간 공유되지 않습니다. 현재 화면 전체에 운영자 로그인 장벽은 없으므로 실제 사내 자료를 넣기 전에 사이트 접근 범위를 설정해야 합니다.

## 문서

- [PRD 제품 요구사항](docs/PRD.md): 제품의 목적·범위·확정 정책·성공 기준과 미결정 사항
- [PLAN 구현 계획](docs/PLAN.md): 단계별 작업·완료 기준·진행 상태와 다음 작업. 구현을 시작할 때 먼저 확인합니다.
- [SPEC 현재 구현 명세](spec/spec_001.md): 실제 동작·한계와 기능별 구현 차이
- [SPEC 002 기획서 입력·안내 준비](spec/spec_002.md): 문서에서 운영 정보 후보 추출, 필수 대상 빠른 선택, 안내 자료·초안 저장의 추가 요구사항
- [공개 업무 조사](docs/research_001.md): 공개 사례·출처와 조사 당시의 제품 제안
- [데이터 흐름과 저장 구조](docs/data-architecture.md): 파일·텍스트 입력, 분석 후보, 확정 정보, 공지 초안과 신청/안내 이력을 Supabase·API에 연결하는 설계 초안
- [공지 초안 톤 가이드](docs/references/tone-guide.md): 말투 작성 기준과 [공개 레퍼런스](docs/references/daangn-tone-references.csv). 현재 앱에서 읽는 데이터가 아닌 작성 참고 자료입니다.
- [이전 와이어프레임](docs/archive/source.html): 초기 화면 흐름 보관 자료. 현재 실행 화면은 `prototype/`에 있습니다.

## 저장소 구성

```text
저장소 루트/
├─ .gitignore
├─ .gitattributes
├─ README.md
├─ package.json
├─ docs/
│  ├─ PRD.md
│  ├─ PLAN.md
│  ├─ data-architecture.md
│  ├─ research_001.md
│  ├─ references/
│  │  ├─ tone-guide.md
│  │  └─ daangn-tone-references.csv
│  └─ archive/
│     └─ source.html
├─ spec/
│  ├─ spec_001.md
│  └─ spec_002.md
├─ prototype/
│  ├─ index.html
│  ├─ styles.css
│  ├─ data.js
│  ├─ document-extract.js
│  ├─ message-templates.js
│  └─ app.js
├─ tests/
│  ├─ data.test.js
│  ├─ document-extract.test.js
│  └─ message-templates.test.js
└─ scripts/
   └─ dev-server.mjs
```

`.local-preview/`는 로컬 확인 자료를 보관하며 Git 업로드 대상에서 제외합니다.
