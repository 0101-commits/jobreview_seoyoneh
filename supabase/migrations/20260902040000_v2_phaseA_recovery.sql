/*
  v2 Phase A — 복구·권한 축소 (기획안 dcab2660 §7 · §8 Phase A)

  이 마이그레이션이 하는 일은 셋이다.

  1) profiles 자기수정 권한 축소 (S1)
     `GRANT UPDATE (name, email, organization, title) ON profiles TO authenticated`(20260813034113)와
     자기수정 RLS(profile_self_or_admin_update)가 겹쳐, SME가 PostgREST로 자기 email·organization·title을
     바꿀 수 있었다. 리마인더는 profiles.email로 발송되고(functions/send-reminder), 산출물 E1·비교 뷰의
     SME 열 머리는 profiles.organization·title을 쓴다. 즉 응답자가 발송 주소와 산출물의 소속·직급을
     흔들 수 있는 구조였다. 화면에 그 편집 UI는 없으므로 잃는 기능이 없다 —
     관리자 수정은 이미 Edge Function(service_role)이 한다.

     name은 남긴다: 본인 표시 이름은 자기 것이고, 산출물의 신뢰 근거(발송 주소·조직축)가 아니다.
     조직축은 org_unit_id이며 이미 잠겨 있다(20260902010000).

  2) request_rereview 실행 권한 회수 (F8)
     호출부가 0인 RPC다. 사유를 review_history에만 남기고 reviews.rejected_reason을 쓰지 않아,
     SME 화면의 재검토 배너가 사유 없이 뜬다. 반려의 정식 경로는 decide_review(…, 'REJECTED', 사유)다.
     함수는 지우지 않고 실행 권한만 회수한다 — 지우면 옛 마이그레이션 재실행 순서가 깨진다.

  3) PASSWORD_RESET 감사 행위 이름 등록 확인 (F1 ④)
     log_audit은 action을 자유 문자열로 받으므로 스키마 변경은 필요 없다. 여기서는 주석으로만 남긴다:
     비밀번호 재설정 완료는 PASSWORD_RESET / meta.reason = 'RESET_LINK'로 기록된다.

  적용: Supabase SQL Editor에서 supabase/APPLY_2026-09-02_v2_phaseA.sql 를 실행한다.
  멱등: 모두 REVOKE/GRANT라 여러 번 실행해도 결과가 같다.
*/

-- ── 1) profiles 컬럼 단위 UPDATE 권한 재정의 (S1) ────────────────────
-- 전체 UPDATE를 먼저 거두고, 허용 컬럼만 다시 준다. 열 목록을 한곳에서 읽을 수 있게 이 순서를 유지한다.
REVOKE UPDATE ON public.profiles FROM authenticated;

-- 본인 표시 이름(자기수정 RLS 범위 안)
GRANT UPDATE (name) ON public.profiles TO authenticated;
-- 첫 로그인 비밀번호 변경 게이트(Phase 0) — 화면이 false로 내린다.
GRANT UPDATE (must_change_password) ON public.profiles TO authenticated;
-- 시작 가이드 통과 시각(Phase 1) — 가이드 화면이 기록한다.
GRANT UPDATE (guide_completed_at) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.email IS
  'Auth 이메일의 사본. 리마인더 발송 주소이므로 authenticated는 수정할 수 없다(v2 S1). 관리자만 Edge Function으로 바꾼다.';
COMMENT ON COLUMN public.profiles.organization IS
  '산출물 E1·비교 뷰의 SME 소속 표기. authenticated 수정 불가(v2 S1) — 관리자만 Edge Function으로 바꾼다.';
COMMENT ON COLUMN public.profiles.title IS
  '산출물 E1·비교 뷰의 SME 직급 표기. authenticated 수정 불가(v2 S1) — 관리자만 Edge Function으로 바꾼다.';

-- ── 2) request_rereview 실행 권한 회수 (F8) ─────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'request_rereview'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM anon;
    COMMENT ON FUNCTION public.request_rereview(uuid, text) IS
      '사용 중지(v2 F8). 반려는 decide_review(p_review_id, ''REJECTED'', 사유)를 쓴다. 실행 권한 회수됨.';
  END IF;
END
$$;
