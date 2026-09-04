/*
  평문 비밀번호 열람 — 보관 표 (기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md §2)

  ## 무엇을 하는가
  관리자가 「지금 이 계정의 비밀번호」를 다시 볼 수 있도록, 앱을 지나는 비밀번호를 암호문으로 보관한다.

  ## 왜 profiles 컬럼이 아닌가
  profiles 는 SELECT 에 컬럼 통제가 없고, App.tsx 가 로그인마다 select('*') 로 프로필을 읽으며
  `profiles!inner` embed 가 코드 사방에 있다. 평문(또는 복호 가능한 값)을 그 표에 두면 그 순간
  브라우저로 흘러간다. 별도 표로 떼어 놓는다.

  ## 왜 RLS 정책을 하나도 만들지 않는가
  정책 없음 = 전부 거부다. service_role 만 통과한다 — audit_logs 가 쓰는 방식 그대로다.
  화면은 이 표를 절대 직접 읽지 않고 Edge Function 의 reveal-password 모드로만 읽는다.
  anon 키는 배포 번들에 평문으로 들어 있으므로(공개 키다) REVOKE 를 함께 건다.

  ## 값 자체는 여기서 복호할 수 없다
  ciphertext 는 AES-256-GCM 이고 키는 Edge Function 시크릿(PASSWORD_VAULT_KEY)에 있다 — DB 밖이다.
  그래서 DB 덤프·백업 파일 한 벌이 통째로 새도 비밀번호는 읽히지 않는다. 이 표를 스냅샷
  대상(src/lib/snapshotApi.ts SNAPSHOT_TABLES)에 넣지 말 것.

  ## stale 이 뜻하는 것
  앱을 지나지 않는 변경 경로가 넷 남는다(재설정 메일 · 대시보드 · SQL 로 encrypted_password 직접
  UPDATE · service_role 로 앱 밖 호출). 그 경우 여기 값은 더 이상 현재 비밀번호가 아니다.
  틀린 값을 보여 주는 것이 값을 못 보여 주는 것보다 나쁘므로, 확인되면 stale 을 세우고
  화면은 값 대신 "앱을 지나지 않은 변경이 있었습니다"를 띄운다.

  재실행 안전 — IF NOT EXISTS · DROP POLICY IF EXISTS 로만 되어 있다.
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
