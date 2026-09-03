-- Job Review v2 Phase D 적용 여부 판별 (읽기 전용, SELECT 만)
-- 대상: supabase/APPLY_2026-09-02_v2_phaseD.sql (= migrations/20260902060000_v2_phaseD_last_step.sql)
-- 6개 행이 모두 적용됨=true 면 이 Phase 는 운영 DB에 완전히 적용된 상태다.
--
-- [수정 이유 1] 원래 5번이 쓰던 information_schema.column_privileges 는 항상 true 인 오탐이었다.
--   그 뷰는 pg_class.relacl(= 테이블 단위 GRANT)을 모든 컬럼으로 펼친 행까지 UNION 해서 내놓는다.
--   이 프로젝트는 Supabase 기본 권한(ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO authenticated)이
--   그대로 살아 있고(20260901010000 91행 참조) public.reviews 에는 REVOKE 를 건 적이 없다
--   (그 마이그레이션이 회수한 것은 audit_logs 와 profiles 뿐이다).
--   따라서 GRANT UPDATE (last_step) 을 한 번도 실행하지 않아도 그 뷰에는 UPDATE 행이 보인다.
--   컬럼 단위 GRANT 는 pg_attribute.attacl 에만 기록되므로 5·6번은 attacl 로 직접 본다.
--   덤으로 그 뷰의 pg_has_role 가시성 필터에 따른 반대 방향 오작동(소유자가 아닌 롤로 돌리면
--   적용됐는데도 false)도 함께 사라진다.
-- [수정 이유 2] 1번도 information_schema.columns(현재 롤이 권한을 가진 표만 보인다) 대신
--   pg_attribute 를 직접 본다 — 실행 롤에 의존하지 않는다.
-- [수정 이유 3] 4번이 `last_step IS NULL OR` (NULL 허용)를 검증하지 않고 비교 대상이 last_step
--   인지도 보지 않았다. 괄호까지 지운 뒤 last_step 과 붙여서 확인한다.
SELECT '1. 컬럼 public.reviews.last_step (smallint) 존재' AS "항목",
       EXISTS (
         SELECT 1
         FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.reviews')
           AND a.attname  = 'last_step'
           AND a.attnum > 0 AND NOT a.attisdropped
           AND a.atttypid = 'smallint'::regtype
       ) AS "적용됨"
UNION ALL
SELECT '2. 그 컬럼의 COMMENT (v2 §6-5 문구)',
       COALESCE((
         SELECT col_description(a.attrelid, a.attnum) LIKE '마법사에서 마지막으로 본 단계%'
         FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.reviews')
           AND a.attname  = 'last_step'
           AND a.attnum > 0 AND NOT a.attisdropped
       ), false)
UNION ALL
SELECT '3. CHECK 제약 reviews_last_step_range 존재(검증완료)',
       EXISTS (
         SELECT 1
         FROM pg_constraint c
         WHERE c.conrelid = to_regclass('public.reviews')
           AND c.conname  = 'reviews_last_step_range'
           AND c.contype  = 'c'
           AND c.convalidated
       )
UNION ALL
SELECT '4. 그 CHECK 가 (last_step IS NULL OR last_step 1~5) 정의인가',
       COALESCE((
         SELECT translate(pg_get_constraintdef(c.oid), ' ()', '') LIKE '%last_stepISNULL%'
            AND translate(pg_get_constraintdef(c.oid), ' ()', '') LIKE '%last_step>=1%'
            AND translate(pg_get_constraintdef(c.oid), ' ()', '') LIKE '%last_step<=5%'
         FROM pg_constraint c
         WHERE c.conrelid = to_regclass('public.reviews')
           AND c.conname  = 'reviews_last_step_range'
           AND c.contype  = 'c'
       ), false)
UNION ALL
SELECT '5. last_step 에 컬럼 단위 ACL 이 존재 (pg_attribute.attacl 이 비어있지 않다)',
       EXISTS (
         SELECT 1
         FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.reviews')
           AND a.attname  = 'last_step'
           AND a.attnum > 0 AND NOT a.attisdropped
           AND a.attacl IS NOT NULL
       )
UNION ALL
SELECT '6. 그 ACL 에 authenticated 의 UPDATE 가 있다 (= GRANT UPDATE(last_step) 실행됨)',
       COALESCE((
         SELECT EXISTS (
           SELECT 1
           FROM aclexplode(a.attacl) x
           WHERE pg_get_userbyid(x.grantee) = 'authenticated'
             AND x.privilege_type = 'UPDATE'
         )
         FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.reviews')
           AND a.attname  = 'last_step'
           AND a.attnum > 0 AND NOT a.attisdropped
       ), false)
ORDER BY 1;
