/*
# APPLY — 평문 비밀번호 열람 보관 표 (2026-09-04)

원본: `supabase/migrations/20260904010000_password_vault.sql`
기획서: `docs/PLAN_2026-09-04_IMPROVEMENT.md` §2

## 적용 순서
앞뒤 어느 쪽이어도 안전하다(새 표 하나뿐이고 기존 표를 건드리지 않는다).
다만 **프런트·Edge Function 배포보다 먼저** 적용한다 — 표가 없으면 계정 생성·비밀번호 변경이
보관에 실패하고, 그 실패는 계정 발급 자체를 막지 않지만 열람 화면이 계속 "기록 없음"으로 남는다.

## 적용 후에 해야 하는 것 두 가지
1. **키 등록** — Supabase 대시보드 → Edge Functions → Secrets 에 `PASSWORD_VAULT_KEY` 를 넣는다.
   32바이트 난수의 base64 다. 예: `openssl rand -base64 32`
   이 값이 없으면 보관도 열람도 하지 않는다(계정 발급 자체는 그대로 된다).
   **이 키를 잃어버리면 보관된 값은 영영 복호되지 않는다.** 그때는 비밀번호를 재발급하면 된다.
2. **anon 키로 확인** — 아래 확인 쿼리와 별개로, 배포 번들에 들어 있는 공개 anon 키로
   `GET /rest/v1/account_password_vault?select=*` 를 한 번 때려 **0행(또는 권한 오류)** 인지 눈으로 본다.
   RLS 를 빠뜨렸는지는 이 방법으로만 확인된다.

## 재실행 안전
IF NOT EXISTS · DROP POLICY IF EXISTS 로만 되어 있다.
*/

CREATE TABLE IF NOT EXISTS public.account_password_vault (
  profile_id  uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ciphertext  text        NOT NULL,
  key_version smallint    NOT NULL DEFAULT 1,
  -- 'admin-create' | 'sme-create' | 'set-password' | 'self-change'
  source      text        NOT NULL,
  stale       boolean     NOT NULL DEFAULT false,
  set_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  set_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_password_vault IS
  '앱을 통해 마지막으로 설정된 비밀번호의 암호문. 키는 Edge Function 시크릿에 있고 DB 에는 없다. service_role 전용.';
COMMENT ON COLUMN public.account_password_vault.stale IS
  '앱을 지나지 않은 변경이 확인된 계정. true 면 화면은 값을 보여 주지 않는다.';

ALTER TABLE public.account_password_vault ENABLE ROW LEVEL SECURITY;

-- 정책은 만들지 않는다. 실수로 만들어진 것이 있으면 지운다(재실행 안전).
DROP POLICY IF EXISTS account_password_vault_admin_select ON public.account_password_vault;
DROP POLICY IF EXISTS account_password_vault_admin_all ON public.account_password_vault;

/*
  Supabase 는 새 표에 anon·authenticated 기본 GRANT 를 준다. TRUNCATE 는 RLS 를 아예 거치지
  않으므로 회수하지 않으면 계정 하나로 표를 비울 수 있다(Phase 0 이 audit_logs 에 같은 조치를 했다).
*/
REVOKE ALL ON public.account_password_vault FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- 확인 — 표있음·RLS켜짐이 true 이고, anon권한·authenticated권한이 0 이어야 한다.
SELECT
  EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.account_password_vault'::regclass) AS 표있음,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_password_vault'::regclass) AS RLS켜짐,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_password_vault') AS 정책수_0이어야함,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'account_password_vault' AND grantee = 'anon') AS anon권한,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'account_password_vault' AND grantee = 'authenticated') AS authenticated권한;
