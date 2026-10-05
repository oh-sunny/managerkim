# 사내 행사·복리후생 운영 AI 에이전트

행사·복지의 **신청 현황·일정·이전 안내를 연결해 누구에게 언제 무엇을 안내할지 결정하고 실행하는 도구**입니다. 운영 정보를 등록하고 신청 현황을 확인한 뒤, 안내 초안과 대상을 검토해 팀별 개별 DM 또는 지정 Slack 채널로 안내하는 흐름을 목표로 합니다.

## 현재 프로토타입

HTML·CSS·JavaScript와 Node.js 정적 서버로 실행합니다. 현재 가능한 동작은 다음과 같습니다.

- 프로젝트 등록·수정, 이름·팀 검색을 통한 대상·필수 동료 선택
- 로컬 신청·취소·확정 상태 변경과 현황·DM 대상 재계산
- 홈·프로젝트별 티켓·캘린더 확인
- 안내 초안 수정, 팀별 DM 대상 또는 채널 선택, 모의 발송
- 안내 원문·Slack 링크 기록과 브라우저 저장·복원
- `.txt`·`.md` 기획서 또는 붙여넣은 텍스트에서 명시적 항목 후보를 찾아 검토 후 적용

동료 명단과 기존 티켓은 예시 데이터이며, 티켓·캘린더의 예시 기준일은 2026년 10월 3일입니다. 규칙 기반 티켓 생성, 실제 신청 원본·Slack 연결, 서버 저장·주기 실행, PDF·Word·AI 문서 해석은 아직 구현하지 않았습니다. 메시지는 실제로 보내지 않습니다.

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

운영 정보·신청 상태·안내 기록·모의 발송 결과는 브라우저의 로컬 저장소에 보관합니다. 브라우저·기기·접속 포트가 바뀌거나 사이트 데이터를 지우면 공유되지 않습니다. 실제 DB 저장과 Slack 원문 조회는 연결하지 않았으며, Slack 링크는 직접 붙여넣어 기록합니다.

## 문서

- [PRD 제품 요구사항](docs/PRD.md): 제품의 목적·범위·확정 정책·성공 기준과 미결정 사항
- [PLAN 구현 계획](docs/PLAN.md): 단계별 작업·완료 기준·진행 상태와 다음 작업. 구현을 시작할 때 먼저 확인합니다.
- [SPEC 현재 구현 명세](docs/spec_001.md): 실제 동작·한계와 기능별 구현 차이
- [SPEC 002 안내 대상·자료·초안 저장](docs/spec_002.md): 필수 대상 빠른 선택, 링크·파일 첨부, 발송 자료 이력과 초안 임시 저장의 추가 요구사항(미구현)
- [공개 업무 조사](docs/research_001.md): 공개 사례·출처와 조사 당시의 제품 제안
- [문서에서 채우기 구현 방향](docs/document-import-plan.md): PDF·Word·AI 문서 해석으로 확장할 때의 후보·근거·검토 흐름
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
│  ├─ spec_001.md
│  ├─ document-import-plan.md
│  ├─ research_001.md
│  ├─ references/
│  │  ├─ tone-guide.md
│  │  └─ daangn-tone-references.csv
│  └─ archive/
│     └─ source.html
├─ prototype/
│  ├─ index.html
│  ├─ styles.css
│  ├─ data.js
│  ├─ document-extract.js
│  └─ app.js
├─ tests/
│  ├─ data.test.js
│  └─ document-extract.test.js
└─ scripts/
   └─ dev-server.mjs
```

`.local-preview/`는 로컬 확인 자료를 보관하며 Git 업로드 대상에서 제외합니다.
