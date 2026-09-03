/*
  v4 — 검토 화면 첫 진입 안내 기록 (기획서 docs/PLAN_v4_SME_GUIDE.md §5 G4 · §8)

  무엇을 하는가
    profiles 에 coach_completed_at 한 컬럼을 더하고, 응답자 본인이 그 값을 쓸 수 있게 GRANT 한다.

  왜 서버에 두는가
    이 앱은 현장 공용 PC 사용을 전제한다(src/App.tsx 세션 주석 — persistSession 을 끈 이유가 그것이다).
    localStorage 는 사람이 아니라 브라우저를 기억하므로, 같은 PC를 쓰는 다음 사람에게는 안내가
    한 번도 뜨지 않고 정작 본인은 다른 PC에서 다시 본다.

  왜 GRANT 가 필요한가
    20260813034113 이 REVOKE UPDATE ON profiles 후 컬럼 단위 GRANT 만 남겨 두었다.
    이 줄이 없으면 RLS(profile_self_or_admin_update)를 통과해도 권한 오류로 막힌다 —
    must_change_password(Phase 0) · guide_completed_at(Phase 1)이 겪은 함정과 같다.

  왜 게이트가 아닌가
    guide_completed_at 은 통과하지 않으면 앱에 들어갈 수 없는 게이트지만, 이 값은 안내 한 장을
    띄울지 말지만 정한다. 컬럼이 없는 DB에서는 화면이 안내를 아예 띄우지 않는다(App.tsx가
    'coach_completed_at' in profile 로 판별한다) — 기록할 곳이 없으면 검토를 열 때마다 되풀이된다.

  재실행 안전 — ADD COLUMN IF NOT EXISTS · GRANT 모두 멱등이다. 기존 행을 손대지 않는다.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_completed_at timestamptz;

GRANT UPDATE (coach_completed_at) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.coach_completed_at IS
  '검토 화면 첫 진입 안내를 본 시각(v4 G4). 응답자 본인이 기록한다. 게이트가 아니라 안내 노출 여부만 정한다.';
