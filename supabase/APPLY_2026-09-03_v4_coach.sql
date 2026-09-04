/*
# APPLY — v4 검토 화면 첫 진입 안내 기록 (2026-09-03 마이그레이션의 한 벌 사본)

원본: `supabase/migrations/20260903010000_v4_coach_completed.sql`
기획서: `docs/PLAN_v4_SME_GUIDE.md` §5 G4 · §8

## 왜 이 파일이 뒤늦게 생겼나
이 저장소의 운영 원칙은 「SQL 선적용 → 확인 → 프런트 배포」이고, 운영 DB 에는
`supabase/migrations/` 가 아니라 `supabase/APPLY_*.sql` 을 붙여 넣는다.
v4 마이그레이션만 그 짝이 없었다. 그 사이 프런트(PR#5)는 이미 배포됐다.

## 미적용이면 어떻게 되나 — 오류도 경고도 없이 기능만 없다
`coach_completed_at` 컬럼이 없으면 `src/App.tsx` 가 값을 `undefined` 로 만들고
`SmeReviewPage` 는 `=== null` 로만 판정하므로 첫 진입 안내가 **한 번도 뜨지 않는다.**
화면에도 콘솔에도 흔적이 없다(같은 상황의 `must_change_password` 는 console.warn 이라도 남긴다).
컬럼만 만들고 GRANT 를 빠뜨리면 반대로, 안내는 뜨는데 「봤음」 기록이 매번 권한 오류로 실패해
검토를 열 때마다 되풀이된다.

## 적용 순서 제약
`APPLY_2026-09-02_v2_phaseA.sql` **뒤에** 실행한다.
phaseA 는 `REVOKE UPDATE ON profiles` 후 세 컬럼만 다시 GRANT 하므로, 이 파일을 먼저 실행하면
phaseA 가 여기서 준 권한을 도로 회수한다. phaseA 를 다시 돌릴 일이 생기면 이 파일도 다시 돌린다.

## 재실행 안전
`ADD COLUMN IF NOT EXISTS` · `GRANT` 모두 멱등이다. 기존 행을 손대지 않는다.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_completed_at timestamptz;

GRANT UPDATE (coach_completed_at) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.coach_completed_at IS
  '검토 화면 첫 진입 안내를 본 시각(v4 G4). 응답자 본인이 기록한다. 게이트가 아니라 안내 노출 여부만 정한다.';

NOTIFY pgrst, 'reload schema';

-- 확인 — 두 값이 모두 true 여야 안내가 뜨고, 본인이 「봤음」을 기록할 수 있다.
SELECT
  EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.profiles'::regclass
       AND attname = 'coach_completed_at' AND NOT attisdropped
  ) AS 컬럼있음,
  EXISTS (
    SELECT 1 FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'profiles'
       AND column_name = 'coach_completed_at'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) AS 본인쓰기권한;
