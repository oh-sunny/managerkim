# 자동 테스트와 공지 평가 자료

이 폴더는 기능별 자동 테스트와 **가상 회사 가온랩**의 테스트 자료를 담는다. 실제 직원·사내 URL·제도는 사용하지 않는다. 문서의 `.example` 주소는 발송 가능한 실제 링크가 아니라 링크 선택과 본문 반영을 확인하기 위한 고정 값이다.

자동 테스트는 이 폴더의 `*.test.js`, 가상 사례·입력 자료·기대 결과는 `fixtures/`, 생성·평가 도구는 `tools/`에 모은다. 전체 경로별 역할은 [루트 README의 저장소 구성](../README.md#저장소-구성)을 참고한다.

## 구성

| 위치 | 내용 |
| --- | --- |
| `*.test.js` | 신청 계산·추출·템플릿·규칙 평가·원본 연동·API의 자동 테스트 |
| `fixtures/documents/` | 복지 2건·행사/이벤트 2건에 각각 3개씩, 총 PDF 6개와 DOCX 6개 |
| `fixtures/source_text/` | 각 문서와 같은 원문을 담은 UTF-8 텍스트. 현재 TXT 추출기 검증 및 정답 대조용 |
| `fixtures/data/employees.json` | 가상 직원 160명과 고정 ID·팀·사번 |
| `fixtures/data/`의 `projects.json`, `applications.json` | 프로젝트별 대상·필수 명단과 신청·확정 대기·취소 상태 |
| `fixtures/data/`의 `cases.json`, `fact-sources.json`, `expected-extraction.json` | 건별 기대 사실, 근거 문서와 원문 인용, 구버전 충돌 |
| `fixtures/data/gold-notices.json` | 사람이 검토할 자연스러운 공지 예시. 정확한 문장 일치 검사용이 아님 |
| `fixtures.test.js` | 현재 프로토타입의 인원 계산·링크 반영과 자료 자체의 무결성 검증 |
| `tools/notice-contract.mjs`, `tools/evaluate-notice.mjs` | 새 초안의 링크·마감·오래된 정보 검사 |
| `tools/build_fixtures.py` | `fixtures/` 아래 문서·텍스트와 기본 JSON 생성 |

## 실행

저장소 루트에서 `npm test`를 실행한다. 문서를 다시 만들 때는 번들 Python 환경의 `python tests/tools/build_fixtures.py`를 실행한다. 일반 Python을 쓴다면 `python-docx`와 `reportlab`이 필요하다. PDF 생성에는 Windows의 맑은 고딕 글꼴도 필요하다. 같은 입력에서 같은 파일명과 내용을 만든다. `fact-sources.json`, `expected-extraction.json`, `gold-notices.json`은 생성 대상이 아니므로 별도로 유지한다.

새로 생성한 공지 초안은 다음 형식의 JSON 파일로 저장해 검사할 수 있다.

```json
{"caseId":"workshop-2026","text":"공지 본문"}
```

`node tests/tools/evaluate-notice.mjs candidate.json`은 확정된 신청 링크, 마감 날짜·시각, 이전 링크, 신청과 확정의 혼동을 검사한다. 종료 코드 0은 **사실 검사 통과**만 뜻한다. 문장의 자연스러움은 아래 기준으로 별도 평가한다.

## 수동 공지 품질 평가

각 항목을 1~5점으로 채점하고, 근거 문서의 버전과 공지 초안을 함께 보관한다.

1. 첫 두 문장에서 무엇을, 누가, 언제까지 해야 하는지 알 수 있는가?
2. 별도 신청 링크가 눈에 띄고, 그 링크에서 해야 할 행동이 분명한가?
3. 여러 문서의 설명을 자연스럽게 합쳤으며 내부 검토 메모와 불필요한 세부 사항은 빠졌는가?
4. 필수·자율 대상과 신청·확정 상태를 혼동하지 않는가?
5. 동료에게 직접 말하는 듯 자연스럽고 친절한가? 딱딱한 요약문이나 기계적 문장 반복은 없는가?

링크·마감·대상·필수 여부가 틀리면 총점과 관계없이 실패로 기록한다. 지원 조건, 정원, 선정 결과처럼 문서에 없는 사실을 새로 만든 경우도 실패다. `fact-sources.json`의 여러 문서를 함께 확인한다.

## 범위

현재 프로토타입은 여러 PDF·DOCX·TXT·MD를 Gemini로 분석하고 스캔 PDF OCR, 근거 검사, 누락·충돌 검토 후 선택 적용을 지원한다. `document-analysis.test.js`는 혼합 문서 읽기·이미지 전용 PDF·OCR 결과·허위 인용·날짜 형식·오류 경계를 검증한다. `supabase-api.test.js`는 분석 인증·동일 출처·요청 크기·동시 호출을 확인한다. 자동 테스트는 외부 AI를 호출하지 않는다. 실제 Gemini 호출은 별도 예시로 확인하며 공지 문안은 아직 템플릿으로 만든다. 기존 화면의 160명은 같은 ID·팀 순서의 예시 명단이지만 이름 표시와 프로젝트 초기값은 이 폴더의 사례와 별개다.
