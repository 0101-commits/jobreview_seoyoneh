/*
# 관리자 계정 로그인 ID·비밀번호 지정 — 2026-09-04

## 무엇을 하는가
활성 관리자 계정의 **로그인 ID 를 `cgpark@e-hcg.com`**, **비밀번호를 `admin0123`** 으로 맞춘다.
`must_change_password` 를 끄므로 로그인 직후 변경 화면이 뜨지 않고 이 값이 그대로 유지된다.

## 왜 앱 화면이 아니라 SQL 인가
앱의 「비밀번호 직접 지정」은 **10자 이상**을 요구한다
(`src/components/modals/AccountAdminPanel.tsx` `PASSWORD_MIN_LENGTH = 10`,
 서버 `supabase/functions/admin-create-user/index.ts` 의 `passwordPolicyError`).
`admin0123` 은 9자라 그 경로로는 거절된다. 요청값을 그대로 넣으려면 이 스크립트를 쓴다.
정책 숫자 자체는 건드리지 않는다 — 낮추면 앞으로 발급되는 **모든** 계정에 적용된다.

## 실행 위치
Supabase 대시보드 → SQL Editor. (`service_role` 키를 앱이나 저장소에 넣지 말 것.)

## 대상 선택 규칙 (멱등)
- (A) `cgpark@e-hcg.com` 프로필이 이미 있다 → 그 계정의 비밀번호만 맞춘다.
- (B) 없고, **활성 관리자가 정확히 1명**이다 → 그 계정의 로그인 ID 를 `cgpark@e-hcg.com` 으로 바꾸고 비밀번호를 맞춘다.
- (C) 없고, 활성 관리자가 0명이거나 2명 이상이다 → **아무것도 바꾸지 않고 멈춘다.**
      0명이면 `supabase/BOOTSTRAP_2026-09-02_admin.sql`, 2명 이상이면 아래 `v_from_email` 에 대상 계정을 직접 적는다.

## 안전성
- 어떤 행도 지우지 않는다. 대상 1개 계정만 건드린다.
- 같은 이메일이 `auth.users` 와 `profiles` 에서 서로 다른 id 로 갈라져 있으면 예외로 멈춘다(자동 병합은 데이터를 잃는다).
- 로그인 ID 를 바꿀 때 `auth.users.email` · `auth.identities.identity_data` · `profiles.email` 셋을 함께 바꾼다.
  하나라도 빠지면 화면에 보이는 ID 와 실제 로그인 ID 가 어긋난다.

## 실행 후
- SQL Editor 질의 기록에 이 비밀번호가 남는다. 파일럿 종료 시 기록을 정리한다.
- `admin0123` 은 앱의 비밀번호 변경 화면(10자 이상)을 통과하지 못한다. 본인이 화면에서 바꾸려면 10자 이상으로 바꿔야 한다.
*/

DO $admin_account$
DECLARE
  -- ▼▼▼ 필요할 때만 고친다 ▼▼▼
  v_email      text := 'cgpark@e-hcg.com';  -- 새 로그인 ID
  v_password   text := 'admin0123';         -- 새 비밀번호
  v_from_email text := NULL;                -- (C) 관리자가 2명 이상일 때만: 바꿀 대상의 현재 로그인 ID
  -- ▲▲▲ 여기까지 ▲▲▲

  v_user_id    uuid;
  v_profile_id uuid;
  v_target     uuid;
  v_old_email  text;
  v_admins     int;
  v_has_mcp    boolean;
BEGIN
  v_email := lower(trim(v_email));

  SELECT id INTO v_user_id    FROM auth.users      WHERE lower(email) = v_email;
  SELECT id INTO v_profile_id FROM public.profiles WHERE lower(email) = v_email;

  IF v_user_id IS NOT NULL AND v_profile_id IS NOT NULL AND v_user_id <> v_profile_id THEN
    RAISE EXCEPTION
      '같은 이메일(%)이 서로 다른 id 로 갈라져 있습니다. auth.users=% / profiles=%. DIAGNOSE_2026-09-02_login.sql 로 확인한 뒤 수동 정리하세요.',
      v_email, v_user_id, v_profile_id;
  END IF;

  -- (A) 이미 그 이메일의 계정이 있다.
  v_target := COALESCE(v_user_id, v_profile_id);

  -- (B)(C) 없다 → 바꿀 대상을 고른다.
  IF v_target IS NULL THEN
    IF v_from_email IS NOT NULL THEN
      SELECT id INTO v_target FROM public.profiles WHERE lower(email) = lower(trim(v_from_email));
      IF v_target IS NULL THEN
        RAISE EXCEPTION 'v_from_email 로 지정한 계정(%)이 profiles 에 없습니다.', v_from_email;
      END IF;
    ELSE
      SELECT count(*) INTO v_admins FROM public.profiles WHERE role = 'admin' AND active;
      IF v_admins = 0 THEN
        RAISE EXCEPTION '활성 관리자가 0명입니다. supabase/BOOTSTRAP_2026-09-02_admin.sql 을 먼저 실행하세요.';
      ELSIF v_admins > 1 THEN
        RAISE EXCEPTION
          '활성 관리자가 %명입니다. 어느 계정을 바꿀지 v_from_email 에 적고 다시 실행하세요.', v_admins;
      END IF;
      SELECT id INTO v_target FROM public.profiles WHERE role = 'admin' AND active;
    END IF;
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_target;

  IF v_old_email IS NULL THEN
    RAISE EXCEPTION
      '프로필(id=%)에 대응하는 로그인 계정이 auth.users 에 없습니다. BOOTSTRAP_2026-09-02_admin.sql 을 쓰세요.', v_target;
  END IF;

  -- 새 이메일이 남의 계정에 이미 붙어 있으면 멈춘다.
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> v_target)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = v_email AND id <> v_target) THEN
    RAISE EXCEPTION '이미 다른 계정이 % 를 쓰고 있습니다.', v_email;
  END IF;

  -- 로그인 ID · 비밀번호 · 로그인을 막는 상태를 한 번에 맞춘다.
  UPDATE auth.users
     SET email              = v_email,
         encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         banned_until       = NULL,
         updated_at         = now()
   WHERE id = v_target;

  -- identity 가 없으면 비밀번호 로그인이 안 된다. 있으면 이메일만 갈아 끼운다.
  IF EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_target AND provider = 'email') THEN
    UPDATE auth.identities
       SET identity_data = identity_data
                           || jsonb_build_object('email', v_email, 'email_verified', true),
           updated_at    = now()
     WHERE user_id = v_target AND provider = 'email';
  ELSE
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_target::text, v_target,
      jsonb_build_object('sub', v_target::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  END IF;

  -- GoTrue 는 이 토큰 컬럼이 NULL 이면 "Database error querying schema" 로 로그인을 거부한다.
  UPDATE auth.users
     SET confirmation_token         = COALESCE(confirmation_token, ''),
         recovery_token             = COALESCE(recovery_token, ''),
         email_change_token_new     = COALESCE(email_change_token_new, ''),
         email_change               = COALESCE(email_change, ''),
         email_change_token_current = COALESCE(email_change_token_current, ''),
         phone_change               = COALESCE(phone_change, ''),
         phone_change_token         = COALESCE(phone_change_token, ''),
         reauthentication_token     = COALESCE(reauthentication_token, '')
   WHERE id = v_target;

  -- 화면이 보여 주는 ID 도 같이 바꾼다. 관리자·활성은 함께 못 박는다.
  UPDATE public.profiles
     SET email      = v_email,
         role       = 'admin',
         active     = true,
         updated_at = now()
   WHERE id = v_target;

  -- 지정한 비밀번호가 그대로 유지되도록 첫 로그인 강제 변경을 끈다(Phase 0 적용 DB 에서만).
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.profiles'::regclass
       AND attname = 'must_change_password' AND NOT attisdropped
  ) INTO v_has_mcp;

  IF v_has_mcp THEN
    EXECUTE 'UPDATE public.profiles SET must_change_password = false WHERE id = $1' USING v_target;
  END IF;

  RAISE NOTICE '관리자 계정 갱신 완료: % → % (id=%)', v_old_email, v_email, v_target;
END
$admin_account$;

-- 확인 — 아래 한 행이 나오고 이메일확인·비번설정·identity있음이 모두 참, 강제변경이 거짓이면 admin0123 으로 바로 로그인된다.
SELECT p.email, p.role, p.active AS 프로필활성,
       (u.email_confirmed_at IS NOT NULL) AS 이메일확인,
       (u.encrypted_password IS NOT NULL AND u.encrypted_password <> '') AS 비번설정,
       EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email') AS identity있음,
       p.must_change_password AS 강제변경,
       (u.encrypted_password = extensions.crypt('admin0123', u.encrypted_password)) AS 비번일치
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role = 'admin'
ORDER BY p.email;
