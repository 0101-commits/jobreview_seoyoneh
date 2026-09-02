/*
# 배정 해제 안전장치를 서버로 내린다 — 트리거 + 제출 게이트 (§6-3 ⓐ R6)

기준: docs/PLAN.html §6-3 ⓐ(R6 "직무별 최소 인원의 업무전문가 1~2명"), §8 S5·S8,
      docs/OPEN_ISSUES.md 「이번 후속에서 더해진 것 — /assignments-admin」.

1. 무엇이 문제였나
- `/assignments-admin` 의 "제출된 응답이 있으면 해제를 막는다"가 **클라이언트에만** 있었다
  (src/lib/assignmentApi.ts 의 assignmentGuardOf). 서버에는 그 판정이 한 줄도 없다.
- 그래서 두 갈래로 "아무 화면에도 보이지 않는 제출"이 만들어졌다.
  ① 경합 — 관리자가 확인 모달을 보는 사이(또는 해제 직전 조회와 UPDATE 사이)에 SME 가 제출한다.
     서버는 제출을 정상 처리하고, 관리자는 그 위에 active = false 를 쓴다.
  ② 세션 잔존(경합이 없어도 상시 재현) — 관리자가 작성 중 배정을 해제한 뒤, SME 가 **이미 열어 둔**
     마법사에서 제출을 누른다. submit_review 는 배정 담당자(a.sme_id)만 보고 a.active 는 보지 않았다.
- 결과: status = SUBMITTED · submitted_at 이 찍힌 검토가 active = false 배정에 매달린다. 이 행은
  진행 매트릭스 · 검토현황(get_review_status) · 워크벤치 SME 피드백 · Export E1·E2·E5 ·
  SME 본인 목록이 **전부 active = true 로 걸러** 어디에도 나오지 않는다.
  관리자에게는 "제출한 적 없음", SME 에게는 "제출 완료"로 보이고 경고는 어디에도 뜨지 않는다.

2. 두 장치를 함께 넣는다 (하나로는 닫히지 않는다)
- ⓐ **해제 잠금 트리거** — review_assignments 를 true → false 로 내릴 때 그 배정의 검토에
     submitted_at 이 있으면 42501 로 거절한다. ①(경합)과 클라이언트를 거치지 않은 직접 PATCH 를
     함께 닫는다. 20260901020000 의 guard_locked_columns 와 같은 패턴이다.
- ⓑ **제출 게이트에 배정 확인 추가** — submit_review 가 상태 전이 앞에서 a.active 를 본다.
     ②(세션 잔존)는 UPDATE 가 일어나지 않는 경로라 트리거가 잡을 수 없다. 이쪽에서만 닫힌다.
- 클라이언트의 assignmentGuardOf 는 그대로 둔다. 사유 문구·버튼 잠금은 화면에서 미리 보여 주는
  편이 낫고, 서버는 그 화면을 거치지 않는 호출까지 막는 마지막 방어선이다.

3. ⓑ 를 넣은 자리 — save_review_draft 뒤, 상태 전이 앞
- 담당자 확인(a.sme_id) 자리에 a.active 를 함께 넣으면 **임시저장까지 막힌다**
  (save_review_draft 는 별도 함수이므로 직접 영향은 없지만, submit_review 안의 저장 호출이
  검증보다 앞에 있어 순서를 뒤집게 된다). 그래서 조회에는 값만 담고 판정은 저장 뒤로 내렸다.
- 그 결과 SME 가 방금 입력한 내용은 그대로 저장되고, 보이지 않게 될 **제출만** 막힌다.
- 예외를 던지지 않고 { ok:false, missing:[…] } 로 돌려준다. 이 함수의 다른 검증(FTE·미평가)과
  같은 규약이고, 예외로 던지면 방금 한 저장이 통째로 롤백된다.

4. 되살리는 경로 · 우회 경로
- 잘못 내린 배정은 `/assignments-admin` 에서 같은 (SME, 직무)를 다시 추가하면 upsert 로
  active = true 가 된다(트리거는 false → true 를 막지 않는다). 데이터는 지워지지 않는다.
- 제출된 응답이 있는 배정을 **정말로** 내려야 하는 경우의 우회 경로는 남기지 않았다.
  "제출된 응답을 어떻게 처리할지"가 PM 결정 사항이기 때문이다(docs/OPEN_ISSUES.md).
  운영자가 부득이 내려야 한다면 SQL Editor 에서
  `ALTER TABLE public.review_assignments DISABLE TRIGGER review_assignments_guard_deactivate;`
  로 잠시 끄고 작업한 뒤 반드시 `ENABLE TRIGGER` 로 되돌린다. 그 사이의 해제는 감사에 남지 않는다.

5. 멱등 · 데이터 안전
- CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER / REVOKE / GRANT / COMMENT 뿐이다.
  표·컬럼·행·정책·상태머신을 건드리지 않는다. 여러 번 실행해도 같은 결과다.
- 기존 데이터에 소급 적용되지 않는다. 이미 active = false 인 배정에 제출된 검토가 매달려 있다면
  이 파일은 그것을 되살리지 않는다 — 찾는 쿼리는 아래 APPLY 파일의 확인 (4)에 있다.
- submit_review 는 20260902020000_followup_audit_coverage.sql 의 정의를 **그대로 옮기고**
  DECLARE 한 줄 · SELECT 대상 한 칸 · 위 3항의 판정 블록만 더했다. 감사 기록·FTE 게이트·
  미평가 검증·app.trusted_rpc 마커·승인 표시 해제는 전부 그대로다.
- 반드시 20260902020000 뒤에 적용한다. 순서를 뒤집으면 그 파일이 이 판정을 지운 정의로 되돌린다.
*/

-- ── 1. 해제 잠금 트리거 (경합 · 직접 PATCH) ─────────────────────────
/*
  통과 조건을 두지 않는다. 관리자 자신이 내리는 경로가 바로 이 트리거가 막으려는 경로이므로
  guard_locked_columns 처럼 is_admin() 으로 빠져나가게 두면 아무것도 막지 못한다.
  false → true(되살리기)와 그 밖의 컬럼 변경은 그대로 통과한다.
*/
CREATE OR REPLACE FUNCTION public.guard_assignment_deactivate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF OLD.active AND NOT NEW.active
     AND EXISTS (SELECT 1 FROM public.reviews r
                  WHERE r.assignment_id = OLD.id
                    AND r.submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION '이미 제출된 응답이 있어 배정을 해제할 수 없습니다. 해제하면 제출된 응답이 관리자 화면과 산출물(E1·E2)에서 함께 빠져 집계가 어긋납니다.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS review_assignments_guard_deactivate ON public.review_assignments;
CREATE TRIGGER review_assignments_guard_deactivate
  BEFORE UPDATE ON public.review_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_assignment_deactivate();

COMMENT ON FUNCTION public.guard_assignment_deactivate() IS
  '배정 해제(active true → false) 시 그 배정의 검토에 submitted_at 이 있으면 42501 로 거절한다. 제출된 응답이 active=true 로 거르는 모든 화면·산출물에서 조용히 빠지는 것을 막는다. 되살리기(false → true)는 막지 않는다.';

-- ── 2. 제출 게이트에 배정 확인 추가 ─────────────────────────────────
/*
  20260902020000_followup_audit_coverage.sql 의 정의 그대로이고, 위 3항의 세 곳만 더했다.
  ① DECLARE v_assignment_active boolean;
  ② 담당자 조회의 SELECT 대상에 a.active 추가(판정은 여기서 하지 않는다)
  ③ save_review_draft 호출 뒤 · 상태 전이 앞에 배정 확인 블록
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
  -- 배정이 아직 살아 있는지(review_assignments.active). 판정은 저장 뒤로 내린다(머리 3항).
  v_assignment_active boolean;
BEGIN
  -- 컬럼 잠금 트리거에 "정해진 기능으로 들어온 전이"임을 알린다(트랜잭션 한정).
  PERFORM set_config('app.trusted_rpc', '1', true);

  -- ④ 호출자 = 배정 SME 본인.
  -- 저장보다 먼저 본다(위 주석 4번). 검토 자체가 안 보이면(RLS) v_sme_id 가 NULL 이라 같은 갈래로 걸린다.
  -- 회사는 jobs.company_id 를 먼저 보고, 비어 있으면 배정 행의 company_id 를 쓴다.
  -- 20260813053114 이전에 만들어진 직무는 jobs.company_id 가 NULL 로 남아 있다. 그대로 두면
  -- 아래 fte_required 조회가 어떤 행에도 걸리지 않아, 운영자가 해제 스위치를 내려도 그 직무만
  -- 계속 엄격하게 막힌다 — 원인을 화면에서 알 수 없는 제출 차단이 된다.
  SELECT a.sme_id, a.job_id, COALESCE(j.company_id, a.company_id), a.active
    INTO v_sme_id, v_job_id, v_company_id, v_assignment_active
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

  -- ⑤ 배정이 살아 있어야 제출할 수 있다(§6-3 ⓐ R6 · /assignments-admin).
  -- 관리자가 배정을 내린 뒤(active = false) SME 가 이미 열어 둔 마법사에서 제출을 누르는 경로다.
  -- 위 ④ 는 담당자만 보고 배정의 생사는 보지 않으므로 여기까지 아무 제약이 없었다. 그렇게 찍힌
  -- 제출은 진행 매트릭스·검토현황·워크벤치·Export·SME 목록이 전부 active = true 로 걸러
  -- 어디에도 보이지 않는다(관리자에게는 '미제출', SME 에게는 '제출 완료'). 그 상태를 만들지 않는다.
  -- 자리가 여기인 이유는 머리 3항에 적었다 — 저장 뒤·전이 앞이라 입력은 남고 제출만 막힌다.
  IF v_assignment_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'missing', jsonb_build_array(jsonb_build_object(
        'step', 5,
        'kind', 'ASSIGNMENT_INACTIVE',
        'label', '이 직무의 배정이 해제되어 제출할 수 없습니다. 방금 입력한 내용은 저장됐습니다. 관리자에게 문의해 주세요.')));
  END IF;

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

-- ── 권한 재선언 ─────────────────────────────────────────────────────
-- CREATE OR REPLACE 는 기존 권한을 유지하지만, 함수가 없던 DB 에서는 새로 만들어지며
-- PUBLIC 실행 권한이 붙는다. 20260902020000 과 똑같은 내용을 다시 못 박는다.
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) IS
  '검토 저장 + 제출(§7-2 제출 게이트). 상태 전이 전에 전 섹션 평가·조건부 의견·FTE 합계 100·배정 SME 본인·배정 유효(active)를 서버에서 재검증한다. 실패는 예외가 아니라 {ok:false, missing:[…]} 로 돌려준다(저장 롤백 방지). 전이가 성공하면 review_history 와 audit_logs 에 함께 남는다(REVIEW_SUBMITTED / REVIEW_RESUBMITTED).';

-- PostgREST 가 교체된 함수 정의를 바로 다시 읽게 한다. 시그니처는 그대로다.
NOTIFY pgrst, 'reload schema';
