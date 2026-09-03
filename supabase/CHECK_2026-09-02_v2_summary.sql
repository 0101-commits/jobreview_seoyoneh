-- =====================================================================
--  Job Review v2 — Phase A·D·B·E 적용 여부 한눈에 보기 (읽기 전용)
--
--  Supabase SQL Editor(프로젝트 yktdlcpovntegiwfnied)에 그대로 붙여 실행한다.
--  4행이 나오고, 「적용됨」이 false인 Phase만 그 Phase의 APPLY 파일을 실행하면 된다.
--  자세한 항목별 판정이 필요하면 CHECK_2026-09-02_v2_phaseA/B/D/E.sql 을 따로 돌린다.
--
--  ※ 이 파일은 SELECT 뿐이다. 쓰기·DDL 없음.
-- =====================================================================
WITH fn AS (
  SELECT p.proname, p.pronargs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
),
col AS (
  SELECT c.relname, a.attname
    FROM pg_attribute a
    JOIN pg_class     c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT 'Phase A · 권한 축소 (profiles GRANT · request_rereview REVOKE)'::text AS "Phase",
       (    NOT has_column_privilege('authenticated', 'public.profiles', 'organization', 'UPDATE')
        AND NOT has_column_privilege('authenticated', 'public.profiles', 'email',        'UPDATE')
        AND NOT has_column_privilege('authenticated', 'public.profiles', 'title',        'UPDATE')
        AND     has_column_privilege('authenticated', 'public.profiles', 'name',         'UPDATE')) AS "적용됨",
       'APPLY_2026-09-02_v2_phaseA.sql'::text AS "미적용이면 실행할 파일"

UNION ALL SELECT 'Phase D · 이어하기 (reviews.last_step)',
       EXISTS (SELECT 1 FROM col WHERE relname = 'reviews' AND attname = 'last_step')
       AND has_column_privilege('authenticated', 'public.reviews', 'last_step', 'UPDATE'),
       'APPLY_2026-09-02_v2_phaseD.sql'

UNION ALL SELECT 'Phase B · FTE 연동 (client_key · activity_feedback · 8인자 RPC)',
       EXISTS (SELECT 1 FROM col WHERE relname = 'new_task_suggestions' AND attname = 'client_key')
       AND to_regclass('public.activity_feedback') IS NOT NULL
       AND (SELECT count(*) FROM fn WHERE proname = 'save_review_draft') = 1
       AND EXISTS (SELECT 1 FROM fn WHERE proname = 'save_review_draft' AND pronargs = 8)
       AND (SELECT count(*) FROM fn WHERE proname = 'submit_review') = 1,
       'APPLY_2026-09-02_v2_phaseB.sql'

UNION ALL SELECT 'Phase E · 감사 서버 이관 (save_org_units · link_sme_roster_audited)',
       EXISTS (SELECT 1 FROM fn WHERE proname = 'save_org_units')
       AND EXISTS (SELECT 1 FROM fn WHERE proname = 'link_sme_roster_audited'),
       'APPLY_2026-09-02_v2_phaseE.sql'

ORDER BY 1;
