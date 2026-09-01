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
