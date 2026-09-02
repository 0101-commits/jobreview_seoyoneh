/*
# Phase 5 — 조직축 채우기(profiles.org_unit_id) · 명부 배정 · FTE 게이트 기본값

기준: docs/PLAN.txt §2 R6·R8 · §6-3 ⓐ · §7-1 ① · §9 E2(계약 1-(4)·3-(4)) · §8 S5.

1. 왜 이 파일이 있나 — 세 가지 결함
- ① profiles.org_unit_id 에 값을 쓰는 경로가 저장소 전체에 하나도 없었다.
  Phase 1(20260901020000)이 시트 ④(SME 명부: 성명·이메일·조직코드·직급·배정직무)를
  "검증·미리보기까지만" 하고 버렸기 때문에 org_unit_id 는 영원히 NULL 이다. 그 결과
    · §6-3 ⓐ 진행 매트릭스의 행이 전부 '조직 미지정'으로 몰린다(adminApi.fetchProgressMatrix).
    · §9 E2 '직무·조직별 투입 비중 분포'의 조직축이 통째로 비어 계약 1-(4)·3-(4)를 못 낸다
      (exportApi.collectE2 의 조직코드·조직명 칸이 전부 빈칸이 된다).
    · R8(조직 단위 분석 가능성 확보)이 미이행이다.
- ② sync_sme_assignments 는 회사의 활성 직무 '전부'를 모든 SME 에게 배정한다.
  그러면 R6("직무별 최소 인원의 SME 1~2명")을 만족시킬 수단이 없고, §6-3 ⓐ 의
  '직무별 SME 배정 수' 점검이 언제나 전원 배정으로 나온다. 시트 ④ 의 「배정직무」 열은
  파싱·검증만 하고 버려지고 있었다.
- ③ survey_settings.fte_required 의 컬럼 DEFAULT 가 false 라, 20260901040000 이 기존 행만
  true 로 올린 뒤에 만들어지는 회사는 FTE 100% 서버 검증이 꺼진 채 시작한다.
  FTE 입력 화면(STEP 3)은 Phase 2 에서 이미 배포됐으므로 기본값을 미뤄 둘 이유가 사라졌다.

2. 무엇을 하나
- ⓐ link_sme_roster(p_company_id, p_rows) RPC 신설.
     업로드한 SME 명부로 (가) 이미 존재하는 계정의 org_unit_id 를 조직코드로 연결하고
     (나) 「배정직무」를 review_assignments 로 추가한다. 계정은 만들지 않는다 —
     Phase 1 의 범위 결정(계정 생성은 SME 계정 관리 화면의 몫)을 그대로 유지한다.
- ⓑ sync_sme_assignments 에 R6 충돌 사실을 COMMENT 로 남긴다. 함수 정의는 건드리지 않는다.
- ⓒ survey_settings.fte_required 의 컬럼 DEFAULT 를 true 로 올린다.

3. 왜 클라이언트 UPDATE 가 아니라 SECURITY DEFINER RPC 인가
- profiles 는 20260813034113 이 REVOKE UPDATE 한 뒤 컬럼 단위 GRANT 만 열어 두었다.
  지금 열려 있는 컬럼은 name·email·organization·title(20260813034113),
  must_change_password(20260901010000), guide_completed_at(20260901020000) 여섯 개뿐이고
  org_unit_id 는 그 목록에 없다 — 확인했다.
- 그렇다고 GRANT UPDATE (org_unit_id) ... TO authenticated 를 추가하지는 않았다.
  RLS profile_self_or_admin_update 는 "본인 행 또는 관리자"를 허용한다. 이 컬럼을
  authenticated 에 열면 SME 가 자기 행의 소속 조직을 스스로 바꿀 수 있고, 그러면 방금
  살려 낸 §9 E2 의 조직축이 응답자 손에서 흔들린다. 20260901020000 의 4항이 같은 이유로
  이 GRANT 를 일부러 뺐다고 적어 두었고, 그 판단을 뒤집지 않는다.
- SECURITY DEFINER 함수는 소유자 권한으로 돌아 컬럼 GRANT 와 RLS 양쪽에 걸리지 않는다.
  대신 첫머리에서 is_admin() 으로 호출자를 직접 막는다(log_audit·get_review_status 와 같은 형태).
  save_integrated_job_data 가 INVOKER 인 것과 갈리는 지점이 바로 이 컬럼 GRANT 다 —
  그쪽은 적재 대상의 RLS 만 통과하면 되지만, 이쪽은 RLS 를 통과해도 컬럼 권한에서 막힌다.
- 회사 스코프 검사(호출자 profiles.company_id)는 save_integrated_job_data 가 세운 패턴을 그대로 쓴다.

4. 데이터 안전 — 지우지 않는다
- 기존 배정을 통째로 지우지 않는다. 명부에 있는 (SME, 직무) 쌍을 INSERT ... ON CONFLICT DO NOTHING
  으로 '추가'만 한다. 이미 제출된 검토가 딸린 배정을 삭제하면 응답이 사라진다.
  같은 이유로 이미 있는 배정의 active 도 되살리지 않는다 — 관리자가 일부러 내려 둔 배정을
  파일 한 장이 되돌리면 그것도 관리자가 의도하지 않은 변경이다.
- org_unit_id 는 명부의 조직코드로 덮어쓴다. 이 컬럼의 유일한 입력 경로가 이 명부이므로
  덮어쓰기가 곧 정정 경로다(조직 이동을 반영하려면 명부를 고쳐 다시 올린다).
- fte_required 는 DEFAULT 만 바꾸고 기존 행의 값은 건드리지 않는다.
  운영자가 일부러 꺼 둔 회사를 파일 적용이 조용히 다시 켜면 안 된다.
  (SET DEFAULT 는 앞으로 만들어질 행에만 닿는다.)
- 이름·직급은 반영하지 않는다. 관리자가 계정 화면에서 넣은 값을 파일이 덮어쓰지 않는다.

5. 멱등
- CREATE OR REPLACE FUNCTION / COMMENT ON / ALTER COLUMN ... SET DEFAULT 뿐이다.
- link_sme_roster 자체도 멱등이다. 같은 명부를 두 번 반영해도 org_unit_id 는 같은 값으로
  다시 쓰이고(값이 같으면 UPDATE 대상에서 빠진다), 배정은 ON CONFLICT DO NOTHING 으로 늘지 않는다.

6. 감사(§8 S5)
- 연결·배정 결과는 호출한 화면이 log_audit RPC 로 남긴다(src/lib/integratedJobApi.ts 의
  linkSmeRoster → logAudit('SME_ROSTER_LINKED', ...)). 조직 마스터 저장(ORG_UNITS_UPLOADED)과
  같은 방식이다. 함수 안에서 남기지 않는 이유는 log_audit 이 actor_id 를 auth.uid() 로
  강제하는데, 이 함수를 service_role(auth.uid() = NULL)로 부를 여지를 남겨 두기 위해서다.
*/

-- ── ⓐ SME 명부 반영 RPC (지적 ① ② · R6 · R8) ───────────────────────
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
  -- 관리자 프로필의 company_id 가 NULL 이면 전사 권한이다(현재 관리자 계정이 전부 이 상태다).
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
  -- 1. 소속 조직 연결 (지적 ①)
  --
  -- 명부의 「조직코드」를 org_units(company_id, code)로 풀어 profiles.org_unit_id 에 넣는다.
  -- 대조 키는 이메일이다. 계정이 없으면 만들지 않고 아래 2단계에서 명단으로 돌려준다.
  -- 회사 범위 밖 계정은 건드리지 않는다 — company_id 가 NULL 인 레거시 계정만 함께 받는다
  -- (20260813053114 이후 대부분의 기존 계정이 아직 NULL 이다).
  -- 아래 CTE 는 같은 모양이 네 번 반복된다. 임시 테이블 한 장이 더 깔끔해 보이지만,
  -- plpgsql 이 임시 테이블을 참조하는 계획을 OID 로 캐시해 두 번째 호출에서 깨지는 함정이 있다.
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
  -- 2. 연결 결과 집계 — 화면이 "N명 연결 · M명은 계정 없음"을 정확히 말할 수 있게 한다.
  --    못 찾은 이메일·조직코드를 버리지 않고 그대로 돌려준다.
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
  -- 3. 배정직무 반영 (지적 ②)
  --
  -- 직무명 → jobs.id 해석은 이 회사의 활성 직무 안에서만 한다.
  -- 같은 이름의 활성 직무가 둘 이상이면(jobs 의 유일 제약은 group·series·name·version 이라
  -- 이름만으로는 유일하지 않다) 모두 배정한다. 검증 단계(integratedUploadUtils)도 이름만으로
  -- 대조하므로 판정 기준을 같게 두는 편이 낫고, 의도한 배정을 놓치는 쪽이 더 위험하다.
  -- 못 찾은 이름은 버리지 않고 unknownJobNames 로 돌려준다.
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
  --    sync_sme_assignments 의 마지막 단계와 같다. 이 행이 없으면 §6-3 ⓐ 매트릭스에서
  --    '미시작'으로도 세어지지 않아 배정이 화면에서 사라진다.
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

-- ── ⓑ sync_sme_assignments — 동작은 그대로, 충돌 사실만 남긴다 (지적 ②) ──
-- 다른 화면(admin-create-user 엣지 함수의 create-sme)이 이 함수를 쓰고 있다.
-- 여기서 "명부에 있는 직무만"으로 바꾸면 계정을 새로 만든 SME 의 배정이 0 이 되어
-- 지금 돌아가는 관리자 흐름이 끊긴다. 그래서 정의는 손대지 않고 사실만 기록한다.
COMMENT ON FUNCTION public.sync_sme_assignments(uuid, uuid) IS
  '회사의 활성 직무 전부를 해당 SME 에게 배정한다(계정 생성 시 자동 호출). '
  '주의: 이 전 직무 자동 배정은 §2 R6("직무별 최소 인원의 SME 1~2명")과 충돌한다. '
  '전원 배정이 되어 §6-3 ⓐ 의 「직무별 SME 배정 수」 점검이 언제나 전원으로 나온다. '
  '직무를 골라 배정하려면 SME 명부(시트 ④)를 올려 link_sme_roster 를 쓴다.';

-- ── ⓒ FTE 합계 게이트 기본값 (지적 ③) ──────────────────────────────
-- 20260901020000 이 false 로 둔 이유(FTE 입력 화면이 Phase 2 라서)는 화면이 배포된 지금 사라졌다.
-- 앞으로 만들어질 회사가 서버 검증이 꺼진 채 시작하지 않도록 기본값만 올린다.
-- 기존 행의 값은 그대로 둔다 — 운영자가 일부러 꺼 둔 회사를 다시 켜지 않는다.
ALTER TABLE public.survey_settings ALTER COLUMN fte_required SET DEFAULT true;

COMMENT ON COLUMN public.survey_settings.fte_required IS
  'FTE 합계 100% 제출 게이트 스위치(§7-2 제출 게이트 ③). 기본값 true — '
  'Phase 2 에서 FTE 입력 화면이 배포된 뒤로는 새 회사도 켠 채로 시작한다. '
  '회사 단위로 끄려면 이 값을 false 로 내린다.';
