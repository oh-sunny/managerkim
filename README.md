# 사내 행사·복리후생 운영 AI 에이전트

행사·복지의 **신청 현황·일정·이전 안내를 연결해 누구에게 언제 무엇을 안내할지 결정하고 실행하는 도구**입니다. 운영 정보를 등록하고 신청 현황을 확인한 뒤, 안내 초안과 대상을 검토해 팀별 개별 DM 또는 지정 Slack 채널로 안내하는 흐름을 목표로 합니다.

## 현재 프로토타입

HTML·CSS·JavaScript와 Node.js 정적 서버로 실행합니다. 현재 가능한 동작은 다음과 같습니다.

- 프로젝트 등록·수정, 이름·팀 검색을 통한 대상·필수 동료 선택
- 신청·취소·확정 상태 변경과 현황·DM 대상 재계산
- 프로젝트·신청 이력·티켓·보낸 안내의 Supabase 저장과 변경 버전 기록
- 공식 공휴일을 반영한 규칙 티켓 생성·갱신, 보류·안내하지 않기와 사유 기록
- 수정 가능한 공지 정보 카드, 카드 기반 Gemma 초안 생성·사실 검증, 현재 본문과 새 초안 비교, 팀별 DM 대상 또는 채널 선택, 모의 발송
- 안내 초안·대상 선택의 Supabase 저장·복원. 발송 확인 체크는 복원하지 않음
- 여러 PDF·DOCX·TXT·MD와 붙여넣은 내용을 Gemma로 함께 분석하고 핵심 정보·출처·누락·충돌을 검토 후 적용
- 원문을 길게 복사하는 대신 공지 목적·대상·신청 절차를 짧게 편집하고, 근거와 수정 입력은 필요할 때 펼쳐 확인
- 스캔 PDF 자동 OCR과 PDF 전체 이미지 읽기, 적용한 정보의 근거·시각을 프로젝트와 함께 로컬 저장

동료 명단과 기존 티켓 일부는 예시 데이터입니다. 새 프로젝트는 공개 공휴일 달력을 조회한 뒤 규칙으로 티켓을 만듭니다. Google Sheets 이력 조회·정규화 모듈은 있지만 실제 시트 인증과 화면 동기화는 아직 연결되지 않았습니다. Slack 전송과 서버의 주기 실행도 아직 연결되지 않았습니다. 메시지는 실제로 보내지 않습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다. 이 README와 `package.json`이 있는 저장소 루트에서 `npm ci`로 의존성을 설치한 뒤 실행합니다.

```powershell
npm run dev
```

[프로토타입 열기](http://localhost:3000). 종료하려면 실행 중인 터미널에서 Ctrl+C를 누릅니다. 다른 포트가 필요하면 다음처럼 실행합니다.

```powershell
$env:PORT = '3001'
npm run dev
```

계산과 텍스트 추출의 자동 검증은 `npm test`로 실행합니다.

운영 정보를 바꾸려면 Supabase 운영자 로그인이 필요합니다. 프로젝트·대상 명단·신청/취소 사유·티켓·안내 기록은 계정별 `operator_states`에 저장하고 각 버전을 `operator_state_revisions`에 남깁니다. 브라우저에는 복원용 캐시가 남습니다. 여러 탭의 버전이 다르면 덮어쓰기 전에 충돌을 표시합니다. 발송 확인 체크는 저장하지 않으며, 새로고침 뒤 최종 확인을 다시 해야 합니다.

## Supabase 운영 정보·초안·파일 저장 설정

1. [`.env.example`](.env.example)을 참고해 Git에서 제외되는 `.env`에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 입력합니다. secret/service role 키는 넣지 않습니다.
2. 현재 연결된 Supabase 프로젝트에는 [`supabase/migrations/20261006015431_notice_drafts_and_resources.sql`](supabase/migrations/20261006015431_notice_drafts_and_resources.sql)과 [`supabase/migrations/20261006090000_operator_state.sql`](supabase/migrations/20261006090000_operator_state.sql)이 적용됐습니다. 다른 Supabase 프로젝트에도 두 마이그레이션을 적용해야 합니다.
3. Supabase Authentication에 운영자 계정을 준비하고 `npm run dev`로 서버를 다시 시작합니다. 상단 **Supabase 로그인**에서 그 계정으로 로그인합니다.

로그인 후 운영 정보와 안내 초안은 각각 `operator_states`, `notice_drafts`에 자동 저장되며 저장 상태와 버전 충돌을 화면에 표시합니다. 첨부 파일은 비공개 `notice-files` 버킷과 `notice_resources`에 저장됩니다. 모의 발송의 본문·대상·자료 목록도 운영 기록에 저장합니다. 계정별 저장 구조이므로 조직의 여러 운영자 계정 사이에 데이터를 공유하는 권한 모델은 아직 없습니다.

## Gemma 연결 확인

`npm install` 후 `.env`에 `GEMINI_API_KEY`와 `GEMMA_MODEL`을 설정하고 `npm run test:gemma`를 실행합니다. 이 명령은 가상 자료로 연결만 점검하며, 가상 문서 두 개만 Google API에 전달합니다. 기존 `npm test`에는 외부 API 호출이 포함되지 않습니다. 키는 출력하지 않습니다.

웹사이트에서는 **프로젝트 등록·수정 → 자료 분석 → 후보 카드에서 수정·반영 → 프로젝트 저장 → 공지 정보 카드 확인 → Gemma 초안 생성 → 현재 본문과 비교 후 선택** 순서로 사용합니다. 기존 값과 다른 정보나 충돌은 직접 선택해야 합니다. 공지 목적·말투·정보 카드·대상을 바꾸면 새 초안을 생성해 다시 비교합니다. 생성한 본문은 카드의 날짜·링크·수치와 대조하고 별도 Gemma 요청으로 근거 없는 주장도 검사합니다. Supabase 운영자 로그인이 필요하며 키는 서버에서만 사용합니다. 파일 6개, 개별 2MB·전체 2.8MB, PDF 파일당 30쪽, OCR 전체 8쪽, 추출 텍스트 8만 자까지 지원합니다. TXT·MD는 UTF-8입니다.

텍스트가 적거나 깨진 PDF 페이지는 Gemma 이미지 입력으로 자동 OCR합니다. 이미지 속 정보가 누락될 때는 ‘메모 추가 · 스캔 설정’에서 ‘모든 PDF 페이지를 이미지로 다시 읽기’를 켤 수 있으며, 추가 인식 시간이 걸립니다. OCR 페이지·판독 불가 항목은 원본과 대조해야 합니다. DOCX는 본문·표·머리말·꼬리말·주석이 아닌 각주/미주의 텍스트를 읽으며, 삽입 이미지는 OCR하지 않습니다.

분석할 자료의 본문과 OCR 대상 이미지는 Google로 전송됩니다. 원본 파일과 전체 분석은 서버·DB에 저장하지 않습니다. 적용한 값과 근거·파일 해시·분석/적용 시각은 프로젝트와 함께 Supabase에 저장합니다. 선택한 원본 파일과 아직 적용하지 않은 분석 결과는 화면 이동·새로고침으로 사라집니다.

공휴일은 키 발급 없이 [Nager.Date 공개 달력](https://github.com/nager/Nager.Date)의 한국 전국 `Public` 공휴일 목록에서 읽고 서버가 최대 6시간 캐시합니다. 정부 원천 자료는 아니며, 임시공휴일처럼 뒤늦게 지정된 날짜는 반영 시차가 있을 수 있습니다. 조회에 실패하거나 전국 공휴일 목록을 확인하지 못하면 평일로 추정해 정기 점검 티켓을 만들지 않습니다. 공휴일·주말 또는 업무시간 밖에 겹친 점검은 이전 업무일의 가능한 시각으로 조정하고 원래 시각과 달력 출처·조회 시각을 화면에 보여줍니다. 프로젝트별 점검 시각·마감 전 간격·자율 기준·업무시간은 등록 화면에서 바꿀 수 있습니다. 회사 자체 휴무일은 반영하지 않습니다.

## Vercel 배포

이 저장소는 [`vercel.json`](vercel.json)에서 정적 화면을 `prototype/`에서 제공하고, `/api/*` 요청을 [`api/index.js`](api/index.js) 함수로 연결합니다. 로컬 Node 서버를 Vercel에서 실행하지 않습니다.

1. 이 저장소의 배포할 변경을 Git에 커밋하고 GitHub `main`에 푸시합니다. 로컬 `.env`는 Git에 포함하지 않습니다.
2. Vercel에서 **Add New → Project**로 GitHub 저장소를 가져옵니다. Root Directory는 저장소 루트로 둡니다. `vercel.json`의 **Framework Preset: Other**, **Output Directory: prototype** 설정을 사용하고 별도 Build Command는 지정하지 않습니다.
3. Supabase를 사용할 경우 Vercel 프로젝트의 **Settings → Environment Variables**에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 Preview와 Production 환경용으로 입력합니다. 운영자 Auth 계정으로 로그인할 수 있어야 합니다. Gemma 분석·초안에는 `GEMINI_API_KEY`와 `GEMMA_MODEL`을 설정합니다. 공휴일 조회에는 별도 키가 필요하지 않습니다. Node.js는 22.13 이상(권장 24)으로 실행하며 환경 변수 변경 후 새 배포를 생성합니다.
4. Preview 배포에서 화면과 `/api/status`를 확인합니다. Supabase 설정을 했다면 `{ "configured": true }`가 나와야 합니다. 로그인, 초안 저장, 파일 업로드도 확인한 뒤 Production에 배포합니다.

Vercel 함수의 요청·응답 크기 제한에 맞춰 첨부 파일은 4MB 이하입니다. 운영 정보 변경에는 로그인이 필요하지만 읽기 화면의 예시 데이터는 공개되어 있습니다. 실제 사내 자료를 넣기 전에 사이트 전체의 접근 제어를 설정해야 합니다.

## 문서

- [PRD 제품 요구사항](docs/PRD.md): 제품의 목적·범위·확정 정책·성공 기준과 미결정 사항
- [PLAN 구현 계획](docs/PLAN.md): 단계별 작업·완료 기준·진행 상태와 다음 작업. 구현을 시작할 때 먼저 확인합니다.
- [SPEC 현재 구현 명세](spec/spec_001.md): 실제 동작·한계와 기능별 구현 차이
- [SPEC 002 기획서 입력·안내 준비](spec/spec_002.md): 문서에서 운영 정보 후보 추출, 필수 대상 빠른 선택, 안내 자료·초안 저장의 추가 요구사항
- [공개 업무 조사](docs/research_001.md): 공개 사례·출처와 조사 당시의 제품 제안
- [데이터 흐름과 저장 구조](docs/data-architecture.md): 파일·텍스트 입력, 분석 후보, 확정 정보, 공지 초안과 신청/안내 이력을 Supabase·API에 연결하는 설계 초안
- [공지 초안 톤 가이드](docs/references/tone-guide.md): 말투 작성 기준과 [공개 레퍼런스](docs/references/daangn-tone-references.csv). 현재 앱에서 읽는 데이터가 아닌 작성 참고 자료입니다.
- [테스트 구성과 평가 방법](tests/README.md): 자동 테스트, 가상 사례 자료, 문서 생성·공지 평가 도구

## 저장소 구성

화면을 수정할 때는 `prototype/`, 서버 API는 `scripts/supabase-api.mjs`, 다음 구현 작업은 `docs/PLAN.md`부터 확인합니다. 아래 `#` 뒤는 각 경로의 역할을 설명하는 주석입니다.

```text
저장소 루트/
├─ README.md                        # 실행 방법과 폴더 구조의 시작점
├─ package.json                     # 실행 명령과 직접 사용하는 npm 패키지 목록
├─ package-lock.json                # 설치 버전 고정; node_modules와 달리 보관할 파일
├─ vercel.json                      # Vercel 정적 화면 경로와 API 라우팅
├─ .env                             # 로컬 연결 설정·키; Git 제외
├─ .env.example                     # 필요한 환경 변수의 예시; 실제 키 없음
├─ .gitignore                       # 비밀 설정·설치물·임시 자료의 Git 제외 규칙
├─ .gitattributes                   # Git 파일 처리 규칙
│
├─ prototype/                       # 현재 실행·배포하는 프런트엔드
│  ├─ index.html                    # 화면 진입점; app.js와 styles.css 로드
│  ├─ app.js                        # 화면·예시 데이터·상태 저장·API 호출 연결
│  ├─ styles.css                    # 화면 스타일
│  ├─ data.js                       # 신청 인원·대상 계산과 티켓 정렬
│  ├─ document-extract.js           # TXT·MD 텍스트에서 운영 정보 후보 추출
│  ├─ analysis-contract.js          # 자료 분석의 필드·용량 제한·값 검증 규칙
│  ├─ document-import.js            # 자료 분석 결과를 등록 화면에 연결
│  ├─ message-templates.js          # 공지 초안 템플릿
│  └─ rule-engine.js                # 규칙 기반 티켓 평가; 테스트에서 사용, 화면 미연결
│
├─ api/                             # Vercel 서버 함수 진입점
│  └─ index.js                      # 요청을 scripts/supabase-api.mjs로 전달
├─ scripts/                         # 로컬 실행 도구와 서버 모듈이 함께 있는 폴더
│  ├─ dev-server.mjs                # npm run dev; 정적 파일과 /api 요청 처리
│  ├─ supabase-api.mjs              # 로컬·Vercel 공용 로그인·초안·자료 저장 API
│  ├─ document-reader.mjs           # PDF·DOCX·텍스트 자료 읽기
│  ├─ document-analysis.mjs         # 자료 분석 요청과 AI 결과 처리
│  ├─ application-source.mjs        # 대상 명단·신청 이력 정규화; 화면 미연결
│  ├─ google-sheets-source.mjs      # Google Sheets 읽기 어댑터; 실제 인증·화면 미연결
│  └─ gemma-smoke.mjs               # npm run test:gemma; 가상 자료로 외부 API 연결 확인
├─ supabase/
│  └─ migrations/                  # DB 테이블·접근 정책·저장소 변경 이력
│     └─ 20261006015431_notice_drafts_and_resources.sql
│
├─ tests/                           # 자동 테스트·입력 자료·평가 도구를 한곳에 보관
│  ├─ README.md                     # 테스트 구조·자료 재생성 방법·평가 기준
│  ├─ data.test.js                  # 신청 현황 계산·정렬
│  ├─ document-extract.test.js      # 텍스트 후보 추출
│  ├─ document-analysis.test.js     # 문서 읽기·분석 결과와 근거 검증
│  ├─ message-templates.test.js     # 공지 템플릿
│  ├─ rule-engine.test.js           # 규칙 기반 티켓 평가
│  ├─ application-source.test.js    # 신청 원본 정규화·시트 어댑터
│  ├─ source-rule-integration.test.js # 신청 원본과 티켓 평가의 연결
│  ├─ supabase-api.test.js          # Supabase API 처리
│  ├─ fixtures.test.js              # 자료 무결성·사례별 기능 검증; npm test에 포함
│  ├─ fixtures/                    # 테스트 입력과 기대 결과
│  │  ├─ documents/                # PDF 6개·DOCX 6개; 테스트 입력 자료
│  │  ├─ source_text/              # 문서 원문 TXT 12개; 추출 검증·정답 대조
│  │  └─ data/                     # 직원·프로젝트·신청·기대 결과 등 JSON 8개
│  └─ tools/                       # 자료 생성·공지 평가 도구
│     ├─ build_fixtures.py          # fixtures/ 아래 문서·텍스트·기본 JSON 생성
│     ├─ notice-contract.mjs        # 공지의 링크·마감·오래된 정보 검사 규칙
│     └─ evaluate-notice.mjs        # 새 공지 JSON을 검사하는 CLI
│
├─ docs/                            # 기획·설계·조사·참고 자료
│  ├─ PRD.md                        # 제품 목표와 요구사항
│  ├─ PLAN.md                       # 구현 순서와 진행 상태
│  ├─ data-architecture.md          # 데이터 흐름과 서버 저장 설계 초안
│  ├─ research_001.md               # 공개 사례 조사
│  └─ references/                  # 공지 작성 참고 자료; 앱 실행 시 읽지 않음
│     ├─ tone-guide.md              # 말투 기준
│     └─ daangn-tone-references.csv  # 공개 문구와 출처
├─ spec/                            # 기능별 상세 명세
│  ├─ spec_001.md                   # 현재 구현 동작과 한계
│  └─ spec_002.md                   # 기획서 입력·대상 선택·자료·초안 추가 요구사항
│
├─ node_modules/                    # npm 설치 결과; Git 제외, 재설치 가능
└─ .git/                            # Git 이력과 저장소 정보
```

### 실행 경로와 헷갈리기 쉬운 구분

- **로컬 실행:** `npm run dev` → `scripts/dev-server.mjs` → `prototype/` 화면 제공. `/api/*`는 `scripts/supabase-api.mjs`가 처리합니다.
- **Vercel 실행:** `vercel.json` → `prototype/` 화면 제공. `/api/*`는 `api/index.js`를 거쳐 같은 `scripts/supabase-api.mjs`를 사용합니다. 두 서버 진입점은 실행 환경이 달라 필요합니다.
- **자동 테스트:** `npm test`로 `tests/` 아래 자동 테스트를 실행합니다. `fixtures.test.js`는 `fixtures/`의 입력·기대 결과와 `tools/notice-contract.mjs`를 사용합니다. `fixtures/documents/`와 `fixtures/source_text/`는 각각 파일 입력과 원문 대조에 필요합니다.
- **자료 생성·공지 평가:** `python tests/tools/build_fixtures.py`로 자료를 생성하고, `node tests/tools/evaluate-notice.mjs candidate.json`으로 새 공지의 사실 관계를 검사합니다. 환경 요건과 자료 범위는 [테스트 README](tests/README.md)를 참고합니다.
- **아직 화면에 연결하지 않은 코드:** `rule-engine.js`, `application-source.mjs`, `google-sheets-source.mjs`는 테스트에서 참조합니다. 현재 화면에서 사용하지 않는다는 이유로 삭제하면 테스트와 후속 연동 작업에 영향을 줍니다.

### 정리 후보

`node_modules/`는 재생성 가능한 설치물입니다. 공간이 필요할 때 삭제 후 `npm ci`로 복원할 수 있지만, 앱·문서 처리·Gemma 연결 확인에 사용하는 패키지가 들어 있으므로 일반 작업 중에는 유지합니다. `package.json`과 `package-lock.json`도 함께 유지합니다.

`pdfjs-dist`와 `yauzl`은 현재 `scripts/document-reader.mjs`에서 사용하므로 미사용 패키지로 분류하지 않습니다. 의존성 정리는 현재 코드의 참조를 기준으로 판단합니다.

`tests/`, `supabase/migrations/`, `.env`, `.git/`는 테스트와 입력 자료, DB 재구성 이력, 로컬 연결 설정, 버전 이력을 각각 보관합니다.

추가로 구조를 정리한다면 `scripts/`의 서버 모듈을 `server/`로 분리하고, `spec/`을 `docs/spec/`으로 합칠 수 있습니다. 실제 이동 시 import·문서 링크와 로컬·Vercel 실행 경로를 함께 수정해야 합니다.
