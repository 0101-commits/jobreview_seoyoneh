/*
# 관리자 계정 부트스트랩 — 관리자가 0명이거나 로그인 계정이 끊겼을 때의 유일한 복구 경로

## 왜 SQL 로만 되는가
관리자 계정을 만드는 앱 경로는 두 개뿐이고 **둘 다 이미 관리자여야 쓸 수 있다**.
- `/admin-users` 화면 → `admin-create-user` Edge Function → 호출자의 `profiles.role='admin'` 을 확인한다.
- `profiles` INSERT 정책 `profile_admin_insert` = `public.is_admin()`.
따라서 활성 관리자가 0명이 되면 UI 로는 영원히 복구할 수 없다. 이 스크립트가 그 잠금을 푼다.

## 실행 위치
Supabase 대시보드 → SQL Editor. (`service_role` 키를 앱이나 저장소에 넣지 말 것.)

## 실행 전
`supabase/DIAGNOSE_2026-09-02_login.sql` 을 먼저 돌려 원인을 확인한다.

## 이 스크립트가 하는 일 (멱등)
아래 세 경우를 모두 하나의 정합한 상태로 만든다.
- (A) 그 이메일의 로그인 계정이 이미 있다 → 비밀번호를 재설정하고 이메일 확인·잠금 해제, 프로필을 관리자로 맞춘다.
- (B) 프로필만 남아 있다(로그인 계정 없음) → **프로필의 id 를 그대로 쓰는** 로그인 계정을 만든다.
      새 id 로 만들면 `review_assignments.sme_id` 등 `profiles(id)` 를 참조하는 기존 데이터가 전부 끊긴다.
- (C) 둘 다 없다 → 새로 만든다.

## 안전성
- 어떤 행도 지우지 않는다. 다른 계정을 건드리지 않는다.
- 같은 이메일이 서로 다른 id 로 갈라져 있으면(진단 Q4) **아무것도 바꾸지 않고 예외로 멈춘다** — 자동 병합은 데이터를 잃을 수 있다.
- 다시 실행하면 비밀번호만 아래 값으로 되돌아간다.

## 실행 후 반드시
1. 이 비밀번호로 로그인 → 첫 화면에서 비밀번호를 바꾼다(`must_change_password = true` 로 시작한다).
2. SQL Editor 의 질의 기록에 아래 비밀번호가 남는다. 로그인 후 바꾸고, 이 값을 메신저·문서에 남기지 않는다.
*/

DO $bootstrap$
DECLARE
  -- ▼▼▼ 이 두 줄만 고친다 ▼▼▼
  v_email    text := 'cgpark@e-hcg.com';        -- 관리자 이메일 (소문자로 쓴다)
  v_password text := 'ChangeMe-2026!admin';     -- 임시 비밀번호. 로그인 직후 반드시 변경한다.
  v_name     text := '관리자';                   -- 화면에 표시될 이름
  -- ▲▲▲ 여기까지 ▲▲▲

  v_user_id     uuid;
  v_profile_id  uuid;
  v_has_mcp     boolean;   -- must_change_password 컬럼 존재 여부(Phase 0 적용 여부)
BEGIN
  v_email := lower(trim(v_email));

  IF length(v_password) < 10 THEN
    RAISE EXCEPTION '임시 비밀번호는 10자 이상이어야 합니다(앱의 변경 화면 정책과 같은 기준).';
  END IF;

  SELECT id INTO v_user_id    FROM auth.users      WHERE lower(email) = v_email;
  SELECT id INTO v_profile_id FROM public.profiles WHERE lower(email) = v_email;

  -- 갈라진 상태는 자동으로 손대지 않는다. 어느 쪽 id 를 살릴지는 데이터 소유자가 정할 일이다.
  IF v_user_id IS NOT NULL AND v_profile_id IS NOT NULL AND v_user_id <> v_profile_id THEN
    RAISE EXCEPTION
      '같은 이메일(%)이 서로 다른 id 로 갈라져 있습니다. auth.users=% / profiles=%. 진단 Q4 를 보고 수동으로 정리한 뒤 다시 실행하세요.',
      v_email, v_user_id, v_profile_id;
  END IF;

  -- (B)(C) 로그인 계정이 없다 → 만든다. 프로필이 있으면 그 id 를 그대로 쓴다(참조 보존).
  IF v_user_id IS NULL THEN
    v_user_id := COALESCE(v_profile_id, gen_random_uuid());

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name), now(), now(),
      '', '', '', '', '', '', '', ''
    );
  ELSE
    -- (A) 이미 있다 → 비밀번호 재설정 + 로그인을 막는 상태(미확인 이메일·잠금)를 푼다.
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           banned_until       = NULL,
           updated_at         = now()
     WHERE id = v_user_id;
  END IF;

  -- 비밀번호 로그인에는 email identity 행이 있어야 한다. 없으면 넣는다.
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_user_id::text, v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  END IF;

  -- GoTrue 는 이 토큰 컬럼들이 NULL 이면 "Database error querying schema" 로 로그인을 거부한다.
  UPDATE auth.users
     SET confirmation_token         = COALESCE(confirmation_token, ''),
         recovery_token             = COALESCE(recovery_token, ''),
         email_change_token_new     = COALESCE(email_change_token_new, ''),
         email_change               = COALESCE(email_change, ''),
         email_change_token_current = COALESCE(email_change_token_current, ''),
         phone_change               = COALESCE(phone_change, ''),
         phone_change_token         = COALESCE(phone_change_token, ''),
         reauthentication_token     = COALESCE(reauthentication_token, '')
   WHERE id = v_user_id;

  -- 프로필을 관리자로 맞춘다. 이름·소속은 이미 있으면 덮지 않는다.
  INSERT INTO public.profiles (id, email, name, organization, title, role, active)
  VALUES (v_user_id, v_email, v_name, '', '', 'admin', true)
  ON CONFLICT (id) DO UPDATE
     SET email      = EXCLUDED.email,
         role       = 'admin',
         active     = true,
         updated_at = now();

  -- Phase 0 이 적용된 DB 에서만 강제 변경 플래그를 세운다(임시 비밀번호가 그대로 남지 않도록).
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.profiles'::regclass
       AND attname = 'must_change_password' AND NOT attisdropped
  ) INTO v_has_mcp;

  IF v_has_mcp THEN
    EXECUTE 'UPDATE public.profiles SET must_change_password = true WHERE id = $1' USING v_user_id;
  END IF;

  RAISE NOTICE '관리자 준비 완료: % (id=%)', v_email, v_user_id;
END
$bootstrap$;

-- 확인 — 아래 한 행이 나오고 auth유저있음/이메일확인/비번설정이 모두 참이면 로그인 가능한 상태다.
SELECT p.email, p.role, p.active AS 프로필활성,
       (u.id IS NOT NULL) AS auth유저있음,
       (u.email_confirmed_at IS NOT NULL) AS 이메일확인,
       (u.encrypted_password IS NOT NULL AND u.encrypted_password <> '') AS 비번설정,
       EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email') AS identity있음
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.role = 'admin'
ORDER BY p.email;
