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
