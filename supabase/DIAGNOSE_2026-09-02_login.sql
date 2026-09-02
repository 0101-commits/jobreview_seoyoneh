/*
# 로그인 진단 — 읽기 전용

용도: "관리자로 로그인이 안 된다"의 원인을 데이터에서 확정한다.
실행 위치: Supabase 대시보드 → SQL Editor (프로젝트 ref = yktdlcpovntegiwfnied).
안전성: SELECT 만 한다. 어떤 행도 만들거나 바꾸거나 지우지 않는다.

읽는 법: 아래 7개 질의를 위에서부터 실행하고, 각 질의 위의 「이 값이면 이 원인」을 대조한다.
원인이 확정되면 supabase/BOOTSTRAP_2026-09-02_admin.sql 로 복구한다.
*/

-- ────────────────────────────────────────────────────────────────────
-- Q1. 활성 관리자가 몇 명인가?
--   0  → 관리자 부재. UI·Edge Function 만으로는 복구 불가(관리자 생성 경로가 전부 is_admin() 을 요구한다).
--        BOOTSTRAP 스크립트로 SQL Editor 에서 직접 만들어야 한다.
--   1+ → 계정은 있다. Q3~Q6 으로 그 계정의 상태를 본다.
-- ────────────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE role = 'admin' AND active)        AS 활성관리자,
  count(*) FILTER (WHERE role = 'admin' AND NOT active)    AS 비활성관리자,
  count(*) FILTER (WHERE role = 'sme')                     AS SME,
  count(*)                                                 AS 전체프로필
FROM public.profiles;

-- ────────────────────────────────────────────────────────────────────
-- Q2. 관리자 프로필 목록과 로그인 가능 여부
--   auth유저있음 = false        → 프로필만 있고 로그인 계정이 없다(고아 프로필).
--   이메일확인 IS NULL          → GoTrue 가 로그인을 거부한다(email_not_confirmed).
--   비번설정 = false            → 비밀번호가 없는 계정(매직링크/OAuth 로만 생성됨) → 비번 로그인 불가.
--   잠김 IS NOT NULL            → banned_until 이 미래면 로그인 거부.
--   비번변경강제 = true         → 로그인은 되지만 비밀번호 변경 화면에서 시작한다(정상 동작).
-- ────────────────────────────────────────────────────────────────────
SELECT
  p.email,
  p.name,
  p.active                                   AS 프로필활성,
  (u.id IS NOT NULL)                         AS auth유저있음,
  u.email                                    AS auth이메일,
  u.email_confirmed_at                       AS 이메일확인,
  (u.encrypted_password IS NOT NULL
   AND u.encrypted_password <> '')           AS 비번설정,
  u.banned_until                             AS 잠김,
  u.last_sign_in_at                          AS 마지막로그인,
  p.id                                       AS 프로필id
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.role = 'admin'
ORDER BY p.created_at;

-- ────────────────────────────────────────────────────────────────────
-- Q3. profiles ↔ auth.users 불일치 전수
--   profiles.id 는 auth.users(id) 를 FK 로 참조(ON DELETE CASCADE)하므로 정상적으로는
--   '프로필만 있음'이 나올 수 없다. 나온다면 FK 가 빠진 DB다 — 그 자체가 원인이다.
--   '로그인계정만 있음'은 흔하다: 대시보드에서 유저만 만들고 profiles 행을 안 넣은 경우.
--   이 상태면 로그인은 성공하지만 App.tsx 의 loadUser() 가 프로필을 못 찾아 곧바로 로그아웃시킨다
--   (화면 문구: "사용자 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.").
-- ────────────────────────────────────────────────────────────────────
SELECT '프로필만 있음(로그인 계정 없음)' AS 종류, p.id, p.email, p.role
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL
UNION ALL
SELECT '로그인 계정만 있음(프로필 없음)', u.id, u.email, NULL
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY 1, 3;

-- ────────────────────────────────────────────────────────────────────
-- Q4. 같은 이메일이 서로 다른 id 로 갈라져 있는가?
--   행이 나오면: 로그인은 새 계정으로 되는데 프로필은 옛 id 에 붙어 있어 loadUser 가 실패한다.
--   admin-create-user 의 recreate-auth 모드가 이 상태를 만든다(새 auth 유저를 만들고 profiles.id 는 그대로 둔다).
-- ────────────────────────────────────────────────────────────────────
SELECT p.email, p.id AS 프로필id, u.id AS auth유저id
FROM public.profiles p
JOIN auth.users u ON lower(u.email) = lower(p.email)
WHERE u.id <> p.id;

-- ────────────────────────────────────────────────────────────────────
-- Q5. 시드 계정 존재 여부
--   0행 → README 의 admin@jobreview.local / admin1234 로는 절대 로그인되지 않는다.
--          (2026-09-02 라이브 실측: 이 프로젝트는 0행이며 invalid_credentials 로 거부된다.)
-- ────────────────────────────────────────────────────────────────────
SELECT u.id, u.email, u.email_confirmed_at, p.role, p.active
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.email IN ('admin@jobreview.local', 'sme@jobreview.local');

-- ────────────────────────────────────────────────────────────────────
-- Q6. 로그인 경로가 의존하는 스키마가 실제로 적용돼 있는가?
--   must_change_password = false 면 Phase 0 마이그레이션 미적용(게이트가 꺼진 상태).
--   guide_completed_at   = false 면 Phase 1 미적용.
--   is_admin_함수 = false 면 관리자 권한 판정이 아예 없다 → 모든 관리자 화면이 비어 보인다.
--   profiles_FK = false 면 고아 프로필이 생길 수 있다.
-- ────────────────────────────────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_attribute
           WHERE attrelid = 'public.profiles'::regclass
             AND attname = 'must_change_password' AND NOT attisdropped)      AS must_change_password,
  EXISTS (SELECT 1 FROM pg_attribute
           WHERE attrelid = 'public.profiles'::regclass
             AND attname = 'guide_completed_at' AND NOT attisdropped)        AS guide_completed_at,
  EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
           WHERE n.nspname = 'public' AND pr.proname = 'is_admin')           AS is_admin_함수,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.profiles'::regclass AND contype = 'f')   AS profiles_FK,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles')                  AS profiles_정책수;

-- ────────────────────────────────────────────────────────────────────
-- Q7. profiles 컬럼 단위 UPDATE 권한
--   must_change_password 가 목록에 없으면, 첫 로그인 비밀번호 변경 화면에서
--   "변경 완료 표시를 기록하지 못했습니다" 오류가 나며 영원히 그 화면을 벗어나지 못한다.
-- ────────────────────────────────────────────────────────────────────
SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name) AS update_가능_컬럼
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'profiles' AND privilege_type = 'UPDATE'
GROUP BY grantee
ORDER BY grantee;
