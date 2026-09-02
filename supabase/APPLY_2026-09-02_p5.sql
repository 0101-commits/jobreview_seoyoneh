/* =====================================================================
   Job Review — 2026-09-02 Phase 5 (조직축·명부 배정·FTE 기본값) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260902010000_p5_org_axis_and_defaults.sql 한 벌이다. 세 가지를 한다.

       ⓐ link_sme_roster(p_company_id, p_rows) 함수 신설 — 업로드한 SME 명부(시트 ④)로
          ① 이미 존재하는 계정의 profiles.org_unit_id 를 조직코드로 연결하고
          ② 「배정직무」를 review_assignments 로 추가한다. 계정은 만들지 않는다.
       ⓑ sync_sme_assignments 에 COMMENT 를 단다. 함수 정의·동작은 그대로다.
       ⓒ survey_settings.fte_required 의 컬럼 DEFAULT 를 false → true 로 올린다.
          기존 행의 값은 건드리지 않는다.

   ▣ 왜 필요한가
     · profiles.org_unit_id 에 값을 쓰는 경로가 지금까지 하나도 없었다. Phase 1 이 SME 명부를
       검증까지만 하고 버렸기 때문이다. 그래서 /progress 진행 매트릭스의 행이 전부
       '조직 미지정'으로 몰리고, Export E2 '직무·조직별 투입 비중 분포'의 조직코드·조직명
       칸이 통째로 비어 계약 1-(4)·3-(4)를 낼 수 없었다(R8 미이행).
     · sync_sme_assignments 는 회사의 활성 직무 전부를 모든 SME 에게 배정한다. 그 상태에서는
       R6("직무별 SME 1~2명")를 만족시킬 수단이 없다. 명부의 「배정직무」로 직무를 골라
       배정하는 경로가 이 함수다.
     · fte_required 의 컬럼 기본값이 false 라, 2026-09-01 Phase 2 SQL 이 기존 행만 true 로 올린
       뒤에 새로 만들어지는 회사는 FTE 100% 서버 검증이 꺼진 채 시작한다.

   ▣ 실행 시점 — 화면 배포 앞뒤 어느 쪽이어도 안전하다
     · 이 SQL 을 먼저 적용하면 → 함수만 늘어난 상태다. 아무도 부르지 않으므로 화면은 그대로다.
     · 화면을 먼저 배포하면 → 통합 업로드에서 SME 명부 시트를 올릴 때 PGRST202("함수를 찾을 수
       없음")가 나고, 화면은 "SME 명부를 반영하지 못했어요"만 따로 알린다. 직무·과업·Skill·조직
       마스터 저장은 그 상태에서도 정상이다(명부 반영은 별도 단계로 분리돼 있다).
     · 조직 마스터(시트 ③)가 org_units 에 먼저 들어가 있어야 조직코드를 풀 수 있다. 통합 업로드는
       한 번의 실행 안에서 조직 마스터를 먼저 저장하고 명부를 나중에 반영하므로 순서가 보장된다.

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트 → 왼쪽 메뉴 SQL Editor.
     2. New query 에 이 파일 전체를 붙여넣고 Run.
     3. CREATE OR REPLACE FUNCTION / COMMENT ON / ALTER COLUMN ... SET DEFAULT 뿐이라
        여러 번 실행해도 안전하다. 행을 지우거나 바꾸지 않는다.
        (SET DEFAULT 는 앞으로 만들어질 행에만 닿는다. 이미 들어간 값을 바꾸지 않는다.)

   ▣ 적용 후 확인
     -- (1) 함수가 생겼나(1행. prosecdef = true 여야 한다)
     SELECT p.proname, p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'link_sme_roster';

     -- (2) 실행 권한(authenticated 만 있어야 한다. anon 이 보이면 안 된다)
     SELECT grantee, privilege_type
       FROM information_schema.routine_privileges
      WHERE routine_schema = 'public' AND routine_name = 'link_sme_roster';

     -- (3) fte_required 기본값이 true 로 바뀌었나
     SELECT column_name, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'survey_settings'
        AND column_name = 'fte_required';

     -- (4) 기존 회사 설정 값은 그대로인가(적용 전과 같아야 한다)
     SELECT c.name, s.fte_required
       FROM public.companies c LEFT JOIN public.survey_settings s ON s.company_id = c.id
      ORDER BY c.name;

     -- (5) 조직축이 실제로 채워지는지 — 명부를 한 번 올린 뒤에 확인한다
     --     적용 직후에는 아직 전부 NULL 인 것이 정상이다.
     SELECT count(*) FILTER (WHERE org_unit_id IS NOT NULL) AS 조직연결됨,
            count(*) FILTER (WHERE org_unit_id IS NULL)     AS 조직미지정
       FROM public.profiles WHERE role = 'sme';

     -- (6) 직무별 SME 배정 수 — R6(1~2명) 점검. 명부 배정을 쓰기 전에는 전원 배정으로 나온다.
     SELECT j.name AS 직무, count(DISTINCT ra.sme_id) AS SME수
       FROM public.jobs j
       LEFT JOIN public.review_assignments ra ON ra.job_id = j.id AND ra.active = true
      WHERE j.active = true
      GROUP BY j.name ORDER BY 2 DESC, 1;

     -- (7) 감사 기록(§8 S5) — 명부를 반영하면 한 건 남는다
     SELECT action, entity, meta, created_at
       FROM public.audit_logs WHERE action = 'SME_ROSTER_LINKED'
      ORDER BY created_at DESC LIMIT 5;

   ▣ 함께 알아 둘 것 — 이 SQL 이 하지 않는 일
     · 계정을 만들지 않는다. 명부에 있으나 profiles 에 없는 이메일은 화면이 명단으로 보여 주고,
       계정 생성은 지금처럼 SME 계정 관리 화면에서 한다(Phase 1 의 범위 결정 유지).
     · 기존 배정을 지우지 않는다. 명부에 있는 (SME, 직무) 쌍을 추가만 한다. 이미 제출된 검토가
       딸린 배정을 지우면 응답이 사라지기 때문이다. 이미 있는 배정의 active 도 되살리지 않는다.
     · sync_sme_assignments 의 전 직무 자동 배정을 끄지 않는다. 계정 생성 흐름이 그것을 쓰고 있어
       지금 끄면 새 SME 의 배정이 0 이 된다. R6 로 좁히려면 명부 배정을 쓴 뒤, 남는 전 직무 배정을
       관리자가 화면에서 정리하는 순서가 안전하다.
     · profiles 에 GRANT UPDATE (org_unit_id) 를 열지 않는다. RLS 가 본인 행 UPDATE 를 허용하므로
       그 컬럼을 authenticated 에 열면 SME 가 자기 소속 조직을 바꿀 수 있고, E2 의 조직축이
       응답자 손에서 흔들린다. 그래서 이 함수만 SECURITY DEFINER 로 두고 is_admin() 으로 막는다.

   ▣ 되돌리기
     -- (1) 명부 반영 함수 제거 — 조직축이 다시 채워지지 않는다(이미 채운 값은 남는다)
     DROP FUNCTION IF EXISTS public.link_sme_roster(uuid, jsonb);

     -- (2) FTE 기본값을 도로 내린다(앞으로 만들어질 회사만 영향받는다)
     ALTER TABLE public.survey_settings ALTER COLUMN fte_required SET DEFAULT false;

     -- (3) 특정 계정의 조직 연결만 되돌리려면
     UPDATE public.profiles SET org_unit_id = NULL, updated_at = now()
      WHERE email = '<이메일>';

     -- (4) 명부로 추가된 배정만 되돌리려면 — 검토가 붙지 않은 것만 지운다.
     --     제출·작성 중인 검토가 딸린 배정은 절대 지우지 않는다(응답이 사라진다).
     DELETE FROM public.review_assignments ra
      WHERE ra.id IN (
        SELECT a.id FROM public.review_assignments a
          JOIN public.reviews r ON r.assignment_id = a.id
         WHERE r.status = 'NOT_STARTED' AND a.created_at >= '<적용 시각>'
      );
   ===================================================================== */

-- ── ⓐ SME 명부 반영 RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.link_sme_roster(p_company_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- 조직코드까지 확인돼 소속 조직이 연결된 계정 수(이미 같은 조직이던 계정 포함).
  v_linked int := 0;
  -- 그중 이번 호출에서 실제로 값이 바뀐 계정 수.
  v_changed int := 0;
  v_assignments int := 0;
  v_reviews int := 0;
  v_unmatched text[] := '{}';
  v_missing_orgs text[] := '{}';
  v_unknown_jobs text[] := '{}';
BEGIN
  ------------------------------------------------------------------
  -- 0. 권한·인자 검증
  ------------------------------------------------------------------
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'SME 명부를 반영할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION '회사 정보를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  -- 호출자 소속 검사. 20260828030000(save_integrated_job_data)이 세운 회사 스코프 패턴 그대로다.
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.id = auth.uid()
          AND (me.company_id IS NULL OR me.company_id = p_company_id)) THEN
    RAISE EXCEPTION '이 회사의 SME 명부를 반영할 권한이 없습니다. 관리자에게 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  -- 빈 명부는 오류가 아니다. 아무것도 하지 않고 0 을 돌려준다.
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object(
      'linkedCount', 0, 'changedCount', 0, 'unmatchedEmails', '[]'::jsonb,
      'missingOrgCodes', '[]'::jsonb, 'assignmentCreatedCount', 0,
      'unknownJobNames', '[]'::jsonb, 'reviewCreatedCount', 0);
  END IF;

  ------------------------------------------------------------------
  -- 1. 소속 조직 연결
  ------------------------------------------------------------------
  WITH roster AS (
    SELECT DISTINCT
           lower(btrim(coalesce(t.e->>'이메일', ''))) AS email,
           btrim(coalesce(t.e->>'조직코드', ''))      AS org_code
      FROM jsonb_array_elements(p_rows) AS t(e)
     WHERE btrim(coalesce(t.e->>'이메일', '')) <> ''
  ),
  resolved AS (
    SELECT r.email, o.id AS org_id
      FROM roster r
      JOIN public.org_units o ON o.company_id = p_company_id AND o.code = r.org_code
  )
  UPDATE public.profiles p
     SET org_unit_id = x.org_id,
         updated_at  = now()
    FROM resolved x
   WHERE lower(p.email) = x.email
     AND (p.company_id IS NULL OR p.company_id = p_company_id)
     AND p.org_unit_id IS DISTINCT FROM x.org_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  ------------------------------------------------------------------
  -- 2. 연결 결과 집계 — 못 찾은 이메일·조직코드를 버리지 않고 그대로 돌려준다.
  ------------------------------------------------------------------
  WITH roster AS (
    SELECT DISTINCT
           lower(btrim(coalesce(t.e->>'이메일', ''))) AS email,
           btrim(coalesce(t.e->>'조직코드', ''))      AS org_code
      FROM jsonb_array_elements(p_rows) AS t(e)
     WHERE btrim(coalesce(t.e->>'이메일', '')) <> ''
  ),
  matched AS (
    SELECT r.email,
           r.org_code,
           o.id AS org_id,
           p.id AS profile_id
      FROM roster r
      LEFT JOIN public.org_units o
             ON o.company_id = p_company_id AND o.code = r.org_code
      LEFT JOIN public.profiles p
             ON lower(p.email) = r.email
            AND (p.company_id IS NULL OR p.company_id = p_company_id)
  )
  SELECT count(*) FILTER (WHERE m.profile_id IS NOT NULL AND m.org_id IS NOT NULL),
         coalesce(array_agg(DISTINCT m.email)    FILTER (WHERE m.profile_id IS NULL), '{}'::text[]),
         coalesce(array_agg(DISTINCT m.org_code) FILTER (WHERE m.org_id IS NULL AND m.org_code <> ''), '{}'::text[])
    INTO v_linked, v_unmatched, v_missing_orgs
    FROM matched m;

  ------------------------------------------------------------------
  -- 3. 배정직무 반영 — 기존 배정은 지우지 않고 추가만 한다.
  ------------------------------------------------------------------
  WITH roster_jobs AS (
    SELECT DISTINCT
           lower(btrim(coalesce(t.e->>'이메일', ''))) AS email,
           btrim(jn.name)                             AS job_name
      FROM jsonb_array_elements(p_rows) AS t(e)
      CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(t.e->'배정직무목록') = 'array'
                  THEN t.e->'배정직무목록'
                  ELSE '[]'::jsonb END) AS jn(name)
     WHERE btrim(coalesce(t.e->>'이메일', '')) <> ''
       AND btrim(jn.name) <> ''
  ),
  pairs AS (
    SELECT p.id AS sme_id, j.id AS job_id
      FROM roster_jobs rj
      JOIN public.profiles p
        ON lower(p.email) = rj.email
       AND (p.company_id IS NULL OR p.company_id = p_company_id)
      JOIN public.jobs j
        ON j.company_id = p_company_id AND j.active = true AND j.name = rj.job_name
  )
  INSERT INTO public.review_assignments (sme_id, job_id, active, created_by)
  SELECT DISTINCT pr.sme_id, pr.job_id, true, auth.uid()
    FROM pairs pr
  ON CONFLICT (sme_id, job_id) DO NOTHING;
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  WITH roster_jobs AS (
    SELECT DISTINCT btrim(jn.name) AS job_name
      FROM jsonb_array_elements(p_rows) AS t(e)
      CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(t.e->'배정직무목록') = 'array'
                  THEN t.e->'배정직무목록'
                  ELSE '[]'::jsonb END) AS jn(name)
     WHERE btrim(jn.name) <> ''
  )
  SELECT coalesce(array_agg(DISTINCT rj.job_name), '{}'::text[])
    INTO v_unknown_jobs
    FROM roster_jobs rj
   WHERE NOT EXISTS (
           SELECT 1 FROM public.jobs j
            WHERE j.company_id = p_company_id AND j.active = true AND j.name = rj.job_name);

  ------------------------------------------------------------------
  -- 4. 새 배정의 검토 행(NOT_STARTED) 생성.
  ------------------------------------------------------------------
  WITH roster AS (
    SELECT DISTINCT lower(btrim(coalesce(t.e->>'이메일', ''))) AS email
      FROM jsonb_array_elements(p_rows) AS t(e)
     WHERE btrim(coalesce(t.e->>'이메일', '')) <> ''
  ),
  smes AS (
    SELECT p.id
      FROM public.profiles p
      JOIN roster r ON lower(p.email) = r.email
     WHERE (p.company_id IS NULL OR p.company_id = p_company_id)
  )
  INSERT INTO public.reviews (assignment_id, status)
  SELECT ra.id, 'NOT_STARTED'
    FROM public.review_assignments ra
   WHERE ra.sme_id IN (SELECT s.id FROM smes s)
     AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.assignment_id = ra.id);
  GET DIAGNOSTICS v_reviews = ROW_COUNT;

  RETURN jsonb_build_object(
    'linkedCount',            v_linked,
    'changedCount',           v_changed,
    'unmatchedEmails',        to_jsonb(v_unmatched),
    'missingOrgCodes',        to_jsonb(v_missing_orgs),
    'assignmentCreatedCount', v_assignments,
    'unknownJobNames',        to_jsonb(v_unknown_jobs),
    'reviewCreatedCount',     v_reviews
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.link_sme_roster(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_sme_roster(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_sme_roster(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.link_sme_roster(uuid, jsonb) IS
  '업로드한 SME 명부(시트 ④)로 이미 존재하는 계정의 profiles.org_unit_id 를 연결하고(R8 · §9 E2 조직축) '
  '「배정직무」를 review_assignments 로 추가한다(R6). 계정은 만들지 않고, 기존 배정도 지우지 않는다. '
  'org_unit_id 는 컬럼 GRANT 가 닫혀 있어 SECURITY DEFINER 로 두고 첫머리에서 is_admin() 으로 막는다.';

-- ── ⓑ sync_sme_assignments — 동작은 그대로, 충돌 사실만 남긴다 ──────
COMMENT ON FUNCTION public.sync_sme_assignments(uuid, uuid) IS
  '회사의 활성 직무 전부를 해당 SME 에게 배정한다(계정 생성 시 자동 호출). '
  '주의: 이 전 직무 자동 배정은 §2 R6("직무별 최소 인원의 SME 1~2명")과 충돌한다. '
  '전원 배정이 되어 §6-3 ⓐ 의 「직무별 SME 배정 수」 점검이 언제나 전원으로 나온다. '
  '직무를 골라 배정하려면 SME 명부(시트 ④)를 올려 link_sme_roster 를 쓴다.';

-- ── ⓒ FTE 합계 게이트 기본값 ────────────────────────────────────────
ALTER TABLE public.survey_settings ALTER COLUMN fte_required SET DEFAULT true;

COMMENT ON COLUMN public.survey_settings.fte_required IS
  'FTE 합계 100% 제출 게이트 스위치(§7-2 제출 게이트 ③). 기본값 true — '
  'Phase 2 에서 FTE 입력 화면이 배포된 뒤로는 새 회사도 켠 채로 시작한다. '
  '회사 단위로 끄려면 이 값을 false 로 내린다.';

-- PostgREST가 새 함수(link_sme_roster)를 바로 알아보게 한다.
-- 이 줄을 빼면 통합 업로드의 SME 명부 단계가 한동안 PGRST202("함수를 찾을 수 없음")로 실패한다.
NOTIFY pgrst, 'reload schema';
