/*
# SME 검토 저장 RPC (임시저장 · 최종 제출)

1. 목적
- 화면(클라이언트)이 수십 번 순차 await으로 저장하다가 중간에 실패해 DB가 절반만 바뀌는 문제를 막는다.
  검토 저장 전체를 Postgres 함수 한 번의 호출(= 하나의 트랜잭션)로 처리한다.

2. 보안
- 두 함수 모두 SECURITY INVOKER(기본값)다. SECURITY DEFINER를 쓰지 않는다.
  기존 RLS(job_feedback / task_feedback / skill_feedback / reviews의 소유자 정책)가 그대로 적용되므로
  본인 검토가 아니면 UPDATE가 0행이 되고 예외로 롤백된다.
- EXECUTE 권한은 authenticated에게만 부여한다.

3. 스키마 보정
- `job_feedback.section` CHECK에 수행요건 3개 섹션을 추가한다.
  화면(App.tsx)은 이미 `req-education` / `req-major` / `req-certifications` 항목을 받고 있는데
  저장할 곳이 없어 SME가 작성한 수행요건 검토가 통째로 사라지는 상태였다.
- `new_task_suggestions` / `new_skill_suggestions`에 소유자 DELETE 정책을 추가한다.
  제안은 "현재 목록 전체 교체" 방식(delete 후 insert)으로 저장하는데 SME에게 DELETE 정책이 없었다.

4. 데이터 안전
- 기존 행을 삭제하지 않는다. CHECK 제약은 허용 값을 넓히기만 한다(기존 NAME/DEFINITION 행은 그대로 유효).
*/

-- 1. job_feedback.section 확장
-- 제약 이름을 추측해 DROP IF EXISTS만 쓰면, 이름이 다를 때 조용히 넘어가고 옛 제약이 남아
-- REQ_* 저장이 계속 막힌다. section을 검사하는 CHECK 제약을 이름과 무관하게 찾아 지운다.
DO $mig$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'job_feedback'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%section%'
  LOOP
    EXECUTE format('ALTER TABLE public.job_feedback DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$mig$;

ALTER TABLE public.job_feedback ADD CONSTRAINT job_feedback_section_check
  CHECK (section IN ('NAME','DEFINITION','REQ_EDUCATION','REQ_MAJOR','REQ_CERTIFICATIONS'));

-- 2. 신규 제안 소유자 DELETE 정책
DROP POLICY IF EXISTS "suggestions_owner_delete" ON public.new_task_suggestions;
CREATE POLICY "suggestions_owner_delete" ON public.new_task_suggestions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reviews r
    JOIN public.review_assignments a ON a.id = r.assignment_id
    WHERE r.id = review_id AND a.sme_id = auth.uid()
  ));

DROP POLICY IF EXISTS "skill_suggestions_owner_delete" ON public.new_skill_suggestions;
CREATE POLICY "skill_suggestions_owner_delete" ON public.new_skill_suggestions FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.reviews r
    JOIN public.review_assignments a ON a.id = r.assignment_id
    WHERE r.id = review_id AND a.sme_id = auth.uid()
  ));

-- 3. 임시저장
/*
  p_job        : [{ "section": "NAME|DEFINITION|REQ_EDUCATION|REQ_MAJOR|REQ_CERTIFICATIONS",
                    "suitability": "SUITABLE|NEEDS_EDIT|UNSUITABLE" 또는 null,
                    "comment": "", "suggestion": "" }, ...]
  p_tasks      : [{ "task_id": uuid, "suitability": ..., "comment": "", "suggestion": "",
                    "delete_requested": false }, ...]
  p_skills     : [{ "skill_id": uuid, ... p_tasks와 동일 ... }, ...]
  p_new_tasks  : [{ "name": "", "description": "", "reason": "" }, ...]
  p_new_skills : [{ "name": "", "description": "", "reason": "" }, ...]

  피드백 3종은 upsert다. 화면은 "지금 화면에 있는 전체 상태"를 매번 보내야 한다.
  일부만 보내면 이전에 저장된 행이 그대로 남는다.
  신규 제안 2종은 전체 교체다.
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

  DELETE FROM public.new_task_suggestions WHERE review_id = p_review_id;
  INSERT INTO public.new_task_suggestions (review_id, name, description, reason)
  SELECT p_review_id, btrim(e->>'name'), COALESCE(e->>'description', ''), COALESCE(e->>'reason', '')
  FROM jsonb_array_elements(COALESCE(p_new_tasks, '[]'::jsonb)) e
  WHERE COALESCE(btrim(e->>'name'), '') <> '';

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

-- 4. 최종 제출
/*
  저장과 제출을 한 트랜잭션에서 처리한다. 피드백 인자를 넘기면 저장 후 제출하고, 비우면 제출만 한다.
  이미 제출된 검토는 status가 SUBMITTED/RESUBMITTED라 save_review_draft에서 먼저 막힌다.
  재검토 요청(REVIEW_REQUESTED) 후 다시 제출하면 RESUBMITTED가 된다.
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
BEGIN
  PERFORM public.save_review_draft(p_review_id, p_job, p_tasks, p_skills, p_new_tasks, p_new_skills);

  UPDATE public.reviews
  SET status = CASE WHEN submitted_at IS NOT NULL OR status = 'REVIEW_REQUESTED'
                    THEN 'RESUBMITTED' ELSE 'SUBMITTED' END,
      submitted_at = now(),
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
    'review_id', v_review.id,
    'status', v_review.status,
    'started_at', v_review.started_at,
    'last_saved_at', v_review.last_saved_at,
    'submitted_at', v_review.submitted_at
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_review_draft(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;

-- review_id 조회 인덱스는 따로 만들지 않는다.
-- unique(review_id, section) / (review_id, task_id) / (review_id, skill_id) 인덱스의 선두 컬럼이 이미 review_id다.
CREATE INDEX IF NOT EXISTS idx_new_task_suggestions_review ON public.new_task_suggestions(review_id);
CREATE INDEX IF NOT EXISTS idx_new_skill_suggestions_review ON public.new_skill_suggestions(review_id);
CREATE INDEX IF NOT EXISTS idx_review_history_review ON public.review_history(review_id);
