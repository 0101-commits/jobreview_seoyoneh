/*
# request_rereview — 관리자의 재검토 요청(반려)

1. 배경
- 관리자가 SME 검토를 반려하려면 두 가지를 함께 해야 한다.
  (1) reviews.status → 'REVIEW_REQUESTED'
  (2) review_history 에 사유(note) 한 줄
- 화면에서 두 번 호출하면 앞만 성공하고 뒤가 실패했을 때
  "왜 반려됐는지 아무도 모르는 재검토 요청"이 남는다. 감사 기록이 어긋난다.
  함수 본문은 한 트랜잭션이므로 RPC 하나로 묶는다.

2. 권한
- SECURITY INVOKER(기본값)다. 호출자의 RLS가 그대로 적용된다.
- 다만 reviews UPDATE 정책은 "관리자 또는 본인 배정"이라 SME도 자기 검토를 반려 상태로
  바꿀 수 있다. 반려는 관리자 행위이므로 함수 안에서 is_admin()을 직접 확인한다.

3. 데이터 안전
- 기존 테이블·정책·행 변경 없음. 함수 추가만 한다.
- submitted_at 은 지우지 않는다. 이전에 제출한 사실은 이력으로 남아야 한다.
*/

CREATE OR REPLACE FUNCTION public.request_rereview(p_review_id uuid, p_note text DEFAULT '')
RETURNS TABLE (
  review_id uuid,
  status text,
  started_at timestamptz,
  last_saved_at timestamptz,
  submitted_at timestamptz
)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '재검토를 요청할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews r
     SET status = 'REVIEW_REQUESTED',
         updated_at = now()
   WHERE r.id = p_review_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 검토를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.review_history (review_id, actor_id, action, note)
  VALUES (p_review_id, auth.uid(), 'REVIEW_REQUESTED', COALESCE(p_note, ''));

  RETURN QUERY
    SELECT r.id, r.status, r.started_at, r.last_saved_at, r.submitted_at
      FROM public.reviews r
     WHERE r.id = p_review_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_rereview(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_rereview(uuid, text) TO authenticated;
