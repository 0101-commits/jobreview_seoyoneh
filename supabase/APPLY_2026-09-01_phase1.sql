/* =====================================================================
   Job Review — 2026-09-01 Phase 1 (데이터 모델 확장 · 제출 게이트) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     아래 2개 마이그레이션의 본문을 적용 순서 그대로 이어붙인 파일이다. 순서가 중요하다.
       1) 20260901020000_phase1_survey_schema.sql  — 표를 먼저 만든다(§7-1)
          - 신규 테이블 7종: org_units / task_fte_allocations / review_sessions / inquiries /
            job_workshop_flags / mail_logs / survey_settings. 전부 RLS 활성(§7-2).
          - 컬럼 추가: profiles.org_unit_id, profiles.guide_completed_at,
            reviews.approved_at, reviews.rejected_reason.
            guide_completed_at 은 SME 본인이 기록해야 해서 컬럼 단위 GRANT UPDATE 를 함께 준다.
          - survey_settings.fte_required (기본 false = FTE 게이트 꺼짐) — 아래 ★ 항목 참조.
          - 새 표의 TRUNCATE 권한을 anon·authenticated 에서 회수한다(RLS 를 거치지 않는 통로 차단).
          - 컬럼 잠금 트리거 2개. RLS 는 행까지만 막고 컬럼은 막지 못해서,
            SME 가 PostgREST 로 본인 행을 직접 PATCH 하면 reviews 의 status·submitted_at·
            approved_at·rejected_reason 과 inquiries 의 answer·status 를 스스로 바꿀 수 있었다
            (제출 게이트를 통째로 건너뛰거나, 없는 관리자 답변을 만들어 낼 수 있었다).
            이제 그 컬럼들은 관리자이거나 아래 RPC 안에서만 바뀐다.
       2) 20260901030000_phase1_submit_gate.sql    — 그 표를 쓰는 함수를 만든다(§7-2)
          - submit_review 재정의. 시그니처(uuid, jsonb x5, text)는 그대로다.
            상태 전이 전에 ① 전 섹션 평가 완료 ② 조건부 필수 의견 ③ FTE 합계 = 100.00
            ④ 호출자 = 배정 SME 본인 을 서버에서 재검증한다.
            검증에 걸리면 예외를 던지지 않고 { "ok": false, "missing": [ … ] } 를 돌려준다.
            ★ 예외로 던지면 같은 트랜잭션에서 방금 저장한 SME 입력까지 롤백되기 때문이다.
          - decide_review 신설(관리자 한정). 승인은 reviews.approved_at 으로 표현하고
            반려는 REVIEW_REQUESTED + 사유 필수. review_history 와 audit_logs 에 함께 남는다.
            승인은 제출된 적 있는 검토(submitted_at IS NOT NULL)에만 찍힌다.
          - save_review_draft · request_rereview 재정의. 시그니처·반환은 그대로다.
            (1) 위 컬럼 잠금 트리거를 통과하도록 함수 안에서만 서는 마커를 켠다 —
                그래서 이 두 파일은 반드시 함께 적용해야 한다(앞 파일만 적용하면 임시저장이 막힌다).
            (2) save_review_draft 가 신규 과업 제안을 전량 삭제 후 재삽입하지 않고 이름 기준으로
                갱신한다. 제안 id 가 매 저장마다 바뀌면 거기에 배분한 FTE 가 캐스케이드로 사라진다.
            (3) 재제출·재검토 요청 시 지난 판정 표시(approved_at 등)를 비운다.
          - 두 번째 파일은 첫 번째 파일이 만든 표에 의존한다. 순서가 뒤바뀌면 파일 첫머리의
            확인 블록이 "먼저 20260901020000 을 적용해 주세요" 로 즉시 멈춘다(조용히 깨지지 않는다).

     ★ 제출 게이트 중 FTE 검사는 꺼진 채로 적용된다 — 켜는 시점은 Phase 2 다
       - FTE 입력 화면(STEP 3)은 Phase 2 에서 배포된다. 그 전에 FTE 검사를 켜면 배분 행이
         하나도 없으므로 SME 는 아무도 제출할 수 없다("FTE를 배분하지 않았습니다").
         그래서 survey_settings.fte_required 의 기본값이 false 다. 이 스크립트를 그냥 실행하면
         FTE 검사는 꺼져 있고, 따로 실행할 해제 SQL 도 없다.
       - Phase 2 의 FTE 화면을 배포한 뒤 아래를 실행해 회사 단위로 켠다.
         (fte_required 만 올리고 나머지 설정은 건드리지 않는다. 여러 번 실행해도 안전하다.)

           INSERT INTO public.survey_settings (company_id, fte_required)
           SELECT c.id, true FROM public.companies c
           ON CONFLICT (company_id) DO UPDATE SET fte_required = true, updated_at = now();

         다시 끌 때는 위 문장의 true 두 곳을 false 로 바꿔 실행한다.
       - 이 스위치는 회사 단위다. 직무(jobs.company_id)도 배정(review_assignments.company_id)도
         비어 있는 검토는 어느 회사 설정에도 걸리지 않아 언제나 꺼진 것으로 본다.
         켠 뒤에는 그 검토만 검사에서 빠지므로, 아래 「적용 후 확인」의 마지막 쿼리로
         그런 검토가 있는지 확인하고 company_id 를 채워 둔다(0행이면 신경 쓸 것 없다).
       - ①② (전 섹션 평가·조건부 의견)에는 해제 스위치가 없다. 원래 필수였던 항목이고
         지금까지는 클라이언트만 막고 있었다. 적용 후에는 미평가 항목이 남은 검토가 제출되지 않는다.

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트(yktdlcpovntegiwfnied) → 왼쪽 메뉴 SQL Editor.
     2. New query 를 누르고 이 파일 전체를 복사해 붙여넣는다.
     3. Run 을 누른다. 전체가 한 번에 실행된다.
        - CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
          DROP POLICY IF EXISTS 후 CREATE POLICY / DROP TRIGGER IF EXISTS 후 CREATE TRIGGER /
          ALTER COLUMN … SET DEFAULT / CREATE OR REPLACE FUNCTION 만 쓴다.
          두 번 실행해도 안전하다.
        - 행을 지우거나 바꾸는 문장이 없다. 만드는 것은 표·컬럼·정책·권한·인덱스·트리거·함수뿐이다.
          (함수 본문 안의 DELETE 는 나중에 그 함수가 호출될 때 도는 것이고 지금 실행되지 않는다.)
        - Phase 0(20260901010000)이 먼저 적용되어 있어야 한다. decide_review 가 그때 만든
          log_audit RPC 를 호출한다. 아직이라면 APPLY_2026-09-01_phase0.sql 을 먼저 돌린다.
     4. 아래 「적용 후 확인」 쿼리를 새 쿼리 창에서 실행한다.

   ▣ 적용 전 실측(선택) — 전부 읽기 전용이다
       -- (1) Phase 0 이 적용되어 있나. log_audit 가 없으면 decide_review 가 런타임에 깨진다.
       SELECT to_regproc('public.log_audit') AS log_audit;

       -- (2) 지금 제출된 검토 중 이번 게이트에 걸릴 것이 얼마나 되나(참고용).
       --     적합성이 비어 있는 피드백 행 수. 0이 아니어도 이미 제출된 건은 다시 검사되지 않는다.
       SELECT 'job'   AS kind, count(*) FROM public.job_feedback   WHERE COALESCE(suitability, '') = ''
       UNION ALL
       SELECT 'task',  count(*) FROM public.task_feedback  WHERE COALESCE(suitability, '') = ''
       UNION ALL
       SELECT 'skill', count(*) FROM public.skill_feedback WHERE COALESCE(suitability, '') = '';

   ▣ 적용 후 확인
       -- 새 표 7종이 생겼고 RLS 가 전부 켜져 있는지. 기대: 7행, rls = true.
       SELECT c.relname, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('org_units','task_fte_allocations','review_sessions','inquiries',
                            'job_workshop_flags','mail_logs','survey_settings')
        ORDER BY 1;

       -- reviews 에 승인/반려 컬럼이 생겼는지. 기대: 2행.
       SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reviews'
          AND column_name IN ('approved_at','rejected_reason') ORDER BY 1;

       -- 상태 CHECK 가 그대로 5상태인지(가산성 확인). 기대: NOT_STARTED / IN_PROGRESS /
       -- SUBMITTED / REVIEW_REQUESTED / RESUBMITTED 다섯 개가 그대로 보인다.
       SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = 'public.reviews'::regclass AND contype = 'c';

       -- 함수 4종. 기대: decide_review 만 security_definer=true(첫 줄에서 is_admin() 확인),
       --              나머지 셋은 false(호출자 RLS 유지).
       SELECT p.proname, p.prosecdef AS security_definer,
              pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('submit_review','decide_review','save_review_draft','request_rereview')
        ORDER BY 1;

       -- 컬럼 잠금·시각 기록 트리거. 기대: 3행(reviews / inquiries / review_sessions).
       SELECT c.relname AS table_name, t.tgname
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public'
          AND t.tgname IN ('reviews_guard_locked_columns','inquiries_guard_locked_columns',
                           'review_sessions_stamp_clock')
        ORDER BY 1;

       -- 실행 권한. 기대: anon 은 두 함수 모두 false, authenticated 는 모두 true.
       SELECT g.grantee, f.fn,
              has_function_privilege(g.grantee, f.fn, 'EXECUTE') AS can_execute
         FROM unnest(ARRAY['anon','authenticated']) AS g(grantee),
              unnest(ARRAY['public.submit_review(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text)',
                           'public.decide_review(uuid,text,text)']) AS f(fn)
        ORDER BY 1, 2;

       -- FTE 게이트 상태. survey_settings 에 행이 없는 회사는 기본값(꺼짐)이다.
       -- 적용 직후 기대: 전부 false. Phase 2 배포 후 위 ★ 의 INSERT 로 켠다.
       SELECT c.name, COALESCE(s.fte_required, false) AS fte_gate_on
         FROM public.companies c
         LEFT JOIN public.survey_settings s ON s.company_id = c.id
        ORDER BY 1;

       -- 검토별 현재 FTE 합계(§10 P1 DoD ③ 예행). 게이트는 round(sum,2) = 100.00 만 통과시킨다.
       -- suggested 열은 신규 제안 과업에 붙은 배분 수다. 저장(자동 저장 포함)을 여러 번 한 뒤에도
       -- 이 수가 그대로여야 한다 — 예전에는 저장할 때마다 제안 id 가 새로 발급되어 캐스케이드로 사라졌다.
       SELECT review_id, count(*) AS rows,
              count(*) FILTER (WHERE target_type = 'SUGGESTED') AS suggested,
              round(sum(pct), 2) AS sum_pct
         FROM public.task_fte_allocations GROUP BY 1 ORDER BY 4 DESC LIMIT 20;

       -- 제안 id 보존 확인. 같은 검토를 두 번 이상 저장한 뒤에 본다.
       -- 기대: survived_a_save = true. 제안 행이 저장을 넘겨 그대로 살아 있다는 뜻이다.
       -- 옛 방식(전량 삭제 후 재삽입)이면 created_at 이 last_saved_at 을 따라 올라가 false 가 된다.
       SELECT s.review_id, s.name, s.created_at, r.last_saved_at,
              (s.created_at < r.last_saved_at) AS survived_a_save
         FROM public.new_task_suggestions s
         JOIN public.reviews r ON r.id = s.review_id
        WHERE r.last_saved_at IS NOT NULL
        ORDER BY r.last_saved_at DESC
        LIMIT 20;

       -- 회사를 알 수 없는 검토(위 ★ 참고). 기대: 0행.
       -- 행이 나오면 해당 직무나 배정에 company_id 를 채워야 FTE 스위치가 그 검토에도 닿는다.
       SELECT r.id AS review_id, j.name AS job_name, r.status
         FROM public.reviews r
         JOIN public.review_assignments a ON a.id = r.assignment_id
         JOIN public.jobs j ON j.id = a.job_id
        WHERE COALESCE(j.company_id, a.company_id) IS NULL
        ORDER BY 2;
   ===================================================================== */

-- =====================================================================
-- ▼ 20260901020000_phase1_survey_schema.sql
-- =====================================================================

/*
# Phase 1 데이터 모델 확장 — 조직 트리 · FTE 배분 · 세션 · 문의 · 워크숍 플래그 · 메일 이력 · 운영 설정

기준: docs/PLAN.txt §7-1(신규 테이블 DDL) · §7-2(RLS 표) · §10 P1 · §11-2 Phase 1.

1. 목적
- §7-1 의 신규 테이블 7종(org_units, task_fte_allocations, review_sessions, inquiries,
  job_workshop_flags, mail_logs, survey_settings)과 profiles·reviews 컬럼을 추가한다.
- audit_logs 는 Phase 0(20260901010000_phase0_security_baseline.sql)에서 이미 만들었으므로
  이 파일에서는 손대지 않는다. 감사 기록은 그때 만든 log_audit RPC 를 그대로 재사용한다.
- 이 마이그레이션은 스키마만 만든다. submit_review / decide_review RPC 와 화면은 별도 파일에서 붙인다.

2. 보안
- 신규 테이블 전부 RLS 활성(§8 S4 "신규 테이블 전부 RLS 활성").
- task_fte_allocations · review_sessions · inquiries — SME 는 본인 review(문의는 본인 sme_id)
  소속 행만 select/insert/update. "본인 review" 판별은 기존 피드백 테이블 정책과 똑같은
  EXISTS(reviews r JOIN review_assignments a ON a.id = r.assignment_id ...) 패턴을 그대로 쓴다
  (20260812084909_create_job_review_system.sql 의 task_feedback 정책과 동일한 형태).
  관리자는 select 가능. 문의는 관리자가 답변해야 하므로 update 도 함께 허용한다.
  FTE·세션은 관리자 update 를 열지 않는다 — 응답 원본(§9 E1·E2 의 산출 근거)을 관리자가
  조용히 고칠 수 있으면 그 자체로 증빙 가치가 사라진다.
  같은 이유로 review_sessions 의 DELETE 는 관리자만 한다(기존 피드백 3종의 *_admin_delete 와
  같은 형태다). 응답자가 자기 소요 기록을 지울 수 있으면 §9 E5 의 "직무당 ○○분"이 근거가 되지 못한다.
  FTE 의 소유자 DELETE 는 남긴다 — STEP 2 에서 과업을 삭제 제안하면 그 배분 행도 함께 사라져야 한다.
- 컬럼 잠금(⑨) — RLS 는 "어느 행"까지만 막고 "어느 컬럼"은 막지 못한다. reviews·inquiries 의
  UPDATE 정책은 "관리자 또는 본인"이라 관리자 전용 판정 컬럼까지 응답자가 직접 PATCH 할 수 있다.
  BEFORE UPDATE 트리거로 그 컬럼들만 잠근다. 자세한 근거는 ⑨ 블록 주석에 적었다.
- org_units · survey_settings · job_workshop_flags — authenticated select, 쓰기는 ADMIN 만
  (companies 테이블의 기존 정책 형태를 그대로 따른다).
- mail_logs — select 는 ADMIN 만. INSERT/UPDATE/DELETE 정책을 만들지 않는다(정책 없음 = 거부).
  기록은 SECURITY DEFINER RPC·Edge Function 경유만 허용한다는 §7-2 규칙 그대로다.
- TRUNCATE 회수: Supabase 기본 권한이 새 테이블에 TRUNCATE 까지 준다. TRUNCATE 는 RLS 를
  거치지 않으므로 SME 계정 하나로 표 전체를 비울 수 있다. Phase 0 audit_logs 와 같은 이유로
  신규 테이블 전부에서 회수한다.
- 관리자 select 를 "자사(company) 범위"로 좁히라는 요구가 §7-2 에 있으나 그렇게 하지 않았다.
  이 저장소의 기존 정책은 전부 public.is_admin() 만 보고 계열사 필터는 클라이언트가 건다
  (jobs·companies·피드백 전 테이블이 그렇다). 회사 범위 제한이 들어간 곳은 RLS 가 아니라
  SECURITY DEFINER 함수 get_review_status 한 곳뿐이다. 이 표들에만 다른 규칙을 넣으면
  "관리자 화면에서 어떤 표는 보이고 어떤 표는 비어 있는" 일관성 붕괴가 생긴다.
  기존 관례대로 is_admin() 으로 두고, 회사 범위 좁히기는 전 테이블을 한 번에 바꾸는
  별도 과제로 남긴다.

3. 스키마 보정 · 기획안과 다르게 쓴 곳
- task_fte_allocations.task_id 의 참조 대상: 기획안 §7-1 ②는 task_activities(id) 라고 적었으나
  job_tasks(id) 로 쓴다. 이 저장소에서 SME 가 검토하는 "과업"의 실제 테이블은 job_tasks 이고
  (task_feedback.task_id 도 job_tasks(id) 를 참조한다), task_activities 는 job_tasks 아래
  세부 활동을 담는 하위 표다. FTE 는 과업 단위로 배분하므로 job_tasks 가 맞다.
- pct 의 CHECK 절: 기준 문서 docs/PLAN.txt 는 HTML 에서 태그를 걷어낸 평문이라
  "check (pct >= 0 and pct" 에서 잘려 있다. 원본 의도인 0 이상 100 이하로 복원해 적었다.
- survey_settings.fte_required 는 기획안에 없는 컬럼을 하나 더한 것이다.
  Phase 1 의 제출 게이트가 FTE 합계 100% 를 강제하는데(§7-2 submit_review ③) 정작 FTE 입력
  화면은 Phase 2 에서 온다. 기본값을 엄격(true)하게 두면 이 파일을 적용하는 순간 배분 행이
  0 이라 SME 전원의 제출이 막힌다. 해제 방법이 적용 문서에만 있으면 그 문단을 건너뛴 순간
  운영이 통째로 선다 — 기본값이 스스로를 막는 설정은 탈출구가 아니다.
  그래서 기본값을 false(꺼짐)로 두고, FTE 입력 화면이 배포되는 Phase 2 에서 true 로 올리는
  가산 마이그레이션을 그때 추가한다. 회사 단위로 먼저 켜려면 survey_settings 에
  fte_required = true 행을 넣으면 된다. submit_review 는 이 값을 읽어 FTE 검증을 켜고 끈다.
- profiles.organization(text)은 지우지 않는다. org_unit_id 가 채워질 때까지의 과도기 표시용으로
  그대로 남긴다(§7-1 ① 주석 그대로).
- updated_at 자동 갱신 트리거는 만들지 않는다. 이 저장소에는 그런 트리거가 없고
  갱신 주체(RPC)가 updated_at = now() 를 직접 쓰는 것이 기존 관례다.

4. 데이터 안전
- 가산적이다. 기존 테이블·행·정책·권한을 지우거나 바꾸지 않고 추가만 한다.
  reviews 의 5상태(NOT_STARTED / IN_PROGRESS / SUBMITTED / REVIEW_REQUESTED / RESUBMITTED)
  CHECK 도 건드리지 않는다 — approved_at·rejected_reason 은 상태 전이를 기록하는 부가 컬럼일 뿐이다.
- 멱등이다. CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
  DROP POLICY IF EXISTS 후 CREATE POLICY / CREATE INDEX IF NOT EXISTS /
  DROP TRIGGER IF EXISTS 후 CREATE TRIGGER / ALTER COLUMN … SET DEFAULT 만 쓴다.
  기존 행을 손대는 UPDATE 가 없으므로 재실행해도 데이터가 변하지 않는다.
  (SET DEFAULT 는 앞으로 만들어질 행에만 적용된다. 이미 들어간 값을 바꾸지 않는다.)
- profiles 컬럼 권한(§ Phase 0 과 같은 함정):
  20260813034113 이 REVOKE UPDATE ON profiles 후 컬럼 단위 GRANT 만 남겨 놓았다.
  · guide_completed_at 은 SME 본인이 가이드를 통과할 때 스스로 갱신하므로 GRANT 를 함께 넣는다.
    없으면 RLS 를 통과해도 권한 오류로 막힌다.
  · org_unit_id 는 GRANT 하지 않는다. 조직 배정은 관리자 업로드(service_role Edge Function ·
    SECURITY DEFINER RPC) 경로로만 들어오고, 이 둘은 컬럼 GRANT 에 걸리지 않는다.
    authenticated 에 열어 주면 SME 가 본인 행을 자기 소속으로 바꿀 수 있어(RLS 는 본인 행
    update 를 허용한다) 조직별 집계(§9 E2)가 응답자 마음대로 흔들린다.
*/

-- ── ① 조직 트리 (§7-1 ① · R8) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  parent_id uuid REFERENCES public.org_units(id),
  code text NOT NULL,                            -- 고객 조직코드(업로드 키)
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_units_authenticated_select" ON public.org_units;
CREATE POLICY "org_units_authenticated_select" ON public.org_units FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "org_units_admin_insert" ON public.org_units;
CREATE POLICY "org_units_admin_insert" ON public.org_units FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "org_units_admin_update" ON public.org_units;
CREATE POLICY "org_units_admin_update" ON public.org_units FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "org_units_admin_delete" ON public.org_units;
CREATE POLICY "org_units_admin_delete" ON public.org_units FOR DELETE
  TO authenticated USING (public.is_admin());

-- profiles.org_unit_id — organization(text)은 과도기 표시용으로 그대로 둔다.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES public.org_units(id);

-- ── ② 과업별 투입 비중 (§7-1 ② · R2) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_fte_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('EXISTING','SUGGESTED')),
  -- 기획안의 task_activities(id) 대신 job_tasks(id). 근거는 위 3항.
  task_id uuid REFERENCES public.job_tasks(id),                                    -- EXISTING일 때
  -- ON DELETE CASCADE: 제안이 취소되면 그 배분도 함께 사라져야 한다(남으면 유령 비중이 합계에 잡힌다).
  -- 이 참조는 "저장을 넘겨도 제안 id 가 그대로"라는 전제 위에 선다. 원래 save_review_draft 는
  -- 저장할 때마다 제안을 전량 삭제 후 새 id 로 다시 넣었고, 그러면 2.5초 자동 저장 한 번에
  -- SUGGESTED 배분이 캐스케이드로 지워졌다. 그래서 20260901030000 이 save_review_draft 를
  -- 이름 기준 갱신(id 보존)으로 바꿨다. 두 파일은 반드시 함께 적용한다.
  suggestion_id uuid REFERENCES public.new_task_suggestions(id) ON DELETE CASCADE, -- SUGGESTED일 때
  -- 평문 PLAN.txt에서 잘린 상한(<= 100)을 원본 의도대로 복원했다.
  pct numeric(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- target_type과 실제로 채워진 참조가 어긋난 행을 아예 만들 수 없게 막는다.
  -- 이게 없으면 둘 다 NULL인 유령 배분이나 둘 다 채운 이중 계상이 §9 E2 피벗에 그대로 섞인다.
  CONSTRAINT task_fte_allocations_target_shape CHECK (
    (target_type = 'EXISTING'  AND task_id IS NOT NULL AND suggestion_id IS NULL)
    OR
    (target_type = 'SUGGESTED' AND suggestion_id IS NOT NULL AND task_id IS NULL)
  )
);

-- 같은 검토에서 같은 대상이 두 줄 나오면 합계 100% 게이트가 통과해도 비중이 이중 계상된다.
-- 한쪽이 NULL인 구조라서 통합 UNIQUE는 쓸 수 없다(NULL은 서로 같지 않게 취급된다). 부분 인덱스 2개로 건다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fte_review_task
  ON public.task_fte_allocations (review_id, task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fte_review_suggestion
  ON public.task_fte_allocations (review_id, suggestion_id) WHERE suggestion_id IS NOT NULL;
-- 조회는 항상 "이 검토의 배분 전체"라서 review_id 단독 인덱스가 주 경로다.
CREATE INDEX IF NOT EXISTS idx_fte_review ON public.task_fte_allocations (review_id);

ALTER TABLE public.task_fte_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fte_access_select" ON public.task_fte_allocations;
CREATE POLICY "fte_access_select" ON public.task_fte_allocations FOR SELECT
  TO authenticated USING (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));

-- 소유 검증만으로는 부족하다. FK 는 "그 id 가 있는가"만 보고 "이 검토의 직무 것인가"는 보지 않아서,
-- 남의 직무 과업 id 를 붙인 배분이 그대로 저장된다(job_tasks 는 전 사용자 select 허용이라 id 를 알 수 있다).
-- 제출 게이트 ③ 은 review_id 로만 합산하므로 그 유령 행이 100% 에 계산되고, §9 E2 의
-- 직무×과업×조직 피벗에도 남의 과업 비중으로 섞여 들어간다. 대상의 소속을 여기서 함께 검사한다.
DROP POLICY IF EXISTS "fte_owner_insert" ON public.task_fte_allocations;
CREATE POLICY "fte_owner_insert" ON public.task_fte_allocations FOR INSERT
  TO authenticated WITH CHECK (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()) and (task_fte_allocations.task_id is null or exists(select 1 from public.job_tasks t join public.reviews r2 on r2.id = task_fte_allocations.review_id join public.review_assignments a2 on a2.id = r2.assignment_id where t.id = task_fte_allocations.task_id and t.job_id = a2.job_id)) and (task_fte_allocations.suggestion_id is null or exists(select 1 from public.new_task_suggestions n where n.id = task_fte_allocations.suggestion_id and n.review_id = task_fte_allocations.review_id)));

DROP POLICY IF EXISTS "fte_owner_update" ON public.task_fte_allocations;
CREATE POLICY "fte_owner_update" ON public.task_fte_allocations FOR UPDATE
  TO authenticated USING (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) WITH CHECK (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()) and (task_fte_allocations.task_id is null or exists(select 1 from public.job_tasks t join public.reviews r2 on r2.id = task_fte_allocations.review_id join public.review_assignments a2 on a2.id = r2.assignment_id where t.id = task_fte_allocations.task_id and t.job_id = a2.job_id)) and (task_fte_allocations.suggestion_id is null or exists(select 1 from public.new_task_suggestions n where n.id = task_fte_allocations.suggestion_id and n.review_id = task_fte_allocations.review_id)));

-- STEP 2에서 과업이 삭제 제안되면 STEP 3 배분 행도 함께 사라져야 해서 소유자 DELETE가 필요하다.
DROP POLICY IF EXISTS "fte_owner_delete" ON public.task_fte_allocations;
CREATE POLICY "fte_owner_delete" ON public.task_fte_allocations FOR DELETE
  TO authenticated USING (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));

-- ── ③ 응답 소요 실측 (§7-1 ③ · R4) ──────────────────────────────────
-- 화면 체류 구간만 남긴다. 개인정보가 아니라 §10 P5의 "○○분" 근거(§9 E5)를 만들기 위한 값이다.
CREATE TABLE IF NOT EXISTS public.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step BETWEEN 0 AND 5),   -- 0=가이드
  -- started_at 자체가 생성 시각이라 created_at/updated_at은 두지 않는다(§7-1 ③ DDL 그대로).
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_review_sessions_review_step
  ON public.review_sessions (review_id, step);

ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_sessions_access_select" ON public.review_sessions;
CREATE POLICY "review_sessions_access_select" ON public.review_sessions FOR SELECT
  TO authenticated USING (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));

DROP POLICY IF EXISTS "review_sessions_owner_insert" ON public.review_sessions;
CREATE POLICY "review_sessions_owner_insert" ON public.review_sessions FOR INSERT
  TO authenticated WITH CHECK (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));

-- 이탈 시각(ended_at)은 열려 있던 행을 나중에 닫는 방식이라 소유자 UPDATE가 필요하다.
DROP POLICY IF EXISTS "review_sessions_owner_update" ON public.review_sessions;
CREATE POLICY "review_sessions_owner_update" ON public.review_sessions FOR UPDATE
  TO authenticated USING (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) WITH CHECK (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));

-- 삭제는 관리자만. 소요 기록은 응답 원본과 같은 증빙이라(§9 E5 · 착수보고 11면의 "직무당 ○○분")
-- 응답자가 지울 수 있으면 안 된다. 기존 피드백 3종의 *_admin_delete 정책과 같은 형태다.
-- (§7-2 도 세션에는 select/insert/update 만 준다. 화면에도 삭제 경로가 없다.)
DROP POLICY IF EXISTS "review_sessions_owner_delete" ON public.review_sessions;
DROP POLICY IF EXISTS "review_sessions_admin_delete" ON public.review_sessions;
CREATE POLICY "review_sessions_admin_delete" ON public.review_sessions FOR DELETE
  TO authenticated USING (public.is_admin());

-- 시각은 서버가 찍는다. started_at·ended_at 이 클라이언트 값이면 응답자가 구간을 마음대로 만들 수 있어
-- 소요 실측이 근거가 되지 못한다(RLS 도 컬럼 GRANT 도 "값"까지는 막지 못한다).
-- started_at 은 만들 때 한 번 now(), 이후 UPDATE 에서는 원래 값을 지킨다.
-- ended_at 은 닫을 때마다 now() 로 덮어쓴다(두 번 닫아도 안전하다는 기존 동작 그대로다).
CREATE OR REPLACE FUNCTION public.review_sessions_stamp_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_at := now();
  ELSE
    NEW.started_at := OLD.started_at;
    IF NEW.ended_at IS NOT NULL THEN
      NEW.ended_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS review_sessions_stamp_clock ON public.review_sessions;
CREATE TRIGGER review_sessions_stamp_clock
  BEFORE INSERT OR UPDATE ON public.review_sessions
  FOR EACH ROW EXECUTE FUNCTION public.review_sessions_stamp_clock();

-- ── ④ 문의 채널 (§7-1 ④) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sme_id uuid NOT NULL REFERENCES public.profiles(id),
  review_id uuid REFERENCES public.reviews(id),
  step smallint,                                          -- 컨텍스트 자동 첨부
  body text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED','CLOSED')),
  answer text,
  answered_by uuid REFERENCES public.profiles(id),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inquiries_access_select" ON public.inquiries;
CREATE POLICY "inquiries_access_select" ON public.inquiries FOR SELECT
  TO authenticated USING (public.is_admin() OR sme_id = auth.uid());

-- review_id는 nullable이라 본인 판별의 기준은 sme_id다. 다만 검토를 첨부한 문의라면
-- 그 검토도 본인 것이어야 한다 — 남의 검토 번호를 붙여 관리자 인박스의 맥락을 흐리지 못하게 막는다.
DROP POLICY IF EXISTS "inquiries_owner_insert" ON public.inquiries;
CREATE POLICY "inquiries_owner_insert" ON public.inquiries FOR INSERT
  TO authenticated WITH CHECK (sme_id = auth.uid() AND (review_id IS NULL OR exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())));

-- 관리자 답변(answer/status/answered_by/answered_at)과 SME 본인의 수정이 같은 UPDATE 정책을 탄다.
-- 정책은 행까지만 보므로 답변 컬럼은 아래 ⑨ 의 트리거가 따로 잠근다(SME 는 body 만 고칠 수 있다).
DROP POLICY IF EXISTS "inquiries_owner_update" ON public.inquiries;
CREATE POLICY "inquiries_owner_update" ON public.inquiries FOR UPDATE
  TO authenticated USING (public.is_admin() OR sme_id = auth.uid()) WITH CHECK (public.is_admin() OR sme_id = auth.uid());

DROP POLICY IF EXISTS "inquiries_owner_delete" ON public.inquiries;
CREATE POLICY "inquiries_owner_delete" ON public.inquiries FOR DELETE
  TO authenticated USING (sme_id = auth.uid());

-- ── ⑤ 워크숍 플래그 (§7-1 ⑤ · R7) ───────────────────────────────────
-- 직무당 한 줄이라 job_id 자체가 PK다. 자동 규칙이 다시 돌면 같은 줄을 갱신한다(사유는 reasons에 누적).
CREATE TABLE IF NOT EXISTS public.job_workshop_flags (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id),
  flagged boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('AUTO','MANUAL')),
  reasons text[] NOT NULL DEFAULT '{}',                   -- 예: {'부적합 30%+','FTE 1위 불일치'}
  decided_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_workshop_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_workshop_flags_authenticated_select" ON public.job_workshop_flags;
CREATE POLICY "job_workshop_flags_authenticated_select" ON public.job_workshop_flags FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "job_workshop_flags_admin_insert" ON public.job_workshop_flags;
CREATE POLICY "job_workshop_flags_admin_insert" ON public.job_workshop_flags FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "job_workshop_flags_admin_update" ON public.job_workshop_flags;
CREATE POLICY "job_workshop_flags_admin_update" ON public.job_workshop_flags FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "job_workshop_flags_admin_delete" ON public.job_workshop_flags;
CREATE POLICY "job_workshop_flags_admin_delete" ON public.job_workshop_flags FOR DELETE
  TO authenticated USING (public.is_admin());

-- ── ⑥ 메일 이력 (§7-1 ⑥ · §7-2) ─────────────────────────────────────
-- audit_logs는 Phase 0에서 이미 만들었다. 여기서는 mail_logs만 같은 규칙으로 만든다.
CREATE TABLE IF NOT EXISTS public.mail_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('INVITE','REMINDER')),
  recipient uuid NOT NULL REFERENCES public.profiles(id),
  simulated boolean NOT NULL DEFAULT true,                -- Resend 미설정 시 true
  sent_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.mail_logs ENABLE ROW LEVEL SECURITY;

-- SELECT는 ADMIN만. INSERT/UPDATE/DELETE 정책은 의도적으로 만들지 않는다(정책 없음 = 거부).
DROP POLICY IF EXISTS "mail_logs_admin_select" ON public.mail_logs;
CREATE POLICY "mail_logs_admin_select" ON public.mail_logs FOR SELECT
  TO authenticated USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.mail_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.mail_logs FROM authenticated;

-- ── ⑦ 운영 설정 (§7-1 ⑥ · §6-3 ⓒ 설정) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id),
  due_date date,
  expected_minutes int,
  guide_md text,
  inquiry_contact text,
  -- 기획안에 없는 컬럼. FTE 합계 100% 제출 게이트 스위치다(근거는 상단 3항).
  -- 기본값은 false(꺼짐)다. FTE 입력 화면이 Phase 2라서 true로 두면 이 파일을 적용하는 순간
  -- 배분 행이 0인 채로 게이트가 켜져 SME 전원의 제출이 막힌다.
  fte_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 표가 이미 있는 DB(먼저 한 번 적용된 경우)에도 같은 기본값이 닿게 한다. CREATE TABLE IF NOT EXISTS는
-- 표가 있으면 통째로 건너뛰므로 이 한 줄이 없으면 옛 기본값(true)이 그대로 남는다.
ALTER TABLE public.survey_settings ALTER COLUMN fte_required SET DEFAULT false;

ALTER TABLE public.survey_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_settings_authenticated_select" ON public.survey_settings;
CREATE POLICY "survey_settings_authenticated_select" ON public.survey_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "survey_settings_admin_insert" ON public.survey_settings;
CREATE POLICY "survey_settings_admin_insert" ON public.survey_settings FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "survey_settings_admin_update" ON public.survey_settings;
CREATE POLICY "survey_settings_admin_update" ON public.survey_settings FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "survey_settings_admin_delete" ON public.survey_settings;
CREATE POLICY "survey_settings_admin_delete" ON public.survey_settings FOR DELETE
  TO authenticated USING (public.is_admin());

-- ── ⑧ profiles · reviews 컬럼 추가 (§7-1 ⑥ 하단) ────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS guide_completed_at timestamptz;

-- 가이드 통과는 SME 본인이 기록한다. profiles는 REVOKE UPDATE 후 컬럼 단위 GRANT만 열려 있어
-- 이 한 줄이 없으면 RLS를 통과해도 권한 오류로 막힌다(Phase 0의 must_change_password와 같은 함정).
-- org_unit_id는 여기에 넣지 않는다 — 조직 배정을 응답자가 스스로 바꾸지 못하게 한다.
GRANT UPDATE (guide_completed_at) ON public.profiles TO authenticated;

-- 승인/반려 기록용. 상태 CHECK(5상태)는 건드리지 않는다.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text;

-- ── ⑨ 컬럼 잠금 트리거 (§7-2 · §8 S4) ───────────────────────────────
/*
  RLS 는 "어느 행"까지만 막고 "어느 컬럼"은 막지 못한다. reviews 와 inquiries 의 UPDATE 정책은
  둘 다 "관리자 또는 본인"이라, 본인 행이기만 하면 관리자 전용 판정 컬럼까지
  PostgREST 로 그대로 PATCH 할 수 있었다. 실제로 열려 있던 구멍 두 가지다.
    · reviews  — SME 가 approved_at 을 채워 자기 검토를 "승인됨"으로 만들고 rejected_reason 을
                 지울 수 있었다(승인 표시는 approved_at IS NOT NULL 하나로 판단한다).
                 status·submitted_at 도 같아서 submit_review 의 제출 게이트 네 가지
                 (전 섹션 평가 · 조건부 의견 · FTE 합계 100 · 배정 본인)를 통째로 건너뛰고
                 review_history 도 남기지 않을 수 있었다. 되돌리기(IN_PROGRESS)까지 되므로
                 §6-2 의 "제출 후 읽기 전용 잠금"도 함께 풀렸다.
    · inquiries — SME 가 자기 문의에 answer 와 status='ANSWERED' 를 스스로 적어 있지도 않은
                 관리자 답변을 만들 수 있었다. §6-3 ⓒ 인박스의 "미답 문의 수"가 그만큼 새어 나간다.

  REVOKE UPDATE + 컬럼 단위 GRANT 로 막는 방법(profiles 가 쓰는 방식)은 여기서 쓸 수 없다.
  save_review_draft·submit_review·request_rereview 가 SECURITY INVOKER 라 호출자 권한으로 쓰기 때문에
  함께 깨지고, 관리자의 문의 답변도 같은 GRANT 에 걸린다. 그래서 트리거로 컬럼만 잠근다.

  통과 조건은 둘 중 하나다.
    · public.is_admin() — 관리자의 판정·답변 경로(decide_review · request_rereview · 인박스).
    · app.trusted_rpc 마커 — 위 RPC 들이 자기 트랜잭션 안에서만 켠다
      (set_config 의 세 번째 인자 true = 트랜잭션 한정). PostgREST 는 요청 하나가 트랜잭션 하나라
      클라이언트가 PATCH 앞에 이 마커를 따로 세울 방법이 없다.
  마커를 세우는 쪽은 20260901030000_phase1_submit_gate.sql 이다. 두 파일은 반드시 함께 적용한다
  (이 파일만 적용하면 SME 의 임시저장이 status 전이에서 막힌다).
*/
CREATE OR REPLACE FUNCTION public.guard_locked_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> v_col IS DISTINCT FROM to_jsonb(OLD) -> v_col THEN
      -- 잠긴 컬럼이 실제로 바뀔 때만 권한을 본다. 평범한 저장은 is_admin() 조회를 타지 않는다.
      IF COALESCE(current_setting('app.trusted_rpc', true), '') = '1' OR public.is_admin() THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION '% 값은 직접 바꿀 수 없습니다. 제출·승인·반려·답변 기능을 통해서만 변경됩니다.', v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS reviews_guard_locked_columns ON public.reviews;
CREATE TRIGGER reviews_guard_locked_columns
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_columns('status', 'submitted_at', 'approved_at', 'rejected_reason');

DROP TRIGGER IF EXISTS inquiries_guard_locked_columns ON public.inquiries;
CREATE TRIGGER inquiries_guard_locked_columns
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_columns('status', 'answer', 'answered_by', 'answered_at');

-- ── TRUNCATE 회수 ───────────────────────────────────────────────────
-- TRUNCATE는 RLS를 거치지 않는다. Supabase 기본 권한이 새 테이블에 이 권한까지 주므로
-- 회수하지 않으면 SME 계정 하나로 표 전체를 비울 수 있다(Phase 0 audit_logs와 같은 이유).
REVOKE TRUNCATE ON TABLE
  public.org_units,
  public.task_fte_allocations,
  public.review_sessions,
  public.inquiries,
  public.job_workshop_flags,
  public.mail_logs,
  public.survey_settings
FROM anon;
REVOKE TRUNCATE ON TABLE
  public.org_units,
  public.task_fte_allocations,
  public.review_sessions,
  public.inquiries,
  public.job_workshop_flags,
  public.mail_logs,
  public.survey_settings
FROM authenticated;

COMMENT ON TABLE public.task_fte_allocations IS
  '과업별 투입 비중(§7-1 ②). 대상은 job_tasks(EXISTING) 또는 new_task_suggestions(SUGGESTED) 중 하나다. 검토당 대상 중복은 부분 unique 인덱스로 막힌다.';
COMMENT ON COLUMN public.survey_settings.fte_required IS
  'FTE 합계 100% 제출 게이트 스위치. 기본 false(꺼짐) — FTE 입력 화면이 Phase 2라 켜 두면 제출이 전면 차단된다. 화면 배포 후 회사별로 true로 올린다.';
COMMENT ON COLUMN public.profiles.organization IS
  '조직명 표시용 텍스트(과도기). org_unit_id가 채워진 뒤에도 기존 화면 호환을 위해 유지한다.';


-- =====================================================================
-- ▼ 20260901030000_phase1_submit_gate.sql
-- =====================================================================

/*
# Phase 1 제출 게이트 — submit_review 서버 재검증 · decide_review(승인/반려)

기준: docs/PLAN.txt §6-2 STEP 5, §7-2 「제출 게이트」·「승인/반려」 행, §10 P1.

1. 목적
- 제출 가능 여부를 클라이언트 판단에만 맡기지 않는다. submit_review 가 상태를 전이하기 전에
  ① 전 섹션 평가 완료 ② 조건부 필수 의견 ③ FTE 합계 = 100.00 ④ 호출자 = 배정 SME 본인
  네 가지를 서버에서 다시 확인한다(§7-2). 브라우저 콘솔에서 RPC 를 직접 불러도 같은 문에 막힌다.
- 실패는 "부족 항목 목록"으로 돌려준다. STEP 5 요약이 그대로 표시하고 각 항목의 step 으로
  해당 단계 바로가기를 만들 수 있어야 하기 때문이다(§6-2 STEP 5).
- decide_review 를 만들어 관리자의 승인/반려를 한 함수·한 트랜잭션으로 처리한다(§7-2).
- 검토 상태를 쓰는 기존 RPC 두 개(save_review_draft · request_rereview)도 함께 다시 정의한다.
  시그니처와 결과는 그대로다. 바뀐 것은 아래 두 가지뿐이다.
  · 20260901020000 이 reviews·inquiries 에 건 컬럼 잠금 트리거를 통과하도록
    함수 안에서 app.trusted_rpc 마커를 켠다(트랜잭션 한정). 이 파일과 그 파일은 짝이다.
  · save_review_draft 의 신규 과업 제안 저장을 "전량 삭제 후 재삽입"에서 "이름 기준 갱신"으로
    바꾼다. 근거는 3번 항목.

2. 보안
- submit_review 는 기존과 같이 SECURITY INVOKER(기본값)다. 저장 경로(save_review_draft)의 RLS
  소유자 검증을 그대로 살려야 하므로 SECURITY DEFINER 로 바꾸지 않는다.
  ④ 는 RLS 로도 대부분 막히지만, 관리자는 reviews UPDATE 정책을 통과하므로 명시적으로 한 번 더 본다.
  ④ 를 저장보다 먼저 두는 이유는 4번 항목에 적었다.
- decide_review 는 SECURITY DEFINER 다. 20260828010500_secure_review_status_and_sync.sql 의
  호출자 검증 패턴을 그대로 따라 함수 첫 줄에서 public.is_admin() 을 확인하고
  SET search_path = public 을 건다. 감사 기록은 Phase 0 의 log_audit RPC 를 재사용한다.
- EXECUTE 는 두 함수 모두 authenticated 에게만 준다(PUBLIC·anon 회수).
  재정의하는 두 함수의 권한은 기존 그대로다(CREATE OR REPLACE 는 부여된 권한을 유지한다).
- app.trusted_rpc 마커는 set_config(..., true) 로 트랜잭션 안에서만 산다. PostgREST 는 요청
  하나가 트랜잭션 하나라 클라이언트가 PATCH 앞에 이 마커를 미리 세울 수 없다.
  마커가 여는 것은 "정해진 RPC 안에서의 상태 전이"뿐이고, 누가 무엇을 할 수 있는지는
  각 함수의 검사(④ 배정 본인 · is_admin())가 그대로 판단한다.

3. 스키마 보정
- 없다. 이 파일은 함수 네 개만 만든다. 테이블·컬럼·정책·인덱스를 건드리지 않는다.
- 대신 20260901020000_phase1_survey_schema.sql 이 만드는
  task_fte_allocations · survey_settings.fte_required · reviews.approved_at · reviews.rejected_reason
  에 의존한다. 순서가 뒤바뀐 적용을 조용히 통과시키면 함수는 만들어지고 제출만 런타임에 깨진다.
  그래서 파일 첫머리에서 존재를 확인하고 없으면 즉시 멈춘다.
- save_review_draft 의 신규 과업 제안 저장 방식을 바꾼 이유:
  task_fte_allocations.suggestion_id 가 new_task_suggestions(id) 를 ON DELETE CASCADE 로 참조한다.
  옛 방식은 저장할 때마다 제안을 전량 DELETE 후 새 uuid 로 다시 넣었으므로,
  2.5초 자동 저장이나 submit_review 내부의 저장 한 번에 SUGGESTED 배분이 캐스케이드로 사라졌다.
  그러면 화면에는 100% 가 보이는데 서버 합계는 그 배분만큼 모자란 채로 굳어 제출이 영영 막힌다
  (§6-2 STEP 3 의 "유지+신규 제안" 배분과 §7-2 제출 게이트 ③ 이 동시에 성립하지 못한다).
  사라진 제안만 지우고 남은 제안은 id 를 유지하도록 바꾼다. 신규 Skill 제안은 참조하는 표가
  없으므로 기존 방식 그대로 둔다.

4. 데이터 안전
- ★ 검증 실패를 예외로 던지지 않는다. submit_review 는 앞부분에서 save_review_draft 로 SME 입력을
  먼저 저장하는데(저장과 제출이 한 트랜잭션), 여기서 예외를 던지면 그 저장까지 함께 롤백되어
  방금 작성한 내용이 사라진다. 그래서 실패는 정상 반환값
  { "ok": false, "missing": [ { "step":1..5, "kind":"...", "label":"..." } ] } 으로 돌려준다.
  입력은 남고 상태만 전이되지 않는다.
- ④ 만 저장보다 먼저 본다. 담당자가 아닌 호출에는 지켜야 할 입력이 애초에 없고, 그대로 통과시키면
  관리자가 자기 payload 로 SME 검토를 덮어쓸 수 있다(save_review_draft 는 관리자 UPDATE 를 허용한다).
- 성공 응답은 기존 키(review_id·status·started_at·last_saved_at·submitted_at)를 그대로 두고
  ok:true 만 더한다. 기존 클라이언트(src/lib/reviewApi.ts 의 toState)가 review_id 를 읽는다.
- 기존 review 상태 머신(5상태)을 바꾸지 않는다. 그래서 "승인"은 새 상태가 아니라
  reviews.approved_at 으로 표현한다. APPROVED 시 status 는 SUBMITTED/RESUBMITTED 그대로 둔다.
- 기존 request_rereview 는 지우지 않는다. 관리자 화면이 지금 쓰고 있는 반려 경로이고,
  decide_review 는 승인·반려를 한곳에서 처리하는 상위 함수다. 반려 결과(status·approved_at·이력)는
  두 함수가 동일하며, decide_review 는 여기에 rejected_reason 저장과 감사 기록을 더한다.
- approved_at·rejected_reason 은 "이번 판정"의 표시지 이력이 아니다. 그래서 판정을 무르는 경로에서
  반드시 함께 지워야 한다. decide_review 는 이미 그렇게 하고 있었지만(승인 시 rejected_reason,
  반려 시 approved_at) 재제출(submit_review)과 재검토 요청(request_rereview)에는 그 처리가 없었다.
  그대로 두면 승인 → 재검토 요청 → 재제출을 거친 검토가 아무도 다시 보지 않았는데 approved_at 이
  남아 관리자 목록에 "승인됨"으로 뜬다(§9 E2·E3 의 승인 응답 집계가 그 값을 기준으로 센다).
  두 경로 모두에서 approved_at 을, 재제출에서는 rejected_reason 까지 비운다.
- 승인은 제출된 검토에만 찍는다. decide_review 의 APPROVED 갈래에 submitted_at 확인이 없어
  한 번도 제출된 적 없는 검토(배정과 함께 만들어지는 NOT_STARTED 행)도 승인 도장이 찍혔다.
  status:'NOT_STARTED' + approved_at:now 라는 모순된 행이 만들어지고, 이력·감사 기록만으로는
  정상 승인과 구분되지 않는다. 상태 화이트리스트가 아니라 submitted_at 으로 본다 —
  반려되어 REVIEW_REQUESTED 가 된 검토를 관리자가 다시 승인하는 정당한 경로를 막지 않기 위해서다.
*/

-- ── 선행 마이그레이션 확인 ──────────────────────────────────────────
-- to_regclass 로 본다. 'public.survey_settings'::regclass 는 테이블이 없을 때
-- 여기서 먼저 에러를 내 버려서 아래 안내 문구가 나가지 못한다.
DO $dep$
BEGIN
  IF to_regclass('public.task_fte_allocations') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.survey_settings')
          AND attname = 'fte_required' AND NOT attisdropped)
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.reviews')
          AND attname IN ('approved_at', 'rejected_reason') AND NOT attisdropped
        HAVING count(*) = 2)
  THEN
    RAISE EXCEPTION '먼저 20260901020000_phase1_survey_schema.sql 을 적용해 주세요. task_fte_allocations · survey_settings.fte_required · reviews.approved_at · reviews.rejected_reason 이 있어야 이 파일을 적용할 수 있습니다.'
      USING ERRCODE = '42P01';
  END IF;
END
$dep$;

-- ── 1. 임시저장 재정의 (제안 id 보존 · 마커) ────────────────────────
/*
  20260828010000_add_review_draft_rpc.sql 의 save_review_draft 와 시그니처·인자 의미·반환이 같다.
  달라진 곳은 두 군데뿐이다.
    ① 첫 줄에서 app.trusted_rpc 마커를 켠다. 20260901020000 이 reviews 의
       status·submitted_at·approved_at·rejected_reason 을 트리거로 잠갔기 때문에,
       이 마커가 없으면 SME 의 임시저장이 NOT_STARTED → IN_PROGRESS 전이에서 막힌다.
    ② 신규 과업 제안을 이름 기준으로 맞춘다(사라진 것만 삭제, 남은 것은 id 유지).
       FTE 배분이 이 표의 id 를 참조하므로 id 가 매번 바뀌면 배분이 캐스케이드로 지워진다.
  나머지 세 upsert(job/task/skill 피드백)와 신규 Skill 제안은 옛 본문 그대로다.
*/
CREATE OR REPLACE FUNCTION public.save_review_draft(
  p_review_id uuid,
  p_job jsonb DEFAULT '[]'::jsonb,
  p_tasks jsonb DEFAULT '[]'::jsonb,
  p_skills jsonb DEFAULT '[]'::jsonb,
  p_new_tasks jsonb DEFAULT '[]'::jsonb,
  p_new_skills jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_review public.reviews;
BEGIN
  -- 컬럼 잠금 트리거에 "정해진 기능으로 들어온 전이"임을 알린다. 트랜잭션이 끝나면 함께 사라진다.
  PERFORM set_config('app.trusted_rpc', '1', true);

  -- RLS가 소유자 검증을 한다. 남의 검토거나 이미 제출된 검토면 0행이 되고 예외로 전체가 롤백된다.
  UPDATE public.reviews
  SET status = CASE WHEN status = 'NOT_STARTED' THEN 'IN_PROGRESS' ELSE status END,
      started_at = COALESCE(started_at, now()),
      last_saved_at = now(),
      updated_at = now()
  WHERE id = p_review_id
    AND status NOT IN ('SUBMITTED','RESUBMITTED')
  RETURNING * INTO v_review;

  IF NOT FOUND THEN
    RAISE EXCEPTION '검토를 저장할 수 없습니다. 이미 제출되었거나 접근 권한이 없습니다. 관리자에게 재검토 요청을 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.job_feedback (review_id, section, suitability, comment, suggestion)
  SELECT p_review_id,
         e->>'section',
         NULLIF(e->>'suitability', ''),
         COALESCE(e->>'comment', ''),
         COALESCE(e->>'suggestion', '')
  FROM jsonb_array_elements(COALESCE(p_job, '[]'::jsonb)) e
  WHERE COALESCE(e->>'section', '') <> ''
  ON CONFLICT (review_id, section) DO UPDATE
    SET suitability = EXCLUDED.suitability,
        comment = EXCLUDED.comment,
        suggestion = EXCLUDED.suggestion,
        updated_at = now();

  INSERT INTO public.task_feedback (review_id, task_id, suitability, comment, suggestion, delete_requested)
  SELECT p_review_id,
         (e->>'task_id')::uuid,
         NULLIF(e->>'suitability', ''),
         COALESCE(e->>'comment', ''),
         COALESCE(e->>'suggestion', ''),
         COALESCE((e->>'delete_requested')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_tasks, '[]'::jsonb)) e
  WHERE COALESCE(e->>'task_id', '') <> ''
  ON CONFLICT (review_id, task_id) DO UPDATE
    SET suitability = EXCLUDED.suitability,
        comment = EXCLUDED.comment,
        suggestion = EXCLUDED.suggestion,
        delete_requested = EXCLUDED.delete_requested,
        updated_at = now();

  INSERT INTO public.skill_feedback (review_id, skill_id, suitability, comment, suggestion, delete_requested)
  SELECT p_review_id,
         (e->>'skill_id')::uuid,
         NULLIF(e->>'suitability', ''),
         COALESCE(e->>'comment', ''),
         COALESCE(e->>'suggestion', ''),
         COALESCE((e->>'delete_requested')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_skills, '[]'::jsonb)) e
  WHERE COALESCE(e->>'skill_id', '') <> ''
  ON CONFLICT (review_id, skill_id) DO UPDATE
    SET suitability = EXCLUDED.suitability,
        comment = EXCLUDED.comment,
        suggestion = EXCLUDED.suggestion,
        delete_requested = EXCLUDED.delete_requested,
        updated_at = now();

  -- 신규 과업 제안: 이름 기준 맞춤. 화면이 매번 "지금 전체 상태"를 보내는 것은 그대로이고,
  -- 서버가 그것을 전량 교체가 아니라 차이 반영으로 처리한다(사라진 것만 삭제 · 남은 것은 id 유지).
  -- id 를 유지해야 STEP 3 의 SUGGESTED 배분(task_fte_allocations.suggestion_id)이 저장을 넘겨 살아남는다.
  -- ponytail: 같은 이름의 제안이 두 줄이면 그 둘을 구분하지 않는다(옛 저장 방식이 남긴 중복만 해당).
  --           이름이 유일하지 않아도 되게 하려면 제안 행에 클라이언트가 만든 안정 키가 필요하다.
  WITH incoming AS (
    SELECT DISTINCT ON (btrim(e->>'name'))
           btrim(e->>'name') AS name,
           COALESCE(e->>'description', '') AS description,
           COALESCE(e->>'reason', '') AS reason
      FROM jsonb_array_elements(COALESCE(p_new_tasks, '[]'::jsonb)) e
     WHERE COALESCE(btrim(e->>'name'), '') <> ''
  ),
  removed AS (
    DELETE FROM public.new_task_suggestions s
     WHERE s.review_id = p_review_id
       AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.name = s.name)
  ),
  updated AS (
    UPDATE public.new_task_suggestions s
       SET description = i.description,
           reason = i.reason
      FROM incoming i
     WHERE s.review_id = p_review_id
       AND s.name = i.name
  )
  INSERT INTO public.new_task_suggestions (review_id, name, description, reason)
  SELECT p_review_id, i.name, i.description, i.reason
    FROM incoming i
   WHERE NOT EXISTS (SELECT 1 FROM public.new_task_suggestions s
                      WHERE s.review_id = p_review_id AND s.name = i.name);

  -- 신규 Skill 제안은 이 id 를 참조하는 표가 없으므로 옛 방식(전체 교체) 그대로 둔다.
  DELETE FROM public.new_skill_suggestions WHERE review_id = p_review_id;
  INSERT INTO public.new_skill_suggestions (review_id, name, description, reason)
  SELECT p_review_id, btrim(e->>'name'), COALESCE(e->>'description', ''), COALESCE(e->>'reason', '')
  FROM jsonb_array_elements(COALESCE(p_new_skills, '[]'::jsonb)) e
  WHERE COALESCE(btrim(e->>'name'), '') <> '';

  RETURN jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'started_at', v_review.started_at,
    'last_saved_at', v_review.last_saved_at,
    'submitted_at', v_review.submitted_at
  );
END;
$fn$;

-- ── 2. 최종 제출 (§7-2 제출 게이트) ─────────────────────────────────
/*
  인자와 시그니처는 20260828010000_add_review_draft_rpc.sql 과 동일하다(uuid, jsonb x5, text).
  달라진 점은 상태 전이 앞에 서버 재검증이 들어가고, 반환 jsonb 에 ok 가 생긴 것뿐이다.

  반환
    성공 : { "ok": true, "review_id":…, "status":…, "started_at":…, "last_saved_at":…, "submitted_at":… }
    실패 : { "ok": false, "missing": [ { "step": 1~5, "kind": "…", "label": "사람이 읽는 문구" }, … ] }

  missing[].step 은 §6-2 의 5단계 번호다.
    1 직무 개요 / 2 과업 / 3 투입 비중(FTE) / 4 Skill·수행요건 / 5 최종 확인
*/
CREATE OR REPLACE FUNCTION public.submit_review(
  p_review_id uuid,
  p_job jsonb DEFAULT '[]'::jsonb,
  p_tasks jsonb DEFAULT '[]'::jsonb,
  p_skills jsonb DEFAULT '[]'::jsonb,
  p_new_tasks jsonb DEFAULT '[]'::jsonb,
  p_new_skills jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_review public.reviews;
  v_sme_id uuid;
  v_job_id uuid;
  v_company_id uuid;
  v_fte_required boolean;
  v_fte_rows integer;
  v_fte_sum numeric;
  v_fte_item jsonb;
  v_missing jsonb;
BEGIN
  -- 컬럼 잠금 트리거에 "정해진 기능으로 들어온 전이"임을 알린다(트랜잭션 한정).
  PERFORM set_config('app.trusted_rpc', '1', true);

  -- ④ 호출자 = 배정 SME 본인.
  -- 저장보다 먼저 본다(위 주석 4번). 검토 자체가 안 보이면(RLS) v_sme_id 가 NULL 이라 같은 갈래로 걸린다.
  -- 회사는 jobs.company_id 를 먼저 보고, 비어 있으면 배정 행의 company_id 를 쓴다.
  -- 20260813053114 이전에 만들어진 직무는 jobs.company_id 가 NULL 로 남아 있다. 그대로 두면
  -- 아래 fte_required 조회가 어떤 행에도 걸리지 않아, 운영자가 해제 스위치를 내려도 그 직무만
  -- 계속 엄격하게 막힌다 — 원인을 화면에서 알 수 없는 제출 차단이 된다.
  SELECT a.sme_id, a.job_id, COALESCE(j.company_id, a.company_id)
    INTO v_sme_id, v_job_id, v_company_id
    FROM public.reviews r
    JOIN public.review_assignments a ON a.id = r.assignment_id
    JOIN public.jobs j ON j.id = a.job_id
   WHERE r.id = p_review_id;

  IF v_sme_id IS NULL OR v_sme_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'missing', jsonb_build_array(jsonb_build_object(
        'step', 5,
        'kind', 'NOT_ASSIGNEE',
        'label', '이 검토에 배정된 담당자 본인만 제출할 수 있습니다.')));
  END IF;

  -- 저장 먼저. 검증에 걸리더라도 지금 화면의 입력은 남아 있어야 한다.
  PERFORM public.save_review_draft(p_review_id, p_job, p_tasks, p_skills, p_new_tasks, p_new_skills);

  -- ③ FTE 합계 = 100.00
  -- fte_required 는 회사 단위 스위치이고 기본값이 false(꺼짐)다. FTE 입력 화면이 Phase 2 라
  -- 켜 두면 배분 행이 0 인 채로 제출이 전면 차단된다. 화면 배포 후 회사별로 true 로 올린다.
  -- 설정 행이 없거나 회사를 알 수 없는 검토도 같은 이유로 꺼진 것으로 본다.
  SELECT COALESCE(
           (SELECT s.fte_required FROM public.survey_settings s WHERE s.company_id = v_company_id),
           false)
    INTO v_fte_required;

  IF v_fte_required THEN
    -- 부동소수 오차를 피해 numeric 으로 더하고 소수 둘째 자리에서 비교한다.
    SELECT count(*), round(COALESCE(sum(f.pct), 0), 2)
      INTO v_fte_rows, v_fte_sum
      FROM public.task_fte_allocations f
     WHERE f.review_id = p_review_id;

    IF v_fte_rows = 0 THEN
      v_fte_item := jsonb_build_object(
        'step', 3, 'kind', 'FTE_EMPTY',
        'label', 'FTE를 배분하지 않았습니다. 과업별 투입 비중을 배분해 주세요.');
    ELSIF v_fte_sum <> 100.00 THEN
      v_fte_item := jsonb_build_object(
        'step', 3, 'kind', 'FTE_SUM',
        'label', '투입 비중 합계가 ' || to_char(v_fte_sum, 'FM999990.00') || '%입니다. 합계가 100%가 되도록 배분해 주세요.');
    END IF;
  END IF;

  -- ①② 전 섹션 평가 완료 · 조건부 필수 의견
  --   ① suitability 가 비어 있으면 미평가.
  --   ② 'SUITABLE' 이 아닌데 의견·수정안이 둘 다 비어 있으면 사유 미작성.
  --   한 항목이 두 갈래에 동시에 걸리지 않도록 CASE 로 하나만 만든다.
  WITH job_sections(section, step, ord, label) AS (
    VALUES ('NAME'::text,          1, 1, '직무명'::text),
           ('DEFINITION',          1, 2, '직무정의'),
           ('REQ_EDUCATION',       4, 2, '수행요건 · 학력'),
           ('REQ_MAJOR',           4, 3, '수행요건 · 전공'),
           ('REQ_CERTIFICATIONS',  4, 4, '수행요건 · 자격증')
  ),
  rated(step, ord, entity, name, unrated) AS (
    -- STEP 1 직무 개요 + STEP 4 수행요건 (job_feedback 5개 섹션)
    SELECT s.step, s.ord, 'JOB', s.label, (NULLIF(f.suitability, '') IS NULL)
      FROM job_sections s
      LEFT JOIN public.job_feedback f
             ON f.review_id = p_review_id AND f.section = s.section
     WHERE NULLIF(f.suitability, '') IS NULL
        OR (f.suitability <> 'SUITABLE'
            AND btrim(COALESCE(f.comment, '')) = ''
            AND btrim(COALESCE(f.suggestion, '')) = '')
    UNION ALL
    -- STEP 2 과업 (이 직무의 활성 과업 전부)
    SELECT 2, 1, 'TASK', t.name, (NULLIF(tf.suitability, '') IS NULL)
      FROM public.job_tasks t
      LEFT JOIN public.task_feedback tf
             ON tf.review_id = p_review_id AND tf.task_id = t.id
     WHERE t.job_id = v_job_id
       AND t.active
       AND (NULLIF(tf.suitability, '') IS NULL
            OR (tf.suitability <> 'SUITABLE'
                AND btrim(COALESCE(tf.comment, '')) = ''
                AND btrim(COALESCE(tf.suggestion, '')) = ''))
    UNION ALL
    -- STEP 4 Skill (이 직무의 활성 Skill 전부)
    SELECT 4, 1, 'SKILL', sk.name, (NULLIF(sf.suitability, '') IS NULL)
      FROM public.job_skills sk
      LEFT JOIN public.skill_feedback sf
             ON sf.review_id = p_review_id AND sf.skill_id = sk.id
     WHERE sk.job_id = v_job_id
       AND sk.active
       AND (NULLIF(sf.suitability, '') IS NULL
            OR (sf.suitability <> 'SUITABLE'
                AND btrim(COALESCE(sf.comment, '')) = ''
                AND btrim(COALESCE(sf.suggestion, '')) = ''))
  )
  SELECT COALESCE(jsonb_agg(p.item ORDER BY p.step, p.ord, p.sort_name), '[]'::jsonb)
    INTO v_missing
    FROM (
      SELECT r.step, r.ord, r.name AS sort_name,
             jsonb_build_object(
               'step', r.step,
               'kind', r.entity || CASE WHEN r.unrated THEN '_UNRATED' ELSE '_REASON' END,
               'label', r.name || CASE WHEN r.unrated
                                       THEN ' — 적합성을 선택해 주세요.'
                                       ELSE ' — 적합이 아니므로 의견 또는 수정안을 적어 주세요.' END
             ) AS item
        FROM rated r
      UNION ALL
      -- FTE 는 단계 순서(3)에 맞는 자리에 끼워 넣는다.
      SELECT 3, 0, ''::text, v_fte_item WHERE v_fte_item IS NOT NULL
    ) p;

  IF jsonb_array_length(v_missing) > 0 THEN
    -- 예외를 던지지 않는다. 위 save_review_draft 결과를 살린 채 부족 항목만 돌려준다.
    RETURN jsonb_build_object('ok', false, 'missing', v_missing);
  END IF;

  -- 상태 전이. 방금 다시 제출된 검토는 아직 아무도 보지 않은 상태다. 그래서 지난 사이클의
  -- 판정 표시(approved_at·rejected_reason)를 함께 비운다 — 남겨 두면 관리자 목록에
  -- "승인됨"으로 뜨거나 지난 반려 사유가 새 제출본에 계속 붙는다.
  UPDATE public.reviews
  SET status = CASE WHEN submitted_at IS NOT NULL OR status = 'REVIEW_REQUESTED'
                    THEN 'RESUBMITTED' ELSE 'SUBMITTED' END,
      submitted_at = now(),
      approved_at = NULL,
      rejected_reason = NULL,
      updated_at = now()
  WHERE id = p_review_id
    AND status NOT IN ('SUBMITTED','RESUBMITTED')
  RETURNING * INTO v_review;

  IF NOT FOUND THEN
    RAISE EXCEPTION '검토를 제출할 수 없습니다. 이미 제출되었거나 접근 권한이 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.review_history (review_id, actor_id, action, note)
  VALUES (p_review_id, auth.uid(), v_review.status, COALESCE(p_note, ''));

  RETURN jsonb_build_object(
    'ok', true,
    'review_id', v_review.id,
    'status', v_review.status,
    'started_at', v_review.started_at,
    'last_saved_at', v_review.last_saved_at,
    'submitted_at', v_review.submitted_at
  );
END;
$fn$;

-- ── 3. 승인/반려 (§7-2 decide_review) ───────────────────────────────
/*
  관리자의 판정을 한 함수로 모은다. APPROVED 와 REJECTED 가 상태·사유·이력·감사를 각각
  다르게 남기는데, 화면에서 두세 번 나눠 호출하면 앞만 성공하고 뒤가 실패했을 때
  "사유 없는 반려"나 "이력 없는 승인"이 남는다. 함수 본문은 한 트랜잭션이다.

  반려는 기존 request_rereview 와 결과가 겹친다(status='REVIEW_REQUESTED' + 이력 한 줄).
  중복 구현이 아니라, decide_review 가 승인·반려를 한곳에서 처리하는 상위 함수다.
  request_rereview 는 관리자 화면이 지금 쓰고 있으므로 지우지 않는다.

  승인은 새 상태를 만들지 않는다. 기존 5상태 머신을 바꾸지 않기로 했으므로(§7 원칙)
  승인 사실은 reviews.approved_at 으로만 표현하고 status 는 SUBMITTED/RESUBMITTED 그대로 둔다.
  "승인됨" 표시는 화면에서 approved_at IS NOT NULL 로 판단하면 된다.
*/
CREATE OR REPLACE FUNCTION public.decide_review(
  p_review_id uuid,
  p_verdict text,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_review public.reviews;
  v_verdict text;
  v_reason text;
BEGIN
  -- 호출자 검증. SECURITY DEFINER 라 RLS 가 적용되지 않으므로 여기서 직접 막는다.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '검토를 승인·반려할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  v_verdict := upper(btrim(COALESCE(p_verdict, '')));
  v_reason := btrim(COALESCE(p_reason, ''));

  IF v_verdict NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION '판정 값이 올바르지 않습니다. 승인(APPROVED) 또는 반려(REJECTED)만 가능합니다.'
      USING ERRCODE = '22023';
  END IF;

  IF v_verdict = 'REJECTED' AND v_reason = '' THEN
    RAISE EXCEPTION '반려 사유를 입력해 주세요. SME가 무엇을 고쳐야 하는지 알 수 없습니다.'
      USING ERRCODE = '22023';
  END IF;

  -- 판정 대상 확인. 승인은 제출된 적 있는 검토에만 찍는다 — 배정과 함께 만들어지는 NOT_STARTED
  -- 행에도 approved_at 이 찍히면 응답이 하나도 없는 검토가 §9 E2·E3 의 승인 집계에 들어간다.
  -- status 가 아니라 submitted_at 으로 본다. 반려되어 REVIEW_REQUESTED 로 돌아간 검토를
  -- 관리자가 다시 승인하는 것은 정당한 경로다.
  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 검토를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_verdict = 'APPROVED' AND v_review.submitted_at IS NULL THEN
    RAISE EXCEPTION '아직 제출되지 않은 검토는 승인할 수 없습니다. SME가 제출을 마친 뒤에 승인해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  -- SECURITY DEFINER 라 RLS 는 없지만 컬럼 잠금 트리거는 그대로 탄다. 마커로 통과시킨다.
  PERFORM set_config('app.trusted_rpc', '1', true);

  IF v_verdict = 'APPROVED' THEN
    UPDATE public.reviews
       SET approved_at = now(),
           rejected_reason = NULL,
           updated_at = now()
     WHERE id = p_review_id
    RETURNING * INTO v_review;
  ELSE
    -- 반려하면 SME 가 다시 편집할 수 있어야 하므로 REVIEW_REQUESTED 로 되돌린다.
    -- submitted_at 은 지우지 않는다. 이전에 제출한 사실은 이력으로 남아야 한다.
    UPDATE public.reviews
       SET status = 'REVIEW_REQUESTED',
           rejected_reason = v_reason,
           approved_at = NULL,
           updated_at = now()
     WHERE id = p_review_id
    RETURNING * INTO v_review;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 검토를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.review_history (review_id, actor_id, action, note)
  VALUES (p_review_id, auth.uid(), v_verdict, v_reason);

  -- 감사 기록(§8 S5). Phase 0 의 log_audit RPC 를 재사용한다.
  PERFORM public.log_audit(
    'REVIEW_' || v_verdict,
    'reviews',
    p_review_id::text,
    jsonb_build_object('status', v_review.status, 'reason', v_reason));

  RETURN jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'approved_at', v_review.approved_at,
    'rejected_reason', v_review.rejected_reason,
    'submitted_at', v_review.submitted_at
  );
END;
$fn$;

-- ── 4. 재검토 요청 재정의 (마커 · 승인 표시 해제) ───────────────────
/*
  20260828020000_add_request_rereview_rpc.sql 의 함수와 시그니처·반환·권한 검사가 같다.
  달라진 곳은 두 군데뿐이다.
    ① app.trusted_rpc 마커를 켠다(status 가 잠긴 컬럼이라 이것이 없으면 반려가 막힌다).
    ② approved_at 을 함께 비운다. 승인된 검토를 다시 검토 요청했는데 승인 표시가 남아 있으면
       그 뒤 재제출된 검토가 아무도 보지 않은 채 "승인됨"으로 집계된다(§9 E2·E3).
       rejected_reason 은 이 함수가 쓰지 않는다 — 사유를 저장하는 반려 경로는 decide_review 다.
  이 함수는 여전히 관리자만 호출할 수 있다(첫 줄 is_admin()).
*/
CREATE OR REPLACE FUNCTION public.request_rereview(p_review_id uuid, p_note text DEFAULT '')
RETURNS TABLE (
  review_id uuid,
  status text,
  started_at timestamptz,
  last_saved_at timestamptz,
  submitted_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '재검토를 요청할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.trusted_rpc', '1', true);

  UPDATE public.reviews r
     SET status = 'REVIEW_REQUESTED',
         approved_at = NULL,
         updated_at = now()
   WHERE r.id = p_review_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 검토를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.review_history (review_id, actor_id, action, note)
  VALUES (p_review_id, auth.uid(), 'REVIEW_REQUESTED', COALESCE(p_note, ''));

  RETURN QUERY
    SELECT r.id, r.status, r.started_at, r.last_saved_at, r.submitted_at
      FROM public.reviews r
     WHERE r.id = p_review_id;
END;
$fn$;

-- ── 권한 ────────────────────────────────────────────────────────────
-- 재정의한 두 함수도 원래 권한 그대로 다시 못 박는다. CREATE OR REPLACE 는 권한을 유지하지만,
-- 어떤 이유로든 함수가 없던 DB 에서는 새로 만들어지면서 PUBLIC 실행 권한이 붙는다.
REVOKE EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_rereview(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decide_review(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decide_review(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_review(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) IS
  '검토 저장 + 제출(§7-2 제출 게이트). 상태 전이 전에 전 섹션 평가·조건부 의견·FTE 합계 100·배정 SME 본인을 서버에서 재검증한다. 실패는 예외가 아니라 {ok:false, missing:[…]} 로 돌려준다(저장 롤백 방지).';
COMMENT ON FUNCTION public.decide_review(uuid, text, text) IS
  '관리자의 승인/반려(§7-2). 승인은 상태를 바꾸지 않고 approved_at 으로 표현하며 제출된 적 있는 검토(submitted_at IS NOT NULL)에만 찍는다. 반려는 REVIEW_REQUESTED + 사유 필수이고 approved_at 을 지운다. review_history 와 audit_logs 에 함께 남는다.';

-- =====================================================================
-- ▼ 마무리 — PostgREST 스키마 캐시 갱신
--    새 표(7종)·새 컬럼(reviews.approved_at 등)·새 함수(decide_review)를
--    PostgREST 가 바로 알아보게 한다. SQL Editor로 직접 적용하면 갱신이 늦어
--    PGRST202/PGRST204 가 나는 일이 있다.
-- =====================================================================
NOTIFY pgrst, 'reload schema';
