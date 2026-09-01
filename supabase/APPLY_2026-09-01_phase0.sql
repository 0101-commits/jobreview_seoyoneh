/* =====================================================================
   Job Review — 2026-09-01 Phase 0 보안 기반 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     아래 1개 마이그레이션의 본문을 그대로 이어붙인 파일이다.
       1) 20260901010000_phase0_security_baseline.sql
          - profiles.must_change_password 컬럼 추가(§8 S2). 첫 로그인 비밀번호 변경 강제의 근거.
            ★ 이미 쓰고 있던 계정은 전부 false 로 내린다. 그렇게 하지 않으면 관리자를 포함한
              모든 기존 계정이 잠겨 아무도 화면에 들어가지 못한다. 잠기는 것은 이 스크립트를
              적용한 뒤에 새로 만들어지는 계정뿐이다.
          - must_change_password 에 대한 컬럼 단위 UPDATE 권한을 authenticated 에 부여.
            20260813034113 이 profiles 의 테이블 UPDATE 권한을 회수하고 4개 컬럼만 열어 둔 탓에,
            이 GRANT 가 없으면 RLS 를 통과해도 본인이 값을 못 바꾼다(권한 오류).
            role·active 는 넣지 않는다 — SME 의 자가 승격 차단은 지금 그대로 유지된다.
          - audit_logs 테이블 신설(§7-1 ⑥ · §8 S5) + RLS. SELECT 는 ADMIN 만.
            INSERT/UPDATE/DELETE 정책은 만들지 않고 권한도 회수해 클라이언트 직접 기록을 막는다.
            TRUNCATE 도 함께 회수한다 — RLS 를 거치지 않아 회수하지 않으면 감사 로그가 통째로 지워진다.
          - log_audit RPC 신설. actor_id 를 auth.uid() 로 강제 기록하는 SECURITY DEFINER 함수다.
            실제 호출 지점(제출·승인/반려·업로드·Export·메일)은 Phase 1~4에서 붙인다.
          - 조회 인덱스 2개(actor_id+created_at, entity+entity_id).

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트(yktdlcpovntegiwfnied) → 왼쪽 메뉴 SQL Editor.
     2. New query 를 누르고 이 파일 전체를 복사해 붙여넣는다.
     3. Run 을 누른다. 전체가 한 번에 실행된다.
        - CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS /
          CREATE OR REPLACE FUNCTION / 컬럼 존재 확인 DO 블록으로만 되어 있어 두 번 실행해도 안전하다.
        - 특히 must_change_password 백필(UPDATE)은 "컬럼을 지금 막 만든 경우"에만 돈다.
          두 번째 실행에서는 아예 실행되지 않으므로, 그 사이 만들어진 신규 계정의
          강제 변경 게이트가 풀리지 않는다.
        - 이 스크립트는 행을 지우지 않는다. 만드는 것은 컬럼·테이블·정책·권한·인덱스·함수뿐이다.
     4. 아래 「적용 후 확인」 쿼리를 새 쿼리 창에서 실행한다.

   ▣ 적용 전 실측(선택) — 전부 읽기 전용이다
       -- (1) 지금 잠기지 않아야 할(= 이미 쓰고 있는) 계정 수. 적용 후 이 수만큼 false 여야 한다.
       SELECT count(*) FROM public.profiles;

       -- (2) audit_logs 가 이미 있나? 있으면 이 스크립트는 테이블을 건드리지 않고 넘어간다.
       SELECT to_regclass('public.audit_logs');

   ▣ 적용 후 확인
       -- 컬럼이 생겼고, 기존 계정이 전부 false 인지. must_change_password=true 행은 0이어야 한다.
       SELECT must_change_password, count(*)
         FROM public.profiles GROUP BY 1 ORDER BY 1;

       -- 컬럼 기본값이 true 로 남아 있는지(신규 계정만 잠기게 하는 장치).
       SELECT column_name, column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name = 'must_change_password';

       -- authenticated 가 바꿀 수 있는 profiles 컬럼 목록.
       -- 기대: can_update=true 가 name, email, organization, title, must_change_password 다섯 개뿐.
       --       role·active 가 true 로 나오면 자가 승격이 열린 것이니 즉시 원인을 찾을 것.
       SELECT a.attname AS column_name,
              has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE') AS can_update
         FROM pg_attribute a
        WHERE a.attrelid = 'public.profiles'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY 1;

       -- audit_logs 의 RLS 가 켜져 있고 정책이 SELECT 하나뿐인지.
       -- 기대: rowsecurity = true, 정책 1행(audit_logs_admin_select / SELECT).
       SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_logs'::regclass;
       SELECT policyname, cmd FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_logs' ORDER BY 1;

       -- audit_logs 에 클라이언트가 직접 쓰거나 지울 수 없어야 한다. 기대: 8행 모두 allowed=false.
       SELECT g.grantee, pr.privilege,
              has_table_privilege(g.grantee, 'public.audit_logs', pr.privilege) AS allowed
         FROM unnest(ARRAY['anon','authenticated']) AS g(grantee),
              unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS pr(privilege)
        ORDER BY 1, 2;

       -- log_audit 이 보이고, anon 은 실행 못 하고 authenticated 는 실행할 수 있어야 한다.
       SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
              has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_run,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_run
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'log_audit';

       -- 인덱스 2개.
       SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('idx_audit_logs_actor_created','idx_audit_logs_entity');

     마지막으로 앱에서 기존 계정으로 로그인해 평소처럼 화면에 들어가지는지 확인한다.
     여기서 비밀번호 변경 화면에 갇히면 백필이 안 된 것이다(위 첫 번째 확인 쿼리를 다시 본다).

   ▣ 되돌리는 법
     이 스크립트는 행을 지우지 않는다. 되돌림도 컬럼/테이블/함수 수준이다.

       -- 1) log_audit 제거
       DROP FUNCTION IF EXISTS public.log_audit(text, text, text, jsonb);

       -- 2) audit_logs 제거 — ★ 이미 쌓인 감사 기록이 함께 사라진다. 기록이 있으면 먼저 Export 할 것.
       DROP TABLE IF EXISTS public.audit_logs;

       -- 3) must_change_password 제거(강제 변경 게이트를 통째로 없앤다)
       REVOKE UPDATE (must_change_password) ON public.profiles FROM authenticated;
       ALTER TABLE public.profiles DROP COLUMN IF EXISTS must_change_password;

       -- 컬럼은 두고 게이트만 잠시 풀려면 3) 대신 아래를 쓴다.
       -- UPDATE public.profiles SET must_change_password = false;

   ===================================================================== */




-- =====================================================================
-- ▼ 20260901010000_phase0_security_baseline.sql
-- =====================================================================

/*
# Phase 0 보안 기반 — 첫 로그인 비밀번호 변경 강제 · 감사 로그 골격

기준: docs/PLAN.html §8 S2·S5, §7-1 ⑥, §10 P0.

1. 목적
- profiles.must_change_password 를 추가해 신규 계정이 첫 로그인에서 비밀번호를 바꾸기 전에는
  어떤 화면에도 진입하지 못하게 하는 서버측 근거를 만든다(§8 S2, §10 P0 DoD ②).
- audit_logs 테이블과 기록용 RPC log_audit 를 만든다. 제출·승인/반려·계정 생성/삭제·업로드·
  Export·메일 발송을 한곳에 남기기 위한 골격이다(§8 S5). 실제 호출 지점은 Phase 1~4에서 붙인다.

2. 보안
- audit_logs 는 RLS 활성. SELECT 는 public.is_admin() 만. INSERT/UPDATE/DELETE 정책은
  만들지 않는다 — RLS 는 정책이 없으면 거부이므로 클라이언트 직접 기록이 차단된다.
  같은 내용을 권한 층에서도 한 번 더 못박기 위해 anon·authenticated 의 쓰기 권한을 REVOKE 한다.
  SECURITY DEFINER 인 log_audit 는 함수 소유자 권한으로 돌기 때문에 이 REVOKE 에 걸리지 않는다.
- log_audit 는 20260828010500_secure_review_status_and_sync.sql 의 호출자 검증 패턴을 그대로 따른다.
  auth.uid() 가 NULL 이면 42501 로 거절하고, actor_id 는 인자로 받지 않고 auth.uid() 로 강제한다.
  호출자가 남의 이름으로 로그를 남길 방법이 없다.
- actor_id 에는 FK 를 걸지 않는다(§7-1 ⑥ DDL 그대로). "계정 삭제"도 감사 대상이라
  계정이 지워진 뒤에도 그 행위 기록은 남아야 한다.

3. 데이터 안전
- 가산적이다. 기존 테이블·행·정책을 지우거나 바꾸지 않는다. 추가만 한다.
- must_change_password 의 DEFAULT 는 true 다. 그대로 두면 이미 쓰고 있는 운영 계정이
  전부 잠긴다(관리자 포함 — 아무도 로그인 후 화면에 못 들어간다). 그래서 컬럼을 "지금 막
  만들었을 때에만" 기존 행을 false 로 내린다. 목적은 이후 만들어지는 신규 계정만
  DEFAULT true 로 걸리게 하는 것이다.
  이 백필을 ADD COLUMN IF NOT EXISTS + 무조건 UPDATE 로 쓰면 두 번째 실행 때
  그 사이 생긴 신규 계정까지 false 로 풀려 강제 변경 게이트가 통째로 무력화된다.
  그래서 컬럼 존재 여부로 감싼 DO 블록으로 쓴다(멱등하면서도 재실행이 게이트를 풀지 않는다).
- must_change_password 는 profiles 의 컬럼 단위 UPDATE 권한 목록에 추가해야 한다.
  20260813034113_20260813120000_secure_role_based_login.sql.sql 이
  `REVOKE UPDATE ON public.profiles FROM authenticated` 후
  `GRANT UPDATE (name, email, organization, title)` 만 남겨 놓았기 때문에,
  RLS 정책이 통과해도 컬럼 권한에서 막혀 본인 갱신이 실패한다.
- 권한 확인 결과(§10 P0 4항 점검):
  · 본인 행 UPDATE — RLS `profile_self_or_admin_update` 가 USING/WITH CHECK 양쪽에
    `id = auth.uid()` 를 허용한다. 정책은 그대로 통과하므로 새 정책을 만들지 않는다.
    막고 있던 것은 정책이 아니라 위의 컬럼 권한이었고, 아래 GRANT 한 줄로 해소한다.
  · SME 의 role 자가 승격 — 이미 막혀 있다. 컬럼 단위 GRANT 목록에 role 이 없어
    authenticated 는 role 을 UPDATE 할 수 없고, 변경 경로는 is_admin() 을 확인하는
    set_profile_role RPC 뿐이다. 그대로 둔다. 이번 GRANT 에도 role 을 넣지 않는다.
  · 남는 위험: 비밀번호를 실제로 바꾸지 않고 must_change_password 만 false 로 바꾸는 호출은
    가능하다. Auth 비밀번호 변경은 DB 함수가 아니라 Auth API(supabase.auth.updateUser) 로만
    되므로 한 트랜잭션으로 묶을 수 없다. 자기 계정 위생을 스스로 포기하는 행위일 뿐
    권한 상승이 아니라서 §8 S2 범위에서는 이 설계를 유지한다.
*/

-- ── profiles.must_change_password (§8 S2) ────────────────────────────
DO $$
BEGIN
  -- information_schema.columns 는 호출자 권한에 따라 행을 감추므로 카탈로그를 직접 본다.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.profiles'::regclass
       AND attname = 'must_change_password'
       AND NOT attisdropped
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN must_change_password boolean NOT NULL DEFAULT true;

    -- 컬럼을 지금 막 만든 경우에만 돈다. 이 시점에 있던 행 = 이미 쓰고 있던 계정이므로
    -- 잠그지 않는다. 이후 INSERT 되는 신규 계정만 DEFAULT true 로 걸린다.
    UPDATE public.profiles SET must_change_password = false;
  END IF;
END $$;

-- 컬럼 단위 UPDATE 권한. 이것이 없으면 RLS 를 통과해도 본인 갱신이 권한 오류로 막힌다.
-- role·active 는 넣지 않는다(자가 승격·자가 활성화 차단 유지).
GRANT UPDATE (must_change_password) ON public.profiles TO authenticated;

-- ── audit_logs (§7-1 ⑥ · §8 S5) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT 는 ADMIN 만. INSERT/UPDATE/DELETE 정책은 의도적으로 만들지 않는다(정책 없음 = 거부).
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin());

-- 정책 층뿐 아니라 권한 층에서도 클라이언트 직접 기록·변조를 막는다.
-- Supabase 의 기본 권한(ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated)이
-- 새 테이블에 TRUNCATE 까지 준다. TRUNCATE 는 RLS 를 아예 거치지 않으므로,
-- 이것을 회수하지 않으면 SME 계정 하나로 감사 로그 전체를 지울 수 있다. 반드시 함께 회수한다.
-- log_audit 는 SECURITY DEFINER 라 소유자 권한으로 돌기 때문에 이 회수에 영향받지 않는다.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;

-- 조회 축 두 개. "누가 언제 무엇을 했나"(관리자 행위 추적)와 "이 대상에 무슨 일이 있었나"(E5 Export).
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON public.audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity, entity_id);

-- ── log_audit RPC (§7-2 audit_logs 행) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.log_audit(
  p_action text,
  p_entity text,
  p_entity_id text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- 호출자 검증. SECURITY DEFINER 라 RLS 가 적용되지 않으므로 여기서 직접 막는다.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '기록할 권한이 없습니다. 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  -- actor_id 는 인자로 받지 않는다. 남의 이름으로 로그를 남길 수 없게 auth.uid() 로 강제한다.
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, meta)
  VALUES (auth.uid(), p_action, p_entity, p_entity_id, COALESCE(p_meta, '{}'::jsonb));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.log_audit(text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit(text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_audit(text, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.log_audit(text, text, text, jsonb) IS
  '감사 로그 기록(§8 S5). actor_id 는 auth.uid() 로 강제되며 인자로 지정할 수 없다. 비로그인 호출은 42501로 거절한다.';


-- =====================================================================
-- ▼ 마무리 — PostgREST 스키마 캐시 갱신
--    새 컬럼(profiles.must_change_password)·새 테이블(audit_logs)·새 함수(log_audit)를
--    PostgREST 가 바로 알아보게 한다. SQL Editor로 직접 적용하면 갱신이 늦어
--    PGRST202/PGRST204 가 나는 일이 있다.
-- =====================================================================
NOTIFY pgrst, 'reload schema';
