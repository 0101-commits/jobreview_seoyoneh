/* =====================================================================
   Job Review — 2026-09-02 후속(감사 로그 보강) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260902020000_followup_audit_coverage.sql 한 벌이다. 세 함수를 다시 정의하면서
     감사 기록 한 줄씩만 얹는다. 표·컬럼·정책·상태머신·함수 시그니처는 하나도 건드리지 않는다.

       ⓐ submit_review          → REVIEW_SUBMITTED / REVIEW_RESUBMITTED
       ⓑ request_rereview       → REVIEW_REREVIEW_REQUESTED
       ⓒ save_integrated_job_data → JOB_DATA_UPLOADED

     세 함수의 기존 본문은 한 줄도 바뀌지 않았다. 20260901030000(제출 게이트·마커·승인 표시
     해제)과 20260828030000(검토 이력 보존 replace)의 최신 정의를 그대로 옮기고
     각 함수 마지막에 log_audit 호출 블록만 끼워 넣은 것이다.

   ▣ 왜 필요한가
     · 기획안 §8 S5 는 감사 대상을 "제출 · 승인/반려 · 계정 생성/삭제 · 업로드 · Export ·
       메일 발송" 여섯으로 못박는다. 이 중 제출과 직무정보(4시트) 업로드가 audit_logs 에
       남지 않고 있었다. 감사 요구가 "한 표에서 다 보인다"였다면 그 요구가 안 지켜진 상태였다.
     · 제출이 추적 불가능했던 것은 아니다. review_history 에는 남고 있었고 Export E5 로도
       나온다. 이번에 채우는 것은 audit_logs 한 표에서 여섯 항목이 함께 보이게 하는 부분이다.
     · request_rereview 는 화면 호출부가 없지만 authenticated 실행 권한이 살아 있다.
       기록 없이 검토 상태를 되돌릴 수 있는 경로를 남겨 두지 않기 위해 함께 넣는다.

   ▣ 서버에서 남기는 이유 (클라이언트가 아니라)
     · decide_review 가 이미 함수 안에서 남기고 있다. 클라이언트에서 남기면 호출을 빠뜨리거나
       임의의 meta 를 넣을 수 있다. 함수 안이면 그 RPC 로 들어온 모든 호출에 예외 없이 붙는다.
     · 이 셋은 첫머리에서 auth.uid()·is_admin() 으로 호출자를 확인하므로 log_audit 의
       42501 조건이 정상 경로에 새 제약을 더하지 않는다. 행위자가 service_role(auth.uid() = NULL)
       이라 클라이언트에 남을 수밖에 없는 것은 계정 생성/삭제뿐이다 — 조직 마스터 업로드와
       SME 명부 반영(link_sme_roster)은 관리자 브라우저에서만 불리고 is_admin() 으로 막힌다
       (그런데도 기록은 클라이언트에 있다. docs/OPEN_ISSUES.md §8 S5 「남은 작업」 5번).

   ▣ 감사 기록 실패가 본래 작업을 되돌리지 않는다
     세 곳 모두 log_audit 호출을 BEGIN ... EXCEPTION WHEN OTHERS THEN NULL 로 감쌌다.
     plpgsql 함수 본문은 한 트랜잭션이라, 감사 기록에서 난 예외가 밖으로 새면 SME 가 방금 마친
     제출이, 관리자가 방금 올린 4시트 업로드가 통째로 롤백된다. 감사 한 줄을 지키자고 본래
     작업을 되돌리는 것이 더 나쁜 결과다. src/lib/auditApi.ts 가 클라이언트에서 내린 판단과 같다.
     대가는 감사 기록이 조용히 빠질 수 있다는 것이고, 그래서 아래 확인 (4)(5)를 실제로 돌려 본다.

   ▣ 실행 시점 — 화면 배포와 무관하다
     · 화면 코드는 바뀌지 않는다. 이 SQL 만 적용해도 그 순간부터 기록이 쌓이기 시작한다.
     · 적용하지 않아도 화면은 지금처럼 동작한다(기록만 계속 빠진다).
     · 적용 중 짧은 순간 함수가 교체되지만, CREATE OR REPLACE 는 실행 중인 호출을 끊지 않는다.

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트 → 왼쪽 메뉴 SQL Editor.
     2. New query 에 이 파일 전체를 붙여넣고 Run.
     3. CREATE OR REPLACE FUNCTION / REVOKE / GRANT / COMMENT 뿐이라 여러 번 실행해도 안전하다.
        행을 지우거나 바꾸지 않는다.

   ▣ 적용 후 확인
     -- (1) 세 함수가 그대로 있나 (3행. prosecdef 는 셋 다 false = SECURITY INVOKER 여야 한다.
     --     여기서 true 가 나오면 RLS 를 우회하는 함수가 된 것이므로 즉시 되돌린다)
     SELECT p.proname, p.prosecdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('submit_review', 'request_rereview', 'save_integrated_job_data')
      ORDER BY 1;

     -- (2) 실행 권한 (authenticated 만 있어야 한다. anon 이 보이면 안 된다)
     SELECT routine_name, grantee, privilege_type
       FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name IN ('submit_review', 'request_rereview', 'save_integrated_job_data')
      ORDER BY 1, 2;

     -- (3) 감사 기록이 실제로 함수 본문에 들어갔나 (3행이 나와야 한다)
     SELECT p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('submit_review', 'request_rereview', 'save_integrated_job_data')
        AND p.prosrc LIKE '%log_audit%'
      ORDER BY 1;

     -- (4) 실제로 쌓이는가 — SME 제출 1건, 관리자 직무정보 업로드 1건을 해 본 뒤에 본다.
     --     적용 직후에는 0행이 정상이다.
     SELECT action, entity, entity_id, meta, created_at
       FROM public.audit_logs
      WHERE action IN ('REVIEW_SUBMITTED', 'REVIEW_RESUBMITTED',
                       'REVIEW_REREVIEW_REQUESTED', 'JOB_DATA_UPLOADED')
      ORDER BY created_at DESC LIMIT 20;

     -- (5) §8 S5 여섯 항목이 한 표에서 다 보이는가 — 행위별 건수
     SELECT action, count(*) AS 건수, max(created_at) AS 마지막
       FROM public.audit_logs GROUP BY action ORDER BY 3 DESC NULLS LAST;

     -- (6) 제출 이력과 감사 로그의 건수가 맞는가 — 적용 이후 제출분만 비교한다.
     --     감사 기록은 실패해도 삼키므로 두 값이 어긋나면 (감사 < 이력) 기록이 빠진 것이다.
     SELECT (SELECT count(*) FROM public.review_history
              WHERE action IN ('SUBMITTED', 'RESUBMITTED') AND created_at >= '<적용 시각>') AS 이력,
            (SELECT count(*) FROM public.audit_logs
              WHERE action IN ('REVIEW_SUBMITTED', 'REVIEW_RESUBMITTED')
                AND created_at >= '<적용 시각>') AS 감사;

   ▣ 함께 알아 둘 것 — 이 SQL 이 하지 않는 일
     · 지난 제출·업로드를 소급해 기록하지 않는다. 적용 시점 이후의 호출부터 남는다.
       적용 이전의 제출은 review_history 로만 확인한다.
     · upload_history 표를 채우지 않는다. 클라이언트가 파일명을 넘기지 않아 filename(NOT NULL)을
       채울 수 없다는 조건이 그대로다. 업로드 감사는 audit_logs 의 JOB_DATA_UPLOADED 로 본다.
     · 감사 로그에 사유·의견 같은 자유 서술을 담지 않는다. 재검토 요청 사유는 review_history.note
       에만 두고 감사 로그에는 길이만 남긴다(§8 S6 최소 수집). SME 성명·이메일도 넣지 않는다 —
       행위자는 actor_id 로 남는다.
     · 화면 코드를 바꾸지 않는다. 이미 클라이언트에서 남기고 있는 조직 마스터 업로드
       (ORG_UNITS_UPLOADED)·SME 명부 반영(SME_ROSTER_LINKED)은 그대로 둔다. 통합 업로드 한 번이
       이제 최대 세 줄(조직·명부·직무정보)을 남긴다. 중복이 아니라 서로 다른 단계다.

   ▣ 되돌리기
     DROP FUNCTION 하지 않는다. 세 함수는 화면이 쓰고 있어 지우면 제출·업로드가 즉시 막힌다.
     감사 기록만 걷어내려면 아래 두 파일의 해당 함수 정의를 그대로 다시 실행한다.
     (같은 CREATE OR REPLACE 이므로 감사 블록이 없는 정의로 돌아간다)

       · submit_review · request_rereview
         → supabase/migrations/20260901030000_phase1_submit_gate.sql
       · save_integrated_job_data
         → supabase/migrations/20260828030000_add_save_integrated_job_data.sql

     이미 쌓인 감사 로그 행을 지우려면(권장하지 않는다 — 감사 기록을 지우는 행위 자체가
     감사 대상이다. 파일럿 시험 데이터에만 쓴다)

     DELETE FROM public.audit_logs
      WHERE action IN ('REVIEW_SUBMITTED', 'REVIEW_RESUBMITTED',
                       'REVIEW_REREVIEW_REQUESTED', 'JOB_DATA_UPLOADED')
        AND created_at >= '<적용 시각>';
   ===================================================================== */

-- ── 1. 제출 (§8 S5 「제출」) ─────────────────────────────────────────
/*
  20260901030000_phase1_submit_gate.sql 의 정의 그대로이고, 마지막 review_history INSERT 뒤에
  감사 기록 블록만 붙였다. 부족 항목을 돌려주는 갈래(ok:false)는 이 지점에 닿지 않는다 —
  RETURN 이 앞에서 함수를 끝내므로, 제출이 일어나지 않은 호출은 감사 로그에 남지 않는다.
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

  -- 감사 기록(§8 S5). 상태 전이가 성공한 뒤에만 남는다.
  -- action 은 실제로 찍힌 상태를 따라간다 — 첫 제출은 REVIEW_SUBMITTED, 반려·재검토 요청 뒤의
  -- 다시 제출은 REVIEW_RESUBMITTED 다. v_review 는 위 UPDATE ... RETURNING 의 결과이므로
  -- 여기서 상태를 다시 계산하지 않는다.
  -- meta 에 SME 성명·이메일은 넣지 않는다(§8 S6 최소 수집). "누가"는 actor_id 로 남는다.
  -- 실패를 삼키는 이유는 파일 머리 3항에 적었다. 요약하면, 이 시점의 제출은 이미 끝났고
  -- 여기서 예외가 새면 그 제출이 통째로 롤백된다.
  BEGIN
    PERFORM public.log_audit(
      CASE WHEN v_review.status = 'RESUBMITTED' THEN 'REVIEW_RESUBMITTED' ELSE 'REVIEW_SUBMITTED' END,
      'reviews',
      p_review_id::text,
      jsonb_build_object(
        'status', v_review.status,
        'job_id', v_job_id,
        'job_name', (SELECT j.name FROM public.jobs j WHERE j.id = v_job_id)));
  EXCEPTION WHEN OTHERS THEN
    -- 감사 기록 실패가 제출을 되돌리지 않는다. 하위 트랜잭션이라 이 블록 안의 영향만 사라진다.
    NULL;
  END;

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

-- ── 2. 재검토 요청 (§8 S5 「승인/반려」의 되돌리기 경로) ─────────────
/*
  20260901030000_phase1_submit_gate.sql 의 정의 그대로이고, review_history INSERT 뒤에
  감사 기록 블록만 붙였다. decide_review 의 반려와 결과가 겹치지만 그쪽만 기록되고 있었다.
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

  -- 감사 기록(§8 S5). 위 UPDATE 가 성공(IF NOT FOUND 통과)한 뒤에만 닿는다.
  -- 사유 전문은 넣지 않는다 — 원문은 바로 위 review_history.note 에 이미 있고,
  -- 같은 자유 서술을 audit_logs 에 복제하면 개인 서술의 보관처만 둘로 늘어난다(§8 S6).
  -- "사유를 적었는가"는 감사에서 확인할 값이므로 존재 여부와 길이만 남긴다.
  -- 실패를 삼키는 이유는 파일 머리 3항과 같다.
  BEGIN
    PERFORM public.log_audit(
      'REVIEW_REREVIEW_REQUESTED',
      'reviews',
      p_review_id::text,
      jsonb_build_object(
        'status', 'REVIEW_REQUESTED',
        'has_note', btrim(COALESCE(p_note, '')) <> '',
        'note_length', length(btrim(COALESCE(p_note, '')))));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN QUERY
    SELECT r.id, r.status, r.started_at, r.last_saved_at, r.submitted_at
      FROM public.reviews r
     WHERE r.id = p_review_id;
END;
$fn$;

-- ── 3. 직무정보 통합 업로드 (§8 S5 「업로드」) ──────────────────────
/*
  20260828030000_add_save_integrated_job_data.sql 의 정의 그대로이고, 마지막 RETURN 앞에
  감사 기록 블록만 붙였다. 시그니처(uuid, text, jsonb, jsonb)와 반환 키(camelCase)를 바꾸지
  않았다 — src/lib/integratedJobApi.ts 가 그대로 호출한다.
  같은 업로드 화면의 조직 마스터(ORG_UNITS_UPLOADED)·SME 명부(SME_ROSTER_LINKED)는 이미
  클라이언트에서 남고 있어 건드리지 않는다. 이제 한 번의 통합 업로드가 최대 세 줄을 남긴다.
*/
CREATE OR REPLACE FUNCTION public.save_integrated_job_data(
  p_company_id uuid,
  p_mode text,
  p_job_rows jsonb,
  p_skill_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_bad_name text;
  v_job_count bigint := 0;
  v_task_count bigint := 0;
  v_activity_count bigint := 0;
  v_skill_count bigint := 0;
  v_requirement_count bigint := 0;
BEGIN
  ------------------------------------------------------------------
  -- 1. 권한·인자 검증
  ------------------------------------------------------------------
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '직무정보를 업로드할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('append', 'replace') THEN
    RAISE EXCEPTION '업로드 방식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION '회사 정보를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  -- 호출자 소속 검사. 20260828010500(get_review_status)이 세운 회사 스코프 패턴과 같다.
  -- 관리자 프로필의 company_id가 NULL이면 전사 권한(현재 관리자 계정이 전부 이 상태라 동작은 바뀌지 않는다).
  -- 회사별 관리자를 만드는 순간부터 이 다섯 줄이 "남의 회사 직무를 통째로 교체"를 막는다.
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.id = auth.uid()
          AND (me.company_id IS NULL OR me.company_id = p_company_id)) THEN
    RAISE EXCEPTION '이 회사의 직무정보를 업로드할 권한이 없습니다. 관리자에게 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_job_rows) <> 'array' OR jsonb_array_length(p_job_rows) = 0 THEN
    RAISE EXCEPTION '‘직무 및 과업 정보’ 시트에 저장할 데이터가 없습니다.'
      USING ERRCODE = '22023';
  END IF;

  -- 길이 0도 막는다. 빈 배열이 replace로 들어오면 4단계가 회사 전체 Skill을 내린 뒤 6단계가 아무것도 되살리지
  -- 못해 Skill이 통째로 사라지는데, 반환값은 skillCount 0이고 화면은 "저장 완료"로 표시된다.
  -- 클라이언트는 skillRows.length > 0을 이미 요구하므로(integratedUploadUtils.ts:370) 정상 경로를 막지 않는다.
  IF jsonb_typeof(p_skill_rows) <> 'array' OR jsonb_array_length(p_skill_rows) = 0 THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트에 저장할 데이터가 없습니다. 파일을 다시 선택해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------
  -- 2. 값 검증
  --    클라이언트(integratedUploadUtils.ts)가 이미 검증하지만, RPC는 아무 관리자나
  --    임의의 payload로 부를 수 있는 경계다. 여기서 막지 않으면 빈 문자열이 그대로 적재된다.
  --
  --    행 번호는 쓰지 않는다. 클라이언트가 완전 공백 행(integratedUploadUtils.ts:114)과 중복 행(260·351행)을
  --    빼고 배열을 만들기 때문에, 배열 인덱스 + 1은 실제 엑셀 행과 어긋난다. 대신 값으로 지목한다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT concat_ws(' > ', nullif(src.grp, ''), nullif(src.ser, ''), nullif(src.job, '')) INTO v_bad_name
    FROM src
   WHERE src.grp = '' OR src.ser = '' OR src.job = ''
      OR src.definition = '' OR src.task = '' OR src.activity = ''
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘직무 및 과업 정보’ 시트의 % 행에 비어 있는 값이 있습니다. 직군·직렬·직무·직무정의·주요과업·세부활동은 모두 입력해 주세요.',
      coalesce(nullif(v_bad_name, ''), '직군·직렬·직무가 모두 빈') USING ERRCODE = '22023';
  END IF;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT concat_ws(' > ', nullif(src.grp, ''), nullif(src.ser, ''), nullif(src.job, '')) INTO v_bad_name
    FROM src
   WHERE src.grp = '' OR src.ser = '' OR src.job = ''
      OR src.skill_type = '' OR src.skill_name = ''
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 % 행에 비어 있는 값이 있습니다. 직군·직렬·직무·Skill 구분·Skill은 모두 입력해 주세요.',
      coalesce(nullif(v_bad_name, ''), '직군·직렬·직무가 모두 빈') USING ERRCODE = '22023';
  END IF;

  -- job_skills.skill_type CHECK 제약과 같은 값만 허용한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type, t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT src.skill_type INTO v_bad_name
    FROM src
   WHERE src.skill_type NOT IN ('Hard Skill', 'Soft Skill')
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 Skill 구분 값 ‘%’은(는) 사용할 수 없습니다. Hard Skill 또는 Soft Skill로 입력해 주세요.',
      v_bad_name USING ERRCODE = '22023';
  END IF;

  -- job_groups는 전역 unique(name, source_version)이라 같은 직군명을 회사끼리 나눠 가질 수 없다.
  -- 다른 회사가 이미 등록한 이름이면 삽입 시 중복 키 오류가 나므로, 먼저 한국어로 알린다.
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  SELECT string_agg(DISTINCT jg.name, ', ' ORDER BY jg.name) INTO v_bad_name
    FROM public.job_groups jg
    JOIN src ON src.grp = jg.name
   WHERE jg.source_version = 1
     AND jg.company_id IS NOT NULL
     AND jg.company_id <> p_company_id;

  IF v_bad_name IS NOT NULL THEN
    RAISE EXCEPTION '직군 ‘%’은(는) 다른 회사에 이미 등록되어 있어 저장할 수 없습니다. 관리자에게 문의해 주세요.',
      v_bad_name USING ERRCODE = '23505';
  END IF;

  ------------------------------------------------------------------
  -- 3. 레거시 편입 — company_id가 NULL인 기존 행을 이 회사로 끌어온다.
  --    replace의 비활성화 범위가 company_id 기준이므로 반드시 비활성화보다 먼저 한다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_groups jg
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
   WHERE jg.name = src.grp
     AND jg.source_version = 1
     AND jg.company_id IS NULL;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_series js
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE js.group_id = jg.id
     AND js.name = src.ser
     AND js.source_version = 1
     AND js.company_id IS NULL;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser,
                    btrim(coalesce(t.e->>'직무', '')) AS job
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.jobs j
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = src.ser AND js.source_version = 1
   WHERE j.group_id = jg.id
     AND j.series_id = js.id
     AND j.name = src.job
     AND j.source_version = 1
     AND j.company_id IS NULL;

  ------------------------------------------------------------------
  -- 4. replace: 이 회사 범위를 전부 active=false로 내린다. 삭제하지 않는다.
  --    파일에 있는 행은 5단계에서 같은 id 그대로 다시 살아난다.
  ------------------------------------------------------------------
  IF p_mode = 'replace' THEN
    UPDATE public.task_activities ta
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE ta.active
       AND ta.job_task_id IN (
             SELECT jt.id FROM public.job_tasks jt
              JOIN public.jobs j ON j.id = jt.job_id
             WHERE j.company_id = p_company_id);

    UPDATE public.job_tasks jt
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE jt.active
       AND jt.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = p_company_id);

    UPDATE public.job_skills sk
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE sk.active
       AND sk.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = p_company_id);

    UPDATE public.jobs j
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE j.active AND j.company_id = p_company_id;

    UPDATE public.job_series js
       SET active = false, updated_at = now()
     WHERE js.active AND js.company_id = p_company_id;

    UPDATE public.job_groups jg
       SET active = false, updated_at = now()
     WHERE jg.active AND jg.company_id = p_company_id;
  END IF;

  ------------------------------------------------------------------
  -- 5-1. 직군(job_groups)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_groups jg
     SET company_id = p_company_id,
         active = true,
         updated_at = now()
    FROM src
   WHERE jg.name = src.grp
     AND jg.source_version = 1
     AND jg.company_id = p_company_id;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  INSERT INTO public.job_groups (company_id, name, active, source_version, created_by)
  SELECT p_company_id, src.grp, true, 1, v_actor
    FROM src
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_groups jg
            WHERE jg.name = src.grp AND jg.source_version = 1);

  ------------------------------------------------------------------
  -- 5-2. 직렬(job_series) — 키는 (group_id, name, source_version)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_series js
     SET company_id = p_company_id,
         active = true,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE js.group_id = jg.id
     AND js.name = src.ser
     AND js.source_version = 1
     -- 타 회사 소유로 표시된 직렬은 흡수하지 않는다. 3단계에서 NULL은 이미 편입했다.
     AND (js.company_id IS NULL OR js.company_id = p_company_id);

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  INSERT INTO public.job_series (company_id, group_id, name, active, source_version, created_by)
  SELECT p_company_id, jg.id, src.ser, true, 1, v_actor
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_series js
            WHERE js.group_id = jg.id AND js.name = src.ser AND js.source_version = 1);

  ------------------------------------------------------------------
  -- 5-3. 직무(jobs) — 키는 (group_id, series_id, name, source_version)
  --      직무정의는 같은 직무의 첫 등장 행 값을 쓴다(클라이언트가 불일치를 이미 막는다).
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  def AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.definition
      FROM src
     ORDER BY src.grp, src.ser, src.job, src.ord
  )
  UPDATE public.jobs j
     -- 직무정의는 replace에서만 덮어쓴다. append 모드의 화면 문구는 "새로운 직무정보를 추가하고 기존 검토 이력을
     -- 유지합니다"(UploadPage.tsx:285)이고 확인 모달도 없다. 그런 경로가 구버전 마스터 파일 하나로
     -- SME가 이미 검토한 직무정의를 조용히 되돌리면 안 된다. job_feedback은 검토 대상 원문을 보존하지 않아
     -- 무엇에 대해 '적합'이라고 답했는지 복원할 수 없다. 새로 만들어지는 직무는 INSERT 경로라 영향이 없다.
     SET company_id = p_company_id,
         definition = CASE WHEN p_mode = 'replace' THEN def.definition ELSE j.definition END,
         active = true,
         updated_at = now(),
         updated_by = v_actor
    FROM def
    JOIN public.job_groups jg
      ON jg.name = def.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = def.ser AND js.source_version = 1
   WHERE j.group_id = jg.id
     AND j.series_id = js.id
     AND j.name = def.job
     AND j.source_version = 1
     AND (j.company_id IS NULL OR j.company_id = p_company_id);

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  def AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.definition
      FROM src
     ORDER BY src.grp, src.ser, src.job, src.ord
  )
  INSERT INTO public.jobs (company_id, group_id, series_id, name, definition, active, source_version, created_by, updated_by)
  SELECT p_company_id, jg.id, js.id, def.job, def.definition, true, 1, v_actor, v_actor
    FROM def
    JOIN public.job_groups jg
      ON jg.name = def.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = def.ser AND js.source_version = 1
   WHERE NOT EXISTS (
           SELECT 1 FROM public.jobs j
            WHERE j.group_id = jg.id AND j.series_id = js.id
              AND j.name = def.job AND j.source_version = 1);

  ------------------------------------------------------------------
  -- 5-4. 주요과업(job_tasks) — unique 제약이 없으므로 (job_id, name)으로 찾아 UPDATE, 없으면 INSERT.
  --      기존에 같은 (job_id, name) 행이 여러 개 있으면(구 업로드 경로가 중복 삽입했다)
  --      한 행만 되살린다. 어느 행을 고르는지는 머리 주석 §8 참고 — SME 피드백이 달린 행이 우선이다.
  --      나머지는 replace에서 내려간 채로 둔다 = 자연스러운 중복 정리.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  -- 되살릴 한 행을 고르는 기준(머리 주석 §8). replace는 4단계에서 전부 inactive로 만들어 놓기 때문에
  -- active DESC가 동률이 된다. 그 다음 기준으로 "SME 피드백이 달린 행"을 먼저 되살려 검토 이력을 지킨다.
  fb AS (SELECT DISTINCT tf.task_id FROM public.task_feedback tf),
  target AS (
    SELECT DISTINCT ON (jt.job_id, jt.name) jt.id, jt.job_id, jt.name
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
      LEFT JOIN fb ON fb.task_id = jt.id
     ORDER BY jt.job_id, jt.name, jt.active DESC, (fb.task_id IS NOT NULL) DESC, jt.created_at
  )
  UPDATE public.job_tasks upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
    JOIN target ON target.job_id = ji.job_id AND target.name = ranked.task
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_tasks (job_id, name, active, sort_order, updated_by)
  SELECT ji.job_id, ranked.task, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_tasks jt
            WHERE jt.job_id = ji.job_id AND jt.name = ranked.task);

  ------------------------------------------------------------------
  -- 5-5. 세부활동(task_activities) — 키는 (job_task_id, activity_name)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task, activity,
           (row_number() OVER (PARTITION BY grp, ser, job, task ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, activity, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task, activity) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  task_ids AS (
    SELECT DISTINCT ON (ji.grp, ji.ser, ji.job, jt.name)
           ji.grp, ji.ser, ji.job, jt.name AS task, jt.id AS task_id
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
     ORDER BY ji.grp, ji.ser, ji.job, jt.name, jt.active DESC, jt.created_at
  ),
  target AS (
    SELECT DISTINCT ON (ta.job_task_id, ta.activity_name) ta.id, ta.job_task_id, ta.activity_name
      FROM public.task_activities ta
      JOIN task_ids ti ON ti.task_id = ta.job_task_id
     ORDER BY ta.job_task_id, ta.activity_name, ta.active DESC, ta.created_at
  )
  UPDATE public.task_activities upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN task_ids ti
      ON ti.grp = ranked.grp AND ti.ser = ranked.ser AND ti.job = ranked.job AND ti.task = ranked.task
    JOIN target ON target.job_task_id = ti.task_id AND target.activity_name = ranked.activity
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task, activity,
           (row_number() OVER (PARTITION BY grp, ser, job, task ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, activity, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task, activity) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  task_ids AS (
    SELECT DISTINCT ON (ji.grp, ji.ser, ji.job, jt.name)
           ji.grp, ji.ser, ji.job, jt.name AS task, jt.id AS task_id
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
     ORDER BY ji.grp, ji.ser, ji.job, jt.name, jt.active DESC, jt.created_at
  )
  INSERT INTO public.task_activities (job_task_id, activity_name, active, sort_order, updated_by)
  SELECT ti.task_id, ranked.activity, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN task_ids ti
      ON ti.grp = ranked.grp AND ti.ser = ranked.ser AND ti.job = ranked.job AND ti.task = ranked.task
   WHERE NOT EXISTS (
           SELECT 1 FROM public.task_activities ta
            WHERE ta.job_task_id = ti.task_id AND ta.activity_name = ranked.activity);

  ------------------------------------------------------------------
  -- 6. Skill 시트
  ------------------------------------------------------------------
  -- 6-1. 직무 시트에 없는 직무를 참조하면(클라이언트가 이미 막지만) INNER JOIN에서 조용히 사라진다.
  --      조용한 누락 대신 트랜잭션을 되돌리고 알린다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', '')) AS grp,
           btrim(coalesce(t.e->>'직렬', '')) AS ser,
           btrim(coalesce(t.e->>'직무', '')) AS job,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  SELECT concat_ws(' > ', src.grp, src.ser, src.job) INTO v_bad_name
    FROM src
   WHERE NOT EXISTS (
           SELECT 1 FROM job_ids ji
            WHERE ji.grp = src.grp AND ji.ser = src.ser AND ji.job = src.job)
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 ‘%’ 직무를 ‘직무 및 과업 정보’ 시트에서 찾을 수 없습니다.',
      v_bad_name USING ERRCODE = '22023';
  END IF;

  -- 6-2. Skill(job_skills) — 키는 (job_id, skill_type, name).
  --      job_skills_unique_active 부분 unique 인덱스(WHERE active)와 같은 키다.
  --      되살릴 대상을 한 행으로 좁히지 않으면 중복 행을 동시에 active로 올려 인덱스를 위반한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, skill_type, skill_name,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, skill_type, skill_name, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, skill_type, skill_name) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  fb AS (SELECT DISTINCT sf.skill_id FROM public.skill_feedback sf),
  target AS (
    SELECT DISTINCT ON (sk.job_id, sk.skill_type, sk.name) sk.id, sk.job_id, sk.skill_type, sk.name
      FROM public.job_skills sk
      JOIN job_ids ji ON ji.job_id = sk.job_id
      LEFT JOIN fb ON fb.skill_id = sk.id
     ORDER BY sk.job_id, sk.skill_type, sk.name, sk.active DESC, (fb.skill_id IS NOT NULL) DESC, sk.created_at
  )
  UPDATE public.job_skills upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
    JOIN target ON target.job_id = ji.job_id
               AND target.skill_type = ranked.skill_type
               AND target.name = ranked.skill_name
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, skill_type, skill_name,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, skill_type, skill_name, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, skill_type, skill_name) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_skills (job_id, name, skill_type, active, sort_order, updated_by)
  SELECT ji.job_id, ranked.skill_name, ranked.skill_type, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_skills sk
            WHERE sk.job_id = ji.job_id
              AND sk.skill_type = ranked.skill_type
              AND sk.name = ranked.skill_name);

  -- 6-3. 수행요건(job_requirements) — 직무당 1행. unique 인덱스 job_requirements_job_id_key(job_id)를
  --      ON CONFLICT 타깃으로 쓴다(이 테이블만 타깃이 명확하다).
  --      같은 직무가 두 번 들어오면 "cannot affect row a second time"이 나므로 DISTINCT ON으로 1행만 남긴다.
  --      active 컬럼이 없고 jobs 삭제 시 CASCADE라, replace에서도 지우지 않고 덮어쓰기만 한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))              AS grp,
           btrim(coalesce(t.e->>'직렬', ''))              AS ser,
           btrim(coalesce(t.e->>'직무', ''))              AS job,
           btrim(coalesce(t.e->>'요구 학력', ''))          AS education,
           btrim(coalesce(t.e->>'관련 전공', ''))          AS major,
           btrim(coalesce(t.e->>'관련 자격증/면허', ''))   AS certifications,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  req AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.education, src.major, src.certifications
      FROM src
     -- replace는 파일이 진실이므로 세 항목이 모두 빈 직무도 빈 문자열로 덮어쓴다. 그래야 "지웠다"가 반영된다.
     -- (job_requirements에는 active 컬럼이 없어 4단계 비활성화 대상이 아니고, 세 컬럼은 NOT NULL DEFAULT ''다.)
     -- append는 빈 칸을 "손대지 말라"로 읽어 기존 값을 유지한다. 화면 문구가 "추가"이고 확인 모달이 없기 때문이다.
     WHERE p_mode = 'replace'
        OR src.education <> '' OR src.major <> '' OR src.certifications <> ''
     ORDER BY src.grp, src.ser, src.job, src.ord
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_requirements (job_id, education, major, certifications, updated_by)
  SELECT ji.job_id, req.education, req.major, req.certifications, v_actor
    FROM req
    JOIN job_ids ji ON ji.grp = req.grp AND ji.ser = req.ser AND ji.job = req.job
  ON CONFLICT (job_id) DO UPDATE
    SET education = EXCLUDED.education,
        major = EXCLUDED.major,
        certifications = EXCLUDED.certifications,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  ------------------------------------------------------------------
  -- 7. 건수 집계
  --    한 트랜잭션 안에서 위 단계가 모두 성공했으므로, 입력 기준 건수 = 반영된 건수다.
  --    화면 검증 단계에서 보여 준 숫자(integratedUploadUtils.ts)와 같은 정의를 쓴다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job FROM src) a),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, task FROM src) b),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, task, activity FROM src) c)
    INTO v_job_count, v_task_count, v_activity_count;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))              AS grp,
           btrim(coalesce(t.e->>'직렬', ''))              AS ser,
           btrim(coalesce(t.e->>'직무', ''))              AS job,
           btrim(coalesce(t.e->>'Skill 구분', ''))        AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))             AS skill_name,
           btrim(coalesce(t.e->>'요구 학력', ''))          AS education,
           btrim(coalesce(t.e->>'관련 전공', ''))          AS major,
           btrim(coalesce(t.e->>'관련 자격증/면허', ''))   AS certifications
      FROM jsonb_array_elements(p_skill_rows) AS t(e)
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, skill_type, skill_name FROM src) a),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job FROM src
                                 WHERE education <> '' OR major <> '' OR certifications <> '') b)
    INTO v_skill_count, v_requirement_count;

  -- 감사 기록(§8 S5 「업로드」). 적재가 전부 끝나고 건수까지 세어 둔 자리다.
  -- 4시트 업로드는 관리자의 한 번의 조작이므로 한 줄만 남긴다(행마다 남기면 감사 로그가
  -- 적재 로그로 변한다). 남기는 값은 무엇이 얼마나 들어갔는지 — 파일 내용이나 개인정보는 없다.
  -- replace 인지 append 인지는 사고 조사에서 가장 먼저 볼 값이라 함께 남긴다.
  -- 실패를 삼키는 이유는 파일 머리 3항과 같다. 여기서 예외가 새면 방금 적재한
  -- 직무·과업·세부활동·Skill·수행요건 전부가 롤백된다.
  BEGIN
    PERFORM public.log_audit(
      'JOB_DATA_UPLOADED',
      'jobs',
      p_company_id::text,
      jsonb_build_object(
        'mode', p_mode,
        'jobCount', v_job_count,
        'taskCount', v_task_count,
        'activityCount', v_activity_count,
        'skillCount', v_skill_count,
        'requirementCount', v_requirement_count));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'jobCount', v_job_count,
    'taskCount', v_task_count,
    'activityCount', v_activity_count,
    'skillCount', v_skill_count,
    'requirementCount', v_requirement_count
  );
END;
$fn$;

-- ── 권한 재선언 ─────────────────────────────────────────────────────
-- CREATE OR REPLACE 는 기존 권한을 유지하지만, 함수가 없던 DB 에서는 새로 만들어지며
-- PUBLIC 실행 권한이 붙는다. 원래 파일과 똑같은 내용을 다시 못 박는다.
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_rereview(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) IS
  '검토 저장 + 제출(§7-2 제출 게이트). 상태 전이 전에 전 섹션 평가·조건부 의견·FTE 합계 100·배정 SME 본인을 서버에서 재검증한다. 실패는 예외가 아니라 {ok:false, missing:[…]} 로 돌려준다(저장 롤백 방지). 전이가 성공하면 review_history 와 audit_logs 에 함께 남는다(REVIEW_SUBMITTED / REVIEW_RESUBMITTED).';
COMMENT ON FUNCTION public.request_rereview(uuid, text) IS
  '관리자의 재검토 요청(§7-2). status 를 REVIEW_REQUESTED 로 되돌리고 approved_at 을 지운다. review_history 와 audit_logs 에 함께 남는다(REVIEW_REREVIEW_REQUESTED). 사유 원문은 review_history.note 에만 두고 감사 로그에는 길이만 남긴다(§8 S6).';
COMMENT ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) IS
  '관리자 직무정보 통합 업로드. 한 트랜잭션으로 직군·직렬·직무·주요과업·세부활동·Skill·수행요건을 적재한다. replace 는 삭제 대신 active=false 로 내리고 파일에 있는 행을 같은 id 로 되살려 검토 이력을 보존한다. 적재가 끝나면 audit_logs 에 한 줄 남긴다(JOB_DATA_UPLOADED · 모드와 건수).';

-- PostgREST 가 교체된 세 함수의 정의를 바로 다시 읽게 한다.
-- 시그니처는 그대로라 이 줄이 없어도 호출은 되지만, 스키마 캐시를 새로 태워
-- "옛 정의가 한동안 남는" 애매한 구간을 없앤다.
NOTIFY pgrst, 'reload schema';
