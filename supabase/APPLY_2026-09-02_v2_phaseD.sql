/* =====================================================================
   Job Review — 2026-09-02 v2 Phase D(화면·IA) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260902060000_v2_phaseD_last_step.sql — reviews.last_step 컬럼 + 범위 제약 + 컬럼 UPDATE 권한.
     화면(SME 홈의 「이어하기 → STEP n」)이 이 값을 읽고, 검토 화면이 단계를 옮길 때 갱신한다.

   ▣ 적용 전이어도 화면은 동작한다
     컬럼이 없으면 조회 결과에 값이 없어 last_step이 null이 되고, 이어하기 대신 「검토 시작」이
     보인다. 갱신 호출은 실패하지만 화면은 콘솔 경고만 남기고 그대로 간다(saveLastStep).

   ▣ 적용 후 확인 (SME 세션으로)
     PATCH /rest/v1/reviews?id=eq.<본인 검토>  body {"last_step":3}  → 204
     PATCH … body {"status":"SUBMITTED"}                              → 42501(잠긴 컬럼 그대로)
   ===================================================================== */

/*
  v2 Phase D — 이어하기 단계 서버 저장 (기획안 dcab2660 §6-5 "SME 홈 — 배정 카드")

  ▣ 왜
    "이어하기 → STEP n"의 근거가 localStorage였다(App.tsx lastStepKey).
    그래서 회사 PC에서 STEP 3까지 하고 집에서 열면 언제나 STEP 1이었고, 사파리 사생활 모드처럼
    저장소가 막힌 브라우저에서는 아예 기억되지 않았다(F7).

  ▣ 무엇을
    reviews.last_step smallint — 1~5. 화면이 단계를 옮길 때마다 갱신한다.
    이 값은 "어디까지 봤는가"일 뿐 게이트·제출 판정과 무관하다. 그래서 잠금 트리거의
    보호 대상에 넣지 않고, 본인 검토에 한해 authenticated가 직접 UPDATE할 수 있게 열어 둔다
    (reviews의 RLS가 이미 "배정된 본인"으로 행을 좁힌다).

  ▣ 적용
    supabase/APPLY_2026-09-02_v2_phaseD.sql
*/
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS last_step smallint;

COMMENT ON COLUMN public.reviews.last_step IS
  '마법사에서 마지막으로 본 단계(1~5). 기기 간 이어하기용 표시값이며 게이트·제출 판정에는 쓰이지 않는다(v2 §6-5).';

ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_last_step_range;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_last_step_range CHECK (last_step IS NULL OR (last_step BETWEEN 1 AND 5));

/*
  reviews는 컬럼 잠금 트리거(20260901020000)가 지키는 표다. 그 트리거는 "정해진 RPC로 들어온
  전이(app.trusted_rpc)나 관리자"만 잠긴 컬럼을 바꾸게 한다. last_step은 잠긴 컬럼이 아니므로
  컬럼 단위 UPDATE 권한만 주면 SME 본인이 직접 갱신할 수 있다.
*/
GRANT UPDATE (last_step) ON public.reviews TO authenticated;
