# Job Review

서연이화 업무조사·SME 검증 플랫폼. 관리자가 직무정보를 올리고, 현업 SME가 5단계 마법사로
검토·투입 비중(FTE)을 입력하고, 관리자가 비교·승인한 뒤 계약 산출물로 내보내는 반응형 웹 앱이다.

## 문서

| 문서 | 용도 |
|---|---|
| `docs/PLAN.html` | **이 개편의 기준 문서.** 화면 명세·데이터 모델·보안 요구사항·Phase 0~5 로드맵·오픈 이슈가 전부 여기 있다(`docs/PLAN.txt`는 grep용 평문 사본). |
| `docs/OPERATIONS.md` | **운영 전환·운영 중 절차서.** SQL 적용 순서, 환경변수·시크릿, 시드 계정 제거, 백업·파기, 메일 발신, 장애 대응. 운영에 관한 것은 전부 이 문서를 본다. |
| `docs/PILOT.md` | 파일럿 체크리스트(Phase 5). 계정 발급부터 Export 검산까지 전 경로를 실제로 한 번 완주하는 절차와 접근성·모바일 점검 항목. |
| `docs/OPEN_ISSUES.md` | **미결 사항 정리.** 기준 문서 §12의 오픈 이슈 8건에 대해 코드가 처리한 것과 아직 사람(PM·고객 TF·HCG IT)이 정해야 하는 것을 나눠 적었다. 파일럿 후 무엇을 확정해야 하는지는 이 문서를 본다. |

## 제공 기능

라우트 기준이다(`src/App.tsx`).

### 공통

- 이메일·비밀번호 로그인, ADMIN / SME 역할 분리, 역할별 사이드바
- 첫 로그인 시 비밀번호 변경 강제 — 변경 전에는 라우터 자체를 띄우지 않아 어떤 화면에도 진입할 수 없다
- 로그인 연속 실패 5회 시 60초 잠금 UI(클라이언트 완충 장치. 실제 방어선은 Supabase Auth rate limit)
- 감사 로그(`audit_logs`) — 기록되는 것은 다음뿐이다. **제출·재제출** · 승인/반려 · **재검토 요청** ·
  계정 생성/삭제/비활성화 · 첫 로그인 비밀번호 변경 · 시작 가이드 통과 ·
  **직무정보(4시트) 업로드** · 조직 마스터 업로드 · SME 명부 반영 · **SME 배정 추가/해제** ·
  Export 내려받기 · 스냅샷 · 메일 발송 · 운영 설정 변경.
  행위 이름과 남기는 위치는 `docs/OPERATIONS.md` §7-3에 있다.
  **굵게 표시한 제출·재제출·재검토 요청·직무정보 업로드는 서버(RPC) 안에서 남으며,
  `supabase/APPLY_2026-09-02_followup.sql`을 적용한 뒤에만 쌓인다.** 적용 전에는 제출이
  `review_history`에만 남는다(제출 이력 자체는 그때도 추적된다). 소급 기록은 없다.
  §8 S5 여섯 항목의 현재 상태는 `docs/OPEN_ISSUES.md`의
  「§8 S5 — 이번 후속으로 닫은 것과 남은 것」에 적어 두었다.

### SME

| 라우트 | 화면 |
|---|---|
| `/assignments` | 내 검토 목록 — 배정된 직무 |
| `/review/:jobId?step=1..5` | 직무정보 검토 5단계 마법사. STEP 3이 투입 비중(FTE) 배분(±5% 스텝퍼·균등 배분·합계 100% 게이트). 단계는 URL이 진실이라 새로고침·직접 링크·뒤로가기가 같은 단계를 연다 |
| `/guide` | 시작 가이드 4장 — 최초 1회 필수 통과(`profiles.guide_completed_at`), 이후 상시 재열람 |
| `/inquiries` | 내 문의 — 검토 중 어느 단계에서든 문의를 남기고 답변을 확인 |
| `/history` | 검토 이력 |

### 관리자

| 라우트 | 화면 |
|---|---|
| `/dashboard` | 대시보드 — 전체 검토 현황, 직무당 소요 중앙값(`review_sessions` 기반) |
| `/reviews` | SME 검토 현황 |
| `/progress` | 진행 현황 — 조직×직무 매트릭스, 미시작·미제출 필터, 리마인더 발송 |
| `/workbench` · `/workbench/:jobId` | 검토 워크벤치 — 제출 큐와 SME 1·2인 응답 비교 뷰(적합성 불일치·FTE 비중 차 하이라이트), 승인/반려, 워크숍 플래깅 |
| `/analytics/fte` | FTE 분포 — 직무·조직별 투입 비중 집계 |
| `/inbox` | 문의 인박스 — 상태(미답·답변·종결), 미답 경과일, 답변 |
| `/jobs` · `/jobs/:jobId` | 직무정보 관리 |
| `/upload` | 직무정보 업로드 — 4시트 Excel 검증·미리보기, 양식 다운로드 |
| `/users` · `/admin-users` | SME 계정 관리 · 관리자 계정 관리 |
| `/assignments-admin` | SME 배정 관리 — 직무별 배정 인원(R6 1~2명) 점검, SME 추가·해제. 해제는 삭제가 아니라 `active = false`라 응답 데이터는 남는다. **제출된 응답이 있으면 해제되지 않는다**(화면·서버 트리거 양쪽에서 막는다) |
| `/exports` | 산출물 내보내기 — E1~E5를 XLSX·CSV·JSON으로, 그리고 수동 스냅샷(백업) |
| `/settings` | 운영 설정 — 마감일, 예상 소요, 가이드 문구, 문의 담당, 리마인더 템플릿, FTE 게이트 스위치 |

서버 게이트: 제출은 `submit_review` RPC가 ① 전 섹션 평가 완료 ② 조건부 필수 의견
③ FTE 합계 100.00 ④ 호출자 = 배정 SME 본인 ⑤ 배정이 아직 살아 있는지(`review_assignments.active`)를
다시 검증한 뒤에만 통과시킨다(⑤는 `supabase/APPLY_2026-09-02_assignment_guard.sql` 적용 후).
승인/반려는 `decide_review` RPC(ADMIN 한정, 반려 사유 필수)로만 한다.

## 개발자 시작 절차

1. 의존성 설치

   ```bash
   npm install
   ```

2. 환경변수 — 저장소 루트에 `.env`를 만든다(`.env.example` 참고)

   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

3. 개발 서버

   ```bash
   npm run dev
   ```

4. 배포 전 확인 — 세 개가 모두 통과해야 한다

   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

## 데이터베이스

새 Supabase 프로젝트에 붙일 때는 `supabase/migrations/`의 SQL을 파일 이름 순서대로 실행한다.
**이미 돌고 있는 운영 DB에 반영할 때는 `supabase/APPLY_*.sql`을 쓰며, 적용 순서와
확인 쿼리는 `docs/OPERATIONS.md` 1절에 있다.** 화면 배포보다 SQL이 먼저다.

계정 생성·삭제 화면은 `supabase/functions/admin-create-user`, 리마인더 발송은
`supabase/functions/send-reminder` Edge Function이 배포되어 있어야 동작한다.

### 표

기존

- `companies`, `profiles`
- `job_groups`, `job_series`, `jobs`
- `job_tasks`, `task_activities`, `job_skills`, `job_requirements`
- `review_assignments`, `reviews`
- `job_feedback`, `task_feedback`, `skill_feedback`
- `new_task_suggestions`, `new_skill_suggestions`
- `review_history`, `upload_history`

Phase 0~4에서 추가

- `audit_logs` — 감사 로그. SELECT는 ADMIN만, INSERT는 `log_audit` RPC 경유만
- `org_units` — 조직 트리(조직코드·상위조직). 조직별 집계의 키
- `task_fte_allocations` — 과업별 투입 비중(FTE) 배분
- `review_sessions` — 마법사 진입·이탈 기록. 직무당 소요 실측의 원천
- `inquiries` — SME 문의·답변 (`OPEN` / `ANSWERED` / `CLOSED`)
- `job_workshop_flags` — 워크숍 대상 지정과 사유(자동 규칙 + 수동)
- `mail_logs` — 메일 발송 이력. `simulated`로 실발송/시뮬레이션 구분
- `survey_settings` — 회사별 운영 설정(마감일·예상 소요·가이드 문구·문의 담당·리마인더 템플릿·FTE 게이트 스위치)

추가 컬럼: `profiles.must_change_password`, `profiles.org_unit_id`, `profiles.guide_completed_at`,
`reviews.approved_at`, `reviews.rejected_reason`.

직무 원문은 버전 값을 기준으로 보관하고 피드백이 원래 직무·Task·Skill을 참조하도록 설계해,
이후 Excel을 다시 올려도 제출 이력이 끊어지지 않는다.

## Excel 업로드 양식

한 파일에 시트 넷을 담는다. **①②는 필수, ③④는 선택**이며, ③④가 없으면 기존 2시트 파일과
완전히 동일하게 동작한다. 양식은 `/upload` 화면에서 내려받는다.

| 시트 | 열 |
|---|---|
| ① `직무 및 과업 정보` | `직군`, `직렬`, `직무`, `직무정의`, `주요과업`, `세부활동` |
| ② `Skill 및 수행요건` | `직군`, `직렬`, `직무`, `Skill 구분`, `Skill`, `요구 학력`, `관련 전공`, `관련 자격증/면허` |
| ③ `조직 마스터` | `조직코드`, `조직명`, `상위조직코드` |
| ④ `SME 명부` | `성명`, `이메일`, `조직코드`, `직급`, `배정직무` |

같은 직무가 여러 행에 반복되는 형식으로 과업·세부활동·Skill을 등록한다. 화면에서 빈 필수 열,
필수 값 누락, 파일 형식 오류, 조직코드 중복·고아를 검증하고 미리보기로 보여 준다.
④ `SME 명부`는 **이미 등록된 계정의 소속 조직(`profiles.org_unit_id`)과 배정직무(`review_assignments`)만**
반영하고 **계정을 만들지는 않는다** — 계정 발급은 `/users` 화면에서 한다. 명부에 있으나 계정이 없는
이메일, 조직 마스터에 없는 조직코드, 등록된 직무에서 못 찾은 직무명은 완료 화면에 그대로 나열한다.
기존 배정은 지우지 않고 명부에 있는 (SME, 직무) 쌍을 더하기만 한다.
반영은 `link_sme_roster` RPC가 한다 — `supabase/APPLY_2026-09-02_p5.sql`을 적용해야 동작한다.

## 보안

- 비밀번호는 Supabase Auth가 처리한다. 애플리케이션 데이터에는 Row Level Security가 걸려 있다.
- SME는 본인에게 배정된 검토만 조회·수정할 수 있다. 관리자 기능은 서버 측에서 다시 확인한다.
- RLS는 행까지만 막고 컬럼은 막지 못한다. 그래서 `reviews`의 상태·제출·승인 컬럼과
  `inquiries`의 답변 컬럼은 컬럼 잠금 트리거로 따로 잠갔고, RPC 안에서만 바뀐다.
- `service_role` 키와 메일 발송 키 같은 실제 비밀값은 Supabase 대시보드와 Actions에만 두고
  코드·저장소에 기록하지 않는다.

### anon key에 대한 정확한 이해

Supabase anon key가 클라이언트 번들에 포함되는 것은 설계상 정상이며 비밀이 아니다.
실제 방어선은 RLS와 함수 권한이다. 따라서 보안 목표는 "키 숨기기"가 아니라
**RLS 누락 0건 · SECURITY DEFINER 함수 호출자 검증 100%** 로 관리한다.
확인 쿼리는 `docs/OPERATIONS.md` 7-2절에 있다.

### 검색 노출 차단과 그 한계

`index.html`에 `<meta name="robots" content="noindex, nofollow">`를 넣고
`public/robots.txt`에 전체 Disallow를 두었다.

다만 GitHub Pages는 하위 경로에서 서빙하므로 `robots.txt`가 사이트 루트가 아닌
`/jobreview_seoyoneh/robots.txt`에 놓인다. 검색엔진은 도메인 루트의 `robots.txt`만 읽으므로
이 파일은 실제로는 적용되지 않는다. 검색 노출을 막는 것은 `meta` 태그이고,
실질 방어선은 인증과 RLS다.

**GitHub Pages URL 자체는 공개다. URL을 아는 것만으로 데이터에 접근할 수는 없어야 하며,
비밀은 오직 인증·RLS다.**

## 계정

**운영 DB에는 이 문서에 적을 수 있는 로그인 정보가 없다.** 관리자 계정은
`supabase/BOOTSTRAP_2026-09-02_admin.sql`을 SQL Editor에서 실행해 만든다
(스크립트 상단 세 줄에 이메일·임시 비밀번호·이름을 채운다). 로그인이 되지 않을 때는
먼저 `supabase/DIAGNOSE_2026-09-02_login.sql`(읽기 전용)로 원인을 확정한다.

관리자 계정을 만드는 앱 경로(`/admin-users` 화면, `profiles` INSERT 정책)는 둘 다
호출자가 이미 관리자일 것을 요구한다. **활성 관리자가 0명이면 화면으로는 복구할 수 없고,
위 SQL 스크립트가 유일한 경로다.**

### 로컬 개발 전용 시드

`supabase/seed.sql`은 **로컬 Supabase에서만** 쓴다. 비밀번호가 저장소에 공개되어 있고,
재실행하면 비밀번호를 그 값으로 되돌려 놓는다. **운영 DB에서는 실행하지 않는다.**
과거 문서가 이 계정을 운영 로그인 정보로 안내한 적이 있으나, 운영 DB에는 만들어진 적이 없다
(2026-09-02 실측: 해당 계정으로 인증하면 `invalid_credentials`).

## 배포

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 GitHub Pages로 배포한다.
빌드에 필요한 값은 저장소 Actions **variables**로 주입한다(secrets가 아니다).

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Pages는 하위 경로에서 서빙되므로 빌드 시 `GITHUB_PAGES=true`로 `base`를 `/jobreview_seoyoneh/`로 맞춘다.

**이 워크플로는 SQL을 적용하지 않는다.** DB 변경은 `docs/OPERATIONS.md` 1절의 순서대로
사람이 먼저 적용한다.
