-- ============================================================
-- Job Review v2 Phase A 적용 여부 판별 (읽기 전용)
--   대상: supabase/APPLY_2026-09-02_v2_phaseA.sql
--         = supabase/migrations/20260902040000_v2_phaseA_recovery.sql
--   판정: 아래 18행(A-01~A-18)이 모두 적용됨=true 이면 적용 완료.
--         하나라도 false 면 그 항목이 미적용(부분 적용).
--   주의: A-13·A-14 는 함수 존재·시그니처 확인이라 미적용 DB 에서도 true 다.
--         개별 행이 아니라 18행 전부 true 일 때만 '적용 완료'로 읽는다.
-- ============================================================
WITH cp AS (
  -- profiles 에 대해 authenticated 가 가진 UPDATE 권한 컬럼 (테이블단위 GRANT 도 컬럼으로 펼쳐져 보인다)
  -- 이 뷰는 '현재 활성화된 롤(grantor 또는 grantee)' 기준으로만 행을 보여준다.
  -- 그래서 개수 판정(A-07)과 유효권한 교차확인(A-08·A-09)은 has_column_privilege 로 따로 본다.
  SELECT DISTINCT column_name
  FROM information_schema.column_privileges
  WHERE table_schema     = 'public'
    AND table_name       = 'profiles'
    AND grantee          = 'authenticated'
    AND privilege_type   = 'UPDATE'
),
pa AS (
  -- profiles 의 살아 있는 사용자 컬럼 (뷰 가시성과 무관한 카탈로그 원본)
  SELECT a.attrelid, a.attnum, a.attname
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.profiles')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
cc AS (
  -- profiles 컬럼 주석
  SELECT a.attname, col_description(a.attrelid, a.attnum) AS cmt
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.profiles')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
f AS (
  -- public.request_rereview 오버로드 전체
  SELECT p.oid,
         pg_get_function_identity_arguments(p.oid)          AS ident_args,
         p.pronargs,
         p.proargnames,
         COALESCE(p.proacl, acldefault('f', p.proowner))    AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'request_rereview'
),
rr AS (
  -- authenticated · anon 에 더해 PUBLIC(oid 0) 도 후보로 둔다.
  -- PUBLIC 에 EXECUTE 가 남아 있으면 authenticated 는 그대로 실행할 수 있다.
  SELECT oid FROM pg_roles WHERE rolname IN ('authenticated', 'anon')
  UNION ALL
  SELECT 0::oid
)
SELECT 'A-01 profiles.name UPDATE 유지 (authenticated)'::text AS 항목,
       EXISTS (SELECT 1 FROM cp WHERE column_name = 'name')    AS 적용됨
UNION ALL SELECT 'A-02 profiles.must_change_password UPDATE 유지',
       EXISTS (SELECT 1 FROM cp WHERE column_name = 'must_change_password')
UNION ALL SELECT 'A-03 profiles.guide_completed_at UPDATE 유지',
       EXISTS (SELECT 1 FROM cp WHERE column_name = 'guide_completed_at')
UNION ALL SELECT 'A-04 profiles.email UPDATE 회수 (S1)',
       NOT EXISTS (SELECT 1 FROM cp WHERE column_name = 'email')
UNION ALL SELECT 'A-05 profiles.organization UPDATE 회수 (S1)',
       NOT EXISTS (SELECT 1 FROM cp WHERE column_name = 'organization')
UNION ALL SELECT 'A-06 profiles.title UPDATE 회수 (S1)',
       NOT EXISTS (SELECT 1 FROM cp WHERE column_name = 'title')
UNION ALL SELECT 'A-07 profiles UPDATE 허용 컬럼이 정확히 3개 (테이블단위 GRANT 잔존 없음 · 유효권한 전수)',
       -- information_schema 가시성에 기대지 않고 카탈로그 전 컬럼을 유효권한으로 센다.
       -- 테이블단위 GRANT 가 남아 있으면 여기서 컬럼 수만큼 세어져 즉시 false 가 된다.
       (SELECT count(*) FROM pa
         WHERE has_column_privilege('authenticated', pa.attrelid, pa.attnum, 'UPDATE')) = 3
UNION ALL SELECT 'A-08 유효권한 교차확인 — email/organization/title 모두 UPDATE 불가',
       (    NOT has_column_privilege('authenticated', 'public.profiles', 'email',        'UPDATE')
        AND NOT has_column_privilege('authenticated', 'public.profiles', 'organization', 'UPDATE')
        AND NOT has_column_privilege('authenticated', 'public.profiles', 'title',        'UPDATE'))
UNION ALL SELECT 'A-09 유효권한 교차확인 — name/must_change_password/guide_completed_at 모두 UPDATE 가능',
       (    has_column_privilege('authenticated', 'public.profiles', 'name',                 'UPDATE')
        AND has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE')
        AND has_column_privilege('authenticated', 'public.profiles', 'guide_completed_at',   'UPDATE'))
UNION ALL SELECT 'A-10 COMMENT profiles.email 에 v2 S1 표기',
       COALESCE((SELECT cmt FROM cc WHERE attname = 'email') LIKE '%v2 S1%', false)
UNION ALL SELECT 'A-11 COMMENT profiles.organization 에 v2 S1 표기',
       COALESCE((SELECT cmt FROM cc WHERE attname = 'organization') LIKE '%v2 S1%', false)
UNION ALL SELECT 'A-12 COMMENT profiles.title 에 v2 S1 표기',
       COALESCE((SELECT cmt FROM cc WHERE attname = 'title') LIKE '%v2 S1%', false)
UNION ALL SELECT 'A-13 request_rereview 존재 · 오버로드 정확히 1개 (전제 확인 — 미적용 DB 에서도 true)',
       (SELECT count(*) FROM f) = 1
UNION ALL SELECT 'A-14 request_rereview 시그니처 (uuid, text) · IN 인자 2개 (p_review_id, p_note) (전제 확인)',
       (SELECT count(*) FROM f
         WHERE pronargs = 2
           AND proargnames[1:2] = ARRAY['p_review_id', 'p_note']
           AND ident_args ~* '^(p_review_id )?uuid, (p_note )?text$') = 1
UNION ALL SELECT 'A-15 request_rereview EXECUTE — authenticated 실행 불가 (F8, 유효권한 · PUBLIC 경유 포함)',
       EXISTS (SELECT 1 FROM f)
       AND NOT EXISTS (SELECT 1 FROM f WHERE has_function_privilege('authenticated', f.oid, 'EXECUTE'))
UNION ALL SELECT 'A-16 request_rereview EXECUTE — anon 실행 불가 (F8, 유효권한 · PUBLIC 경유 포함)',
       EXISTS (SELECT 1 FROM f)
       AND NOT EXISTS (SELECT 1 FROM f WHERE has_function_privilege('anon', f.oid, 'EXECUTE'))
UNION ALL SELECT 'A-17 request_rereview ACL 에 authenticated/anon/PUBLIC EXECUTE GRANT 없음',
       EXISTS (SELECT 1 FROM f)
       AND NOT EXISTS (
             SELECT 1
             FROM f, aclexplode(f.acl) x
             WHERE x.privilege_type = 'EXECUTE'
               AND x.grantee IN (SELECT oid FROM rr))
UNION ALL SELECT 'A-18 COMMENT request_rereview 에 v2 F8(사용 중지) 표기',
       EXISTS (SELECT 1 FROM f
                WHERE COALESCE(obj_description(f.oid, 'pg_proc'), '') LIKE '%v2 F8%')
ORDER BY 1;
