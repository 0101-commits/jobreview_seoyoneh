/* =====================================================================
   Job Review — 2026-09-02 v2 Phase B(FTE 연동) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260902050000_v2_phaseB_fte_link.sql 한 벌.
       ⓐ new_task_suggestions.client_key + (review_id, client_key) 유일 인덱스
       ⓑ activity_feedback 표 + RLS 4정책 (결정 D2)
       ⓒ save_review_draft — client_key upsert · p_fte 원자 저장 · p_activities (시그니처 변경)
       ⓓ submit_review — p_fte · p_activities 전달 (시그니처 변경)
       ⓔ 진행 중 검토가 있는 직무의 구조 편집 잠금 트리거 3개 (F6 · D7)

   ▣ 순서가 중요하다
     ⓒⓓ는 기존 함수를 DROP한 뒤 다시 만든다. 적용 도중 몇 초간 두 함수가 모두 없는 구간이
     생기므로, 사용자가 적은 시간대에 적용한다. 적용이 끝나면 옛 화면(6인자 호출)은 더 이상
     맞는 함수를 찾지 못하므로 화면 배포와 함께 적용한다.

   ▣ 적용 후 확인
     · SELECT client_key FROM new_task_suggestions LIMIT 1;            → 값이 있어야 한다
     · SELECT count(*) FROM pg_proc WHERE proname='save_review_draft'; → 1이어야 한다
     · SELECT count(*) FROM pg_proc WHERE proname='submit_review';     → 1이어야 한다
     · 검토 진행 중 직무의 과업을 UPDATE ... SET active=false          → 42501이어야 한다

   ▣ 되돌리기
     트리거 3개는 DROP TRIGGER로 즉시 끌 수 있다. 함수는 20260902020000·20260901030000의
     정의를 다시 실행하면 옛 시그니처로 돌아간다(그때는 화면도 함께 되돌려야 한다).
   ===================================================================== */

/*
  v2 Phase B — FTE 연동 데이터 계약 (기획안 dcab2660 §5-4 · §8 Phase B)

  ▣ 왜
    STEP 3의 신규 제안 배분이 "이름 문자열"로 화면과 DB를 잇고 있었다(F5).
      · 제안 이름을 고치면 그 배분이 사라졌다(이름이 키였다).
      · 같은 이름 두 줄은 한 줄만 배분됐다(DISTINCT ON (name)).
      · 배분 저장이 delete → insert 두 왕복이라(surveyApi.saveFteAllocations) 자동저장 도중
        순단이 나면 배분 0행 상태가 남았다 — 화면은 여전히 100%였다.

  ▣ 무엇을
    1) new_task_suggestions.client_key uuid — 화면이 만드는 안정 키. (review_id, client_key) 유일.
    2) save_review_draft(…, p_fte, p_activities) — 제안 upsert를 client_key 기준으로 바꾸고,
       FTE 배분 저장을 같은 트랜잭션 안으로 들인다. p_fte가 NULL이면 배분을 건드리지 않는다
       (배분과 무관한 저장이 배분을 지우지 않게 하는 안전판).
    3) activity_feedback — 세부활동 줄 단위 의견·삭제 제안(결정 D2 ⓑ).
       배분 단위는 바꾸지 않는다: FTE는 과업 단위 그대로다(계약 E3 · 착수보고 11면).
    4) submit_review(…, p_fte, p_activities) — 저장을 위임하므로 인자만 그대로 넘긴다.

  ▣ 함수 시그니처가 바뀐다 — 기존 함수를 DROP한 뒤 만든다
    인자를 더하면 CREATE OR REPLACE가 아니라 새 오버로드가 생긴다. 두 개가 함께 있으면
    PostgREST의 명명 인자 호출이 "function is not unique"로 실패한다. 그래서 옛 시그니처를
    먼저 DROP한다. 함수 본문은 PostgreSQL이 의존성으로 추적하지 않으므로 DROP은 안전하다.

  ▣ 적용
    supabase/APPLY_2026-09-02_v2_phaseB.sql 를 SQL Editor에서 실행한다.
    화면(v2 Phase B 코드)이 p_fte를 보내기 전에 적용해도 무해하다 — 옛 화면은 p_fte를 보내지
    않으므로 배분 저장은 그대로 클라이언트 경로를 탄다.
*/

-- ── 1. 신규 과업 제안의 안정 키 ─────────────────────────────────────
ALTER TABLE public.new_task_suggestions
  ADD COLUMN IF NOT EXISTS client_key uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.new_task_suggestions.client_key IS
  '화면이 만드는 안정 키(v2 F5). 이름이 아니라 이 값으로 제안을 맞춘다 — 이름을 고쳐도 FTE 배분이 유지된다.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_new_task_sugg_review_client_key
  ON public.new_task_suggestions (review_id, client_key);

-- ── 2. 세부활동 의견 (결정 D2 ⓑ) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.task_activities(id) ON DELETE CASCADE,
  comment text NOT NULL DEFAULT '',
  delete_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_feedback_unique UNIQUE (review_id, activity_id)
);

COMMENT ON TABLE public.activity_feedback IS
  '세부활동 줄 단위 의견·삭제 제안(v2 D2). 적합성은 받지 않는다 — 평가 단위는 과업이고, 배분 단위도 과업이다.';

CREATE INDEX IF NOT EXISTS idx_activity_feedback_review ON public.activity_feedback (review_id);

ALTER TABLE public.activity_feedback ENABLE ROW LEVEL SECURITY;

-- 정책은 task_feedback과 같은 모양이다(20260812084909) — 본인 검토 + 관리자 읽기.
DROP POLICY IF EXISTS "activity_feedback_access_select" ON public.activity_feedback;
CREATE POLICY "activity_feedback_access_select" ON public.activity_feedback FOR SELECT
  TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.reviews r
        JOIN public.review_assignments a ON a.id = r.assignment_id
       WHERE r.id = review_id AND a.sme_id = auth.uid()));

DROP POLICY IF EXISTS "activity_feedback_owner_insert" ON public.activity_feedback;
CREATE POLICY "activity_feedback_owner_insert" ON public.activity_feedback FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reviews r
        JOIN public.review_assignments a ON a.id = r.assignment_id
       WHERE r.id = review_id AND a.sme_id = auth.uid()));

DROP POLICY IF EXISTS "activity_feedback_owner_update" ON public.activity_feedback;
CREATE POLICY "activity_feedback_owner_update" ON public.activity_feedback FOR UPDATE
  TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.reviews r
        JOIN public.review_assignments a ON a.id = r.assignment_id
       WHERE r.id = review_id AND a.sme_id = auth.uid()))
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.reviews r
        JOIN public.review_assignments a ON a.id = r.assignment_id
       WHERE r.id = review_id AND a.sme_id = auth.uid()));

DROP POLICY IF EXISTS "activity_feedback_admin_delete" ON public.activity_feedback;
CREATE POLICY "activity_feedback_admin_delete" ON public.activity_feedback FOR DELETE
  TO authenticated USING (public.is_admin());

-- ── 3. save_review_draft — client_key upsert + FTE 원자 저장 ────────
DROP FUNCTION IF EXISTS public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.save_review_draft(
  p_review_id uuid,
  p_job jsonb DEFAULT '[]'::jsonb,
  p_tasks jsonb DEFAULT '[]'::jsonb,
  p_skills jsonb DEFAULT '[]'::jsonb,
  p_new_tasks jsonb DEFAULT '[]'::jsonb,
  p_new_skills jsonb DEFAULT '[]'::jsonb,
  -- NULL = "배분은 이 저장의 대상이 아니다". '[]'는 "배분을 전부 지운다"와 같다.
  p_fte jsonb DEFAULT NULL,
  p_activities jsonb DEFAULT '[]'::jsonb
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

  -- 세부활동 의견(D2). 화면이 매번 전체 상태를 보내므로 목록에서 사라진 줄은 지운다.
  -- 빈 의견 + 삭제 제안 없음은 화면이 애초에 보내지 않는다(빈 행을 만들지 않는다).
  DELETE FROM public.activity_feedback af
   WHERE af.review_id = p_review_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(p_activities, '[]'::jsonb)) e
        WHERE NULLIF(e->>'activity_id','')::uuid = af.activity_id);

  INSERT INTO public.activity_feedback (review_id, activity_id, comment, delete_requested)
  SELECT p_review_id,
         (e->>'activity_id')::uuid,
         COALESCE(e->>'comment', ''),
         COALESCE((e->>'delete_requested')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_activities, '[]'::jsonb)) e
  WHERE COALESCE(e->>'activity_id', '') <> ''
  ON CONFLICT (review_id, activity_id) DO UPDATE
    SET comment = EXCLUDED.comment,
        delete_requested = EXCLUDED.delete_requested,
        updated_at = now();

  /*
    신규 과업 제안: client_key 기준 맞춤(v2 F5).
    옛 화면은 client_key를 보내지 않는다. 그때는 같은 이름의 기존 행에서 키를 물려받고,
    그것도 없으면 새 키를 만든다 — 옛 화면에서도 저장이 깨지지 않게 하려는 폴백이다.
    이름은 더 이상 키가 아니므로 같은 이름 두 줄이 각각 저장되고 각각 배분된다.
  */
  WITH raw AS (
    SELECT btrim(e->>'name') AS name,
           COALESCE(e->>'description', '') AS description,
           COALESCE(e->>'reason', '') AS reason,
           NULLIF(e->>'client_key', '')::uuid AS client_key
      FROM jsonb_array_elements(COALESCE(p_new_tasks, '[]'::jsonb)) e
     WHERE COALESCE(btrim(e->>'name'), '') <> ''
  ),
  keyed AS (
    SELECT r.name, r.description, r.reason,
           COALESCE(
             r.client_key,
             (SELECT s.client_key FROM public.new_task_suggestions s
               WHERE s.review_id = p_review_id AND s.name = r.name
               LIMIT 1),
             gen_random_uuid()) AS client_key
      FROM raw r
  ),
  incoming AS (
    SELECT DISTINCT ON (client_key) client_key, name, description, reason FROM keyed
  ),
  removed AS (
    DELETE FROM public.new_task_suggestions s
     WHERE s.review_id = p_review_id
       AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.client_key = s.client_key)
  ),
  updated AS (
    UPDATE public.new_task_suggestions s
       SET name = i.name,
           description = i.description,
           reason = i.reason
      FROM incoming i
     WHERE s.review_id = p_review_id
       AND s.client_key = i.client_key
  )
  INSERT INTO public.new_task_suggestions (review_id, client_key, name, description, reason)
  SELECT p_review_id, i.client_key, i.name, i.description, i.reason
    FROM incoming i
   WHERE NOT EXISTS (SELECT 1 FROM public.new_task_suggestions s
                      WHERE s.review_id = p_review_id AND s.client_key = i.client_key);

  -- 신규 Skill 제안은 이 id 를 참조하는 표가 없으므로 옛 방식(전체 교체) 그대로 둔다.
  DELETE FROM public.new_skill_suggestions WHERE review_id = p_review_id;
  INSERT INTO public.new_skill_suggestions (review_id, name, description, reason)
  SELECT p_review_id, btrim(e->>'name'), COALESCE(e->>'description', ''), COALESCE(e->>'reason', '')
  FROM jsonb_array_elements(COALESCE(p_new_skills, '[]'::jsonb)) e
  WHERE COALESCE(btrim(e->>'name'), '') <> '';

  /*
    투입 비중(FTE) — 제안 저장 뒤에 온다. 방금 만든 제안의 id를 client_key로 풀 수 있어야 한다.
    같은 함수(같은 트랜잭션) 안이라 "delete만 성공하고 insert가 실패한" 중간 상태가 남지 않는다(F5).
    화면은 언제나 전체 배분을 보낸다 — 일부만 보내면 삭제 제안한 과업의 옛 비중이 남아
    서버 합계만 100%를 넘긴다.
  */
  IF p_fte IS NOT NULL THEN
    DELETE FROM public.task_fte_allocations WHERE review_id = p_review_id;

    -- 기존 과업. 이 직무의 과업이 아닌 id는 RLS(fte_owner_insert)가 막는다.
    INSERT INTO public.task_fte_allocations (review_id, target_type, task_id, suggestion_id, pct)
    SELECT p_review_id,
           'EXISTING',
           (e->>'task_id')::uuid,
           NULL,
           least(100, greatest(0, round(COALESCE((e->>'pct')::numeric, 0), 2)))
      FROM jsonb_array_elements(p_fte) e
     WHERE COALESCE(e->>'target_type', 'EXISTING') = 'EXISTING'
       AND COALESCE(e->>'task_id', '') <> '';

    -- 신규 제안. client_key → id를 서버가 푼다(화면은 DB id를 몰라도 된다).
    INSERT INTO public.task_fte_allocations (review_id, target_type, task_id, suggestion_id, pct)
    SELECT p_review_id,
           'SUGGESTED',
           NULL,
           s.id,
           least(100, greatest(0, round(COALESCE((e->>'pct')::numeric, 0), 2)))
      FROM jsonb_array_elements(p_fte) e
      JOIN public.new_task_suggestions s
        ON s.review_id = p_review_id
       AND s.client_key = NULLIF(e->>'client_key', '')::uuid
     WHERE COALESCE(e->>'target_type', '') = 'SUGGESTED';
  END IF;

  RETURN jsonb_build_object(
    'review_id', v_review.id,
    'status', v_review.status,
    'started_at', v_review.started_at,
    'last_saved_at', v_review.last_saved_at,
    'submitted_at', v_review.submitted_at
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;

-- ── 4. submit_review — 인자만 넘긴다 ───────────────────────────────
/*
  20260902020000_followup_audit_coverage.sql 의 정의와 같고 두 곳만 다르다.
    · 인자에 p_fte · p_activities 추가
    · save_review_draft 호출에 그 둘을 전달
  게이트 5종·감사 기록·상태 전이는 한 줄도 바뀌지 않았다.
*/
DROP FUNCTION IF EXISTS public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION public.submit_review(
  p_review_id uuid,
  p_job jsonb DEFAULT '[]'::jsonb,
  p_tasks jsonb DEFAULT '[]'::jsonb,
  p_skills jsonb DEFAULT '[]'::jsonb,
  p_new_tasks jsonb DEFAULT '[]'::jsonb,
  p_new_skills jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT '',
  p_fte jsonb DEFAULT NULL,
  p_activities jsonb DEFAULT '[]'::jsonb
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
  PERFORM set_config('app.trusted_rpc', '1', true);

  -- ④ 호출자 = 배정 SME 본인.
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
  -- 배분까지 이 호출에 실려 오므로(v2 F5) 제출 직전 클라이언트 왕복이 하나 줄었다.
  PERFORM public.save_review_draft(
    p_review_id, p_job, p_tasks, p_skills, p_new_tasks, p_new_skills, p_fte, p_activities);

  -- ③ FTE 합계 = 100.00
  SELECT COALESCE(
           (SELECT s.fte_required FROM public.survey_settings s WHERE s.company_id = v_company_id),
           false)
    INTO v_fte_required;

  IF v_fte_required THEN
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
  WITH job_sections(section, step, ord, label) AS (
    VALUES ('NAME'::text,          1, 1, '직무명'::text),
           ('DEFINITION',          1, 2, '직무정의'),
           ('REQ_EDUCATION',       4, 2, '수행요건 · 학력'),
           ('REQ_MAJOR',           4, 3, '수행요건 · 전공'),
           ('REQ_CERTIFICATIONS',  4, 4, '수행요건 · 자격증')
  ),
  rated(step, ord, entity, name, unrated) AS (
    SELECT s.step, s.ord, 'JOB', s.label, (NULLIF(f.suitability, '') IS NULL)
      FROM job_sections s
      LEFT JOIN public.job_feedback f
             ON f.review_id = p_review_id AND f.section = s.section
     WHERE NULLIF(f.suitability, '') IS NULL
        OR (f.suitability <> 'SUITABLE'
            AND btrim(COALESCE(f.comment, '')) = ''
            AND btrim(COALESCE(f.suggestion, '')) = '')
    UNION ALL
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
      SELECT 3, 0, ''::text, v_fte_item WHERE v_fte_item IS NOT NULL
    ) p;

  IF jsonb_array_length(v_missing) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'missing', v_missing);
  END IF;

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

GRANT EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb, jsonb) TO authenticated;

-- ── 5. 진행 중 검토가 있는 직무의 구조 편집 잠금 (v2 F6 · 결정 D7) ──
/*
  관리자가 검토 진행 중에 직무를 편집하면 과업·Skill이 active=false로 내려가고,
  그 순간 SME 응답의 참조가 끊긴다.
    · 제출 게이트는 "활성 과업 전부"의 평가를 요구한다 → 과업이 늘면 제출이 막히고,
    · 배분 합계는 활성 과업 기준이라 과업이 내려가면 100%가 깨진다.
  화면에는 경고만 있었다(JobDetailPage). 여기서 서버가 같은 조건을 다시 본다.

  막는 것은 "구조를 없애는 변경"뿐이다 — 비활성화와 삭제. 이름·설명·정의 수정은 그대로 허용한다
  (문구 교정까지 막으면 오탈자 하나 때문에 재업로드를 해야 한다).
  NOT_STARTED 검토만 있는 직무는 잠기지 않는다: 아직 아무 응답도 이 과업을 가리키지 않는다.
*/
CREATE OR REPLACE FUNCTION public.job_has_open_review(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.reviews r
      JOIN public.review_assignments a ON a.id = r.assignment_id
     WHERE a.job_id = p_job_id
       AND a.active
       AND r.status IN ('IN_PROGRESS','REVIEW_REQUESTED','SUBMITTED','RESUBMITTED')
  );
$$;

COMMENT ON FUNCTION public.job_has_open_review(uuid) IS
  '이 직무에 응답이 걸린 검토가 있는가(v2 F6). NOT_STARTED는 제외 — 아직 아무 응답도 참조하지 않는다.';

CREATE OR REPLACE FUNCTION public.guard_job_structure_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_task_id uuid;
  v_removing boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_removing := true;
  ELSE
    -- 활성 → 비활성 전이만 본다. 다시 켜는 것과 문구 수정은 통과다.
    v_removing := (OLD.active IS TRUE AND NEW.active IS NOT TRUE);
  END IF;

  -- 여기 오는 것은 UPDATE 뿐이다 — DELETE는 위에서 항상 v_removing = true다.
  IF NOT v_removing THEN
    RETURN NEW;
  END IF;

  /*
    NEW·OLD는 record라 COALESCE(NEW, OLD)로 묶을 수 없고, 함수 호출 결과에서 필드를 바로
    뽑는 문법도 없다 — 처음 판은 COALESCE(NEW, OLD).job_id 라고 써서 CREATE FUNCTION 자체가
    42601(syntax error at or near ".")로 실패했다. TG_OP로 갈라 각각 읽는다.
  */
  IF TG_TABLE_NAME = 'task_activities' THEN
    IF TG_OP = 'DELETE' THEN v_task_id := OLD.job_task_id; ELSE v_task_id := NEW.job_task_id; END IF;
    SELECT t.job_id INTO v_job_id FROM public.job_tasks t WHERE t.id = v_task_id;
  ELSE
    -- job_tasks · job_skills 는 job_id를 직접 들고 있다.
    IF TG_OP = 'DELETE' THEN v_job_id := OLD.job_id; ELSE v_job_id := NEW.job_id; END IF;
  END IF;

  IF v_job_id IS NOT NULL AND public.job_has_open_review(v_job_id) THEN
    RAISE EXCEPTION '이 직무는 검토가 진행 중이라 과업·Skill 구조를 바꿀 수 없습니다. 문구·정의 수정은 가능하며, 구조 변경은 검토가 끝난 뒤 재업로드로 해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  -- BEFORE 트리거라 DELETE에서 NEW(=NULL)를 돌려주면 삭제가 취소된다. 반드시 갈라 돌려준다.
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_tasks_structure_lock ON public.job_tasks;
CREATE TRIGGER trg_job_tasks_structure_lock
  BEFORE UPDATE OR DELETE ON public.job_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_structure_lock();

DROP TRIGGER IF EXISTS trg_job_skills_structure_lock ON public.job_skills;
CREATE TRIGGER trg_job_skills_structure_lock
  BEFORE UPDATE OR DELETE ON public.job_skills
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_structure_lock();

DROP TRIGGER IF EXISTS trg_task_activities_structure_lock ON public.task_activities;
CREATE TRIGGER trg_task_activities_structure_lock
  BEFORE UPDATE OR DELETE ON public.task_activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_job_structure_lock();
