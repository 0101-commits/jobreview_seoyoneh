/*
# get_review_status / sync_sme_assignments 권한 구멍 차단

1. 문제
- `get_review_status`는 SECURITY DEFINER인데 호출자 기준 필터가 없어 RLS를 우회했다.
  SME 계정 하나로 전 계열사 SME의 이름·이메일·소속(organization)·직급(title)이 그대로 조회됐다.
  화면(App.tsx HistoryPage)은 이 결과를 "내가 작성한 검토 기록"이라고 표시하고 있었다.
- `sync_sme_assignments`도 SECURITY DEFINER인데 EXECUTE가 authenticated 전체에 열려 있었다.
  SME가 임의의 sme_id로 직접 호출하면 남의 배정을 통째로 삭제할 수 있었다
  (p_company_id를 NULL로 주면 DELETE FROM review_assignments WHERE sme_id = p_sme_id 가 실행된다).

2. 조치
- get_review_status: 반환 컬럼 구조는 그대로 두고(화면이 이미 그 형태를 쓴다) WHERE 절에 호출자 기준 필터를 추가한다.
  - SME  → 본인 행만.
  - 관리자 → 자기 회사(profiles.company_id) 범위만. 단 관리자 프로필의 company_id가 NULL이면 전사(기존 동작 유지).
    현재 관리자 계정은 company_id 없이 생성되므로 관리자 화면 동작은 바뀌지 않는다.
  - 비로그인(auth.uid() IS NULL)은 어느 조건도 만족하지 못해 0행을 받는다.
- sync_sme_assignments: 관리자가 아닌 로그인 사용자의 호출을 막는다.
  auth.uid()가 NULL인 호출(= service_role로 도는 admin-create-user 엣지 함수)은 그대로 허용해
  기존 계정 생성 흐름이 깨지지 않게 한다. anon에는 애초에 EXECUTE 권한이 없다.

3. 데이터 안전
- 함수 정의만 교체한다. 테이블·행·정책 변경 없음. 시그니처와 반환 컬럼은 동일하다.
*/

CREATE OR REPLACE FUNCTION public.get_review_status(p_company_id uuid DEFAULT NULL)
RETURNS TABLE (
  sme_id uuid,
  sme_name text,
  sme_email text,
  organization text,
  title text,
  company_id uuid,
  company_name text,
  job_id uuid,
  job_name text,
  group_name text,
  series_name text,
  review_status text,
  review_id uuid,
  submitted_at timestamptz,
  suitable_count bigint,
  needs_edit_count bigint,
  unsuitable_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    p.id AS sme_id,
    p.name AS sme_name,
    p.email AS sme_email,
    p.organization,
    p.title,
    p.company_id,
    c.name AS company_name,
    j.id AS job_id,
    j.name AS job_name,
    jg.name AS group_name,
    js.name AS series_name,
    COALESCE(r.status, 'NOT_STARTED') AS review_status,
    r.id AS review_id,
    r.submitted_at,
    COALESCE(s.suitable_count, 0) AS suitable_count,
    COALESCE(s.needs_edit_count, 0) AS needs_edit_count,
    COALESCE(s.unsuitable_count, 0) AS unsuitable_count
  FROM public.profiles p
  JOIN public.review_assignments ra ON ra.sme_id = p.id AND ra.active = true
  JOIN public.jobs j ON j.id = ra.job_id AND j.active = true
  JOIN public.job_groups jg ON jg.id = j.group_id
  JOIN public.job_series js ON js.id = j.series_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.reviews r ON r.assignment_id = ra.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE suitability = 'SUITABLE') AS suitable_count,
      COUNT(*) FILTER (WHERE suitability = 'NEEDS_EDIT') AS needs_edit_count,
      COUNT(*) FILTER (WHERE suitability = 'UNSUITABLE') AS unsuitable_count
    FROM (
      SELECT suitability FROM public.job_feedback WHERE review_id = r.id
      UNION ALL
      SELECT suitability FROM public.task_feedback WHERE review_id = r.id
      UNION ALL
      SELECT suitability FROM public.skill_feedback WHERE review_id = r.id
    ) all_feedback
  ) s ON true
  WHERE p.role = 'sme'
    AND p.active = true
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    -- 호출자 기준 필터. SECURITY DEFINER라 RLS가 적용되지 않으므로 여기서 직접 막는다.
    AND (
      p.id = auth.uid()
      OR (
        public.is_admin()
        AND (
          (SELECT me.company_id FROM public.profiles me WHERE me.id = auth.uid()) IS NULL
          OR p.company_id = (SELECT me.company_id FROM public.profiles me WHERE me.id = auth.uid())
        )
      )
    )
  ORDER BY p.name, j.name;
$fn$;

CREATE OR REPLACE FUNCTION public.sync_sme_assignments(p_sme_id uuid, p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- 로그인 사용자가 호출했다면 관리자여야 한다.
  -- auth.uid()가 NULL인 호출은 service_role(admin-create-user 엣지 함수)이므로 통과시킨다.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION '배정을 변경할 권한이 없습니다. 관리자에게 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  -- Remove existing assignments if company_id is null
  IF p_company_id IS NULL THEN
    DELETE FROM public.review_assignments WHERE sme_id = p_sme_id;
    RETURN;
  END IF;

  -- Remove assignments for jobs that don't belong to the SME's company
  DELETE FROM public.review_assignments ra
  USING public.jobs j
  WHERE ra.sme_id = p_sme_id
    AND ra.job_id = j.id
    AND (j.company_id IS DISTINCT FROM p_company_id OR j.active = false);

  -- Insert new assignments for all active jobs in the company
  INSERT INTO public.review_assignments (sme_id, job_id, active)
  SELECT p_sme_id, j.id, true
  FROM public.jobs j
  WHERE j.company_id = p_company_id
    AND j.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.review_assignments ra2
      WHERE ra2.sme_id = p_sme_id AND ra2.job_id = j.id
    );

  -- Create reviews with NOT_STARTED status for new assignments
  INSERT INTO public.reviews (assignment_id, status)
  SELECT ra.id, 'NOT_STARTED'
  FROM public.review_assignments ra
  WHERE ra.sme_id = p_sme_id
    AND NOT EXISTS (
      SELECT 1 FROM public.reviews r WHERE r.assignment_id = ra.id
    );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_review_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_review_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_sme_assignments(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_sme_assignments(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_review_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_sme_assignments(uuid, uuid) TO authenticated;
