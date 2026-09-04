# 내부 파일럿 체크리스트 (Phase 5)

> **이 문서는 실행 결과를 적는 곳이다 — 빈 체크박스는 아직 확인되지 않았다는 뜻이다.**
>
> 항목을 읽고 "될 것 같다"고 판단해서 체크하지 않는다. 실제로 그 화면을 열고, 그 버튼을 누르고,
> 화면에 적힌 문구를 눈으로 읽은 뒤에만 `[x]`로 바꾼다. 확인하지 못한 항목은 빈 칸으로 남기고
> 아래 「기록란」에 왜 확인하지 못했는지를 적는다. 통과하지 못한 항목은 `[!]`로 표시하고
> 관측한 실제 화면·문구를 그대로 옮겨 적는다.
>
> 근거 표기: `§n` = `docs/PLAN.html`(평문 사본 `docs/PLAN.txt`)의 절 번호,
> `파일:줄` = 이 저장소의 실제 코드 위치. 줄 번호는 2026-09-01 `revamp/phase-5` 시점 기준이며
> **코드가 바뀌면 밀린다** — 줄이 어긋나면 항목에 함께 적힌 **문구·함수명**으로 찾는다(그쪽이 진짜 기준점이다).

- 대상: 내부 2~3인 파일럿(§10 P5 「내부 2~3인 파일럿」, §11-2 Phase 5 1번)
- 참가자 역할 배분 권장: **관리자 1명 + SME 2명**. SME 2명이어야 §6-3ⓑ 비교 뷰·워크숍 자동 규칙
  ④(SME 응답 1명뿐)를 둘 다 관측할 수 있다.
- 실시 일자: ____________  · 실시자: ____________  · 대상 회사(계열사): ____________

---

## 0. 시작 전에 알고 있어야 할 것 — 파일럿 결과를 오해하지 않기 위한 3가지

- **배정은 "회사의 활성 직무 전부"로 만들어진다.** SME 계정을 만들면 Edge Function이
  `sync_sme_assignments`를 부르고, 그 함수가 **해당 회사의 활성 직무 전체**를 그 SME에게 배정하고
  `reviews`를 `NOT_STARTED`로 만든다
  (`supabase/functions/admin-create-user/index.ts:250-256`, `supabase/APPLY_2026-08-28.sql:483-530`).
  **자동 배정 자체는 그대로다.** 다만 사후에 정리하는 화면은 생겼다 —
  관리자 `/assignments-admin`(SME 배정 관리)에서 직무별 R6 배지를 보고 배정을 추가·해제한다(§2-N').
  그 화면은 `sync_sme_assignments`를 막지 못하므로 **계정을 만든 뒤에 한 번 돌아야 한다.**
  3명째 추가도 경고만 하고 막지 않는다(상한이 미확정이라 코드가 먼저 정하지 않았다).
  따라서 **§6-3ⓐ의 "직무별 SME 배정 수 1~2명 규칙(R6)"은 여전히 코드로 강제되지 않는다.**
  파일럿에서는 대상 회사의 활성 직무를 2~3개로 줄여 두고 시작하고,
  이 사실은 §12 오픈이슈 3번(배정 예외 처리)에 올린다.
- **`fte_required`는 기본값이 꺼짐(false)이다.** 켜지 않으면 합계 100% 서버 검증이 통과되어
  파일럿이 "제출 게이트가 없는 상태"를 시험하게 된다. 아래 §1에서 반드시 켠다.
- **소요 실측 중앙값은 표본 3건 미만이면 숫자로 나오지 않는다.** `/dashboard`의 「직무당 소요
  중앙값(실측)」 카드가 `MIN_SAMPLE = 3` 미만에서 「표본 부족」으로 뜬다(`src/lib/durationApi.ts`).
  2~3인 파일럿에서는 **제출을 4건 이상** 만들어야 값이 나온다 — §6에 계획 항목을 두었다.

---

## 1. 사전 준비 — SQL 적용 순서

> **정본은 `docs/OPERATIONS.md` §1(배포 순서)이다.** 아래 표는 파일럿 실시자가 그 문서를 열지 않고도
> 순서를 확인할 수 있게 요약한 것이고, 상세한 근거·실패 증상·확인 쿼리는 OPERATIONS.md에 있다.
> 두 문서가 어긋나면 OPERATIONS.md를 따르고 이 표를 고친다.

Supabase 대시보드 → 대상 프로젝트 → SQL Editor → New query에 파일 전체를 붙여넣고 Run.
각 파일 머리주석에 「적용 후 확인」 쿼리가 들어 있으므로 **매 단계마다 그 쿼리를 돌려 결과를 기록한다**.
전부 재실행 안전(idempotent)하게 작성돼 있다.

| 순서 | 파일 | 하는 일 | 순서 제약 |
|---|---|---|---|
| 1 | `supabase/APPLY_2026-08-28.sql` | `job_feedback.section` CHECK 확장(수행요건 3항목), `save_review_draft`·`submit_review` 1차, `get_review_status`/`sync_sme_assignments` 권한 구멍 차단, `request_rereview`, **`save_integrated_job_data`**(이 함수가 없으면 직무정보 업로드가 `PGRST202`로 실패한다) | 나머지 전부의 선행 |
| 2 | `supabase/APPLY_2026-09-01_phase0.sql` | `profiles.must_change_password` 추가(기존 계정은 false로 백필 — 안 그러면 전원 잠긴다), `audit_logs` 테이블+RLS(SELECT는 ADMIN만), `log_audit` RPC, 인덱스 2 | 1 이후. **프런트 배포보다 먼저** |
| 3 | `supabase/APPLY_2026-09-01_phase1.sql` | 신규 표 7종(`org_units`/`task_fte_allocations`/`review_sessions`/`inquiries`/`job_workshop_flags`/`mail_logs`/`survey_settings`) + 컬럼 추가(`profiles.org_unit_id`·`guide_completed_at`, `reviews.approved_at`·`rejected_reason`) + 컬럼 잠금 트리거 2개, 그리고 `submit_review` 4종 재검증 재정의·`decide_review` 신설·`save_review_draft`/`request_rereview` 재정의 | 2 이후. **파일 내부 2개 마이그레이션은 한 벌로 적용해야 한다** — 앞쪽만 적용하면 트리거 때문에 임시저장이 막힌다 (OPERATIONS.md §1-4) |
| 4 | `supabase/APPLY_2026-09-01_phase2.sql` | **`survey_settings.fte_required`를 회사 단위로 true**로 올려 §7-2 제출 게이트 ③(FTE 합계 100.00)을 켠다 | 3 이후 **그리고 STEP 3 화면이 배포된 뒤에만.** 화면보다 먼저 켜면 배분 행이 없어 아무도 제출하지 못한다 (OPERATIONS.md §1-5) |
| 5 | `supabase/APPLY_2026-09-01_phase4.sql` | `survey_settings`에 `reminder_subject`·`reminder_body_md` 두 열 추가(리마인더 템플릿 자리). ALTER TABLE 두 줄뿐 | 3 이후면 앞뒤 어느 쪽이어도 안전 (OPERATIONS.md §1-6) |
| 6 | `supabase/APPLY_2026-09-02_p5.sql` | `link_sme_roster` 신설 — SME 명부(시트 ④)로 `profiles.org_unit_id`를 연결하고 「배정직무」를 `review_assignments`에 추가한다. `survey_settings.fte_required`의 컬럼 DEFAULT를 true로 올린다(기존 행 값은 안 건드림) | 3 이후면 앞뒤 어느 쪽이어도 안전. **적용하지 않으면 조직축이 계속 비어 진행 매트릭스가 전부 '조직 미지정', Export E2의 조직 칸이 빈칸이다** (OPERATIONS.md §1-7) |
| 7 | `supabase/APPLY_2026-09-02_followup.sql` | `submit_review`·`request_rereview`·`save_integrated_job_data`를 감사 기록 한 줄씩만 얹어 재정의한다 — 제출·재제출(`REVIEW_SUBMITTED`/`REVIEW_RESUBMITTED`), 재검토 요청(`REVIEW_REREVIEW_REQUESTED`), 직무정보 4시트 업로드(`JOB_DATA_UPLOADED`)가 `audit_logs`에 남기 시작한다. 표·컬럼·정책·시그니처는 그대로 | **반드시 ①·③ 뒤에(가능하면 맨 마지막).** 이 파일은 ①·③이 만든 최신 정의 위에 얹는 것이라 ③을 나중에 실행하면 감사 블록이 **오류 없이 조용히** 사라진다. 화면 배포와는 무관하다 — 적용 전에도 화면은 그대로 돌고 기록만 빠진다 (OPERATIONS.md §1-8) |
| 8 | `supabase/APPLY_2026-09-02_assignment_guard.sql` | 배정 해제 안전장치를 서버로 내린다 — 제출된 응답이 있는 배정을 `active = false`로 내리는 UPDATE를 42501로 거절하는 트리거 + `submit_review`가 상태 전이 앞에서 배정이 살아 있는지 확인. 이 둘이 없으면 해제된 배정에 매달린 제출이 **어느 화면에도 보이지 않는다** | **반드시 ⑦ 뒤에.** ⑦이 만든 `submit_review` 정의 위에 배정 확인만 얹는 것이라 순서를 뒤집으면 ⑦이 그 확인을 **오류 없이 조용히** 지운다 (OPERATIONS.md §1-8) |

- Phase 3(§11-2)에는 DDL이 없어 `APPLY_*` 파일이 없다 — 저장소 실측 확인함
  (`supabase/APPLY_*.sql` 8개 = 08-28 / phase0 / phase1 / phase2 / phase4 / 09-02_p5 / 09-02_followup /
  09-02_assignment_guard).
- ⑦⑧은 **이 저장소에서 한 번도 실행해 본 적이 없다**(환경에 `psql`·`docker`가 없어 정적 확인만 했다).
  구문 오류가 있다면 실행 즉시 드러난다 — ⑦은 확인 (3)이 세 함수 본문에 `log_audit`이 들어갔는지,
  ⑧은 확인 (1)(2)가 트리거와 배정 확인이 들어갔는지 본다.
- 각 파일 끝의 `NOTIFY pgrst, 'reload schema';`를 지우지 않는다 — 없으면 `PGRST202`/`PGRST204`가 한동안 계속 난다 (근거: `docs/OPERATIONS.md` §1-1)
- Edge Function(`admin-create-user`·`send-reminder`) 배포는 `docs/OPERATIONS.md` §1-9를 따른다
- 체크:
- [ ] (실시자) ①~⑧을 위 순서대로 적용하고 각 파일의 「적용 후 확인」 쿼리를 돌린다 → 각 쿼리가 파일 주석에 적힌 기대 결과와 일치 (근거: 각 `APPLY_*.sql` 머리주석)
- [ ] (실시자) ⑧ 적용 후 확인 (1)(2)(4)를 돌린다 → (1) 트리거 `review_assignments_guard_deactivate` **1행**,
      (2) `has_check`가 **true**이고 `prosecdef`가 **false**, (4) **0행**(적용 이전에 생긴 "보이지 않는 제출"이 없다).
      (4)가 0행이 아니면 그 목록을 §10-2에 적고 PM과 처리를 정한다 (근거: `supabase/APPLY_2026-09-02_assignment_guard.sql` 「적용 후 확인」)
- [ ] (실시자) ⑦ 적용 후 확인 (1)(3)을 돌린다 → (1) 세 함수의 `prosecdef`가 **모두 false**(true가 나오면 RLS를 우회하는 함수가 된 것이니 즉시 되돌린다), (3) **3행**(세 함수 본문에 `log_audit`이 들어갔다) (근거: `supabase/APPLY_2026-09-02_followup.sql` 「적용 후 확인」 (1)(3))
- [ ] (실시자) ② 적용 후 `SELECT must_change_password, count(*) FROM public.profiles GROUP BY 1;`을 돌린다 → **`true` 행이 0**이어야 한다(기존 계정이 잠기지 않음) (근거: `supabase/APPLY_2026-09-01_phase0.sql` 「적용 후 확인」)

### 1-1. `fte_required` 스위치 — 현재 기본값과 파일럿 절차

- **현재 기본값: 꺼짐(false).** Phase 1 스키마가 `survey_settings.fte_required`를 기본 false로 만든다.
  이유는 파일 주석에 그대로 있다 — STEP 3 화면 배포 전에 켜면 배분 행이 하나도 없어 SME가
  아무도 제출하지 못하기 때문이다(`supabase/APPLY_2026-09-01_phase1.sql` ★ 항목).
- **파일럿에서는 켜야 한다.** 파일럿의 목적 중 하나가 "합계 100% 미만이면 제출이 막히는가"를
  실측하는 것이고(§10 P2 DoD ②), 꺼진 상태에서는 서버가 그 검사를 건너뛴다.
- 절차:
- [ ] (실시자) STEP 3 화면이 배포된 것을 눈으로 확인한 뒤 `supabase/APPLY_2026-09-01_phase2.sql`을 실행한다 → 실행 성공 (근거: `supabase/APPLY_2026-09-01_phase2.sql:32-34`)
- [ ] (실시자) 확인 쿼리 `SELECT c.name, s.fte_required FROM public.companies c LEFT JOIN public.survey_settings s ON s.company_id = c.id ORDER BY c.name;`를 돌린다 → 대상 회사 행의 `fte_required`가 **t** (근거: 같은 파일 「적용 후 확인」)
- [ ] (실시자) 같은 파일의 두 번째 확인 쿼리로 `jobs.company_id IS NULL`인 검토가 있는지 본다 → **0행**. 0행이 아니면 그 검토들은 회사에 매이지 않아 서버 FTE 게이트가 걸리지 않는다(클라이언트 게이트만 남는다) (근거: 같은 파일 「적용 후 확인」, `src/pages/SmeReviewPage.tsx:560-566`)
- [ ] (관리자) `/settings`에서 대상 회사를 고르고 「제출 게이트 · 투입 비중 합계 검사」가 **켜짐**으로 보이는지 확인한다 → 스위치 라벨이 `켜짐` (근거: `src/pages/SettingsPage.tsx:421-437`)
- 되돌릴 때: 같은 파일의 `true` 두 곳을 `false`로 바꿔 재실행한다.

### 1-2. 운영 설정 준비

- [ ] (관리자) `/settings`에서 **조사 마감일**을 넣는다 → 대시보드 「마감 D-day」 지표가 `마감일 미설정` 대신 D-day를 표시 (근거: §6-3ⓐ, `src/pages/SettingsPage.tsx:330-331`, `src/pages/DashboardPage.tsx:271-272`)
- [ ] (관리자) **직무당 예상 소요(분)** 잠정치를 넣는다 → 가이드 카드 ④에 "예상 소요는 직무당 약 N분이며, 입력은 자동 저장됩니다…"가 나타난다. **비워 두면 그 문장이 통째로 빠진다**(앱이 숫자를 지어내지 않는다) (근거: §6-1 카드 ④, `src/pages/sme-review/copy.ts:98-103`, `src/pages/SettingsPage.tsx:344-345`)
- [ ] (관리자) 직무정보를 업로드한다(`/upload`). 파일럿 대상 회사의 활성 직무를 **2~3개로 제한**한다 → 업로드 성공, `/jobs`에 그 직무들만 보임 (근거: §0의 배정 주의사항, `supabase/APPLY_2026-08-28.sql:483-530`)
- [ ] (관리자) 업로드 파일에 시트 ③ 「조직 마스터」를 포함한다 → 조직 마스터가 `org_units`에 저장된다. **시트 ④ 「SME 명부」는 검증·미리보기까지만 되고 계정은 만들어지지 않는다** — 계정은 `/users`에서 만든다 (근거: `src/lib/integratedUploadUtils.ts:11-17`, `src/lib/integratedJobApi.ts:81-82`)
- [ ] (실시자) 위 업로드 직후 SQL `SELECT action, meta, created_at FROM public.audit_logs WHERE action IN ('JOB_DATA_UPLOADED','ORG_UNITS_UPLOADED','SME_ROSTER_LINKED') ORDER BY created_at DESC LIMIT 5;` → **`JOB_DATA_UPLOADED` 1행**(`meta`에 `mode`와 5건수). 시트 ③④를 함께 올렸다면 세 행이 나오는데 중복이 아니라 서로 다른 단계다. **0행이면 ⑦(`APPLY_2026-09-02_followup.sql`)이 적용되지 않았거나 감사 기록이 조용히 빠진 것이다** — 감사 실패는 화면에 뜨지 않으므로 이 쿼리로만 확인된다 (근거: §8 S5, `supabase/APPLY_2026-09-02_followup.sql` 확인 (4))

---

## 2. 전 경로 체크리스트

### A. 계정 발급

- [ ] (관리자) `/users` 「SME 계정 관리」 → 개별 추가로 SME 2명을 만든다. 회사·조직·직급·사번·이름·이메일·비밀번호를 모두 넣는다 → "SME 계정 추가" 성공, 목록에 `● 활성`으로 표시 (근거: `src/pages/SmeUsersPage.tsx:233`, `src/components/modals/SmeSingleCreateModal.tsx:43-50`)
- [ ] (관리자) 초기 비밀번호를 7자로 넣어 본다 → `비밀번호는 8자 이상이어야 합니다. 지금 7자입니다.` (근거: `src/lib/passwordPolicy.ts`)
- [ ] (관리자) 같은 이메일로 한 번 더 만들어 본다 → `이미 등록된 이메일이에요. 다른 이메일을 쓰거나 기존 계정을 수정해 주세요.` (근거: `src/components/modals/edgeApi.ts:24`)
- [ ] (실시자) SQL로 `SELECT email, must_change_password FROM public.profiles WHERE role='sme';`를 확인한다 → 방금 만든 두 계정이 **true** (근거: §8 S2, `supabase/APPLY_2026-09-01_phase0.sql` must_change_password 기본값)
- [ ] (실시자) SQL로 `SELECT count(*) FROM public.review_assignments WHERE sme_id = '<새 SME id>';`를 센다 → **대상 회사의 활성 직무 수와 같다**(골라 배정되지 않는다는 사실 확인) (근거: `supabase/APPLY_2026-08-28.sql:510-518`)
- [ ] (관리자) 계정을 만든 직후 `/assignments-admin`(SME 배정 관리)을 열어 배정을 정리한다 → 아래 **N'** 절차. 정리하지 않으면 두 SME가 모든 직무를 배정받은 상태로 파일럿이 시작된다 (근거: §0의 배정 주의사항)

### B. 첫 로그인 · 비밀번호 강제 변경

- [ ] (SME) 발급받은 계정으로 로그인한다 → 사이드바가 있는 화면 대신 **「비밀번호 변경」 화면만** 뜬다. 문구: `처음 로그인하셨습니다. 계속하기 전에 비밀번호를 변경해 주세요.` (근거: §10 P0 DoD ②, `src/App.tsx:269-275`, `src/pages/ChangePasswordPage.tsx:105-110`)
- [ ] (SME) 주소창에 `/assignments`, `/guide`, `/dashboard`를 직접 친다 → **어느 것도 열리지 않고 계속 비밀번호 변경 화면**. (라우터 자체를 띄우지 않으므로 화면이 한 번 그려졌다 사라지는 일도 없어야 한다) (근거: `src/App.tsx:267-275` 주석)
- [ ] (SME) 7자 비밀번호를 넣고 제출한다 → `비밀번호는 8자 이상이어야 합니다. 지금 7자입니다.` (근거: `src/lib/passwordPolicy.ts`)
- [ ] (SME) 확인란에 다른 값을 넣는다 → `두 번 입력한 비밀번호가 서로 다릅니다. 다시 확인해 주세요.` (근거: `src/pages/ChangePasswordPage.tsx:50`)
- [ ] (SME) 8자 이상 + 영문·숫자로 변경하고 「비밀번호 변경하고 시작하기」를 누른다 → 화면이 넘어간다 (근거: `src/pages/ChangePasswordPage.tsx`)
- [ ] (SME) 로그아웃 후 **옛 비밀번호**로 로그인해 본다 → 실패한다 (근거: §8 S2 「관리자가 발급한 초기 비밀번호는 더 이상 사용할 수 없습니다」 `src/pages/ChangePasswordPage.tsx:110`)
- [ ] (SME) 일부러 5회 연속 틀린다 → `로그인 시도가 5회 연속 실패했습니다. 60초 후에 다시 시도해 주세요. (남은 시간 N초)`가 뜨고 카운트가 줄어든다 (근거: §8 S3, `src/pages/LoginPage.tsx:6-7,122-123`)

### C. 시작 가이드 통과

- [ ] (SME) 비밀번호 변경 직후 → **가이드 4장 카드 화면**이 뜬다. 사이드바·다른 메뉴로 빠져나갈 수 없다 (근거: §6-1, `src/App.tsx:281-290`)
- [ ] (SME) 카드 ①을 읽는다 → 제목 `조사 취지와 방식`, 본문 `직무·과업 초안을 HCG가 먼저 작성했습니다. 여러분은 초안이 실제 업무와 맞는지 확인·보완해 주시면 됩니다. 처음부터 작성하는 조사가 아닙니다.`(「확인·보완」이 굵게) (근거: §6-1 고정 문언, `src/pages/sme-review/copy.ts:60-64`)
- [ ] (SME) 카드 ②를 본다 → `무엇을 하게 되는지 — 5단계 미리보기`와 STEP 1~5 정식 제목 목록 (근거: `src/pages/sme-review/copy.ts:71-75`)
- [ ] (SME) 카드 ③을 읽는다 → `투입 비중(FTE)은 지난 1년 기준, 이 직무 수행에 실제로 들어간 시간의 상대적 비중을 과업별로 배분하는 것입니다. 직무 단위 합계가 100%가 되면 됩니다. 개인별 소요 시간을 실측하는 방식이 아니므로, 시계를 재실 필요가 없습니다.` (근거: §6-1 고정 문언, `src/pages/sme-review/copy.ts:82-86`)
- [ ] (SME) 카드 ④를 읽는다 → `예상 소요는 직무당 약 N분이며, 입력은 자동 저장됩니다. 중간에 나가셔도 이어서 진행됩니다. 막히는 부분은 화면 우측 하단 '문의하기'로 남겨 주세요.` N이 §1-2에서 넣은 값과 같은지 확인 (근거: `src/pages/sme-review/copy.ts:98-103`)
- [ ] (관리자) `/settings`의 「가이드 추가 안내」에 한 문장을 넣어 두고 (SME)가 마지막 카드를 본다 → 고정 문언 **아래에** 「추가 안내」 상자로 따로 표시된다(고정 문언 안에 섞이지 않는다) (근거: `src/pages/GuidePage.tsx:240-249`)
- [ ] (SME) 마지막 카드에서 「시작하기」를 누른다 → 가이드가 닫히고 `/assignments`로 들어간다 (근거: `src/pages/sme-review/copy.ts:116`, `src/pages/GuidePage.tsx:143-165`)
- [ ] (실시자) SQL `SELECT email, guide_completed_at FROM public.profiles WHERE role='sme';` → 통과 시각이 기록됨 (근거: §6-1 「가이드 통과 시각을 기록」)
- [ ] (SME) 로그아웃 후 다시 로그인한다 → 가이드가 **다시 강제되지 않는다** (근거: `src/App.tsx:281`)
- [ ] (SME) 사이드바 「가이드 다시 보기」를 누른다 → 같은 4장 카드가 열리고 마지막 버튼이 「시작하기」가 아니라 **「닫기」**로 바뀐다 (근거: §6-1 「상시 재열람」, `src/App.tsx:86`, `src/pages/GuidePage.tsx:260`)

### D. 배정 직무 확인

- [ ] (SME) `/assignments` 「내 검토 목록」을 연다 → 배정된 직무 카드가 보이고 각 카드에 상태와 `마지막 저장 …` 또는 `아직 저장한 내용이 없어요`가 표시 (근거: §5-1, `src/pages/MyAssignmentsPage.tsx:13-14,45`)
- [ ] (SME) 배정 목록의 직무 수를 센다 → §1-2에서 제한한 활성 직무 수와 같다. 다르면 §0의 배정 규칙 때문이므로 그대로 기록한다
- [ ] (SME) 주소창에 배정되지 않은 직무의 `/review/<다른 jobId>`를 친다 → 검토 화면이 열리지 않거나 저장이 거부된다(관측한 실제 동작을 기록) (근거: §7-2 RLS, `src/pages/SmeReviewPage.tsx:9-11` 주석)

### E. 5단계 완주 — 각 단계 게이트 확인

각 단계에서 **먼저 게이트를 일부러 걸어 보고**, 그 다음에 채워서 넘어간다.
게이트에 걸리면 「다음 단계」 버튼이 비활성이 되는 것이 아니라 **그 자리에 사유 목록이 뜬다**
(`src/pages/sme-review/wizard.tsx:318-345`, `src/pages/SmeReviewPage.tsx:953-958`).

**STEP 1 직무 개요 확인**

- [ ] (SME) 아무것도 고르지 않고 「다음 단계」 → `다음 단계로 넘어가기 전에 확인해 주세요.` + `적합성을 1건 선택해 주세요.` (근거: §6-2 표, `src/pages/sme-review/copy.ts:204,233`)
- [ ] (SME) 「부적합」을 고르고 의견·수정안을 비운 채 「다음 단계」 → `'부적합' 또는 '일부 수정 필요'를 고르셨어요. 의견이나 수정안 중 하나는 적어 주셔야 다음 단계로 넘어갈 수 있어요.` (근거: `src/pages/sme-review/copy.ts:207-208`, `src/pages/sme-review/wizard.tsx:75-79`)
- [ ] (SME) A 직무명·B 직무정의 **둘 다** 평가한다 → 좌측 StepChecklist의 1번에 체크 표시가 생긴다 (근거: `src/pages/sme-review/wizard.tsx:92-96,182`)

**STEP 2 과업·활동 확인·보완**

- [ ] (SME) 과업 하나를 평가하지 않고 「다음 단계」 → `아직 평가하지 않은 과업이 N건 있어요. 모두 평가해 주세요.` (근거: `src/pages/sme-review/copy.ts:211`)
- [ ] (SME) 신규 과업을 추가하고 명칭을 비운 채 「다음 단계」 → `추가하신 신규 과업의 명칭을 입력해 주세요.` (근거: `src/pages/sme-review/copy.ts:214`)
- [ ] (SME) 「직군별 작성 예시 보기」를 펼친다 → 기획·관리 / 영업·고객 / 생산·기술 3개 표본 예시가 보인다 (근거: §6-2 STEP 2 「직군별 작성 예시 팝오버」, `src/pages/sme-review/copy.ts:290-313`)
- [ ] (SME) 과업 하나에 **삭제 제안**을 하고, 신규 과업 1건을 명칭까지 채운다 → 다음 단계로 넘어간다

**STEP 3 투입 비중(FTE) 배분** — §6-2 상세·그림 6-A

- [ ] (SME) 헤더를 확인한다 → 칩 `지난 1년` + `이 직무에 쓴 시간만을 100%로 봅니다(타 직무 겸직 시간 제외)`가 접히지 않고 항상 보인다 (근거: §6-2 「겸직·비중 인식 지원」, `src/pages/sme-review/copy.ts:131,137`, `src/pages/sme-review/fte.tsx:400-403`)
- [ ] (SME) 안내문을 확인한다 → `지난 1년 기준, 이 직무 수행에 실제로 들어간 시간의 비중을 과업별로 배분해 주세요. 합계 100%가 되면 다음으로 진행됩니다. (개인별 시간 실측이 아닙니다)` (근거: `src/pages/sme-review/copy.ts:127-128`)
- [ ] (SME) 배분 대상 목록을 센다 → STEP 2에서 **삭제 제안한 과업은 빠져 있고**, 신규 제안 과업은 `SME 추가 제안 과업` 배지를 달고 들어와 있다. 목록 아래에 `삭제 제안 1건은 배분 대상에서 제외되었습니다` (근거: §10 P2 DoD ①, `src/pages/sme-review/copy.ts:164,167`, `src/pages/sme-review/fte.tsx:102-152`)
- [ ] (SME) 합계가 100 미만인 상태에서 「다음 단계」를 본다 → 버튼 라벨이 **`다음 단계 (100% 필요)`** 이고, 누르면 `배분 합계가 100%가 되어야 다음 단계로 넘어갈 수 있어요. 지금은 N%예요.` (근거: 그림 6-A, `src/pages/sme-review/copy.ts:152,217-218`)
- [ ] (SME) 게이지를 본다 → `배분 합계` / `N% / 100%` / `잔여 M%를 배분해 주세요` (근거: `src/pages/sme-review/copy.ts:143,149`, `src/pages/sme-review/fte.tsx:196-212`)
- [ ] (SME) 합계를 100 초과로 만든다 → `N% 초과됐어요. 합계가 100%가 되도록 줄여 주세요` + 게이지가 적색 (근거: §6-2 「초과 시 초과분 적색 표시」, `src/pages/sme-review/copy.ts:158`, `src/pages/sme-review/fte.tsx:162,188`)
- [ ] (SME) 「균등 배분으로 시작」을 누른다(이미 값이 있는 상태에서) → `이미 입력한 비중을 지우고 균등하게 다시 배분할까요?` 확인창 → 확인하면 **합계가 정확히 100**이 된다(나머지를 앞쪽부터 1씩 얹는다) (근거: §6-2 「잔여 없이 n등분」, `src/pages/sme-review/fte.tsx:90-95,375-382`)
- [ ] (SME) 한 과업에 100%를 몰아준다 → 모달 `한 과업에 100%를 배분했어요` / `이 직무의 시간이 사실상 한 과업에 쓰인다는 의미입니다. 맞습니까?` / 버튼 `맞습니다`·`다시 배분할게요` (근거: 품질 가드 ⓐ, `src/pages/sme-review/copy.ts:176-181`)
- [ ] (SME) 「다시 배분할게요」를 누른다 → **직전 값으로 되돌아온다** (근거: `src/pages/sme-review/fte.tsx:557-575`)
- [ ] (SME) 0%인 과업을 남겨 둔다 → `투입 비중이 0%인 과업이 N건 있어요. 그대로 제출할 수 있지만, 실제로 수행하지 않는 과업인지 한 번만 확인해 주세요.` — **막지 않고 알리기만** 한다 (근거: 품질 가드 ⓑ, `src/pages/sme-review/copy.ts:187-188`)
- [ ] (SME) 5% 미만 배분을 3건 이상 만든다 → `5% 미만으로 배분한 과업이 N건이에요. 비슷한 과업을 묶으면 비중을 읽기 쉬워집니다.` (근거: 품질 가드 ⓒ, `src/pages/sme-review/copy.ts:194-195`, `src/pages/sme-review/fte.tsx:527`)
- [ ] (SME) 합계를 정확히 100으로 맞춘다 → 게이지가 초록으로 바뀌고 버튼 라벨이 `다음 단계`로 돌아온다 (근거: `src/pages/sme-review/fte.tsx:186-188,214-222`)

**STEP 4 Skill·수행요건 확인**

- [ ] (SME) Skill 또는 수행요건 하나를 비운 채 「다음 단계」 → `아직 평가하지 않은 항목이 N건 있어요. 모두 평가해 주세요.` (근거: `src/pages/sme-review/copy.ts:221`)
- [ ] (SME) 수행요건 3항목(요구 학력·관련 전공·자격증)이 모두 평가 대상에 들어가는지 확인 → 3건 모두 평가해야 넘어간다 (근거: `src/pages/sme-review/wizard.tsx:50,112-116`)

**STEP 5 최종 확인·제출**

- [ ] (SME) 제출 요약을 확인한다 → 「단계별 완료 현황」(STEP 1~4, 완료/미완료 + n/m), 「제안 요약」(수정 제안 / 신규 제안 과업·Skill / 삭제 제안 건수), 「투입 비중 상위 과업 (합계 100%)」 상위 3개 (근거: §6-2 STEP 5, `src/pages/SmeReviewPage.tsx:1152-1214`)
- [ ] (SME) 미완료 단계가 있는 상태에서 요약을 본다 → 그 줄에 `STEP N으로 이동` 버튼이 있고 누르면 해당 단계로 간다 (근거: §6-2 「미완료 항목은 해당 단계로 바로가기 링크」, `src/pages/SmeReviewPage.tsx:1166-1171`)

### F. 임시저장 · 이탈 후 재진입 복원

- [ ] (SME) 입력하고 손을 뗀다 → 상단 칩이 `입력 중 · 잠시 후 자동 저장` → 약 2.5초 뒤 `저장 중…` → `자동 저장됨 · 방금` (근거: §6-2 「자동 저장(2.5초)」, `src/pages/sme-review/copy.ts:241-257`)
- [ ] (SME) 「임시저장」 버튼을 직접 누른다 → 같은 칩이 `자동 저장됨 · 방금`이 된다 (근거: `src/pages/SmeReviewPage.tsx:941-952`)
- [ ] (SME) 저장이 끝나기 전에 사이드바의 다른 메뉴를 누른다 → `저장하지 않은 검토 내용이 있어요. 이 화면을 떠나면 작성 중인 내용이 사라집니다. 이동할까요?` (근거: `src/App.tsx:320-322`)
- [ ] (SME) 브라우저 탭을 닫으려 한다 → 브라우저의 이탈 확인 대화상자가 뜬다 (근거: `src/App.tsx:325-331`)
- [ ] (SME) STEP 3에서 값을 넣고 저장된 것을 확인한 뒤 브라우저를 완전히 닫는다 → 다시 로그인해 `/assignments`에서 같은 직무를 연다 → **같은 단계(STEP 3)·같은 값**으로 복원된다 (근거: §10 P2 DoD ③, `src/App.tsx:601-627`)
- [ ] (SME) 주소창의 `?step=2`를 손으로 `?step=4`로 바꾼다 → STEP 4가 열린다. 브라우저 **뒤로가기**로 STEP 2로 돌아온다 (근거: `src/App.tsx:600,648-650`)
- [ ] (실시자) 네트워크를 끊고 SME가 입력하게 한다 → 칩이 `저장하지 못했어요` + 사유 + `입력하신 내용은 화면에 그대로 남아 있어요. 네트워크 연결을 확인한 뒤 '다시 저장'을 눌러 주세요.` + 「다시 저장」 버튼 (근거: `src/pages/sme-review/copy.ts:251-252,355-356`, `src/pages/sme-review/wizard.tsx:253-276`)
- [ ] (실시자) 네트워크를 복구하고 「다시 저장」을 누른다 → 저장된다. **입력이 사라지지 않는다** (근거: 같은 곳)

### G. 최종 제출

- [ ] (SME) STEP 3 합계를 99로 만들어 두고 STEP 5에서 「최종 제출」을 누른다 → 제출 모달이 뜨지 않고 그 자리에 게이트 사유가 뜬다(클라이언트가 먼저 막는다) (근거: §10 P2 DoD ②, `src/pages/SmeReviewPage.tsx:958-966`)
- [ ] (실시자) 서버 게이트도 확인한다 — SQL로 `task_fte_allocations`의 한 행을 직접 고쳐 합계를 99.99로 만든 뒤 SME가 제출한다 → 제출되지 않고 `아직 제출할 수 없어요. 채워야 할 항목이 N개 있어요. 아래 항목을 눌러 해당 단계로 이동해 주세요.` + `투입 비중 합계가 99.99%입니다. 합계가 100%가 되도록 배분해 주세요.` (근거: §10 P1 DoD ③ · §7-2, `supabase/APPLY_2026-09-01_phase1.sql:960-961`, `src/pages/sme-review/copy.ts:224-227`)
- [ ] (실시자) 위 실패 직후 SME의 입력이 그대로 남아 있는지 확인한다 → **롤백되지 않는다**(서버가 예외 대신 `{ok:false, missing:[…]}`를 돌려준다) (근거: `supabase/APPLY_2026-09-01_phase1.sql` submit_review 주석 ★)
- [ ] (SME) 합계를 100으로 되돌리고 「최종 제출」 → 모달 `검토를 제출할까요?` / `최종 제출 후에는 관리자가 재검토를 요청하기 전까지 수정할 수 없어요.` (근거: `src/pages/SmeReviewPage.tsx:987-988`)
- [ ] (SME) 「제출하기」 → 토스트 `검토를 제출했어요. 관리자가 확인한 뒤 결과가 반영됩니다.` (근거: `src/pages/SmeReviewPage.tsx:659`)
- [ ] (SME) 제출 후 화면을 본다 → 상단에 `이미 제출한 검토라 수정할 수 없어요 (제출 …). 수정이 필요하면 관리자에게 재검토를 요청해 주세요.` 그리고 **모든 입력이 잠긴다**. 단계 이동은 읽기용으로 열려 있다 (근거: `src/pages/SmeReviewPage.tsx:770-778`, `:227-228`, `:571`)
- [ ] (실시자) 제출 직후 SQL `SELECT action, entity_id, meta, created_at FROM public.audit_logs WHERE action IN ('REVIEW_SUBMITTED','REVIEW_RESUBMITTED') ORDER BY created_at DESC LIMIT 5;` → **`REVIEW_SUBMITTED` 1행**(`meta`에 `status`·`job_id`·`job_name`, SME 성명·이메일은 없다). **0행이면 ⑦이 적용되지 않았거나 감사 기록이 빠진 것이다** — 제출 자체는 성공했으므로 화면에는 아무 표시도 없다 (근거: §8 S5, `supabase/APPLY_2026-09-02_followup.sql` 확인 (4))
- [ ] (실시자) 건수를 대조한다 — 같은 파일의 확인 (6)을 `<적용 시각>`을 채워 실행한다 → **이력 = 감사**. 감사 쪽이 작으면 그만큼 기록이 조용히 빠진 것이므로 그 사실을 §10-2에 적는다 (근거: `supabase/APPLY_2026-09-02_followup.sql` 확인 (6))
- [ ] (SME) SME 2명이 **같은 직무**를 각각 제출한다(비교 뷰를 만들기 위해). 두 사람의 FTE를 한 과업에서 **20%p 이상 벌려 둔다** → 아래 H에서 하이라이트를 확인할 준비 (근거: §6-3ⓑ, `src/lib/workshopThresholds.ts:31`)

### H. 관리자 워크벤치 — 비교 · 반려

- [ ] (관리자) `/workbench` 「제출 큐」를 연다 → 제출된 직무가 목록에 뜨고 이견 신호 배지·워크숍 후보 표시가 보인다. 정렬은 이견 신호 → 제출일 (근거: §6-3ⓑ, `src/pages/WorkbenchPage.tsx:12,84`)
- [ ] (관리자) 직무를 눌러 `/workbench/:jobId` 비교 뷰를 연다 → 상단 칩 `이견 신호 N건`(+ 해당하면 `· 워크숍 후보`) (근거: 그림 6-B, `src/pages/workbench/compare.tsx:261-262`)
- [ ] (관리자) SME 헤더를 본다 → `이름 (조직 · 직급) — 제출 09/24` 형식 (근거: `src/pages/workbench/compare.tsx:61-63`)
- [ ] (관리자) 「적합성 판정 불일치」 표를 본다 → 판정이 갈린 행만 모여 있고, 없으면 `판정이 갈린 항목이 없습니다.` (근거: `src/pages/workbench/compare.tsx:370-373`)
- [ ] (관리자) 「과업별 투입 비중(FTE)」 표를 본다 → **비중 차 ≥ 20%p 행이 하이라이트**되고 하이라이트마다 사유 문구가 함께 붙는다(색만으로 알리지 않음). 배지 문구는 `FTE 비중 차 20%p+` (근거: §10 P3 DoD ②, `src/lib/workshopThresholds.ts:31,77`, `src/pages/workbench/compare.tsx:71,450`)
- [ ] (관리자) 한쪽만 제안한 신규 과업 행을 본다 → 제안 안 한 SME 칸이 `－ 미제안`(0%가 아니다). FTE를 아직 안 낸 확정 과업은 `－ 미응답` (근거: `src/pages/workbench/compare.tsx:556-557`)
- [ ] (관리자) 「승인 · 반려」에서 사유 없이 「반려」를 시도한다 → `반려 사유를 입력해 주세요. SME가 무엇을 고쳐야 하는지 알 수 없습니다.` (근거: §7-2 decide_review, `src/pages/workbench/compare.tsx:711`)
- [ ] (관리자) 사유를 적고 SME A 1명만 반려한다 → 토스트 `… 님의 검토를 반려했습니다.` (판정 대상은 직무 전체가 아니라 **그 SME의 검토 1건**) (근거: `src/pages/workbench/compare.tsx:204,608,630`)
- [ ] (실시자) SQL로 `SELECT status, rejected_reason FROM public.reviews WHERE id='<review id>';` → `REVIEW_REQUESTED` + 입력한 사유. `review_history`와 `audit_logs`에도 남는다 (근거: §7-2, `supabase/APPLY_2026-09-01_phase1.sql` decide_review)

### I. SME 재검토 — 사유 배너 확인

- [ ] (SME A) 다시 로그인해 그 직무를 연다 → 상단에 **주황 배너** `관리자가 재검토를 요청했어요 (일시)` + 관리자가 쓴 사유가 **줄바꿈까지 그대로** + `내용을 고친 뒤 STEP 5에서 다시 제출해 주세요.` (근거: §10 P3 DoD ①, `src/pages/sme-review/recheck.tsx:52-60`, `src/pages/SmeReviewPage.tsx:788`)
- [ ] (SME A) 입력을 고쳐 본다 → **편집이 다시 열려 있다**(잠금 배너가 사라졌다). 5단계 전부가 열린다 — 반려가 겨눈 단계를 저장하는 컬럼이 없어 특정 단계만 열지 않는다 (근거: `src/pages/SmeReviewPage.tsx:227-228`, `:783-787` 주석)
- [ ] (SME B) 같은 직무를 연다 → **SME B에게는 배너가 없고 여전히 제출 잠금 상태**다(반려는 그 SME의 검토 1건에만 걸린다) (근거: `src/pages/workbench/compare.tsx:608`)

### J. 재제출 → 승인

- [ ] (SME A) 사유대로 고치고 STEP 5로 간다 → 제출 버튼 라벨이 **`재제출`** (근거: `src/pages/SmeReviewPage.tsx:972`)
- [ ] (SME A) 재제출한다 → 다시 잠금 상태가 되고 상태가 `재제출 완료` (근거: `src/pages/SmeReviewPage.tsx:86,227`)
- [ ] (관리자) 비교 뷰를 새로고침한다 → SME A 카드가 `반려된 검토입니다…`가 아니라 다시 판정 가능한 상태로 바뀐다 (근거: `src/pages/workbench/compare.tsx:161` 주석)
- [ ] (관리자) SME A·B를 각각 「승인」한다 → 카드에 `승인 완료 (일시)` (근거: `src/pages/workbench/compare.tsx:658`)
- [ ] (실시자) SQL `SELECT status, approved_at FROM public.reviews WHERE id IN (…);` → `approved_at`이 찍혔다. 제출된 적 없는 검토에는 찍히지 않는다 (근거: `supabase/APPLY_2026-09-01_phase1.sql` decide_review — 승인은 `submitted_at IS NOT NULL`에만)

### K. Export 5종 검산

- [ ] (관리자) `/exports`를 연다 → E1~E5 카드 5개, 각 카드에 §9 표의 **산출물 매핑 칩**이 그대로 붙어 있다(E1=계약 1-(2)/1-(3)/23면 현황진단 행, E2=계약 1-(4)/계약 3-(4) 원천/16면, E3=계약 2-(2) JD/23면, E4=13면, E5=검수 대응/11면 ○○분 확정 근거) (근거: §9 표, `src/lib/exportSchema.ts:517-567`, `src/pages/ExportsPage.tsx:290`)
- [ ] (관리자) E1을 XLSX·CSV·JSON으로 각각 내려받는다 → 3종 모두 파일이 만들어진다(브라우저의 "여러 파일 다운로드" 허용이 필요할 수 있다) (근거: §10 P4 DoD ①, `src/pages/ExportsPage.tsx:369-387`)
- [ ] (관리자) E1을 열고 파일럿 SME 2명의 응답과 대조한다 → 적합성 판정·의견·수정/삭제/신규 제안·FTE 비중·제출/승인 시각이 화면에서 본 값과 같다 (근거: §9 E1)
- [ ] (관리자) E2를 **「승인 응답 기준」**으로 내려받는다 → 승인한 검토만 집계에 들어간다 (근거: §9 E2 토글, `src/pages/ExportsPage.tsx:313-317`)
- [ ] (관리자) E2를 **「전체 기준」**으로 다시 내려받는다 → 승인 전 검토까지 포함되어 「응답 수」가 늘어난다. 두 파일의 차이가 승인/미승인 구분과 일치하는지 확인 (근거: §9 E2)
- [ ] (관리자) **E2 수기 검산** — 파일럿 직무 1개를 골라 SME 2명의 STEP 3 화면 값을 손으로 적고, 과업별 평균·표준편차를 Excel `AVERAGE`/`STDEV.S`로 계산해 E2 피벗 값과 맞춘다 → **일치**. (표준편차는 표본표준편차 n-1 정의를 쓴다. 응답 1건이면 정의되지 않아 빈칸이다) (근거: §10 P4 DoD ②, `src/lib/exportApi.ts:61-63,237`)
- [ ] (관리자) E3을 연다 → job_description / task_activity(**FTE 비중 열 포함**) / skill / requirements 4시트, 승인 반영 기준 (근거: §9 E3, `src/lib/exportSchema.ts:538-547`)
- [ ] (관리자) E4를 연다 → 워크숍 대상 직무와 **플래그 사유(자동/수동)** 가 함께 실린다 (근거: §9 E4, `src/lib/exportSchema.ts:548-556`)
- [ ] (관리자) E5를 연다 → 3시트(상태 전이 이력 · 감사 로그 · **소요 실측 요약**). 감사 로그 시트에는 계열사 필터가 그대로 걸리지 않는다는 안내가 파일에도 실린다 (근거: §9 E5, `src/lib/exportSchema.ts:557-566`, `src/pages/ExportsPage.tsx:343`)
- [ ] (관리자) 「수동 스냅샷」을 내려받는다 → 주요 표가 JSON 한 벌로 저장된다 (근거: §8 S7 · §11-2 Phase 4 4번, `src/pages/ExportsPage.tsx:424-466`)
- [ ] (실시자) SQL `SELECT action, entity, entity_id, created_at FROM public.audit_logs ORDER BY created_at DESC LIMIT 20;` → Export 실행이 `entity='export'`, `entity_id='E2'` 형태로 남아 있다 (근거: §8 S5, `src/pages/ExportsPage.tsx:194-196`)

### L. 워크숍 플래그 확인

- [ ] (관리자) 비교 뷰 아래 「워크숍 대상 지정」 패널을 본다 → 자동 규칙 ①~④가 각각 **걸림/안 걸림 + 판정 기준 + 측정값**과 함께 나열된다 (근거: §6-3ⓑ, `src/pages/workbench/WorkshopFlagPanel.tsx:232-233`)
- [ ] (관리자) 규칙 ④를 확인한다 — SME 1명만 제출한 직무를 열어 본다 → `교차 확인 불가 — 워크숍 후보. 제출한 SME가 1명뿐이라 응답을 서로 비교할 수 없…` (근거: 규칙 ④, `src/lib/workshopThresholds.ts:45`, `src/pages/workbench/compare.tsx:298`)
- [ ] (관리자) 「자동 판정 반영」을 누른다 → 자동 규칙 결과가 그대로 저장되고 상태 칩이 `워크숍 후보 · 자동 판정` 또는 `대상 아님 · 자동 판정` (근거: `src/pages/workbench/WorkshopFlagPanel.tsx:196-201,325`)
- [ ] (관리자) 자동 판정과 **다른** 결정을 사유 없이 저장해 본다 → `자동 판정과 다른 결정입니다 — 사유를 입력해 주세요.` (근거: `src/pages/workbench/WorkshopFlagPanel.tsx:162`)
- [ ] (관리자) 사유를 적고 수동 지정한다 → 토스트 `워크숍 대상으로 지정했습니다.`, 칩이 `워크숍 후보 · 수동 결정`, 「저장된 사유 (누적)」에 사유가 **덧붙는다**(기존 사유를 지우지 않는다) (근거: `src/pages/workbench/WorkshopFlagPanel.tsx:150,259,292`)
- [ ] (실시자) SQL `SELECT job_id, flagged, reasons FROM public.job_workshop_flags;` → `reasons` 배열에 자동 사유(`부적합 30%+`, `FTE 1위 불일치`, `신규 제안 3건+`, `SME 응답 1명`)와 `수동: …`이 축적된다 (근거: §10 P3 DoD ③, `src/lib/workshopThresholds.ts:62-67`, `src/pages/workbench/WorkshopFlagPanel.tsx:31`)
- [ ] (관리자) E4를 다시 내려받아 위 플래그가 실렸는지 확인한다 → 같은 직무·같은 사유 (근거: §9 E4)

### M. 문의 작성 · 답변 확인

- [ ] (SME) 검토 화면 **우측 하단** 「문의하기」 버튼을 누른다 → 모달이 열리고 상단에 `직무: … · 단계: STEP N … — 이 정보가 함께 전달됩니다.` (근거: §6-1 카드 ④ · §6-3ⓒ, `src/pages/sme-review/inquiry.tsx:100,126-133`)
- [ ] (SME) 5단계를 각각 열어 문의 버튼이 **모든 단계에** 있는지 본다 → 전 단계에 있고, STEP 3에서는 하단 고정 게이지 바를 **덮지 않는다** (근거: `src/pages/sme-review/inquiry.tsx:73-87`, `src/pages/SmeReviewPage.tsx:681-682`)
- [ ] (SME) 문의를 남긴다 → 토스트 `문의를 남겼습니다. 답변이 등록되면 '내 문의' 화면에서 확인하실 수 있어요.` (근거: `src/pages/sme-review/inquiry.tsx:60`)
- [ ] (관리자) `/inbox` 「문의 인박스」를 연다 → 그 문의가 `미답` 상태로, SME 이름과 **직무·단계 컨텍스트**와 함께 도착해 있다. 접수 당일이면 `오늘 접수` (근거: §6-3ⓒ, `src/pages/InquiryInboxPage.tsx:73,247,338`)
- [ ] (관리자) 답변을 쓰고 「답변 저장」 → 토스트 `답변을 저장했습니다. SME 화면에 배너로 표시됩니다.` (근거: `src/pages/InquiryInboxPage.tsx:204,387`)
- [ ] (SME) 검토 화면을 새로고침한다 → 상단에 파란 배너 `문의 N건에 답변이 등록되었어요 (최근 …)` + 「내 문의에서 확인」 버튼 (근거: §6-3ⓒ, `src/pages/sme-review/recheck.tsx:99-110`)
- [ ] (SME) 「내 문의에서 확인」을 누른다 → 작성 중 내용이 있으면 이탈 확인창을 거친 뒤 `/inquiries`로 이동하고 답변이 보인다 (근거: `src/App.tsx:655-658`, `src/pages/MyInquiriesPage.tsx:92`)
- [ ] (관리자) 그 문의를 「종결」한다 → SME 화면에서 배너가 사라진다(배너는 `ANSWERED`만 대상) (근거: `src/pages/InquiryInboxPage.tsx:228`, `src/pages/sme-review/recheck.tsx:72-77`)
- [ ] (SME) 검토를 시작하지 않은 상태(`/guide` 등)에서 문의를 남겨 본다 → `아직 검토를 시작하지 않아 직무는 함께 전달되지 않습니다. 문의 내용에 직무명을 적어 주시면 확인이 빠릅니다.` (근거: `src/pages/sme-review/inquiry.tsx:135-139`)

### N. 관리자 운영 화면(부수 확인)

- [ ] (관리자) `/dashboard`를 연다 → 상단 4지표(응답률(제출/배정) · 마감 D-day · 미시작 SME 수 · 미답 문의 수)가 모두 값을 갖는다 (근거: §6-3ⓐ, `src/pages/DashboardPage.tsx:261-297`)
- [ ] (관리자) `/progress` 진행 매트릭스를 연다 → 행=조직, 열=직무, 셀=상태. 배정 0명 칸은 `배정 없음`으로 표시된다(§6-3ⓐ R6 점검) (근거: `src/pages/ProgressMatrixPage.tsx:76`, `src/lib/adminApi.ts:296-300`)
- [ ] (관리자) 셀을 누른다 → 그 직무의 검토 워크벤치가 열린다 (근거: `src/pages/ProgressMatrixPage.tsx:719`)
- [ ] (관리자) 「미제출」 필터로 대상을 고르고 리마인더를 보낸다 → 발송 결과에 `시뮬레이션 모드입니다 — 실제 메일은 발송되지 않습니다. 발송 이력(mail_logs)에는 시뮬레이션으로 기록됐습니다.` (RESEND 키 미설정 시) (근거: §10 P4 DoD ③, `src/pages/admin/MailSendPanel.tsx:339-342`)
- [ ] (실시자) SQL `SELECT simulated, count(*) FROM public.mail_logs GROUP BY 1;` → 시뮬레이션 발송이 기록됨 (근거: §10 P4 DoD ③)
- [ ] (관리자) `/analytics/fte`를 연다 → 화면 하단에 종료선 문구 `본 화면은 투입 비중 분포의 집계까지 제공하며, 적정 인력의 확정 수치 산정은 후속 별도 과제로 구분됩니다`가 고정 표기 (근거: §6-3ⓒ 16면, `src/pages/FteAnalyticsPage.tsx:522`)

### N'. SME 배정 관리 — R6 점검·정리 (`/assignments-admin`)

이 화면은 §0의 「전 직무 자동 배정」을 **사후에** 정리한다. 자동 배정을 막지는 못한다.
A(계정 발급) 직후에 한 번, 그리고 SME 계정을 추가할 때마다 다시 돌아야 한다.

- [ ] (관리자) 사이드바 「SME 배정 관리」를 누른다 → `/assignments-admin`이 열리고 상단에 R6 근거
      (`R6 · 착수보고 7·12면 — "업무 조사는 직무별 최소 인원의 업무전문가(SME, 1~2명)를 대상으로 운영"`)와
      자동 배정 경고가 고정 표기 (근거: `src/pages/AssignmentAdminPage.tsx`)
- [ ] (관리자) 요약 줄을 본다 → `직무 N개 · 적정 n · 미배정 n · 과다 n`. A에서 SME 2명만 만들었다면
      자동 배정으로 직무당 정확히 2명이 되므로 **대상 회사의 직무가 전부 「적정」**이고 「과다」는 0이다.
      배지 기준은 0명 = 미배정 / 1~2명 = 적정 / 3명 이상 = 과다 (근거: 같은 파일 `r6BadgeOf`)
- [ ] (관리자) 「R6 위반만 (0명 · 3명 이상)」 필터를 누른다 → 목록이 위반 직무만 남는다.
      **SME 2명 상태에서는 위반이 없는 것이 정상이다** — `R6(직무별 1~2명)에 어긋나는 직무가 없습니다.`
      가 뜬다. 「과다」 배지와 아래 해제 절차를 실제로 시험하려면 **먼저** SME 계정을 3명 이상 만들거나
      (A를 한 번 더) SME 명부로 같은 직무에 배정을 더해 직무당 3명을 만든 뒤 이 절로 돌아온다.
      해제 절차 자체는 필터를 「전체」로 두고 일반 목록에서도 그대로 수행할 수 있다 (근거: 같은 파일)
- [ ] (관리자) 직무 한 행을 눌러 펼치고 담당이 아닌 SME의 「배정 해제」를 누른다 →
      **아직 아무것도 작성하지 않았다면** 확인 모달 없이 해제되고 토스트
      `… 배정을 해제했습니다. 응답 데이터는 지워지지 않았습니다.` (근거: `src/lib/assignmentApi.ts` `assignmentGuardOf`)
- [ ] (실시자) SQL `SELECT active FROM public.review_assignments WHERE id = '<해제한 배정 id>';` →
      **행이 남아 있고 `active = false`**. 삭제가 아니다 (근거: `src/lib/assignmentApi.ts:326-335`)
- [ ] (SME) 해제당한 SME로 `/assignments`를 새로 고친다 → 그 직무가 목록에서 사라진다.
      관리자 `/progress`에서도 그 칸이 빠진다 (근거: `src/lib/reviewApi.ts:211`, `src/lib/adminApi.ts:310`)
- [ ] (관리자) **작성 중인** 검토가 있는 SME를 해제해 본다 → 경고 모달 `배정을 해제할까요?` +
      `이미 작성을 시작한 검토입니다…`. 「취소」를 누르면 배정이 그대로다 (근거: 같은 파일)
- [ ] (관리자) **G에서 제출을 마친** SME를 해제해 본다 → 「배정 해제」 버튼이 **비활성**이고 그 옆에
      잠금 사유(`이미 제출된 응답이 있어 배정을 해제할 수 없습니다…`)가 함께 표시된다.
      색만이 아니라 문장으로 알린다 (근거: 같은 파일, §8 S8)
- [ ] (관리자) **반려당한** 검토(H에서 만든 것)의 배정도 해제해 본다 → 상태가 `재검토 요청`으로
      돌아가 있어도 **여전히 막힌다**(제출 시각이 남아 있으므로). 상태만 보고 판단하지 않는다는 확인이다
- [ ] (실시자) 서버도 같은 판정을 하는지 본다 — `supabase/APPLY_2026-09-02_assignment_guard.sql`의
      확인 (3)을 실행한다(제출된 검토의 배정을 `active = false`로 UPDATE → `42501`.
      `BEGIN … ROLLBACK` 안이라 데이터는 그대로다). 화면을 거치지 않는 해제까지 막힌다는 확인이다
      (근거: `supabase/migrations/20260902030000_assignment_deactivate_guard.sql`)
- [ ] (관리자 + SME 2인 동시) **작성 중**인 배정을 관리자가 해제한 직후, 그 SME가 **이미 열어 둔**
      마법사에서 제출을 누른다 → 제출이 막히고 `이 직무의 배정이 해제되어 제출할 수 없습니다.
      방금 입력한 내용은 저장됐습니다…`가 뜬다. 관리자 `/progress`에 「제출됨」이 나타나지 않는다.
      SQL `SELECT count(*) FROM public.reviews r JOIN public.review_assignments a ON a.id = r.assignment_id
      WHERE r.submitted_at IS NOT NULL AND a.active = false;` → **0** (근거: 같은 파일 `submit_review` ⑤)
      (근거: `assignmentGuardOf` — 판정 기준이 `status`가 아니라 `submitted_at`)
- [ ] (관리자) 방금 해제한 SME를 같은 직무에 「배정 추가」로 다시 넣는다 → 되살아난다(새 행이 아니라
      같은 행의 `active`가 다시 `true`). SQL `SELECT count(*) FROM public.review_assignments
      WHERE sme_id='<id>' AND job_id='<id>';` → **1행** (근거: `src/lib/assignmentApi.ts` `addAssignment` upsert)
- [ ] (관리자) 배정이 2명인 직무에서 3명째를 추가해 본다 → 경고 문구
      `이미 2명이 배정되어 있습니다. 더 추가하면 R6(1~2명)을 넘습니다.`가 뜨지만 **추가는 된다**.
      상한이 미확정이라 코드가 막지 않는다는 사실 확인 (근거: §12 오픈이슈 3, `docs/OPEN_ISSUES.md` §3)
- [ ] (실시자) SQL `SELECT action, entity_id, meta FROM public.audit_logs WHERE action IN
      ('ASSIGNMENT_ADDED','ASSIGNMENT_DEACTIVATED') ORDER BY created_at DESC LIMIT 10;` →
      추가·해제가 각각 남고 `meta`에 `sme_id`·`job_id`만 있다(이름·이메일 없음) (근거: §8 S5·S6)
- [ ] (SME) SME 계정으로 로그인해 주소창에 `/assignments-admin`을 직접 친다 → **관리자 화면이 열리지
      않고** SME 홈(`/assignments`)으로 되돌아간다. 사이드바에도 그 항목이 없다 (근거: `src/App.tsx` isAdmin 분기)
- [ ] (실시자) 조회를 일부러 실패시킨다(예: 네트워크 차단 후 새로 고침) → 목록이 **「0건」이 아니라**
      `배정 현황을 불러오지 못했어요…` + 「다시 시도」 버튼으로 표시된다. 「데이터 없음」과 구분된다
      (근거: `src/lib/assignmentApi.ts` `ApiResult` 분기)

---

## 3. 모바일 390px 점검

브라우저 개발자도구에서 폭 **390px**(iPhone 12/13/14 기준)로 고정한다. 화면 확대 200%도 함께 본다.
가로 스크롤이 생기면 그 자체가 실패다(`body { min-width: 320px }` — `src/index.css:94`).

**공통**

- [ ] (실시자) 모든 화면에서 좌우로 흔들어 본다 → 가로 스크롤이 없다. 표는 표 자체만 가로로 스크롤된다
- [ ] (실시자) 상단 좌측 「메뉴 열기」 버튼을 누른다 → 서랍 메뉴가 열리고 항목을 고르면 닫힌다 (근거: `src/App.tsx:352-360`)

**STEP 3 FTE 조작 — 가장 중요**

- [ ] (SME) STEP 3을 연다 → 좌측 단계 목록이 **상단 가로 한 줄**로 바뀌고, 합계 게이지가 **하단 고정 바**로 내려온다 (근거: 그림 6-A 캡션, `src/pages/sme-review/wizard.tsx:161`, `src/pages/sme-review/fte.tsx:226-246`)
- [ ] (SME) 단계를 4→1로 옮겨 본다 → 가로 단계 목록이 스스로 스크롤해 **현재 단계를 가운데로** 끌어온다(화면 밖에 남지 않는다) (근거: `src/pages/sme-review/wizard.tsx:147-153`)
- [ ] (SME) ± 스텝퍼를 손가락으로 누른다 → 버튼이 **44×44px 이상**이라 오눌림이 없다 (근거: `min-h-11 min-w-11` `src/pages/sme-review/fte.tsx:448,487`)
- [ ] (SME) 비중 입력 칸에 이름표가 붙어 있는지 확인한다(과업명만으로는 무엇을 넣는 칸인지 알 수 없다) → 보조기기가 칸의 이름을 읽어 준다 (근거: `src/pages/sme-review/copy.ts:328` 이하)
- [ ] (SME) 숫자 칸을 누른다 → **숫자 키패드**가 뜨고(`inputMode="numeric"`), 칸의 값이 **전체 선택**되어 앞자리가 끼어들지 않는다 (근거: `src/pages/sme-review/fte.tsx:459-480`)
- [ ] (SME) `25`를 친다 → 도중에 `250`이 되었다가 100으로 잘리는 일이 없다(100 초과 입력은 무시되고 직전 값이 남는다) (근거: `src/pages/sme-review/fte.tsx:474-476`)
- [ ] (SME) 하단 고정 바를 본다 → 막대 + `N% / 100%` + 잔여/초과 안내 + 이전/다음 버튼이 한 줄에 다 들어가고 잘리지 않는다 (근거: `src/pages/sme-review/fte.tsx:227-246`)
- [ ] (SME) 페이지를 맨 아래까지 내린다 → 하단 고정 바가 **본문의 마지막 버튼(임시저장/다음 단계)을 덮지 않는다** (셸이 `pb-44` 여백을 준다) (근거: `src/pages/SmeReviewPage.tsx:681-684`)
- [ ] (SME) 「문의하기」 떠 있는 버튼을 본다 → 하단 고정 바 **위에** 떠 있고 겹치지 않는다. iOS 홈 인디케이터 영역에도 걸리지 않는다 (근거: `src/pages/sme-review/inquiry.tsx:78-84`)
- [ ] (SME) 과업명이 아주 긴 행을 본다 → 스텝퍼·입력칸·막대가 **줄바꿈**되어 넘치지 않는다 (근거: `flex-wrap` `src/pages/sme-review/fte.tsx:445`)
- [ ] (SME) 390px에서 배분을 100%까지 끝까지 해 본다 → 끝난다. 걸리는 조작이 있으면 그대로 기록 (근거: §10 P2 DoD ④)

**그 밖의 화면**

- [ ] (SME) 로그인·비밀번호 변경·가이드 4장 카드 → 카드 넘김 버튼이 화면 안에 있고 본문이 잘리지 않는다
- [ ] (SME) STEP 2 긴 과업 목록 → 맨 아래 「다음 단계」를 누르면 새 단계의 제목이 화면 위에 보인다(스크롤이 맨 위로 올라간다) (근거: `src/pages/SmeReviewPage.tsx:595-608`)
- [ ] (관리자) `/progress` 매트릭스, `/workbench/:jobId` 비교 표 → 표만 가로 스크롤되고 페이지는 흔들리지 않는다
- [ ] (관리자) `/exports` 카드 격자 → 1열로 떨어지고 다운로드 버튼이 눌린다
- [ ] (관리자) `/assignments-admin` → 직무 행이 세로로 접히고 배지·SME 칩이 줄바꿈된다. 펼친 칸의 「SME 검색」·「배정할 SME」·「배정 추가」가 1열로 떨어지고, 「배정 해제」 버튼이 44px 이상이라 눌린다 (근거: `min-h-11`, `src/pages/AssignmentAdminPage.tsx`)

---

## 4. 키보드 전용 조작 점검

**마우스를 치우고** Tab / Shift+Tab / 방향키 / Enter / Space / Esc 만으로 아래를 전부 해낸다.
포커스 표시가 보이지 않는 순간이 있으면 그 위치를 기록한다(§8 S8).

- [ ] (실시자) 로그인 → 비밀번호 변경 → 가이드 4장 통과 → 검토 시작까지 **마우스 없이** 해낸다 (근거: §8 S8)
- [ ] (실시자) Tab 순서가 화면에 보이는 순서(위→아래, 좌→우)와 어긋나지 않는다
- [ ] (실시자) Tab으로 화면 전체를 훑는다 → 포커스가 어디 있는지 **항상 윤곽선으로 보인다**. 안 보이는 컨트롤이 하나라도 있으면 그 이름을 기록한다

**적합성 3지선다**

- [ ] (SME) Tab으로 적합성 그룹에 들어간다 → 그룹 전체가 **Tab 한 번**에 잡힌다(선택된 항목, 없으면 첫 항목) (근거: roving tabindex `src/pages/sme-review/controls.tsx:123`)
- [ ] (SME) ←/→ 또는 ↑/↓ 를 누른다 → 「적합」 → 「일부 수정 필요」 → 「부적합」으로 **선택이 옮겨 간다**(포커스만 옮겨 가는 것이 아니라 값도 바뀐다). 끝에서 반대편으로 돌아간다 (근거: `src/pages/sme-review/controls.tsx:74,99-110`)
- [ ] (SME) 다시 Tab을 누른다 → 3지선다 안을 한 번 더 돌지 않고 **다음 요소로 빠져나간다**

**STEP 3 스텝퍼·입력칸**

- [ ] (SME) 숫자 칸에 포커스를 두고 ↑ 를 누른다 → **+5%** (근거: §6-2 「±5% 스텝퍼」, `src/pages/sme-review/fte.tsx:384-389`, `src/pages/sme-review/copy.ts:170`)
- [ ] (SME) ↓ 를 누른다 → **−5%**. 0에서 더 내려가지 않고 100에서 더 올라가지 않는다 (근거: `src/pages/sme-review/fte.tsx:61-64`)
- [ ] (SME) 숫자 칸에서 ↑/↓ 를 누른다 → 값만 바뀌고 **페이지는 스크롤되지 않는다** (근거: `e.preventDefault()` `src/pages/sme-review/fte.tsx:387`)
- [ ] (SME) − / + 버튼에 Tab으로 가서 Enter·Space로 누른다 → 값이 5씩 바뀐다. 각 버튼의 이름이 보조기기에 `〈과업명〉 비중 5% 늘리기` / `〈과업명〉 비중 5% 줄이기`로 읽힌다 (근거: `src/pages/sme-review/copy.ts:325-326`, `src/pages/sme-review/fte.tsx:453,490`)
- [ ] (SME) 스크린리더를 켜고 비중을 바꾼다 → 합계가 바뀔 때마다 **숫자와 잔여/초과 사유를 한 덩어리로** 읽어 준다(`aria-live="polite"`) (근거: `src/pages/sme-review/fte.tsx:197`)
- [ ] (SME) 「균등 배분으로 시작」에 Tab으로 가서 Enter → 확인창이 뜨고 키보드로 확인/취소가 된다

**모달 포커스 트랩**

대상 모달: 제출 확인, 단일 100% 확인, 문의 작성, 반려 사유, 계정 추가, **배정 해제 확인**(`/assignments-admin`).

- [ ] (실시자) 모달이 열리는 순간 → 포커스가 **모달 안 첫 요소**로 들어간다 (근거: `src/components/ui/ModalShell.tsx:59-64`)
- [ ] (실시자) Tab을 계속 누른다 → 포커스가 **모달 밖으로 새지 않고** 안에서 돈다 (근거: `src/components/ui/ModalShell.tsx:74-94`)
- [ ] (실시자) Shift+Tab으로 첫 요소에서 뒤로 간다 → 모달의 **마지막 요소**로 돈다 (근거: 같은 곳 `:84-86`)
- [ ] (실시자) Esc를 누른다 → 닫힌다. 처리 중(`closeDisabled`)일 때는 닫히지 않는다 (근거: `:52-56,76`)
- [ ] (실시자) 모달이 닫힌 직후 → 포커스가 **그 모달을 연 버튼으로 되돌아온다** (근거: `:60,63`)
- [ ] (실시자) 문의 모달에서 본문을 쓰다가 Esc로 닫고 다시 연다 → **쓰던 글이 남아 있다** (근거: `src/pages/sme-review/inquiry.tsx:40-41`)

**단계 이동**

- [ ] (SME) 키보드로 「다음 단계」를 누른다 → 스크롤이 맨 위로 가고 **새 단계의 제목에 포커스가 옮겨 간다**(스크린리더가 바뀐 단계를 읽는다) (근거: `src/pages/SmeReviewPage.tsx:595-608`)
- [ ] (SME) STEP 2에서 「이전 단계」를 눌러 STEP 1로 간다(그 버튼이 STEP 1에서 비활성이 된다) → 포커스가 body로 떨어지지 않고 **새 단계 제목으로 옮겨 간다** (근거: 같은 곳 주석)
- [ ] (SME) 저장 중에 「임시저장」/「다음 단계」를 Enter로 누른다 → 버튼이 비활성으로 바뀌며 **포커스가 body로 떨어지는 일이 없다** (근거: `src/pages/SmeReviewPage.tsx:937-940`, `src/pages/sme-review/wizard.tsx:240-244`)
- [ ] (SME) StepChecklist의 단계 버튼에 Tab으로 접근한다 → 갈 수 없는 단계는 비활성이고 그 이유가 짐작 가능한지 기록(현재 비활성 버튼에는 사유 문구가 없다)
- [ ] (SME) 게이트에 걸렸을 때 → 사유 목록이 `role="alert"`로 **즉시 읽힌다** (근거: `src/pages/sme-review/wizard.tsx:333`)
- [ ] (SME) 「다음 단계」를 눌러 게이트에 걸린다 → **포커스가 사유 상자로 옮겨 간다**(버튼에 남지 않는다). 확대경 사용자가 화면 밖에 뜬 안내를 놓치지 않고, 키보드 사용자가 Shift+Tab으로 되짚지 않아도 된다 (근거: `src/pages/sme-review/wizard.tsx:311-317,319-325`)
- [ ] (SME) 사유 하나만 고치고 다시 「다음 단계」를 누른다 → **남은 사유로 포커스가 다시 옮겨 온다**(같은 상자라고 건너뛰지 않는다) (근거: `src/pages/sme-review/wizard.tsx:320-325`)
- [ ] (SME) 스크린리더를 켜고 게이트에 걸린다 → 사유를 **한 번만** 읽는다(alert와 포커스 대상이 다른 요소라 중복 낭독이 없다) (근거: `src/pages/sme-review/wizard.tsx:314-316` 주석)

**표 스크롤**

- [ ] (관리자) `/progress` 매트릭스, `/workbench/:jobId` 비교 표, `/analytics/fte` 피벗 표를 키보드만으로 **가로로 끝까지 본다** → 스크롤 컨테이너에 Tab으로 포커스가 가서 ←/→ 로 밀 수 있는지 확인. **가지 않는다면 그것이 결함이다**(가로로 넘치는 영역은 키보드로도 스크롤 가능해야 한다 — WCAG 2.1.1). 관측 결과를 그대로 기록
- [ ] (관리자) 표 안의 링크·버튼(셀 클릭 → 워크벤치 이동)에 Tab으로 도달한다 → 도달하고 Enter로 열린다

**배정 관리 아코디언**

- [ ] (관리자) `/assignments-admin`에서 Tab으로 직무 행에 가서 Enter/Space → 펼쳐지고 다시 누르면 접힌다. 스크린리더가 접힘/펼침을 읽는다(`aria-expanded`·`aria-controls`) (근거: `src/pages/AssignmentAdminPage.tsx`)
- [ ] (관리자) 제출된 SME의 비활성 「배정 해제」 버튼에 접근한다 → **왜 못 누르는지가 문장으로 읽힌다**(`aria-describedby`로 잠금 사유가 연결돼 있다). 색만으로 알리지 않는다 (근거: 같은 파일, §8 S8)

---

## 5. 색 대비 점검 (WCAG 2.2 AA · 본문 4.5:1)

토큰 값은 `src/index.css`의 `:root`(현재 15~76행)에서 읽은 **실제 값**이다. 아래 비율은
sRGB 상대휘도로 계산한 수치다(WCAG 2.x 정의). 대형 텍스트 예외(3:1)는 적용하지 않았다 —
이 앱의 본문은 대부분 12~14px이라 4.5:1 기준이 맞다.

> **주의 — 이 절의 수치는 2026-09-01 Phase 5 작업 중 토큰이 조정된 뒤의 값이다.**
> 같은 날 `--foreground-muted`가 `#64748b`(최악 4.33:1) → **`#5b6779`**, `--foreground-subtle`이
> `#94a3b8`(최악 2.33:1) → **`#66707f`** 로 바뀌었다(`src/index.css:22-42` 주석에 변경 이력이 있다).
> 파일럿 시점의 `src/index.css` 값이 아래와 다르면 **다시 계산해서 이 표를 갱신한 뒤** 점검한다.

### 5-1. 계산 결과 — 텍스트 토큰 (7개 표면 전체에 대해 계산, 괄호는 최악 조합)

표면 7종 = `card #ffffff` · `background #f5f6f8` · `muted #f8fafc` · `primary-subtle #edf8f7` ·
`warning-muted #fffbeb` · `destructive-muted #fff1f2` · `success-muted #ecfdf5`

| 토큰 | 값 | 흰 배경 | **최악 조합** | 판정 |
|---|---|---|---|---|
| `foreground` | #1e293b | 14.63:1 | destructive-muted **13.32:1** | 통과 |
| `foreground-muted` | #5b6779 | 5.74:1 | destructive-muted **5.22:1** | 통과 |
| `foreground-subtle` | #66707f | 5.01:1 | destructive-muted **4.56:1** | 통과 (여유 0.06) |

`foreground-subtle`은 저장소에서 **189곳**에 쓰인다(grep 실측). 최악 조합의 여유가 0.06밖에 없으므로
**이 토큰을 조금이라도 밝히면 즉시 AA가 깨진다.** 값을 손대려면 먼저 계산부터 한다.

### 5-2. 계산 결과 — 상태색 위 텍스트 (§8 S8이 콕 집은 자리)

| 조합 | 값 | 비율 | 쓰이는 곳 |
|---|---|---|---|
| `warning` / `warning-muted` | #b45309 / #fffbeb | **4.84:1** | **반려 사유 배너 · 게이트 안내 · 제출 부족 항목** |
| `destructive` / `destructive-muted` | #be123c / #fff1f2 | **5.72:1** | **저장 실패 칩 · 조회 오류 상자** |
| `success` / `success-muted` | #047857 / #ecfdf5 | **5.21:1** | 저장 완료 칩 |
| `primary` / `primary-subtle` | #247d7c / #edf8f7 | **4.51:1** | 문의 답변 배너 · 현재 단계 강조 (여유 0.01) |
| `primary` / `card` | #247d7c / #ffffff | **4.88:1** | 링크·강조 숫자 |
| 흰색 / `primary` | #ffffff / #247d7c | **4.88:1** | 기본 버튼 라벨 |
| 흰색 / `destructive` | #ffffff / #be123c | **6.29:1** | 반려 버튼 |
| 흰색 / `warning` | #ffffff / #b45309 | **5.02:1** | 경고 배지 |
| 흰색 / `success` | #ffffff / #047857 | **5.48:1** | 성공 배지 |

→ **경고·오류 색 위 텍스트는 계산상 전부 4.5:1을 넘는다.** `primary`/`primary-subtle`은 4.51:1로
여유가 0.01이라 브랜드색을 조금만 밝혀도 깨진다 — 기록해 둔다.

### 5-3. 계산 결과 — 아직 미달인 곳

| 조합 | 값 | 비율 | 판정 |
|---|---|---|---|
| 사이드바 **비활성 메뉴 보조설명** `slate-500` / `#182635` | #64748b / #182635 | **3.23:1** | **미달** (`src/App.tsx:491`) |
| 사이드바 비활성 메뉴 라벨 `slate-400` / `#182635` | #94a3b8 / #182635 | 5.99:1 | 통과 (`src/App.tsx:481`) |
| 사이드바 활성 메뉴 보조설명 `slate-300` / `#182635` | #cbd5e1 / #182635 | 10.34:1 | 통과 |

사이드바는 `index.css` 토큰이 아니라 Tailwind 팔레트 색을 직접 쓰기 때문에(`src/App.tsx:337,481,491`)
Phase 5의 토큰 조정에 함께 딸려 오지 않았다. 메뉴 **라벨**은 통과하고 그 아래 **한 줄 설명**만
3.23:1로 미달이다.

### 5-4. 점검 항목

- [ ] (실시자) 점검 시점의 `src/index.css` `:root` 값이 5-1·5-2 표와 같은지 먼저 확인한다 → 같다. 다르면 다시 계산해 표를 갱신한 뒤 진행
- [ ] (실시자) 5-1·5-2를 브라우저 확장(axe DevTools 등)이나 대비 검사기로 **실제 렌더된 화면에서** 재측정한다 → 표의 수치와 일치. (계산은 토큰 값 기준이므로 `bg-white/95`처럼 투명도가 겹친 자리는 값이 달라질 수 있다) — **미확인 — 파일럿에서 확인**
- [ ] (실시자) **본문 텍스트**를 측정한다: 카드 위 본문·보조 설명·"불러오는 중…"·`–`·`해당 없음` 같은 저강조 표기 → 전부 4.5:1 이상
- [ ] (실시자) **경고·오류 색 위 텍스트**를 실제 화면에서 측정한다: 반려 사유 배너(주황), 게이트 안내(주황), 저장 실패 칩(적색), 조회 오류 상자(적색), 제출 부족 항목(주황) → 전부 4.5:1 이상
- [ ] (실시자) 입력 칸의 **placeholder**를 측정한다(`placeholder:text-foreground-subtle` — `src/index.css:102`) → 4.5:1 이상
- [ ] (실시자) 사이드바 메뉴의 **보조설명 줄**을 측정한다 → 3.23:1 미달이 재현되면 그대로 기록하고 조치 대상에 올린다 (근거: `src/App.tsx:491`)
- [ ] (실시자) 브랜드색 여유가 얇은 두 곳(`primary`/`primary-subtle` 4.51, `foreground-subtle` 최악 4.56)을 기록에 남긴다 → 이후 색을 손댈 때 반드시 재계산해야 함을 인수인계에 적는다
- [ ] (실시자) `/analytics/fte` 피벗 표·`/progress` 매트릭스의 **상태 색**을 본다 → 색만으로 상태를 구분하게 두지 않았는지(문구·아이콘이 함께 있는지) 확인 (근거: §8 S8)
- [ ] (실시자) 하이라이트된 비교 뷰 행을 본다 → 색과 **함께 사유 문구**가 붙어 있다 (근거: `src/pages/workbench/compare.tsx:71,767`)
- [ ] (실시자) 흑백 프린트 미리보기나 그레이스케일 필터로 STEP 3·비교 뷰를 본다 → 정보가 사라지지 않는다

---

## 6. 소요 실측 — "직무당 약 ○○분" 확정 근거 (§12 오픈이슈 1)

**기록 경로**: 마법사에 들어갈 때 `review_sessions`에 세션이 열리고, 이탈할 때 닫힌다
(`src/lib/surveyApi.ts:93-116`, `src/pages/SmeReviewPage.tsx:467,487`). 단계(step)도 함께 기록된다.

**확인 위치는 두 곳이고 계산 규칙은 같다.** 다만 **표본 모집단은 완전히 같지 않다** — 아래 두 곳을
대조할 때 이 차이를 먼저 본다(`docs/OPEN_ISSUES.md` §1 「같지 않은 것 — 표본 모집단」).

1. **`/dashboard`의 「직무당 소요 중앙값(실측)」 카드** — 관리자 전용.
   `src/lib/durationApi.ts`(신규)가 집계하고 `src/pages/DashboardPage.tsx`의 `DurationCard`가 그린다.
   화면 분기만이 아니라 **조회 자체를 역할로 막는다**(관리자가 아니면 통계가 `null`) — §6-1의
   "실측치는 관리자 화면에서만 노출(SME 압박 방지)"을 지키기 위한 것이다.
2. **Export E5의 「소요 실측 요약」 시트** — 직무별 행 + 마지막 `전체` 행.
   열은 `직무 ID / 직군 / 직렬 / 직무 / 응답 수 / 소요 중앙값(분) / 소요 평균(분) / 구분`
   (`src/lib/exportSchema.ts:486-508`, `src/lib/exportApi.ts:1432-1462`).

> ⚠ **파일럿 규모에서는 대시보드 카드가 「표본 부족」으로 뜨는 것이 정상이다.**
> `MIN_SAMPLE = 3`이라 **제출 완료 검토가 3건 미만이면 중앙값을 숫자로 내지 않는다**
> (`src/lib/durationApi.ts` MIN_SAMPLE 주석: "2건이면 중앙값은 두 값의 평균일 뿐이고, 그 수가 그대로
> 착수보고의 '직무당 약 ○○분'이 되면 한 사람의 그날 컨디션이 계약 문구가 된다").
> 내부 2~3인 파일럿에서는 **SME 2명 × 직무 2~3개 = 제출 4~6건**을 만들어야 숫자가 나온다.
> 숫자가 안 나온다고 이 항목을 실패로 적지 말고, 표본 수를 그대로 기록한다.

- [ ] (실시자) 표본을 3건 이상 만들 계획을 세운다 → SME 2명이 각각 직무 2개 이상 제출 = 4건 이상 (근거: `src/lib/durationApi.ts` `MIN_SAMPLE = 3`)
- [ ] (실시자) 파일럿 SME가 **한 직무를 끊지 않고** 완주하도록 안내한다(중간 이탈은 세션을 나누고, 창을 그냥 닫으면 구간이 열린 채 끝나 분모에서 빠진다) → 완주 (근거: `src/lib/exportApi.ts:459-465` 주석, `DurationCard`의 `missingRecordCount` 안내)
- [ ] (관리자) `/dashboard`에서 「직무당 소요 중앙값(실측)」 카드를 연다 → 카드가 보이고 부제에 `착수보고 11면 「현업 SME 1인당 예상 소요: 직무당 약 ○○분(착수 후 확정)」을 채우는 실측 근거입니다` (근거: §11-2 Phase 5 2번, `src/pages/DashboardPage.tsx` `DurationCard`)
- [ ] (SME) SME 계정으로 `/dashboard`에 접근을 시도한다 → **실측치가 보이지 않는다**(관리자 라우트이고, 조회 자체가 역할로 막힌다) (근거: §6-1 「SME 압박 방지」, `src/lib/durationApi.ts` 머리주석)
- [ ] (실시자) 카드의 값을 아래에 적는다 → 중앙값 ______ 분 / 표본 ______ 건 / (표본 부족이면 그대로 기록)
- [ ] (실시자) `완료 검토 N건은 소요 기록이 없어 분모에서 제외했습니다` 문구가 뜨는지 본다 → 뜨면 N을 기록(창을 닫아 구간이 열린 채 끝난 경우다) (근거: `DurationCard` `missingRecordCount`)
- [ ] (관리자) 「단계별 중앙값」 목록을 본다 → STEP별 소요가 막대로 보이고 표본이 3건 미만인 단계는 `· 표본 부족`이 붙는다. **어느 단계가 가장 오래 걸렸는지**를 기록한다 — 부담을 줄일 자리다(§6-1) (근거: `src/pages/DashboardPage.tsx` `stepRows`)
- [ ] (관리자) 「운영 설정 「예상 소요」 반영」 칸을 읽는다 → 계열사를 고르지 않았으면 `계열사를 선택하면 그 회사의 운영 설정값과 비교됩니다.`, 설정값이 있고 표본이 충분하면 `현재 설정값 N분, 실측 중앙값 M분으로 …더/덜 걸립니다` (근거: 같은 곳)
- [ ] (관리자) 계열사를 **고른 상태**에서 같은 칸을 다시 읽는다 → `계열사를 선택하면 …`이 **더는 뜨지 않는다**. 설정을 못 읽은 경우에는 `운영 설정을 불러오지 못해 이번에는 비교하지 못했습니다`가 뜬다 — 이 문장이 뜨면 조회 실패이므로 그대로 기록한다(「비어 있습니다」와 다른 상태다) (근거: `src/lib/durationApi.ts` `ExpectedSource`, `src/pages/DashboardPage.tsx` `DurationCard`)
- [ ] (관리자) E5를 내려받아 「소요 실측 요약」의 `전체` 행 중앙값과 대시보드 카드 값을 **대조하고 둘 다 기록한다** → **자동으로 일치하지는 않는다.** 계산 규칙(60분 상한 · 검토별 합계 · 중앙값 정의 · 제출 완료만)은 같지만 **표본 모집단이 다르다** — 대시보드는 **활성 SME**(`profiles.active = true`)의 검토만 세고 E5는 비활성 SME의 검토도 센다. 어긋나면 **먼저 비활성 SME 계정이 있는지 확인**하고, 없는데도 어긋나면 그때가 두 계산이 갈라진 것이므로 즉시 기록한다 (근거: `supabase/APPLY_2026-08-28.sql:467` vs `src/lib/exportApi.ts:308-324`, 차이 정리는 `docs/OPEN_ISSUES.md` §1 「같지 않은 것 — 표본 모집단」)
- [ ] (실시자) 중앙값과 평균이 크게 벌어지는지 E5에서 본다 → 벌어지면 이상치가 있다는 뜻이므로 어느 응답인지 확인 (근거: `src/lib/exportSchema.ts:499`)
- [ ] (실시자) 참가자에게 체감 소요를 물어 함께 적는다 → SME1 ____분 / SME2 ____분 (실측과 체감이 크게 다르면 그 사유를 기록)
- [ ] (관리자) 확정한 값을 `/settings`의 「직무당 예상 소요(분)」에 넣는다 → 가이드 카드 ④의 N이 그 값으로 바뀐다 (근거: §6-1, `src/pages/sme-review/copy.ts:98-103`)
- [ ] (실시자) 확정값을 착수보고 11면의 "직무당 약 ○○분(착수 후 확정)" 문구에 반영하도록 PM에게 전달한다 → 전달 완료 (근거: §12 오픈이슈 1)
- [ ] (실시자) 한 세션이 60분을 넘으면 60분으로 **잘린다**(버리지 않는다)는 것을 알고 결과를 읽는다 → 60분에 붙은 값이 많으면 자리를 비운 채 켜 둔 세션이 섞인 것이다 (근거: `src/lib/durationApi.ts` `SESSION_CAP_MINUTES = 60`)

---

## 7. §12 오픈 이슈 8건 — 파일럿에서 확인할 것 / PM·고객 TF가 결정할 것

| # | 이슈 | **파일럿에서 확인할 것** (이 문서로 답이 나오는 것) | **PM·고객 TF가 결정할 것** (파일럿으로는 못 정하는 것) | 확인 주체(§12) |
|---|---|---|---|---|
| 1 | 직무당 예상 소요 ○○분 | §6의 대시보드 「직무당 소요 중앙값(실측)」 카드 값과 E5 `전체` 행(**둘 다 적는다 — 표본 모집단이 달라 자동으로 일치하지는 않는다**), 표본 수, 단계별 중앙값, 체감 소요와의 차이 | 확정값을 착수보고·가이드 문구에 반영할지, 반영 시점 | 파일럿 결과 |
| 2 | 조직 마스터 입수 | 업로드 시트 ③ 「조직 마스터」가 실제 조직도 형식(조직코드·조직명·상위조직코드)으로 들어가는지, `/progress` 행 트리가 제대로 그려지는지. **임시 코드로 개시했을 때 매핑 교체가 얼마나 드는지** | 고객 조직도의 **입수 시점·형식**, 임시 코드로 먼저 개시할지 여부 | 고객 TF |
| 3 | SME 배정 예외 처리 | **§0의 사실 — 배정이 "회사 활성 직무 전부"로 만들어진다.** §2-N'에서 `/assignments-admin`으로 정리했을 때 **직무당 1~2명까지 손으로 줄이는 데 든 조작 수**(계정을 추가할 때마다 반복된다). 겸직 SME가 여러 직무를 받았을 때 화면·소요가 어떻게 되는지. SME 1인뿐인 직무가 자동 규칙 ④에 걸리는지(§2-L) | 배정 **상한**(화면은 3명째를 경고만 하고 막지 않는다)과 겸직 직무 취급 원칙의 문서화. `sync_sme_assignments`의 전 직무 자동 배정을 그대로 둘지, 좁힐지 | PM(상무) |
| 4 | 메일 발신 도메인 | 시뮬레이션 모드가 `mail_logs(simulated=true)`로 완결되는지(§2-N), 리마인더 템플릿 치환이 맞는지 | **SPF·DKIM 인증 도메인**(HCG/고객), 실발송 전환 시점 | HCG IT |
| 5 | 워크숍 플래그 임계값 | 초기값(부적합 30% · FTE 차 20%p · 신규 3건)이 파일럿 응답에서 **몇 건을 잡았는지**. 과다/과소 판정 사례 | 임계값 **확정**. 값은 `src/lib/workshopThresholds.ts` 한 곳만 고치면 된다 | PM(상무) |
| 6 | 데이터 보존·파기 | 수동 스냅샷(§2-K)이 실제로 이관 가능한 형태인지, Export 5종이 이관 범위를 덮는지. **Supabase 리전 값 확인** | 이관 **범위**, 파기 **시점**, Supabase 프로젝트 처리. 과업범위 합의서·회의록에 1문장 반영 | PM(상무)·TF |
| 7 | 참고 레포 AI 검토 보조 이식 | 파일럿 응답에서 **오타·부실 응답이 실제로 얼마나 나왔는지**(관리자가 검토에 쓴 시간) — 이식 가치의 근거 데이터 | 이식 여부. P3 완료 후 잔여 일정 기준 | 사용자 |
| 8 | 기존 응답 데이터 존재 여부 | **파일럿보다 먼저 답이 나와야 한다** — 현 배포본에 실제 응답이 있는지 SQL로 확인(`SELECT count(*) FROM public.reviews WHERE status <> 'NOT_STARTED';`). 있으면 §1의 SQL 적용 전에 스냅샷 필수 | 스냅샷 보관 위치·기간 | 사용자 |

- [ ] (실시자) 위 표의 「파일럿에서 확인할 것」 칸을 전부 채운다
- [ ] (실시자) 8번을 **§1의 SQL을 적용하기 전에** 먼저 확인한다 → 응답이 있으면 스냅샷부터 (근거: §12 오픈이슈 8)
- [ ] (실시자) 「PM·고객 TF가 결정할 것」 칸을 그대로 옮겨 PM 확인 요청서를 만든다 → §10 P5 DoD의 "PM 확인 4건(§12)"에 해당하는 항목은 **3·5·6번(PM 상무) + 2번(고객 TF)** 이다

---

## 8. 부하 점검 — 동시 30~50명 응답 (§10 P5)

### 8-1. 사실 확인 — 이 저장소에는 부하를 걸 수단이 없다

`package.json`에 테스트 러너도 부하 도구도 없다(dependencies 7개 = supabase-js·lucide-react·
pretendard·react·react-dom·react-router-dom·xlsx / devDependencies는 빌드·린트·타입 도구뿐).
k6·Artillery·Playwright 어느 것도 없고, 새 의존성 도입은 §11-1 공통 규칙이 금지한다.
따라서 **"동시 30~50명" 부하 시험을 이 저장소만으로는 실행할 수 없다.**
파일럿 인원은 2~3명이므로 파일럿 자체도 그 부하를 만들지 못한다.

> **이 절의 어떤 항목도 "통과"로 적어서는 안 된다.** 실측 없이 통과로 적는 순간
> 그 기록이 검수 자리에서 근거가 된다. 아래는 부하 시험의 대체가 아니라 **완화책**이다.

### 8-2. 완화책 ① 단계적 개시

- [ ] (PM·실시자) 전사 동시 개시를 하지 않고 **조직/직군 단위로 나눠 개시**하는 일정을 잡는다 → 1회차 대상 인원 ____명, 회차 간격 ____일
- [ ] (실시자) 1회차 개시일에 관리자가 `/progress`를 지켜본다 → 동시 접속이 몰리는 시간대 기록(개시 메일 발송 직후 1~2시간)
- [ ] (실시자) 1회차에서 저장 실패·타임아웃이 보고되면 2회차 인원을 줄인다 → 판단 근거를 기록

### 8-3. 완화책 ② Supabase 대시보드 모니터링 (개시 당일 관측 항목)

Supabase 대시보드에서 아래를 개시 전·개시 직후·개시 익일 3회 캡처해 남긴다.

- [ ] (실시자) **Database → Roles / Connection pooling** — 활성 연결 수와 풀 한도 → 한도 대비 몇 %인지 기록. 브라우저가 PostgREST를 쓰므로 연결은 풀이 흡수하지만, 한도에 닿으면 저장이 실패한다
- [ ] (실시자) **Reports → API** — 요청 수·오류율·p95 응답시간 → **자동 저장이 2.5초마다 돈다**(`src/pages/SmeReviewPage.tsx` runSave)는 점을 감안해 동시 응답자 수 × 저장 빈도를 함께 적는다
- [ ] (실시자) **Reports → Database** — CPU·메모리·디스크 IO → 개시 직후 급등 여부
- [ ] (실시자) **Logs → Postgres / PostgREST** — 5xx, `statement timeout`, RLS 거부 로그 → 0건이 아니면 원문을 기록
- [ ] (실시자) **Auth → Rate Limits** — 로그인 요청 한도 → 개시 직후 대량 로그인에 걸리지 않는지 (근거: `docs/OPERATIONS.md` §7-1)
- [ ] (실시자) 프로젝트 **요금제 한도**(Free/Pro)를 확인한다 → 동시 연결·대역폭 한도가 예상 인원을 감당하는지. 감당하지 못하면 개시 전에 상향
- [ ] (실시자) 개시 직후 화면 로딩이 느리다는 보고가 오면 어느 쪽인지 가른다 → 정적 파일(GitHub Pages)은 병목이 아니고 **지연은 전부 Supabase 쪽**이다 (근거: `.github/workflows/deploy.yml`)

### 8-4. 결론 기록

- [ ] (실시자) 이 절의 결론을 한 문장으로 적는다 → 예: "동시 30~50명 부하 시험은 **미실시** — 저장소에 부하 도구가 없고 파일럿 인원이 2~3명이라 재현 불가. 단계적 개시(1회차 ○○명)와 Supabase 대시보드 실측으로 대체하고, 1회차 실측치를 이 문서에 붙인다."

---

## 9. 운영 계정 전환 — 관리자 개설

> **정본은 `docs/OPERATIONS.md`다** — §3(운영 계정 전환) · §4(데이터 보존·파기, 리전 확인) ·
> §5(백업) · §6(메일 발신) · §7(운영 중 점검). 아래는 파일럿 자리에서 바로 밟을 순서만 추린 것이다.

**2026-09-02 실측 정정** — 운영 프로젝트(`yktdlcpovntegiwfnied`)에는 `supabase/seed.sql`이
실행된 적이 없다. 아래 계정으로 인증하면 `400 invalid_credentials`가 돌아온다.
즉 **지울 시드 계정이 없고, 만들 관리자가 없다.** 이 절은 "제거"가 아니라 "개설" 절차다.

| 계정 | 비밀번호 | 역할 | 상태 |
|---|---|---|---|
| `admin@jobreview.local` | `admin1234` | admin | **운영에 없음** — 로컬 Supabase 전용(`supabase/seed.sql:20-48`) |
| `sme@jobreview.local` | `sme1234` | sme | **운영에 없음** — 로컬 Supabase 전용(`supabase/seed.sql:51-79`) |

관리자를 만드는 앱 경로는 전부 호출자가 이미 관리자일 것을 요구한다.
**활성 관리자가 0명이면 SQL Editor가 유일한 복구 경로다.**

- [ ] (실시자) `supabase/DIAGNOSE_2026-09-02_login.sql`(읽기 전용 7개 질의)로 원인을 확정한다 → 활성 관리자 수, 고아 프로필, 같은 이메일의 id 분기 여부
- [ ] (실시자) **Phase 0를 먼저 적용한다** → `supabase/APPLY_2026-09-01_phase0.sql`. 순서를 바꾸면 Phase 0의 백필이 새 관리자의 `must_change_password`를 `false`로 내려 임시 비밀번호가 강제 변경 없이 남는다 (근거: `docs/OPERATIONS.md` §3-3 2단계)
- [ ] (실시자) `supabase/BOOTSTRAP_2026-09-02_admin.sql` 상단 세 줄을 채워 실행한다 → 끝의 확인 질의에서 `auth유저있음 · 이메일확인 · 비번설정 · identity있음`이 모두 참 (근거: `docs/OPERATIONS.md` §3-3 3단계)
- [ ] (실시자) 새 운영 관리자로 로그인한다 → 첫 로그인 비밀번호 변경을 통과하고 관리자 화면 전부가 열린다 (근거: §8 S2)
- [ ] (실시자) 임시 비밀번호를 정리한다 → SQL Editor 질의 기록에 평문으로 남는다. 변경 후 메신저·문서에 남기지 않는다
- [ ] (실시자) 인수인계 문서에 "운영 DB에서 `supabase/seed.sql`을 실행하지 않는다"를 적는다 → 적힘. 실행하면 비밀번호가 공개된 계정이 운영에 생긴다
- [ ] (실시자) 파일럿용 SME 계정도 정리한다 → 운영에 그대로 쓸 계정만 남기고 나머지는 비활성 또는 삭제
- [ ] (실시자) Supabase 대시보드 **Auth → Rate Limits**와 **Auth → Sessions** 만료 정책을 확인한다 → 화면의 5회/60초 잠금은 클라이언트 방어일 뿐이고 서버 한도가 실제 방어선이다 (근거: §8 S3, `docs/OPERATIONS.md` §7-1)
- [ ] (실시자) `service_role` 키와 `RESEND_API_KEY`가 **저장소·번들에 없고** Supabase 시크릿에만 있는지 확인한다 → `git grep`으로 0건 (근거: §8 S4, §11-1)
- [ ] (실시자) 배포본에 `noindex` 메타와 `public/robots.txt`가 살아 있는지 확인한다 → 배포된 HTML의 `<meta name="robots" content="noindex, nofollow">` (근거: §8 S1)

### 9-1. 데이터 보존·파기 · 리전 · 백업

`docs/OPERATIONS.md`에 절차가 들어 있으나 **값이 비어 있는 칸이 있다.** 파일럿 때 채운다.

- [ ] (실시자) Supabase 대시보드 → Project Settings → General에서 **리전**을 확인하고 `docs/OPERATIONS.md` §4-2의 `확인한 리전: _____` 칸을 채운다 → 채움 (근거: §8 S6 「데이터 위치(Supabase 리전) 명시」, `docs/OPERATIONS.md` §4-2)
- [ ] (실시자) 국외 리전이면 **개인정보 국외 이전 고지 필요 여부**를 고객 TF에 확인 요청한다 → 요청 완료 (근거: `docs/OPERATIONS.md` §4-2 「합의 필요」)
- [ ] (실시자) 수동 스냅샷에 **개인정보가 포함된다**는 사실을 확인하고 파일 보관 위치·기간을 정한다 → 정함 (근거: `docs/OPERATIONS.md` §5-2)
- [ ] (PM·TF) 보존 기간·파기 시점·이관 범위를 합의해 `docs/OPERATIONS.md` §4-3의 빈칸을 채운다 → 채움 (근거: §12 오픈이슈 6)

### 9-2. 이 문서를 쓰면서 확인된 **미구현 1건** (코드는 이 문서 소유 범위 밖이라 고치지 않았다)

- [ ] (실시자) **§8 S6 — 로그인 화면의 개인정보 수집·이용 안내 1문장이 없다.**
  `src/pages/LoginPage.tsx`에 "수집/이용 안내/개인정보" 문구가 없음을 grep으로 확인했다
  (`docs/OPERATIONS.md:310`도 같은 사실을 기록해 두었다). §8 S6이 요구하는 항목이므로
  **운영 개시 전에** 넣을 대상이다 → 조치 담당: ____________ / 반영일: ____________

> 이 문서 초안 작성 시점에 "미구현"으로 적었다가 같은 날 구현이 들어와 해소된 항목 2건:
> **대시보드 소요 중앙값 카드**(§11-2 Phase 5 2번 — `src/lib/durationApi.ts` 신설로 구현, §6에서 점검),
> **운영 전환 절차서**(§11-2 Phase 5 4번 — `docs/OPERATIONS.md` 신설로 구현).
> 파일럿 시점에도 두 가지가 실제로 있는지 눈으로 확인하고 진행한다.

---

## 10. 기록란

### 10-1. 실측값

| 항목 | 값 | 비고 |
|---|---|---|
| 직무당 소요 **중앙값** (대시보드 카드) | ______ 분 | 표본 ______ 건 · 3건 미만이면 「표본 부족」 |
| 같은 값 (E5 `전체` 행) | ______ 분 | 위와 다르면 **비활성 SME 계정부터 확인**(E5만 그 검토를 센다). 그래도 다르면 기록 |
| 직무당 소요 **평균** (E5) | ______ 분 | 중앙값과의 차 |
| 가장 오래 걸린 **단계** | STEP ____ | ______ 분 (부담 축소 대상) |
| 소요 기록이 없어 제외된 검토 | ______ 건 | 창을 닫아 구간이 열린 채 끝난 경우 |
| SME 체감 소요 | SME1 ____ / SME2 ____ 분 | |
| 워크숍 자동 규칙에 걸린 직무 수 | ______ 건 / 전체 ______ 직무 | 규칙별 내역: |
| 문의 건수 | ______ 건 | 주된 문의 내용: |
| 게이트에 실제로 걸린 횟수 | ______ 회 | 어느 단계에서 가장 많이: |
| 1회차 개시 인원(계획) | ______ 명 | 부하 완화책 |

### 10-2. 통과하지 못한 항목

| 항목 번호 | 관측한 실제 화면·문구 | 재현 방법 | 조치 |
|---|---|---|---|
| | | | |

### 10-3. 확인하지 못한 항목과 그 사유

| 항목 번호 | 확인하지 못한 사유 |
|---|---|
| §8 부하 점검 | 저장소에 부하 도구 없음 · 파일럿 인원 2~3명으로 재현 불가 — **미확인** |
| | |

### 10-4. 완료 판정

§10 P5 DoD는 **「파일럿 체크리스트 전 항목 통과 + PM 확인 4건(§12) 반영」** 이다.

- [ ] (실시자) §2~§6·§9의 항목이 전부 `[x]` 또는 사유가 적힌 상태다
- [ ] (실시자) §8은 "미실시 + 대체 완화책" 결론이 §8-4에 적혀 있다(통과로 적지 않았다)
- [ ] (PM) §7 표의 「PM·고객 TF가 결정할 것」 4건(§12 2·3·5·6번)에 대한 답이 회신되어 이 문서에 붙었다
- [ ] (실시자) 확정된 소요 중앙값이 `/settings`와 착수보고 문구에 반영되었다

판정: ☐ 통과  ☐ 조건부 통과(조건: ____________)  ☐ 미통과
판정일 ____________ · 판정자 ____________
