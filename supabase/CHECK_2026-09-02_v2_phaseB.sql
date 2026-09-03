-- =====================================================================
-- Phase B (supabase/APPLY_2026-09-02_v2_phaseB.sql) 적용 여부 점검
-- 읽기 전용 SELECT 하나. 모든 행의 "적용됨"이 true 이면 적용 완료.
-- Supabase SQL Editor(기본 postgres 롤)에 그대로 붙여 실행한다.
-- =====================================================================
WITH fsave AS (
  SELECT p.oid,
         p.pronargs,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosrc,
         EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) x
            WHERE x.grantee = to_regrole('authenticated')::oid
              AND x.privilege_type = 'EXECUTE'
         ) AS exec_granted
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'save_review_draft'
),
fsubmit AS (
  SELECT p.oid,
         p.pronargs,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosrc,
         EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) x
            WHERE x.grantee = to_regrole('authenticated')::oid
              AND x.privilege_type = 'EXECUTE'
         ) AS exec_granted
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_review'
),
trg AS (
  SELECT t.tgname, c.relname, pr.proname AS fname, t.tgenabled,
         (t.tgtype::int &  1) =  1 AS is_row,
         (t.tgtype::int &  2) =  2 AS is_before,
         (t.tgtype::int &  8) =  8 AS on_delete,
         (t.tgtype::int & 16) = 16 AS on_update
    FROM pg_trigger t
    JOIN pg_class     c  ON c.oid  = t.tgrelid
    JOIN pg_namespace n  ON n.oid  = c.relnamespace
    JOIN pg_proc      pr ON pr.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND n.nspname = 'public'
),
chk(item, ok) AS (

  SELECT '01 컬럼 new_task_suggestions.client_key — uuid NOT NULL DEFAULT gen_random_uuid()'::text,
         EXISTS (
           SELECT 1
             FROM pg_attribute a
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = to_regclass('public.new_task_suggestions')::oid
              AND a.attname = 'client_key'
              AND NOT a.attisdropped
              AND a.atttypid = 'uuid'::regtype
              AND a.attnotnull
              AND pg_get_expr(d.adbin, d.adrelid) LIKE '%gen_random_uuid%')

  UNION ALL
  SELECT '02 인덱스 ux_new_task_sugg_review_client_key — UNIQUE (review_id, client_key)',
         EXISTS (
           SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE ic.relname = 'ux_new_task_sugg_review_client_key'
              AND i.indrelid = to_regclass('public.new_task_suggestions')::oid
              AND i.indisunique
              AND pg_get_indexdef(i.indexrelid) LIKE '%(review_id, client_key)%')

  UNION ALL
  SELECT '03 주석 COMMENT ON COLUMN new_task_suggestions.client_key (참고용)',
         EXISTS (
           SELECT 1 FROM pg_description de
             JOIN pg_attribute a ON a.attrelid = de.objoid AND a.attnum = de.objsubid
            WHERE de.classoid = 'pg_class'::regclass
              AND de.objoid = to_regclass('public.new_task_suggestions')::oid
              AND a.attname = 'client_key')

  UNION ALL
  SELECT '04 표 public.activity_feedback',
         to_regclass('public.activity_feedback') IS NOT NULL

  UNION ALL
  SELECT '05 activity_feedback 컬럼 7종 — id·review_id·activity_id·comment·delete_requested·created_at·updated_at',
         (SELECT count(DISTINCT a.attname) = 7
            FROM pg_attribute a
           WHERE a.attrelid = to_regclass('public.activity_feedback')::oid
             AND a.attnum > 0 AND NOT a.attisdropped
             AND a.attname IN ('id','review_id','activity_id','comment',
                               'delete_requested','created_at','updated_at'))

  UNION ALL
  SELECT '06 제약 activity_feedback PRIMARY KEY (id)',
         EXISTS (
           SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = to_regclass('public.activity_feedback')::oid
              AND c.contype = 'p'
              AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (id)')

  UNION ALL
  SELECT '07 제약 activity_feedback_unique — UNIQUE (review_id, activity_id)',
         EXISTS (
           SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = to_regclass('public.activity_feedback')::oid
              AND c.conname = 'activity_feedback_unique'
              AND c.contype = 'u'
              AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE%(review_id, activity_id)')

  UNION ALL
  SELECT '08 제약 FK activity_feedback.review_id → reviews(id) ON DELETE CASCADE',
         EXISTS (
           SELECT 1 FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.conrelid = to_regclass('public.activity_feedback')::oid
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 1
              AND a.attname = 'review_id'
              AND c.confrelid = to_regclass('public.reviews')::oid
              AND c.confdeltype = 'c')

  UNION ALL
  SELECT '09 제약 FK activity_feedback.activity_id → task_activities(id) ON DELETE CASCADE',
         EXISTS (
           SELECT 1 FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.conrelid = to_regclass('public.activity_feedback')::oid
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 1
              AND a.attname = 'activity_id'
              AND c.confrelid = to_regclass('public.task_activities')::oid
              AND c.confdeltype = 'c')

  UNION ALL
  SELECT '10 인덱스 idx_activity_feedback_review (review_id)',
         EXISTS (
           SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE ic.relname = 'idx_activity_feedback_review'
              AND i.indrelid = to_regclass('public.activity_feedback')::oid)

  UNION ALL
  SELECT '11 RLS 활성화 — activity_feedback',
         COALESCE((SELECT c.relrowsecurity FROM pg_class c
                    WHERE c.oid = to_regclass('public.activity_feedback')::oid), false)

  UNION ALL
  SELECT '12 정책 activity_feedback_access_select — SELECT · authenticated',
         EXISTS (
           SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'activity_feedback'
              AND policyname = 'activity_feedback_access_select'
              AND cmd = 'SELECT'
              AND 'authenticated' = ANY (roles))

  UNION ALL
  SELECT '13 정책 activity_feedback_owner_insert — INSERT · authenticated',
         EXISTS (
           SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'activity_feedback'
              AND policyname = 'activity_feedback_owner_insert'
              AND cmd = 'INSERT'
              AND 'authenticated' = ANY (roles))

  UNION ALL
  SELECT '14 정책 activity_feedback_owner_update — UPDATE · authenticated',
         EXISTS (
           SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'activity_feedback'
              AND policyname = 'activity_feedback_owner_update'
              AND cmd = 'UPDATE'
              AND 'authenticated' = ANY (roles))

  UNION ALL
  SELECT '15 정책 activity_feedback_admin_delete — DELETE · authenticated',
         EXISTS (
           SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'activity_feedback'
              AND policyname = 'activity_feedback_admin_delete'
              AND cmd = 'DELETE'
              AND 'authenticated' = ANY (roles))

  UNION ALL
  SELECT '16 주석 COMMENT ON TABLE activity_feedback (참고용)',
         obj_description(to_regclass('public.activity_feedback')::oid, 'pg_class') IS NOT NULL

  UNION ALL
  SELECT '17 save_review_draft 오버로드가 1개뿐',
         (SELECT count(*) FROM fsave) = 1

  UNION ALL
  SELECT '18 save_review_draft 8인자 시그니처 일치 (…, p_fte jsonb, p_activities jsonb)',
         EXISTS (
           SELECT 1 FROM fsave
            WHERE pronargs = 8
              AND args = 'p_review_id uuid, p_job jsonb, p_tasks jsonb, p_skills jsonb, p_new_tasks jsonb, p_new_skills jsonb, p_fte jsonb, p_activities jsonb')

  UNION ALL
  SELECT '19 save_review_draft 옛 6인자 오버로드 제거됨 (8인자가 있는 상태에서)',
         EXISTS (SELECT 1 FROM fsave WHERE pronargs = 8)
         AND NOT EXISTS (SELECT 1 FROM fsave WHERE pronargs = 6)

  UNION ALL
  SELECT '20 save_review_draft 본문 — client_key · activity_feedback · task_fte_allocations',
         EXISTS (
           SELECT 1 FROM fsave
            WHERE pronargs = 8
              AND prosrc LIKE '%client_key%'
              AND prosrc LIKE '%activity_feedback%'
              AND prosrc LIKE '%task_fte_allocations%')

  UNION ALL
  SELECT '21 GRANT EXECUTE save_review_draft(8인자) → authenticated',
         COALESCE((SELECT bool_or(exec_granted) FROM fsave WHERE pronargs = 8), false)

  UNION ALL
  SELECT '22 submit_review 오버로드가 1개뿐',
         (SELECT count(*) FROM fsubmit) = 1

  UNION ALL
  SELECT '23 submit_review 9인자 시그니처 일치 (…, p_note text, p_fte jsonb, p_activities jsonb)',
         EXISTS (
           SELECT 1 FROM fsubmit
            WHERE pronargs = 9
              AND args = 'p_review_id uuid, p_job jsonb, p_tasks jsonb, p_skills jsonb, p_new_tasks jsonb, p_new_skills jsonb, p_note text, p_fte jsonb, p_activities jsonb')

  UNION ALL
  SELECT '24 submit_review 옛 7인자 오버로드 제거됨 (9인자가 있는 상태에서)',
         EXISTS (SELECT 1 FROM fsubmit WHERE pronargs = 9)
         AND NOT EXISTS (SELECT 1 FROM fsubmit WHERE pronargs = 7)

  UNION ALL
  SELECT '25 submit_review 본문 — save_review_draft 에 p_fte·p_activities 전달',
         EXISTS (
           SELECT 1 FROM fsubmit
            WHERE pronargs = 9
              AND prosrc LIKE '%save_review_draft%'
              AND prosrc LIKE '%p_fte, p_activities%')

  UNION ALL
  SELECT '26 GRANT EXECUTE submit_review(9인자) → authenticated',
         COALESCE((SELECT bool_or(exec_granted) FROM fsubmit WHERE pronargs = 9), false)

  UNION ALL
  SELECT '27 함수 job_has_open_review(uuid) — STABLE · SECURITY DEFINER · SET search_path=public',
         EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'job_has_open_review'
              AND p.pronargs = 1
              AND p.proargtypes[0] = 'uuid'::regtype
              AND p.prosecdef
              AND p.provolatile = 's'
              AND p.proconfig @> ARRAY['search_path=public'])

  UNION ALL
  SELECT '28 함수 guard_job_structure_lock() RETURNS trigger',
         EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'guard_job_structure_lock'
              AND p.pronargs = 0
              AND p.prorettype = 'trigger'::regtype)

  UNION ALL
  SELECT '29 트리거 trg_job_tasks_structure_lock — job_tasks BEFORE UPDATE/DELETE FOR EACH ROW',
         EXISTS (
           SELECT 1 FROM trg
            WHERE tgname = 'trg_job_tasks_structure_lock'
              AND relname = 'job_tasks'
              AND fname = 'guard_job_structure_lock'
              AND is_row AND is_before AND on_delete AND on_update
              AND tgenabled = 'O')

  UNION ALL
  SELECT '30 트리거 trg_job_skills_structure_lock — job_skills BEFORE UPDATE/DELETE FOR EACH ROW',
         EXISTS (
           SELECT 1 FROM trg
            WHERE tgname = 'trg_job_skills_structure_lock'
              AND relname = 'job_skills'
              AND fname = 'guard_job_structure_lock'
              AND is_row AND is_before AND on_delete AND on_update
              AND tgenabled = 'O')

  UNION ALL
  SELECT '31 트리거 trg_task_activities_structure_lock — task_activities BEFORE UPDATE/DELETE FOR EACH ROW',
         EXISTS (
           SELECT 1 FROM trg
            WHERE tgname = 'trg_task_activities_structure_lock'
              AND relname = 'task_activities'
              AND fname = 'guard_job_structure_lock'
              AND is_row AND is_before AND on_delete AND on_update
              AND tgenabled = 'O')

  UNION ALL
  SELECT '32 [Phase B 문 아님·Supabase 기본권한] new_task_suggestions.client_key SELECT/INSERT/UPDATE → authenticated',
         (SELECT count(DISTINCT cp.privilege_type) = 3
            FROM information_schema.column_privileges cp
           WHERE cp.table_schema = 'public'
             AND cp.table_name = 'new_task_suggestions'
             AND cp.column_name = 'client_key'
             AND cp.grantee = 'authenticated'
             AND cp.privilege_type IN ('SELECT','INSERT','UPDATE'))

  UNION ALL
  SELECT '33 [Phase B 문 아님·Supabase 기본권한] activity_feedback 전 컬럼 SELECT/INSERT/UPDATE → authenticated',
         to_regclass('public.activity_feedback') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM pg_attribute a
             CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE')) v(pv)
            WHERE a.attrelid = to_regclass('public.activity_feedback')::oid
              AND a.attnum > 0 AND NOT a.attisdropped
              AND NOT EXISTS (
                SELECT 1 FROM information_schema.column_privileges cp
                 WHERE cp.table_schema = 'public'
                   AND cp.table_name = 'activity_feedback'
                   AND cp.column_name = a.attname
                   AND cp.grantee = 'authenticated'
                   AND cp.privilege_type = v.pv))

  UNION ALL
  SELECT '34 [Phase B 문 아님·Supabase 기본권한] activity_feedback DELETE → authenticated (관리자 삭제 정책 전제)',
         EXISTS (
           SELECT 1 FROM information_schema.table_privileges tp
            WHERE tp.table_schema = 'public'
              AND tp.table_name = 'activity_feedback'
              AND tp.grantee = 'authenticated'
              AND tp.privilege_type = 'DELETE')
)
SELECT item AS "항목", ok AS "적용됨" FROM chk
UNION ALL
SELECT '99 ▣ 종합 — 위 항목 전부 true 여야 적용 완료', bool_and(ok) FROM chk
ORDER BY 1;
