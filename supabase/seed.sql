/*
# Demo accounts seed

Creates the two demo accounts documented in README.md so a freshly provisioned
project can be logged into immediately.

- admin@jobreview.local / admin1234  -> profiles.role = 'admin'
- sme@jobreview.local   / sme1234    -> profiles.role = 'sme'

Idempotent: re-running only refreshes the password and profile row.
These are development credentials. Change or remove them before production use.
*/

DO $$
DECLARE
  v_admin_id uuid;
  v_sme_id   uuid;
BEGIN
  -- ADMIN -------------------------------------------------------------------
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@jobreview.local';
  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
      'admin@jobreview.local', extensions.crypt('admin1234', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_admin_id::text, v_admin_id,
      jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@jobreview.local', 'email_verified', true),
      'email', now(), now(), now());
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt('admin1234', extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now()
    WHERE id = v_admin_id;
  END IF;

  INSERT INTO public.profiles (id, email, name, organization, title, role, active)
  VALUES (v_admin_id, 'admin@jobreview.local', '관리자', '인사팀', '매니저', 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin', active = true, email = EXCLUDED.email, updated_at = now();

  -- SME ---------------------------------------------------------------------
  SELECT id INTO v_sme_id FROM auth.users WHERE email = 'sme@jobreview.local';
  IF v_sme_id IS NULL THEN
    v_sme_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_sme_id, 'authenticated', 'authenticated',
      'sme@jobreview.local', extensions.crypt('sme1234', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_sme_id::text, v_sme_id,
      jsonb_build_object('sub', v_sme_id::text, 'email', 'sme@jobreview.local', 'email_verified', true),
      'email', now(), now(), now());
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt('sme1234', extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now()
    WHERE id = v_sme_id;
  END IF;

  INSERT INTO public.profiles (id, email, name, organization, title, role, active)
  VALUES (v_sme_id, 'sme@jobreview.local', '검토위원', '현업부서', '책임', 'sme', true)
  ON CONFLICT (id) DO UPDATE
    SET role = 'sme', active = true, email = EXCLUDED.email, updated_at = now();
END $$;

-- GoTrue fails with "Database error querying schema" when these token columns are
-- NULL, so keep them as empty strings for the demo accounts.
UPDATE auth.users
SET confirmation_token        = COALESCE(confirmation_token, ''),
    recovery_token            = COALESCE(recovery_token, ''),
    email_change_token_new    = COALESCE(email_change_token_new, ''),
    email_change              = COALESCE(email_change, ''),
    email_change_token_current= COALESCE(email_change_token_current, ''),
    phone_change              = COALESCE(phone_change, ''),
    phone_change_token        = COALESCE(phone_change_token, ''),
    reauthentication_token    = COALESCE(reauthentication_token, '')
WHERE email IN ('admin@jobreview.local', 'sme@jobreview.local');
