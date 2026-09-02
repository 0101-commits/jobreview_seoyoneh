/* =====================================================================
   Job Review — 2026-09-02 v2 Phase E(품질) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260902070000_v2_phaseE_audit_rpc.sql — 감사 기록의 서버 이관(v2 S5).
       ⓐ save_org_units(uuid, jsonb)        신설 — 조직 마스터 업서트 + 상위조직 연결 + 감사
       ⓑ link_sme_roster_audited(uuid, jsonb) 신설 — 기존 RPC 호출 + 감사

   ▣ 화면과의 순서
     화면(v2 Phase E 코드)이 이 두 함수를 부른다. 적용 전에 배포하면 업로드 시트 ③④ 경로가
     PGRST202(함수 없음)로 실패한다 — 화면 배포와 함께 적용한다.
     기존 link_sme_roster는 그대로 남는다(본문 무변경).

   ▣ 적용 후 확인
     · 시트 ③④가 있는 파일을 업로드 → audit_logs에 ORG_UNITS_UPLOADED · SME_ROSTER_LINKED가
       각각 한 줄, actor_id가 업로드한 관리자여야 한다.
     · SELECT count(*) FROM pg_proc WHERE proname IN ('save_org_units','link_sme_roster_audited'); → 2
   ===================================================================== */

/*
  v2 Phase E — 감사 기록을 서버로 이관 (기획안 dcab2660 §7 · S5)

  ▣ 왜
    조직 마스터 업로드와 SME 명부 반영의 감사 기록이 브라우저에서 남고 있었다.
    클라이언트가 남기는 기록은 두 가지가 약하다.
      · 호출을 빠뜨려도 아무도 모른다(성공 경로에서 한 줄 지우면 그대로 사라진다).
      · meta를 임의로 넣을 수 있다(건수를 부풀려도 서버가 모른다).
    계정 생성/삭제만은 service_role(Edge Function)이 하므로 auth.uid()가 없어 클라이언트에
    남을 수밖에 없다(edgeApi.ts 주석). 나머지는 서버로 옮긴다.

  ▣ 무엇을
    1) save_org_units(p_company_id, p_rows) — 조직 마스터 업서트 + 상위조직 연결 + 감사 기록.
       클라이언트의 2패스 upsert를 한 트랜잭션으로 옮긴 것이다(중간에 실패하면 통째로 롤백).
    2) link_sme_roster_audited(p_company_id, p_rows) — 기존 link_sme_roster를 그대로 부르고
       그 결과 건수로 감사 기록만 남긴다. 190줄 본문을 복사하지 않기 위해 감싸는 방식을 골랐다.

  ▣ 적용
    supabase/APPLY_2026-09-02_v2_phaseE.sql
    화면은 새 RPC가 없으면 실패한다(업로드 시트 ③④ 경로). 화면 배포와 함께 적용한다.
*/

-- ── 1. 조직 마스터 저장 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_org_units(p_company_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '조직 마스터를 저장할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION '회사 정보를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  -- 호출자 소속 검사 — link_sme_roster와 같은 패턴이다(company_id가 NULL인 관리자는 전사 권한).
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.id = auth.uid()
          AND (me.company_id IS NULL OR me.company_id = p_company_id)) THEN
    RAISE EXCEPTION '이 회사의 조직 마스터를 저장할 권한이 없습니다. 관리자에게 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  /*
    1패스 — 코드·이름을 먼저 넣어 id를 만든다. 조직을 지우지는 않는다
    (profiles.org_unit_id 등 참조가 걸려 있어 삭제는 이 Phase의 범위 밖이다).
  */
  WITH incoming AS (
    SELECT DISTINCT ON (btrim(e->>'조직코드'))
           btrim(e->>'조직코드') AS code,
           btrim(e->>'조직명') AS name,
           NULLIF(btrim(e->>'상위조직코드'), '') AS parent_code
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
     WHERE COALESCE(btrim(e->>'조직코드'), '') <> ''
       AND COALESCE(btrim(e->>'조직명'), '') <> ''
  )
  INSERT INTO public.org_units (company_id, code, name, active)
  SELECT p_company_id, i.code, i.name, true FROM incoming i
  ON CONFLICT (company_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        active = true;

  /*
    2패스 — 코드→id를 풀어 parent_id를 채운다. 파일이 조직 트리의 기준이므로
    상위조직코드가 비어 있으면 parent_id도 비워 최상위로 되돌린다.
    파일 뒤쪽에 정의된 상위조직도 1패스 뒤라 풀린다.
  */
  WITH incoming AS (
    SELECT DISTINCT ON (btrim(e->>'조직코드'))
           btrim(e->>'조직코드') AS code,
           NULLIF(btrim(e->>'상위조직코드'), '') AS parent_code
      FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
     WHERE COALESCE(btrim(e->>'조직코드'), '') <> ''
       AND COALESCE(btrim(e->>'조직명'), '') <> ''
  )
  UPDATE public.org_units u
     SET parent_id = parent.id
    FROM incoming i
    LEFT JOIN public.org_units parent
           ON parent.company_id = p_company_id
          AND parent.code = i.parent_code
   WHERE u.company_id = p_company_id
     AND u.code = i.code;

  SELECT count(*) INTO v_count
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
   WHERE COALESCE(btrim(e->>'조직코드'), '') <> ''
     AND COALESCE(btrim(e->>'조직명'), '') <> '';

  -- 감사 기록(§8 S5). 조직명·코드 원문은 남기지 않고 건수만 남긴다.
  BEGIN
    PERFORM public.log_audit('ORG_UNITS_UPLOADED', 'org_units', p_company_id::text,
                             jsonb_build_object('count', v_count));
  EXCEPTION WHEN OTHERS THEN
    -- 기록 실패가 이미 끝난 저장을 되돌리지 않는다(하위 트랜잭션이라 이 블록만 사라진다).
    NULL;
  END;

  RETURN jsonb_build_object('count', v_count);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.save_org_units(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_org_units(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_org_units(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_org_units(uuid, jsonb) IS
  '조직 마스터(업로드 시트 ③) 저장 + 감사 기록(v2 S5). 클라이언트의 2패스 upsert를 한 트랜잭션으로 옮긴 것.';

-- ── 2. SME 명부 반영 + 감사 기록 ────────────────────────────────────
/*
  본문을 복사하지 않고 감싼다. link_sme_roster는 이미 권한·회사 범위를 스스로 검사하므로
  여기서는 결과 건수로 감사 한 줄만 남긴다. 이름·이메일 원문은 남기지 않는다(§8 S6 최소 수집).
*/
CREATE OR REPLACE FUNCTION public.link_sme_roster_audited(p_company_id uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
  v_rows int;
BEGIN
  v_result := public.link_sme_roster(p_company_id, p_rows);

  SELECT count(*) INTO v_rows
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
   WHERE COALESCE(btrim(e->>'이메일'), '') <> '';

  BEGIN
    PERFORM public.log_audit('SME_ROSTER_LINKED', 'profiles', p_company_id::text, jsonb_build_object(
      'rowCount', v_rows,
      'linked', COALESCE((v_result->>'linkedCount')::int, 0),
      'changed', COALESCE((v_result->>'changedCount')::int, 0),
      'unmatched', COALESCE(jsonb_array_length(v_result->'unmatchedEmails'), 0),
      'missingOrgCodes', COALESCE(jsonb_array_length(v_result->'missingOrgCodes'), 0),
      'assignmentsCreated', COALESCE((v_result->>'assignmentCreatedCount')::int, 0),
      'unknownJobs', COALESCE(jsonb_array_length(v_result->'unknownJobNames'), 0)));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.link_sme_roster_audited(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_sme_roster_audited(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_sme_roster_audited(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.link_sme_roster_audited(uuid, jsonb) IS
  'link_sme_roster 결과에 감사 기록 한 줄을 붙인 래퍼(v2 S5). 화면은 이 함수를 부른다.';
