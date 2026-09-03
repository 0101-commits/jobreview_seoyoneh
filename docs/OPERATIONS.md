# 운영 전환·운영 절차서

이 문서는 개발이 끝난 플랫폼을 실제 조사에 쓰기 시작할 때, 그리고 조사가 도는 동안
운영자가 따라야 할 순서를 적은 것이다. 기준 문서는 `docs/PLAN.html` §8(보안·개인정보),
§10 P5(파일럿·확정), §11-2 Phase 5, §12(오픈 이슈)다.

## 이 문서의 확인 수준

- 이 문서의 SQL·환경변수 이름·파일 이름은 전부 저장소의 실제 파일에서 읽어 적었다.
- 다만 **여기 적힌 확인 쿼리와 대시보드 절차를 실제 Supabase 프로젝트에 대해 실행해 보지는 않았다.**
  각 절의 "미확인" 표시가 그 뜻이다. 파일럿(`docs/PILOT.md`) 때 한 번씩 실제로 돌려 보고,
  결과가 다르면 이 문서를 고친다.
- 수치를 정하는 자리(보존 기간·파기 시점·리전·발신 도메인)는 **비워 두고 "합의 필요"로 표시했다.**
  기획안에 없고 실측하지 않은 값을 여기서 지어내면 그 값이 그대로 계약 문서로 흘러간다.

---

## 1. 배포 순서 — SQL을 먼저, 프런트를 나중에

### 1-0. 왜 순서가 중요한가

`.github/workflows/deploy.yml`은 `npm ci → typecheck → build → GitHub Pages 업로드`만 한다.
**SQL을 적용하는 단계가 없다.** 즉 `main`에 머지하면 화면만 바뀌고 DB는 그대로다.
순서를 뒤집으면 화면은 새 컬럼·새 함수를 부르는데 DB에 없어서, 사용자에게는
"저장이 안 된다 / 제출이 안 된다"로만 보이고 원인은 어디에도 안 뜬다.

원칙: **SQL 선적용 → 확인 쿼리 통과 → 프런트 배포.** 단 하나의 예외가 Phase 2다(1-5 참조).

### 1-1. 적용 대상 파일과 순서

`supabase/APPLY_*.sql`은 SQL Editor에 통째로 붙여 넣어 실행하는 "한 벌" 파일이다.
`supabase/migrations/`의 원본 마이그레이션 본문을 순서대로 이어 붙인 것이라, 둘 중 하나만 적용한다.
새 Supabase 프로젝트라면 `supabase/migrations/`를 파일명 순서대로 전부 실행하는 쪽이 정석이고,
이미 돌고 있는 운영 DB에 밀어 넣을 때는 아래 APPLY 파일을 쓴다.

| 순서 | 파일 | 무엇을 하나 | 적용 시점 제약 |
|---|---|---|---|
| 1 | `supabase/APPLY_2026-08-28.sql` | 검토 저장·제출 RPC(`save_review_draft`·`submit_review` 1차), `get_review_status` 호출자 필터, `sync_sme_assignments` 관리자 제한, `request_rereview`, **`save_integrated_job_data`**(관리자 직무 업로드의 본체), 조회 인덱스 2개 | 없음. 다만 이게 없으면 직무정보 업로드가 `PGRST202`로 아예 실패한다 |
| 2 | `supabase/APPLY_2026-09-01_phase0.sql` | `profiles.must_change_password` 컬럼 + 기존 계정 백필(false), 해당 컬럼의 `authenticated` UPDATE 권한, `audit_logs` 테이블 + RLS(SELECT는 ADMIN만), `log_audit` RPC, 인덱스 2개 | 프런트 Phase 0 배포보다 **먼저** |
| 3 | `supabase/APPLY_2026-09-01_phase1.sql` | **두 마이그레이션이 한 파일에 들어 있다.** 신규 표 7종(`org_units`·`task_fte_allocations`·`review_sessions`·`inquiries`·`job_workshop_flags`·`mail_logs`·`survey_settings`) + RLS + 컬럼 추가(`profiles.org_unit_id`·`profiles.guide_completed_at`·`reviews.approved_at`·`reviews.rejected_reason`) + 컬럼 잠금 트리거 2개, 그리고 `submit_review` 재정의(서버 4종 재검증)·`decide_review` 신설·`save_review_draft`·`request_rereview` 재정의 | 프런트 Phase 1~3 배포보다 **먼저**. 아래 1-4의 "짝" 설명 필독 |
| 4 | `supabase/APPLY_2026-09-01_phase2.sql` | `survey_settings.fte_required`를 회사 단위로 `true`로 올려 FTE 합계 100% 제출 게이트를 **켠다** | **STEP 3(투입 비중 배분) 화면이 배포된 뒤에만.** 1-5 참조 |
| — | (Phase 3에 해당하는 SQL 없음) | 진행 매트릭스·워크벤치·워크숍 플래깅·문의 인박스는 전부 화면이고 DDL이 없다 | — |
| 5 | `supabase/APPLY_2026-09-01_phase4.sql` | `survey_settings.reminder_subject`·`reminder_body_md` 두 컬럼 추가(ALTER 두 줄) | 앞뒤 어느 쪽이어도 안전. 1-6 참조 |
| 6 | `supabase/APPLY_2026-09-02_p5.sql` | `link_sme_roster` 함수 신설(SME 명부로 `profiles.org_unit_id` 연결 + 「배정직무」를 `review_assignments`에 추가), `sync_sme_assignments`에 COMMENT, `survey_settings.fte_required`의 컬럼 DEFAULT를 true로 | 앞뒤 어느 쪽이어도 안전. **적용 전에는 통합 업로드의 SME 명부 단계만 `PGRST202`로 실패하고**(직무·과업·Skill·조직 마스터 저장은 정상) 조직축이 계속 비어 있다. 1-7 참조 |
| 7 | `supabase/APPLY_2026-09-02_followup.sql` | `submit_review`·`request_rereview`·`save_integrated_job_data` 세 함수를 **감사 기록 한 줄씩만 얹어** 재정의(`REVIEW_SUBMITTED`/`REVIEW_RESUBMITTED` · `REVIEW_REREVIEW_REQUESTED` · `JOB_DATA_UPLOADED`). 표·컬럼·정책·상태머신·함수 시그니처는 건드리지 않는다 | **반드시 1·3 이후.** 그 두 파일이 만든 최신 정의 위에 얹는 것이라 순서를 뒤집으면 나중에 실행된 파일이 감사 블록을 지운다. 화면 배포와는 무관하다 — 적용 전에도 화면은 그대로 돌고 기록만 계속 빠진다. 1-8 참조 |
| 8 | `supabase/APPLY_2026-09-02_assignment_guard.sql` | 배정 해제 안전장치를 서버로 내린다 — `review_assignments` 해제 잠금 트리거(제출된 응답이 있으면 `active = false` UPDATE를 42501로 거절) + `submit_review` 재정의(상태 전이 앞에서 배정이 살아 있는지 확인). 표·컬럼·행·정책·상태머신·함수 시그니처는 건드리지 않는다 | **반드시 7 이후.** 7이 만든 `submit_review` 정의 위에 배정 확인만 얹는 것이라 순서를 뒤집으면 나중에 실행된 파일이 그 확인을 지운다(오류 없이 조용히). 화면 배포와는 무관하다 — 화면은 지금도 같은 판정을 하고 있고 이 SQL은 화면을 거치지 않는 해제·제출까지 막는다. 1-8 참조 |

전부 `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` / `ON CONFLICT DO UPDATE`로만 되어 있어
여러 번 실행해도 안전하다. 각 파일 끝의 `NOTIFY pgrst, 'reload schema';`는 PostgREST가 새 함수·컬럼을
바로 알아보게 하는 것이니 지우지 말 것(생략하면 `PGRST202`/`PGRST204`가 한동안 계속 난다).

### 1-2. 실행 방법(모든 APPLY 파일 공통)

1. Supabase 대시보드 → 해당 프로젝트 → 왼쪽 메뉴 **SQL Editor**.
2. **New query**에 파일 전체를 복사해 붙여 넣는다.
3. **Run**. 파일 하나가 한 번에 실행된다.
4. 아래 각 절의 "적용 후 확인" 쿼리를 새 쿼리 창에서 실행한다.
5. 확인이 통과한 뒤에 프런트를 배포한다(`main` 머지 → Pages 자동 배포).

### 1-3. 적용 후 확인 — Phase 0

```sql
-- (1) 기존 계정이 전부 false 인가. must_change_password = true 행은 0이어야 한다.
--     여기서 true가 나오면 기존 사용자가 전원 비밀번호 변경 화면에 갇힌 것이다.
SELECT must_change_password, count(*) FROM public.profiles GROUP BY 1 ORDER BY 1;

-- (2) 컬럼 기본값이 true 로 남아 있는가(신규 계정만 잠기게 하는 장치).
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND column_name = 'must_change_password';

-- (3) authenticated 가 바꿀 수 있는 profiles 컬럼 목록.
--     기대: can_update = true 가 name, email, organization, title, must_change_password 다섯 개.
--     role · active 가 true 로 나오면 SME 자가 승격이 열린 것이다. 즉시 원인을 찾을 것.
SELECT a.attname AS column_name,
       has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE') AS can_update
  FROM pg_attribute a
 WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY 1;

-- (4) 감사 로그 테이블과 기록 함수가 생겼는가.
SELECT to_regclass('public.audit_logs');
SELECT proname FROM pg_proc WHERE proname = 'log_audit';
```

미확인 — 파일럿에서 확인.

### 1-4. Phase 1의 두 마이그레이션은 왜 반드시 함께 적용해야 하는가

`APPLY_2026-09-01_phase1.sql` 안에는 두 파일이 들어 있다.

- `20260901020000_phase1_survey_schema.sql` — 표·컬럼·RLS·**컬럼 잠금 트리거**를 만든다.
- `20260901030000_phase1_submit_gate.sql` — 그 표를 쓰는 **RPC**(`submit_review`·`decide_review`·
  `save_review_draft`·`request_rereview`)를 만든다.

앞 파일이 만드는 컬럼 잠금 트리거는 `reviews.status`·`submitted_at`·`approved_at`·`rejected_reason`과
`inquiries.answer`·`status`를 잠근다. RLS는 행까지만 막고 컬럼은 못 막기 때문에, 이 트리거가 없으면
SME가 PostgREST로 본인 행을 직접 PATCH해서 제출 게이트를 통째로 건너뛰거나 없는 관리자 답변을
만들어 낼 수 있었다.

트리거는 `app.trusted_rpc` 마커가 서 있을 때만 통과시킨다. **그 마커를 세우는 쪽이 뒤 파일의
RPC들이다.** 그래서:

- **앞 파일만 적용하면** — 트리거는 살아 있는데 마커를 세우는 새 `save_review_draft`가 없다.
  SME의 임시저장·제출이 `"… 값은 직접 바꿀 수 없습니다."`로 전부 막힌다.
- **뒤 파일만 적용하면** — 파일 첫머리의 확인 블록이 `42P01`로 즉시 멈춘다
  (`먼저 20260901020000_phase1_survey_schema.sql 을 적용해 주세요.`). 조용히 깨지지는 않는다.

APPLY 파일 하나를 통째로 실행하면 두 파일이 한 번에 들어가므로 이 문제는 생기지 않는다.
**중간에서 끊어 실행하지 말 것.**

적용 후 확인:

```sql
-- (1) 신규 표 7종이 전부 있고 RLS가 켜져 있는가. 7행 모두 rowsecurity = true 여야 한다.
SELECT tablename, rowsecurity FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('org_units','task_fte_allocations','review_sessions','inquiries',
                     'job_workshop_flags','mail_logs','survey_settings')
 ORDER BY 1;

-- (2) 새 컬럼 4종.
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (('profiles','org_unit_id'),('profiles','guide_completed_at'),
                                     ('reviews','approved_at'),('reviews','rejected_reason'))
 ORDER BY 1,2;

-- (3) RPC 4종.
SELECT proname FROM pg_proc
 WHERE proname IN ('submit_review','decide_review','save_review_draft','request_rereview')
 ORDER BY 1;

-- (4) 컬럼 잠금 트리거 2개.
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('reviews_guard_locked_columns','inquiries_guard_locked_columns');
```

미확인 — 파일럿에서 확인.

**적용 직후 반드시 손으로 해 볼 것(가장 중요한 회귀):** SME 계정으로 검토 화면에 들어가
아무 항목이나 고치고 **임시저장이 되는지** 확인한다. 여기서 막히면 위 "앞 파일만 적용" 상태다.

### 1-5. Phase 2 — 순서가 뒤집힌 유일한 자리

`APPLY_2026-09-01_phase2.sql`은 스키마를 바꾸지 않는다. FTE 제출 게이트 **스위치를 켜는** SQL이다.

```sql
INSERT INTO public.survey_settings (company_id, fte_required)
SELECT c.id, true FROM public.companies c
ON CONFLICT (company_id) DO UPDATE SET fte_required = true, updated_at = now();
```

**반드시 STEP 3(투입 비중 배분) 화면이 배포된 뒤에 실행한다.** 먼저 켜면 배분 행이 하나도 없는
상태에서 게이트가 걸려 SME 전원의 제출이 `FTE를 배분하지 않았습니다.`로 막힌다.

되돌릴 때는 위 문장의 `true` 두 곳을 `false`로 바꿔 다시 실행한다. 운영 중에는
`/settings` 화면에서도 회사별로 끄고 켤 수 있고, 그 변경은 `audit_logs`에
`FTE_REQUIRED_ON` / `FTE_REQUIRED_OFF`로 남는다.

적용 후 확인:

```sql
-- 회사별 스위치 상태(전부 t 여야 한다)
SELECT c.name, s.fte_required FROM public.companies c
  LEFT JOIN public.survey_settings s ON s.company_id = c.id ORDER BY c.name;

-- 어느 회사에도 매이지 않아 게이트가 걸리지 않는 검토(0행이면 신경 쓸 것 없다)
SELECT r.id FROM public.reviews r JOIN public.jobs j ON j.id = r.job_id
 WHERE j.company_id IS NULL;
```

미확인 — 파일럿에서 확인.

### 1-6. Phase 4 — 순서 제약 없음

`ALTER TABLE … ADD COLUMN IF NOT EXISTS` 두 줄뿐이다.

- SQL을 먼저 적용하면 배포 즉시 `/settings`의 리마인더 템플릿 입력이 열린다.
- 화면을 먼저 배포하면 `src/lib/settingsApi.ts`가 첫 조회에서 `42703`("그런 컬럼 없음")을 한 번 보고
  컬럼이 없다고 판정한 뒤, 나머지 컬럼만 읽고 리마인더 입력을 비활성으로 둔다. 마감일·예상 소요·
  가이드 문구·문의 담당·FTE 스위치는 그 상태에서도 정상 저장된다.
  **판정 결과는 브라우저 탭 단위로 기억하므로, SQL을 나중에 적용했다면 화면을 새로고침해야 입력이 열린다.**

적용 후 확인:

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'survey_settings'
   AND column_name IN ('reminder_subject','reminder_body_md');   -- 2행
```

미확인 — 파일럿에서 확인.

### 1-7. Phase 5 — 순서 제약 없음, 다만 안 하면 조직축이 계속 빈다

`CREATE OR REPLACE FUNCTION` / `COMMENT ON` / `ALTER COLUMN … SET DEFAULT`뿐이다. 행을 지우거나 바꾸지 않는다.

- SQL을 먼저 적용하면 함수만 늘어난 상태다. 아무도 부르지 않으므로 화면은 그대로다.
- 화면을 먼저 배포하면 통합 업로드의 **SME 명부 단계만** `PGRST202`("함수를 찾을 수 없음")로 실패하고
  화면이 "SME 명부를 반영하지 못했어요"를 따로 알린다. 직무·과업·Skill·조직 마스터 저장은 정상이다.
- **적용하지 않으면 `profiles.org_unit_id`가 영영 NULL로 남는다.** 그러면 `/progress` 진행 매트릭스의
  행이 전부 '조직 미지정'으로 몰리고 Export E2의 조직코드·조직명 칸이 통째로 빈다.
- 조직 마스터(시트 ③)가 `org_units`에 먼저 들어가 있어야 조직코드를 풀 수 있다. 통합 업로드는 한 번의
  실행 안에서 조직 마스터를 먼저 저장하고 명부를 나중에 반영하므로 순서는 화면이 보장한다.

적용 후 확인은 `supabase/APPLY_2026-09-02_p5.sql`의 「적용 후 확인」 7개 쿼리를 쓴다(함수 생성·실행 권한·
기본값·기존 설정값 보존·조직 연결 수·직무별 SME 배정 수·감사 기록).

미확인 — 파일럿에서 확인.

### 1-8. 후속(감사 로그 보강) — 순서 제약은 "마지막"뿐

`CREATE OR REPLACE FUNCTION` / `REVOKE` / `GRANT` / `COMMENT`뿐이다. 행·표·정책을 건드리지 않는다.

- **반드시 ①(`APPLY_2026-08-28.sql`)과 ③(`APPLY_2026-09-01_phase1.sql`) 뒤에 적용한다.** 이 파일은
  그 두 파일이 만든 최신 함수 정의를 그대로 옮기고 끝에 `log_audit` 호출만 끼워 넣은 것이라,
  순서를 뒤집어 ③을 나중에 실행하면 감사 블록이 없는 정의로 되돌아간다. **오류 없이 조용히 되돌아간다.**
- 화면 코드는 바뀌지 않는다. 적용하지 않아도 제출·업로드는 지금처럼 동작하고 `audit_logs`에
  기록만 계속 빠진다. 그래서 프런트 배포와 순서를 맞출 필요가 없다.
- **감사 기록 실패가 본래 작업을 되돌리지 않는다.** 세 함수 모두 `log_audit` 호출을
  `BEGIN … EXCEPTION WHEN OTHERS THEN NULL`로 감쌌다. plpgsql 함수 본문은 한 트랜잭션이라,
  감사 기록에서 난 예외가 밖으로 새면 방금 끝난 제출·업로드가 통째로 롤백되기 때문이다.
  **대가는 감사 기록이 조용히 빠질 수 있다는 것이다** — 화면에도 오류에도 뜨지 않는다.
  그래서 아래 확인을 파일럿에서 실제로 돌려 봐야 한다.
- 소급 기록은 없다. 적용 시각 **이후**의 호출부터 남는다. 그 이전 제출은 `review_history`로만 본다.

적용 후 확인은 `supabase/APPLY_2026-09-02_followup.sql`의 「적용 후 확인」 6개 쿼리를 쓴다
(함수 존재·`prosecdef = false` · 실행 권한 · 본문에 `log_audit` 포함 · 실제 적재 · 제출 이력과의 건수 대조).
그중 (4)(6)은 **적용 직후에는 0행이 정상**이고, SME 제출 1건·직무정보 업로드 1건을 실제로 돌린 뒤에 봐야 한다.

미확인 — 파일럿에서 확인.

**이어서 ⑧ `APPLY_2026-09-02_assignment_guard.sql`(배정 해제 안전장치) — ⑦ 바로 뒤에 적용한다.**

- **왜 필요한가.** "제출된 응답이 있으면 배정 해제를 막는다"가 클라이언트에만 있었다. 서버에는 그 판정이
  없어 ① 관리자가 확인 모달을 보는 사이에 SME가 제출하거나, ② 관리자가 작성 중 배정을 해제한 뒤
  SME가 **이미 열어 둔** 마법사에서 제출하면, `SUBMITTED`인 검토가 `active = false` 배정에 매달린다.
  그 행은 진행 매트릭스·검토현황·워크벤치·Export·SME 목록이 전부 `active = true`로 걸러
  **어디에도 보이지 않는다**(관리자에게는 "미제출", SME에게는 "제출 완료"). 트리거가 ①을, 제출 게이트가 ②를 막는다.
- **⑦보다 먼저 실행하면 안 된다.** 이 파일의 `submit_review`는 ⑦이 만든 정의(감사 기록 포함)를 그대로 옮기고
  배정 확인만 더한 것이다. 순서를 뒤집으면 ⑦이 그 확인을 지운 정의로 되돌린다. **오류 없이 조용히 되돌아간다.**
- **되돌리려면** 트리거를 지우고(`DROP TRIGGER … review_assignments_guard_deactivate`) ⑦을 다시 실행한다.
  제출된 응답이 있는 배정을 부득이 내려야 할 때는 트리거를 지우지 말고
  `ALTER TABLE public.review_assignments DISABLE TRIGGER review_assignments_guard_deactivate;`로 잠시 끈 뒤
  `ENABLE TRIGGER`로 되돌린다. 그 사이의 해제는 감사에 남지 않는다.

적용 후 확인은 `supabase/APPLY_2026-09-02_assignment_guard.sql`의 「적용 후 확인」 4개 쿼리를 쓴다
(트리거 존재 · `submit_review`에 배정 확인 포함 + `prosecdef = false` · 트리거가 실제로 42501을 내는지 ·
적용 이전에 이미 생긴 "보이지 않는 제출" 찾기). 마지막 (4)가 **0행이면 그 상태는 없다.**

미확인 — 파일럿에서 확인.

### 1-9. Edge Function 배포

SQL과 별개로, 아래 두 함수는 Supabase CLI로 따로 배포해야 화면이 동작한다.

```bash
supabase functions deploy admin-create-user --no-verify-jwt   # 계정 관리 화면(/users, /admin-users)
supabase functions deploy send-reminder      --no-verify-jwt   # 리마인더 발송(/progress)
```

배포하지 않으면 해당 화면의 버튼만 실패하고, 나머지 기능은 정상이다.

**`--no-verify-jwt`를 빼면 안 된다.** 두 함수는 현재 `verify_jwt: false`로 배포되어 있고
(`supabase functions list --project-ref <ref>`로 확인 가능), 이 플래그를 빼면 CLI 기본값(true)으로
올라가 설정이 바뀐다. 그러면 브라우저의 CORS preflight(`OPTIONS`)에 `Authorization` 헤더가 없어
게이트웨이가 먼저 401로 끊는다 — 함수 안의 `OPTIONS` 분기에 닿지 못하므로 브라우저는 본 요청을
아예 보내지 않고, 화면에는 "서버에 연결하지 못했어요"만 뜬다. 권한 검증이 사라지는 것은 아니다:
두 함수 모두 첫 줄에서 `Authorization` 헤더를 직접 읽어 `auth.getUser` → `profiles.role='admin'`을
확인하고, 실패하면 401/403으로 끊는다(`admin-create-user/index.ts` 진입부).

배포 후 확인 — 인증 없이 부르면 401, `OPTIONS`는 200이어야 한다.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://<ref>.supabase.co/functions/v1/admin-create-user \
  -H 'Content-Type: application/json' -d '{"mode":"check-auth"}'   # 401 이어야 한다
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  https://<ref>.supabase.co/functions/v1/admin-create-user         # 200 이어야 한다
```

---

## 2. 환경변수·시크릿 — 어디에 무엇을 넣는가

**값은 이 문서에도, 저장소 어디에도 적지 않는다.** 아래는 "이름"과 "두는 자리"만 적는다.

### 2-1. GitHub Actions variables (저장소 → Settings → Secrets and variables → Actions → Variables)

`.github/workflows/deploy.yml`의 build 스텝이 `vars.` 로 읽는다.

| 이름 | 정체 | 비고 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 비밀이 아니다. 번들에 그대로 들어간다 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | **비밀이 아니다.** 클라이언트 번들에 포함되는 것이 설계상 정상이다. 실제 방어선은 RLS와 함수 권한이다(§8) |

`vars`이지 `secrets`가 아니다. Secrets에 넣으면 워크플로가 빈 값으로 빌드해
"데이터베이스에 연결되어 있지 않습니다" 화면이 배포된다.

로컬 개발은 저장소 루트 `.env`에 같은 두 이름을 쓴다(`.env.example` 참고).
`src/lib/supabase.ts`가 `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`를 읽는다.

Pages는 하위 경로에서 서빙되므로 워크플로가 `GITHUB_PAGES=true`를 함께 넘겨 `base`를
`/jobreview_seoyoneh/`로 맞춘다. 이 값은 워크플로 안에 하드코딩되어 있어 따로 등록할 것이 없다.

### 2-2. Supabase Edge Function secrets (Supabase 대시보드 → Edge Functions → Secrets)

| 이름 | 필요 여부 | 읽는 곳 |
|---|---|---|
| `SUPABASE_URL` | **등록 불필요** — 런타임이 자동 주입 | `admin-create-user/index.ts:15`, `send-reminder/index.ts:94` |
| `SUPABASE_SERVICE_ROLE_KEY` | **등록 불필요** — 런타임이 자동 주입 | `admin-create-user/index.ts:16`, `send-reminder/index.ts:95` |
| `RESEND_API_KEY` | 선택. **없으면 시뮬레이션**(실제 메일을 보내지 않고 `mail_logs.simulated = true`만 기록) | `send-reminder/index.ts:183` |
| `RESEND_FROM` | `RESEND_API_KEY`를 넣었다면 **반드시 함께**. 인증된 발신 도메인의 주소 | `send-reminder/index.ts:184` |
| `RESEND_REPLY_TO` | 선택. 회신 주소 | `send-reminder/index.ts:185` |

`RESEND_API_KEY`만 있고 `RESEND_FROM`이 없으면 함수는 조용히 시뮬레이션으로 내려가지 않고
설정 누락을 명시적 오류로 반환한다("보낸 줄 알았는데 안 갔다"를 막기 위해서다).

`service_role` 키와 `RESEND_API_KEY`는 **실제 비밀값**이다. Supabase 대시보드에만 두고
코드·저장소·이 문서·메신저 어디에도 남기지 않는다(§8 S4).

---

## 3. 운영 계정 전환

### 3-1. `profiles.role` 값의 실제 형식

**소문자 `admin` / `sme` 두 값뿐이다.**
`20260813034113_…secure_role_based_login.sql.sql`이 기존 값을 `lower(role)`로 내리고
`CHECK (role IN ('admin','sme'))` 제약을 걸었다. 대문자 `ADMIN`을 넣으면 제약 위반으로 거부된다.

`profiles.role`은 `authenticated`의 UPDATE 권한 목록에 들어 있지 않다(1-3의 확인 쿼리 (3)).
값을 바꾸려면 Supabase 대시보드/SQL Editor 또는 `admin-create-user` Edge Function을 쓴다.

### 3-2. 시드 계정 — 운영 DB에는 없다

`supabase/seed.sql`은 **로컬 Supabase 전용**이다. 만드는 계정은 둘이고 비밀번호가 저장소에 공개되어 있다.

- `admin@jobreview.local` / `admin1234` → `profiles.role = 'admin'`
- `sme@jobreview.local` / `sme1234` → `profiles.role = 'sme'`

**운영 프로젝트(`yktdlcpovntegiwfnied`)에서는 이 스크립트가 실행된 적이 없다.**
2026-09-02 실측 — 이 계정으로 인증하면 GoTrue가 `400 invalid_credentials`를 준다.
따라서 아래 3-3은 "지우는 절차"가 아니라 **"없는 관리자를 만드는 절차"**다.
운영 DB에서 `seed.sql`을 실행해 관리자를 만들지 않는다. 비밀번호가 공개된 계정이 운영에 생긴다.

### 3-3. 관리자 계정 개설 — 반드시 이 순서다

관리자를 만드는 앱 경로(`/admin-users` 화면, `profiles` INSERT 정책)는 둘 다 호출자가 이미
관리자일 것을 요구한다. **활성 관리자가 0명이면 화면으로는 복구가 불가능하고, SQL Editor가 유일한 경로다.**

1. [ ] **원인을 먼저 확정한다.** `supabase/DIAGNOSE_2026-09-02_login.sql`(SELECT만 한다)의 7개 질의를 위에서부터 실행한다.
   관리자가 정말 0명인지, 로그인 계정만 있고 프로필이 없는지, 같은 이메일이 서로 다른 `id`로 갈라져 있는지가 여기서 갈린다.
2. [ ] **Phase 0 마이그레이션을 먼저 적용한다.** `supabase/APPLY_2026-09-01_phase0.sql`.
   **순서를 바꾸면 안 된다** — Phase 0는 `must_change_password` 컬럼을 *새로 만들 때에만* 기존 행을 `false`로 내린다.
   관리자를 먼저 만들면 그 행도 백필 대상이 되어, 임시 비밀번호를 그대로 쓴 채 강제 변경 화면을 건너뛴다.
3. [ ] **`supabase/BOOTSTRAP_2026-09-02_admin.sql`을 실행한다.** 상단 세 줄(이메일·임시 비밀번호·이름)만 고친다.
   프로필이 이미 있으면 **그 `id`를 그대로 재사용**한다 — 새 `id`로 만들면 `review_assignments.sme_id` 등
   `profiles(id)`를 참조하는 기존 데이터가 전부 끊긴다.
4. [ ] **새 계정으로 로그인해 본다.** `must_change_password = true`로 시작하므로 첫 로그인에서 비밀번호 변경 화면이 뜬다.
   새 비밀번호(10자 이상, §8 S2)로 바꾼 뒤 관리자 화면이 열리는지 확인한다.
5. [ ] **임시 비밀번호를 정리한다.** SQL Editor의 질의 기록에 평문으로 남는다.
   변경을 마친 뒤에는 그 값을 메신저·문서 어디에도 남기지 않는다.

### 3-4. SME 계정 발급

업로드 시트 ④ `SME 명부`는 **검증·미리보기·정규화 결과 다운로드까지만** 한다.
계정을 만들지는 않는다(`src/lib/integratedUploadUtils.ts` 상단 주석). 실제 계정 생성은
`/users`(SME 계정 관리) 화면의 `admin-create-user` Edge Function 경로로 한다.

발급한 계정은 전부 `must_change_password = true`로 시작하므로 초기 비밀번호가
유출되어도 첫 로그인 시점에 바뀐다. 초기 비밀번호를 메신저 단체방에 붙여 넣지 말 것.

---

## 4. 데이터 보존·파기 (§8 S6 · §12 오픈이슈 6)

### 4-1. 이 도구가 담고 있는 개인정보

수집 항목은 **성명·이메일·소속(조직)·직급**으로 한정한다. 주민번호·연락처는 수집하지 않는다.
`profiles` 테이블에 `employee_number`(사번) 열이 있어 SME 명부 업로드 시 함께 들어올 수 있다.
사번을 실제로 채울지 여부는 고객 TF와 **합의 필요**.

로그인 화면의 "수집·이용 안내 1문장"(§8 S6)은 현재 화면에 없다 — `src/pages/LoginPage.tsx`에
해당 문구가 없음을 확인했다. 파일럿 전에 넣을지, 별도 안내 메일로 갈음할지 **합의 필요**.

### 4-2. 데이터 위치(Supabase 리전) 확인 방법

Supabase 대시보드 → 해당 프로젝트 → **Project Settings** → **General**. Region 항목에
리전 이름이 표시된다(메뉴 구성이 다르면 Project Settings 안에서 "Region"을 찾는다).

- 프로젝트 ref: `yktdlcpovntegiwfnied` (APPLY 파일들이 지목하는 운영 프로젝트)
- 확인한 리전: **_____________** ← 미확인. 대시보드를 열어 채워 넣는다.
- 국외 리전일 경우 개인정보 국외 이전 고지가 필요한지: **합의 필요**(고객 TF)

### 4-3. 프로젝트 종료 시 이관·파기 — 뼈대

아래는 절차의 뼈대다. 대괄호 항목은 임의로 정하지 않는다.

1. **이관 범위 합의** — 고객에게 무엇을 넘기는가.
   - 후보: `/exports`의 E1~E5(XLSX·CSV·JSON) 전량 / 수동 스냅샷 JSON 1건 / 둘 다.
   - 결정: **합의 필요**(PM·고객 TF, §12 오픈이슈 6)
2. **이관 시점·전달 방법** — **합의 필요**. (전달 매체와 암호 설정 여부를 함께 정한다)
3. **파기 대상** — 아래 셋은 각각 다른 행위다. 어디까지 할지 정한다.
   - ① 응답 데이터만 삭제(테이블 truncate 계열) — 도구는 남는다
   - ② 계정 삭제(`auth.users` 전량) — 아무도 못 들어온다
   - ③ Supabase 프로젝트 자체 삭제 — 백업까지 함께 사라진다
   - 결정: **합의 필요**
4. **파기 시점** — 프로젝트 종료 후 [ __ ]개월. **합의 필요**
5. **파기 확인 기록** — 누가 언제 무엇을 지웠는지 남긴다. `audit_logs`는 파기와 함께 사라지므로
   **파기 실행 전에 감사 로그를 별도로 내려받아 둔다**(E5 Export 또는 스냅샷).
6. **GitHub Pages 배포본 내리기** — 저장소 Settings → Pages에서 배포를 해제하거나 저장소를 비공개로 돌린다.
   화면만 내려도 Supabase에 데이터가 남아 있으면 파기가 아니다. 3번과 함께 처리한다.
7. **로컬·개인 PC의 Export/스냅샷 파일 파기** — 스냅샷에는 개인정보가 들어 있다(5절 참조).

이 항목들은 과업범위 합의서 또는 회의록에 한 문장으로 반영하기를 권한다(§12 오픈이슈 6의 권고).

---

## 5. 백업 (§8 S7)

### 5-1. 수동 스냅샷 버튼의 위치

관리자 메뉴 **`/exports` (산출물 내보내기)** → 화면 아래쪽 **"수동 스냅샷 (백업)"** 절 →
**[스냅샷 내려받기]** 버튼. E1~E5 카드 격자 밖에 따로 놓여 있다(목적이 달라서다).

누르면 브라우저가 JSON 파일 하나를 내려받는다. 파일명 예: `서연이화_스냅샷_개인정보포함_20260901.json`.
실행은 `audit_logs`에 `SNAPSHOT_EXPORTED`로 남는다.

### 5-2. 스냅샷에 개인정보가 포함되는가 — **포함된다**

`src/lib/snapshotApi.ts`의 `SNAPSHOT_INCLUDES_PERSONAL_DATA = true`이며, 이는 의도된 선택이다.
응답 데이터가 전부 `profiles.id`(uuid)로만 사람을 가리키기 때문에, `profiles`를 빼면
"누가 어느 직무를 검토했는가"를 복원할 수 없어 백업 구실을 못 한다.

대신 두 가지를 지킨다.

- `profiles`에서 담는 열을 §8 S6이 허용한 항목과 참조 키로 잘랐다
  (`id, email, name, organization, title, role, active, company_id, employee_number, org_unit_id,
  assigned_group_id, assigned_series_id, assigned_job_id, must_change_password, guide_completed_at, created_at, updated_at`).
  비밀번호 해시는 `auth.users`에 있고 스냅샷은 건드리지 않는다.
- 파일명과 화면 안내에 "개인정보 포함"을 붙인다. 화면 문구:
  > 이 파일에는 개인정보(성명·이메일·소속·직급)가 포함됩니다. 사내 보관 규정에 따라 다루고, 공용 저장소·메신저에 두지 마세요.

**따라서 스냅샷 파일은 개인정보 파일로 취급한다.** 공용 폴더·메신저에 두지 말고,
보관 위치와 파기 시점은 4-3의 합의에 함께 넣는다.

### 5-3. 주기 권고

기획안에 주기 수치는 없다. 아래는 이 도구의 사용 리듬(조사 기간 몇 주, 하루 몇 건 제출)에서
나온 권고이며, 파일럿 실측 후 조정한다.

- **반드시**: 각 APPLY SQL 적용 **직전** 1회 (§12 오픈이슈 8 — 실제 응답이 이미 있다면 필수)
- **반드시**: 대량 직무정보 재업로드(전체 교체) 직전 1회
- **권고**: 조사 개시 후 응답이 들어오는 기간에는 주 1회
- **반드시**: 조사 마감 직후 1회 (이관·검수의 기준본)

대상 표는 `SNAPSHOT_TABLES`에 26종이 정의되어 있다. 표 하나가 5만 행을 넘으면 스냅샷은
자르지 않고 **실패로 돌린다**(조용히 잘린 백업은 없는 백업보다 나쁘다). 그 규모가 되면
브라우저 다운로드가 아니라 Supabase 프로젝트 백업 기능으로 가야 한다.

Supabase 프로젝트 자체의 자동 백업(플랜별 제공 여부·보존 기간)은 대시보드에서 확인한다 —
미확인. 수동 스냅샷은 그 대체물이 아니라 보완물이다.

---

## 6. 메일 발신 (§12 오픈이슈 4)

### 6-1. SPF·DKIM 미확정 기간의 운영 — 시뮬레이션 + 수동 안내

`RESEND_API_KEY`를 **등록하지 않은 상태**가 시뮬레이션 모드다(`send-reminder/index.ts:186`,
`simulated = resendKey.length === 0`). 이때:

- 실제 메일은 나가지 않는다.
- `mail_logs`에 `simulated = true`로 기록은 남는다. 누구에게 언제 보내려 했는지가 남는다.
- `audit_logs`에는 `MAIL_SIMULATED`로 남는다(실발송이면 `MAIL_SENT`).
- 화면(`/progress`)의 발송 흐름은 끝까지 완결된다 — 오류가 아니다(§10 P4 DoD ③).

미확정 기간의 운영 방법:

1. `/progress`에서 미시작·미제출 필터로 대상을 고르고 리마인더를 "발송"한다(시뮬레이션 기록).
2. `/settings`의 리마인더 템플릿(제목·본문)을 실제로 보낼 문구로 채워 둔다.
   그 문구를 복사해 **운영자가 사내 메일·메신저로 직접 보낸다.**
3. 누구에게 보냈는지는 `mail_logs` 기록으로 추적한다. 수동 발송분도 같은 대상 목록을 쓰면
   기록과 현실이 어긋나지 않는다.

이 상태로도 조사 운영은 가능하다. 실발송은 편의이지 전제가 아니다.

### 6-2. 실발송 전환 시 확인할 항목

- [ ] 발신 도메인 결정 — HCG 도메인인가 고객 도메인인가. **합의 필요**(§12 오픈이슈 4, HCG IT)
- [ ] 그 도메인에 SPF 레코드 등록
- [ ] 그 도메인에 DKIM 레코드 등록 (Resend가 발급하는 값)
- [ ] Resend에서 도메인 인증 상태가 verified인지 확인
- [ ] Supabase Edge Function secrets에 `RESEND_API_KEY` 등록
- [ ] **같이** `RESEND_FROM` 등록 — 인증된 도메인의 주소여야 한다. 빠뜨리면 발송이 500으로 실패한다
- [ ] (선택) `RESEND_REPLY_TO` 등록
- [ ] `supabase functions deploy send-reminder --no-verify-jwt` 재배포 — 시크릿 변경 후 반영 확인 (플래그 생략 금지 — 1-9 참고)
- [ ] **본인 계정 1명에게 먼저 보내 본다.** 스팸함으로 가지 않는지, 발신자 이름이 맞는지 확인
- [ ] 확인 쿼리로 실발송 전환을 확인한다:

  ```sql
  SELECT kind, simulated, sent_at FROM public.mail_logs ORDER BY sent_at DESC LIMIT 10;
  -- simulated = false 행이 보이면 실발송으로 전환된 것이다. 이 SELECT는 ADMIN만 된다.
  ```

미확인 — 실발송 전환 시 확인.

---

## 7. 운영 중 점검 목록

조사가 도는 동안 주기적으로 본다. 각 항목의 근거는 §8이다.

### 7-1. Supabase Auth rate limit (§8 S3)

Supabase 대시보드 → **Authentication** → **Rate Limits**. 로그인·비밀번호 재설정 요청 한도를 확인한다.
화면(`LoginPage`)의 5회 실패 60초 잠금은 **클라이언트 방어**라서 브라우저 콘솔로 우회된다.
**서버 측 한도가 실제 방어선이다.**

같은 메뉴의 **Sessions**에서 세션 만료 정책도 함께 확인한다. 미확인 — 파일럿에서 확인.

### 7-2. RLS 누락 0건 (§8 S4 — anon key가 비밀이 아니므로 이것이 실제 목표다)

```sql
-- (1) RLS가 꺼진 public 테이블. 0행이어야 한다.
SELECT tablename FROM pg_tables
 WHERE schemaname = 'public' AND rowsecurity = false
 ORDER BY 1;

-- (2) RLS는 켜졌는데 정책이 하나도 없는 표.
--     mail_logs·audit_logs처럼 "INSERT 정책을 일부러 안 만든" 표는 여기 걸리지 않는다
--     (SELECT 정책은 있다). 예상 밖의 표가 나오면 그 표는 아무도 못 읽는 상태다.
SELECT t.tablename, count(p.policyname) AS policies
  FROM pg_tables t LEFT JOIN pg_policies p
    ON p.schemaname = t.schemaname AND p.tablename = t.tablename
 WHERE t.schemaname = 'public' AND t.rowsecurity
 GROUP BY 1 HAVING count(p.policyname) = 0
 ORDER BY 1;

-- (3) SECURITY DEFINER 함수 목록. 각 함수 본문에 호출자 검증(auth.uid() 비교 또는
--     관리자 확인)이 있는지 눈으로 확인한다. 개수가 늘어났다면 새로 추가된 것부터 본다.
SELECT proname, prosecdef FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
 ORDER BY 1;
```

미확인 — 파일럿에서 확인.

### 7-3. audit_logs · mail_logs

`audit_logs`의 `SELECT`는 ADMIN만 된다. SQL Editor(service_role)에서는 언제나 보인다.

```sql
-- 최근 감사 기록
SELECT created_at, action, entity, entity_id, actor_id
  FROM public.audit_logs ORDER BY created_at DESC LIMIT 50;

-- 행위 종류별 건수 — 기대하는 종류가 0건이면 그 경로가 안 도는 것이다
SELECT action, count(*) FROM public.audit_logs GROUP BY 1 ORDER BY 2 DESC;
```

현재 코드가 남기는 `action` 값 전부다(`logAudit` / `log_audit` 호출 지점을 저장소 전수 확인한 결과).
여기 없는 행위는 `audit_logs`에 남지 않는다 — 0건이라고 "경로가 안 돈" 것이 아니다.

**★ 표시 세 줄(행위 이름 넷)은 `supabase/APPLY_2026-09-02_followup.sql`을 적용한 뒤에만 남는다.** 그 SQL 적용 전에는
제출·재제출·재검토 요청·직무정보(4시트) 업로드가 `audit_logs`에 남지 않는다(제출 이력 자체는
`review_history`에 남는다 — 아래 「여기 없는 것」 참조). 적용 여부는 §1-8의 확인 쿼리로 본다.

| 행위(`action`) | 뜻 | 남기는 곳 |
|---|---|---|
| ★ `REVIEW_SUBMITTED` / `REVIEW_RESUBMITTED` | SME의 제출·재제출 | `submit_review` RPC 안 (`supabase/APPLY_2026-09-02_followup.sql`) |
| `REVIEW_APPROVED` / `REVIEW_REJECTED` | 관리자의 승인·반려 | `decide_review` RPC 안 (`supabase/APPLY_2026-09-01_phase1.sql:1161`) |
| ★ `REVIEW_REREVIEW_REQUESTED` | 재검토 요청 | `request_rereview` RPC 안 (`supabase/APPLY_2026-09-02_followup.sql`). 화면 호출부는 아직 없다 |
| ★ `JOB_DATA_UPLOADED` | **직무정보 4시트** 업로드 | `save_integrated_job_data` RPC 안 (`supabase/APPLY_2026-09-02_followup.sql`). meta에 모드(append/replace)와 5건수 |
| `ADMIN_CREATED` / `SME_CREATED` | 계정 생성 | `src/components/modals/edgeApi.ts:66,68` → `:130` |
| `ACCOUNT_DELETED` | 계정 삭제 | 같은 곳 `:76` |
| `ACCOUNT_DEACTIVATED` / `ACCOUNT_ACTIVATED` | 계정 비활성/재활성 | 같은 곳 `:79` |
| `ACCOUNT_AUTH_RECREATED` | 고아 프로필에 로그인 계정 재생성 | 같은 곳 `:86` |
| `PASSWORD_CHANGED` | 첫 로그인 비밀번호 변경 | `src/pages/ChangePasswordPage.tsx:87` |
| `GUIDE_COMPLETED` | SME 시작 가이드 통과 | `src/pages/GuidePage.tsx:166` |
| `ORG_UNITS_UPLOADED` | **조직 마스터** 업로드 | `src/lib/integratedJobApi.ts:129` |
| `SME_ROSTER_LINKED` | SME 명부 반영(조직 연결 + 배정 생성) | `src/lib/integratedJobApi.ts:207` |
| `ASSIGNMENT_ADDED` | 관리자가 SME 배정을 추가(되살리기 포함) | `src/lib/assignmentApi.ts:291` (`/assignments-admin` 화면) |
| `ASSIGNMENT_DEACTIVATED` | 관리자가 SME 배정을 해제(`active = false`) | `src/lib/assignmentApi.ts:337` (같은 화면) |
| `SURVEY_SETTINGS_SAVED` | 운영 설정 저장 | `src/lib/settingsApi.ts:260` |
| `FTE_REQUIRED_ON` / `FTE_REQUIRED_OFF` | FTE 게이트 스위치 | `src/lib/settingsApi.ts:268` |
| `EXPORT_DOWNLOADED` | E1~E5 내려받기 | `src/pages/ExportsPage.tsx:205` |
| `SNAPSHOT_EXPORTED` | 수동 스냅샷 실행 | `src/lib/snapshotApi.ts:240` |
| `MAIL_SENT` / `MAIL_SIMULATED` | 메일 실발송 / 시뮬레이션 | `src/lib/mailApi.ts:279` |

**여기 없는 것 — 헷갈리기 쉬운 다섯.**

- **감사 기록이 빠져도 아무 데도 안 뜬다.** 세 RPC의 `log_audit` 호출은 예외를 삼킨다(§1-8의 이유).
  제출은 됐는데 감사 한 줄이 안 남는 경우가 조용히 생길 수 있다. 그래서 건수를 대조한다 —
  `review_history`의 `SUBMITTED`/`RESUBMITTED` 건수와 `audit_logs`의 `REVIEW_SUBMITTED`/
  `REVIEW_RESUBMITTED` 건수가 (적용 시각 이후 구간에서) 같아야 한다.
  대조 쿼리는 `supabase/APPLY_2026-09-02_followup.sql`의 확인 (6)이다.
- **소급 기록은 없다.** `APPLY_2026-09-02_followup.sql` 적용 **이전**의 제출·업로드는 `audit_logs`에
  없다. 그 구간은 `review_history`(또는 Export E5 '상태 전이 이력' 시트)로만 본다.
- **화면의 반려는 `REVIEW_REJECTED`다.** 관리자 화면의 반려 버튼은 `request_rereview`가 아니라
  `decide_review`를 부른다(`src/components/JobDetailPage.tsx:460`). `REVIEW_REREVIEW_REQUESTED`가
  0건인 것은 정상이다 — 그 RPC는 화면 호출부 없이 권한만 살아 있고, 그래서 감사 기록을 붙여 두었다.
- **`REVIEW_REJECTED`의 `meta`에는 반려 사유 전문이 들어간다.** `decide_review`가 관리자 입력 원문을
  그대로 `meta.reason`에 넣고, 그 값은 Export E5 '관리자 행위 로그' 시트의 '상세' 열로 나간다.
  다른 행위의 `meta`에는 자유 서술을 넣지 않지만(재검토 요청은 길이만) **반려만 예외다.**
  즉 반려 사유의 보관처는 `review_history.note`와 `audit_logs.meta` 두 곳이다 —
  §8 S6의 보관·삭제·열람 통제 범위를 잡을 때 `audit_logs`를 빼면 안 된다.
  (`src/lib/exportSchema.ts:481`의 "개인정보는 이미 meta에 넣지 않는다"는 주석은 이 예외를 반영하지 못한
  상태로 남아 있다. 어느 쪽으로 맞출지는 `docs/OPEN_ISSUES.md` §8 S5의 「남은 작업」 6번이다.)
- **`upload_history` 표는 여전히 비어 있다.** 만들어만 두고 쓰는 코드가 없다. 업로드 감사는
  `audit_logs`의 `ORG_UNITS_UPLOADED`(조직 마스터) · `SME_ROSTER_LINKED`(SME 명부) ·
  `JOB_DATA_UPLOADED`(직무정보 4시트) 셋으로 본다. 통합 업로드 한 번이 최대 세 줄을 남기는데,
  중복이 아니라 서로 다른 단계다.

자세한 사유와 남은 작업은 `docs/OPEN_ISSUES.md`의 「§8 S5 — 이번 후속으로 닫은 것과 남은 것」에 있다.

```sql
-- 메일 발송 이력(시뮬레이션 여부 포함)
SELECT kind, simulated, sent_at, recipient FROM public.mail_logs ORDER BY sent_at DESC LIMIT 20;
```

### 7-4. 미답 문의

관리자 메뉴 **`/inbox` (문의 인박스)**에서 상태(미답·답변·종결)와 경과일을 본다.
숫자로 한 번 더 보고 싶으면:

```sql
SELECT status, count(*) FROM public.inquiries GROUP BY 1;

-- 미답 문의와 경과 일수. status는 OPEN / ANSWERED / CLOSED 셋뿐이다.
SELECT id, sme_id, step, created_at,
       date_part('day', now() - created_at) AS 경과일, left(body, 60) AS 내용
  FROM public.inquiries WHERE status = 'OPEN'
 ORDER BY created_at;
```

권고: **미답 문의는 영업일 1일 안에 답한다.** SME는 답을 기다리는 동안 검토를 멈춘다.

### 7-5. 진행 상황

`/progress`(진행 현황) 매트릭스와 `/dashboard`를 본다. 마감 D-day는 `/settings`의 마감일이 원점이다.
직무당 소요 중앙값은 `review_sessions` 기반으로 `/dashboard`에 표시된다 —
이 값이 §12 오픈이슈 1("직무당 약 ○○분")의 확정 근거다. 파일럿 전에는 표본이 없어
값이 비어 있거나 흔들리는 것이 정상이다. **착수 후 확정.**

---

## 8. 장애 대응

증상은 대부분 "SQL이 아직 안 들어갔다" 하나로 수렴한다. 아래 표는 실제로 일어날 수 있는 순서대로다.

### 8-1. 제출이 막힐 때 — 확인 순서

가장 흔한 신고다. **이 순서로 본다.**

1. **화면에 뜬 문구를 그대로 받아 적는다.** `submit_review`는 실패를 예외로 던지지 않고
   부족 항목 목록(`{ok:false, missing:[…]}`)으로 돌려주며, 화면은 그 문구를 그대로 보여 준다.
   문구가 곧 원인이다.
2. 문구가 **FTE 관련**이면 → `fte_required` 스위치와 STEP 3 화면 배포 상태를 본다(아래 표 1·2행).
3. 문구가 **"적합성을 선택해 주세요" / "의견 또는 수정안을 적어 주세요"**면 → 장애가 아니다.
   서버 게이트가 제대로 도는 중이다. 부족 항목 링크를 눌러 그 단계에서 채우면 된다.
4. 문구가 **"… 값은 직접 바꿀 수 없습니다"**면 → Phase 1 마이그레이션이 반쪽만 들어갔다(아래 표 4행).
5. 브라우저 콘솔에 **`PGRST202`**면 → 그 함수가 DB에 없다. 해당 APPLY 파일 미적용(아래 표 5행).

### 8-2. 증상 → 확인할 것 → 조치

| 증상 | 확인할 것 | 조치 |
|---|---|---|
| SME가 제출을 누르면 **"FTE를 배분하지 않았습니다. 과업별 투입 비중을 배분해 주세요."** — 그런데 STEP 3 화면이 화면에 없거나 배분한 적이 없다 | `SELECT c.name, s.fte_required FROM public.companies c LEFT JOIN public.survey_settings s ON s.company_id=c.id;` → `t`인가. 그리고 STEP 3 화면이 실제로 배포되어 있는가 | 화면이 아직이면 **스위치를 끈다**: `APPLY_2026-09-01_phase2.sql`의 `true` 두 곳을 `false`로 바꿔 실행하거나 `/settings`에서 끈다. 화면이 배포돼 있으면 정상 동작이니 SME에게 STEP 3에서 배분하라고 안내 |
| 제출 시 **"투입 비중 합계가 99.99%입니다"** 류 | 실제 배분 합계: `SELECT round(sum(pct),2) FROM public.task_fte_allocations WHERE review_id='<id>';` | 정상 게이트다. SME가 STEP 3에서 100.00이 되도록 맞추면 된다. 합계 링과 0% 항목 요약이 화면에 있다 |
| 제출 시 **"이 검토에 배정된 담당자 본인만 제출할 수 있습니다."** | `SELECT sme_id FROM public.review_assignments WHERE …` 와 로그인 계정 id가 같은가 | 배정이 잘못됐거나 다른 계정으로 로그인한 것이다. `/users`에서 배정을 고친다 |
| **임시저장이 안 된다.** `"status 값은 직접 바꿀 수 없습니다. 제출·승인·반려·답변 기능을 통해서만 변경됩니다."` 류 | `SELECT proname FROM pg_proc WHERE proname IN ('submit_review','decide_review','save_review_draft','request_rereview');` → 4개가 다 있는가 | **Phase 1 APPLY 파일을 처음부터 끝까지 다시 실행한다.** 앞 파일(트리거)만 들어가고 뒤 파일(마커를 세우는 RPC)이 안 들어간 상태다. 1-4 참조 |
| 제출·저장에서 브라우저 콘솔 **`PGRST202` (Could not find the function)** | 해당 함수가 있는가(위 쿼리). 그리고 각 APPLY 파일 끝의 `NOTIFY pgrst, 'reload schema';`를 실행했는가 | 함수가 없으면 그 Phase의 APPLY 파일을 적용한다. 함수는 있는데 안 보이면 `NOTIFY pgrst, 'reload schema';`만 따로 실행하고 1~2분 기다린다 |
| 로그인하면 곧장 화면에 들어가고 **비밀번호 변경을 안 물어본다**. 콘솔에 `[App] Phase 0 마이그레이션 미적용 — 비밀번호 강제 변경 게이트가 꺼져 있다` | `SELECT to_regclass('public.audit_logs');` 와 `profiles.must_change_password` 컬럼 존재 여부 | `APPLY_2026-09-01_phase0.sql`을 적용한다. 컬럼이 없으면 앱은 "변경 불필요"로 통과시킨다(로그인 자체를 막지 않기 위한 의도적 폴백) |
| **기존 사용자 전원이** 비밀번호 변경 화면에 갇혔다 | `SELECT must_change_password, count(*) FROM public.profiles GROUP BY 1;` → `true`가 전부인가 | Phase 0의 백필 UPDATE가 안 돌았다(컬럼이 이미 있던 DB에 적용한 경우). 운영 중인 계정만 골라 `UPDATE public.profiles SET must_change_password = false WHERE …;` — **신규 발급 계정까지 한꺼번에 내리지 않도록 대상을 눈으로 확인하고 실행한다** |
| SME가 로그인하면 가이드 화면만 뜨고 못 넘어간다 | `guide_completed_at` 컬럼이 있는가. 통과 버튼을 눌렀을 때 콘솔에 오류가 있는가 | 컬럼은 Phase 1에서 생긴다. 통과 기록에는 컬럼 단위 UPDATE 권한이 필요하니 1-3 확인 쿼리 (3)으로 권한을 본다 |
| 관리자 **직무정보 업로드가 실패**한다 (`PGRST202`, `save_integrated_job_data`) | `SELECT proname FROM pg_proc WHERE proname='save_integrated_job_data';` | `APPLY_2026-08-28.sql`을 적용한다. 이 함수가 없으면 업로드는 한 번도 성공하지 않는다 |
| `/settings`의 **리마인더 템플릿 입력이 비활성**이고 "저장 위치 준비 중"으로 보인다 | `survey_settings`에 `reminder_subject`·`reminder_body_md`가 있는가 | `APPLY_2026-09-01_phase4.sql` 적용 후 **화면을 새로고침**한다(판정이 탭 단위로 캐시된다) |
| 승인 버튼이 **"아직 제출되지 않은 검토는 승인할 수 없습니다."** | `SELECT status, submitted_at FROM public.reviews WHERE id='<id>';` | 정상 동작이다. 승인은 `submitted_at IS NOT NULL`인 검토에만 찍힌다. SME 제출을 먼저 받는다 |
| 반려가 **"반려 사유를 입력해 주세요."** | — | 정상 동작이다(§7-2). 사유는 SME 화면에 배너로 그대로 나가므로 무엇을 고쳐야 하는지 적는다 |
| 리마인더를 보냈다는데 **메일이 안 온다** | `SELECT kind, simulated, sent_at FROM public.mail_logs ORDER BY sent_at DESC LIMIT 10;` → `simulated`가 `true`인가 | `true`면 `RESEND_API_KEY`가 없는 시뮬레이션 모드다(오류 아님). 6-1의 수동 안내로 운영하거나 6-2로 실발송 전환 |
| 리마인더 발송이 **500 + "발신 주소(RESEND_FROM)가 설정되어 있지 않아…"** | Edge Function secrets에 `RESEND_FROM`이 있는가 | `RESEND_API_KEY`만 넣고 `RESEND_FROM`을 빠뜨린 것이다. 인증된 도메인 주소를 등록하고 재배포 |
| 리마인더 발송 버튼이 아무 반응이 없다 / 404 | `send-reminder` Edge Function이 배포되어 있는가 | `supabase functions deploy send-reminder --no-verify-jwt` |
| 계정 관리 화면(비밀번호 재발급·로그인 ID·역할 포함)이 실패한다 | `admin-create-user` Edge Function 배포 여부·버전 (`supabase functions list`) | `supabase functions deploy admin-create-user --no-verify-jwt` |
| 화면이 **"데이터베이스에 연결되어 있지 않습니다"** | Actions **Variables**에 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`가 있는가(Secrets가 아니라 Variables다) | Variables에 등록하고 워크플로를 다시 돌린다. 값은 빌드 시점에 번들로 들어가므로 **재배포해야 반영된다** |
| 로그인이 반복 실패하고 잠금 문구가 뜬다 | 60초 잠금은 클라이언트다. 그래도 안 되면 Supabase Authentication → Rate Limits | 서버 한도에 걸렸으면 한도를 확인하고 잠시 기다린다. 비밀번호를 잊었으면 관리자가 대시보드에서 재설정 |
| 새로고침하면 404가 뜬다 (`/review/…` 같은 경로) | 워크플로에 `cp dist/index.html dist/404.html` 스텝이 있는가 | 있다. 없어졌다면 되살린다 — GitHub Pages는 실제 파일이 없는 경로에 404를 준다 |
| 스냅샷이 **"스냅샷을 만들지 못했어요"** | 어떤 표에서 실패했는지 콘솔 `[snapshotApi]` 로그를 본다. 5만 행 상한에 닿았을 수 있다 | 상한이면 브라우저 다운로드가 아니라 Supabase 프로젝트 백업으로 간다. 권한 오류면 ADMIN 계정으로 로그인했는지 확인 |

### 8-3. 어떤 조치를 하든

- **행을 지우거나 값을 일괄 UPDATE하기 전에 스냅샷을 먼저 내려받는다**(`/exports`).
- SQL Editor에서 실행한 조치는 `audit_logs`에 안 남는다. 무엇을 왜 했는지 별도로 기록한다.
- 원인이 마이그레이션 미적용이면 **해당 APPLY 파일을 통째로 다시 실행**하는 것이 가장 안전하다.
  전부 멱등하게 쓰여 있어 두 번 실행해도 데이터가 상하지 않는다.

---

## 참고

- `docs/PLAN.html` — 이 개편의 기준 문서(§8 보안, §10 로드맵, §12 오픈 이슈). `docs/PLAN.txt`는 grep용 평문 사본.
- `docs/PILOT.md` — 파일럿 체크리스트(Phase 5). 운영 전환 **전에** 전 경로를 한 번 완주하는 절차.
- `README.md` — 개발자용 시작 절차와 기능·데이터 요약.


---

## v2.0 운영 점검 추가 항목 (2026-09-02)

### 세션·인증

| 항목 | 값 | 어디서 확인 |
| --- | --- | --- |
| 유휴 자동 로그아웃 | **30분**(결정 D8), 1분 전 화면 경고 | 화면 동작 — `src/App.tsx` `IDLE_LIMIT_MS` |
| JWT 만료 | 1시간 권장 | Supabase Dashboard → Authentication → Sessions |
| Refresh 토큰 재사용 감지 | 켠다 | 같은 화면 |
| 이메일 발송 rate limit | 기본값 확인(비밀번호 재설정이 이 한도를 쓴다) | Authentication → Rate limits |
| 비밀번호 재설정 redirect 허용 목록 | `https://<도메인>/jobreview_seoyoneh/reset-password` 를 Redirect URLs에 등록 | Authentication → URL Configuration |

재설정 링크가 "허용되지 않은 주소"로 거부되면 마지막 항목이 원인이다. 등록하지 않으면 메일은 가지만
링크를 열었을 때 세션이 만들어지지 않아 화면이 "링크가 만료되었어요"를 띄운다.

### CSP

`index.html`에 `<meta http-equiv="Content-Security-Policy">`로 건다(GitHub Pages는 응답 헤더를 세울 수 없다).
`connect-src`의 Supabase 도메인은 빌드 시 `VITE_SUPABASE_URL`에서 치환된다(`vite.config.ts`의 `cspEnv`).

- Supabase 프로젝트를 옮기면 **빌드 변수만 바꾸면 된다** — CSP는 따라간다.
- 빌드 변수가 비어 있으면 `connect-src`가 `'self'`만 남아 로그인부터 막힌다. 배포 후 첫 로그인으로 확인한다.
- meta CSP의 한계: `frame-ancestors`·`report-uri`는 무시된다. 클릭재킹 방어는 배포 호스팅의 헤더 설정이 필요하다.

### SME 계정 발급(변경됨)

비밀번호는 **서버가 만들어 화면에 1회만 표시한다**(v2 S2 · 결정 D1 ⓑ). 업로드 양식에 비밀번호 열이 없다.

1. 개별 추가: 등록 직후 모달에 임시 비밀번호가 뜬다 → 복사해 당사자에게 개별 전달 → 창을 닫으면 다시 볼 수 없다.
2. 일괄 업로드: 결과 패널에 `이메일 ⇥ 임시 비밀번호` 목록이 뜬다 → 「목록 복사」 → 창을 닫으면 사라진다.
3. 잊었으면 재발급이 아니라 **재설정 메일**을 보낸다(계정 관리 → 비밀번호 재설정).

파일로 내려받는 기능은 두지 않았다 — 평문 목록이 파일로 남는 것을 없애려고 한 변경이기 때문이다.
