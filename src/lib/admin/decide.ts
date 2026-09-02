import {
  ApiResult,
  NO_DB,
  ReviewStatus,
  Row,
  fail,
  invalid,
  ok,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 6. 승인 / 반려 (§6-3 ⓑ · §7-2 decide_review)
// ────────────────────────────────────────────────────────────────────

export type ReviewVerdict = 'APPROVED' | 'REJECTED';

export interface ReviewDecision {
  reviewId: string;
  status: ReviewStatus;
  approvedAt: string | null;
  rejectedReason: string | null;
  submittedAt: string | null;
}

/**
 * 승인/반려(§6-3 ⓑ). 워크벤치의 승인·반려 버튼이 쓴다.
 * decide_review RPC 한 번(=한 트랜잭션)으로 상태·사유·이력·감사 기록이 함께 남는다.
 * reviews의 status·approved_at·rejected_reason은 컬럼 잠금 트리거가 걸려 있어
 * 클라이언트에서 직접 update 할 수 없다 — 이 경로가 유일하다.
 *
 * 반려 사유는 서버가 최종 판정을 하지만(빈 사유면 예외) 여기서 먼저 막는다.
 * 왕복 한 번을 아끼려는 게 아니라, 같은 상황에서 같은 문구를 즉시 보여 주기 위해서다.
 */
export async function decideReview(
  reviewId: string,
  verdict: ReviewVerdict,
  reason = '',
): Promise<ApiResult<ReviewDecision>> {
  if (!supabase) return fail('검토 판정', NO_DB);
  const trimmed = reason.trim();
  if (verdict === 'REJECTED' && !trimmed) {
    return invalid('반려 사유를 입력해 주세요. SME가 무엇을 고쳐야 하는지 알 수 없습니다.');
  }

  const { data, error } = await supabase.rpc('decide_review', {
    p_review_id: reviewId,
    p_verdict: verdict,
    p_reason: trimmed,
  });
  if (error) return fail(verdict === 'APPROVED' ? '검토 승인' : '검토 반려', error.message);

  const r = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (!r) return fail('검토 판정', '서버가 판정 결과를 돌려주지 않았습니다.');
  return ok({
    reviewId: str(r.review_id) || reviewId,
    status: (str(r.status) as ReviewStatus) || 'SUBMITTED',
    approvedAt: str(r.approved_at) || null,
    rejectedReason: str(r.rejected_reason) || null,
    submittedAt: str(r.submitted_at) || null,
  });
}
