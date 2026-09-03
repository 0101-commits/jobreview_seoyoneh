// SME 검토 화면 상단 배너 2종 — 반려(재검토 요청) 사유와 문의 답변 도착 알림.
// 배치는 통합 담당이 한다(SmeReviewPage의 reviewError·locked 배너와 같은 자리, 같은 결).
//
// 근거 — §6-3 ⓑ "반려 시 사유 입력 필수 → SME 화면 RecheckBanner로 노출되고 해당 단계만 재편집
// 열림", §6-3 ⓒ "답변 시 SME 화면 배너로 노출". §10 P3 DoD ①이 사유 배너 노출을 완료 조건으로 건다.
//
// 색 선택 — destructive 토큰은 이 저장소에서 "조회·저장이 실패했다"는 뜻으로만 쓰인다
// (SmeReviewPage의 reviewError, 각 화면의 오류 상자). 반려는 실패가 아니라 정상 절차라서 warning
// 토큰을 쓴다. 대신 문구·아이콘으로 할 일을 분명히 말한다(색만으로 알리지 않기).
import { MessageSquareText, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { Inquiry } from '@/lib/surveyApi';
import { STEP_TITLES } from './copy';

function formatAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** step은 1~5지만 저장된 값은 smallint라 범위 밖도 올 수 있다. 그때는 번호만 보여 준다. */
function stepTitle(step: number): string {
  return STEP_TITLES[step - 1] ?? `STEP ${step}`;
}

/**
 * 반려 사유 배너(§6-3 ⓑ). 검토가 REVIEW_REQUESTED일 때 마법사 상단에 띄운다.
 *
 * role="alert" — 이 배너는 "지금 무엇을 해야 하는지"가 담긴 유일한 통로다. 잠금 배너처럼 상태를
 * 알리는 정보가 아니라 SME가 놓치면 검토가 그대로 멈추는 지시라 assertive로 읽힌다.
 *
 * step·onGoToStep은 선택 인자다 — 반려가 어느 단계를 겨눈 것인지 아는 경로(관리자가 단계를 함께
 * 남기거나, 통합 담당이 사유에서 단계를 추려내는 경우)에서만 넘기면 된다. 모르면 사유만 보여 준다.
 */
export function RecheckBanner({
  reason,
  requestedAt,
  step,
  onGoToStep,
}: {
  reason: string;
  requestedAt?: string | null;
  step?: number | null;
  onGoToStep?: (step: number) => void;
}) {
  const at = formatAt(requestedAt);
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-start gap-2 rounded-element border border-warning-border bg-warning-muted px-4 py-3 t-label text-warning"
    >
      <RotateCw size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">관리자가 재검토를 요청했어요{at && ` (${at})`}</p>
        {/* 사유는 손대지 않고 그대로 보여 준다 — 줄바꿈까지 관리자가 쓴 대로 읽혀야 한다. */}
        <p className="mt-1 whitespace-pre-line leading-6">
          {reason.trim() || '반려 사유가 함께 저장되지 않았어요. 관리자에게 확인해 주세요.'}
        </p>
        <p className="mt-1 t-caption leading-5">
          {step ? `${stepTitle(step)} 단계를 다시 확인한 뒤 ` : '내용을 고친 뒤 '}
          STEP 5에서 다시 제출해 주세요.
        </p>
      </div>
      {step && onGoToStep && (
        <Button size="sm" variant="secondary" className="shrink-0" onClick={() => onGoToStep(step)}>
          해당 단계로 이동
        </Button>
      )}
    </div>
  );
}

/**
 * 문의 답변 도착 배너(§6-3 ⓒ). 답변이 등록된 문의(status === 'ANSWERED')만 넘긴다 —
 * 예: fetchMyInquiries(user.id) 결과에서 `.filter(q => q.status === 'ANSWERED')`.
 *
 * role="status" — 반려와 달리 지금 당장 할 일이 아니라 알림이라 polite로 읽힌다.
 * 읽음 표시 컬럼이 없으므로 관리자가 종결할 때까지 계속 뜬다. 닫기 버튼은 두지 않았다 —
 * 닫아도 새로고침하면 되살아나 "닫았는데 또 뜬다"가 되고, 상태를 남길 자리도 없다.
 *
 * onOpen은 '내 문의'(/inquiries)로 보내는 동작이다. 라우팅을 이 파일이 정하지 않는 이유는 이
 * 배너가 마법사 안에 놓이기 때문이다 — 저장되지 않은 입력을 두고 이동할지는 배치하는 쪽이 정한다.
 */
export function AnsweredInquiryBanner({
  inquiries,
  onOpen,
}: {
  inquiries: Pick<Inquiry, 'id' | 'answered_at'>[];
  onOpen: () => void;
}) {
  if (inquiries.length === 0) return null;

  // 가장 최근 답변 시각. ISO 문자열이라 사전순 비교로 충분하다(ES2020이라 Array.at은 쓰지 않는다).
  let latest = '';
  for (const q of inquiries) {
    const at = q.answered_at ?? '';
    if (at > latest) latest = at;
  }
  const at = formatAt(latest || null);

  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-start gap-2 rounded-element border border-primary-border bg-primary-subtle px-4 py-3 t-label text-primary"
    >
      <MessageSquareText size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        문의 {inquiries.length}건에 답변이 등록되었어요{at && ` (최근 ${at})`}.
      </p>
      <Button size="sm" variant="secondary" className="shrink-0" onClick={onOpen}>
        내 문의에서 확인
      </Button>
    </div>
  );
}
