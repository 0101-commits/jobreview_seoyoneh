// SME 문의 채널 — 화면 우측 하단 고정 "문의하기" 버튼과 작성 모달(§6-1 카드 ④ · §6-3ⓒ).
//
// 문의는 메일·전화로 새면 운영 부담이 늘고 기록도 남지 않는다(§4 ① 진단). 그래서 검토 화면
// 어디서든 같은 자리에서 열리고, 직무·현재 단계가 자동으로 붙어 관리자 인박스에 도착한다.
import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { client } from '@/lib/reviewApi';
import { createInquiry } from '@/lib/surveyApi';
import { AutoTextarea } from './controls';
import { STEP_TITLES } from './copy';
import type { InquiryButtonProps } from './wizardTypes';

/**
 * 문의 버튼의 props. 공유 계약(InquiryButtonProps = reviewId·step)에 jobName만 선택 인자로 더한다.
 *
 * 계약 타입을 고치지 않은 이유 — 직무명은 문의를 만드는 데 필요한 값이 아니라 "무엇이 함께
 * 전달되는지"를 SME에게 보여 주기 위한 표시용이다. reviewId만 있으면 저장은 그대로 되고,
 * 직무명을 넘기지 않아도 화면이 단계만 보여 주며 정상 동작한다. 마법사 셸에는 jobDetail.name이
 * 이미 있으므로 배치하는 쪽에서 한 글자만 더 적으면 된다.
 */
export type InquiryButtonOwnProps = InquiryButtonProps & {
  jobName?: string;
  /**
   * 운영 설정의 문의 담당 표기(survey_settings.inquiry_contact).
   * 설정 화면은 이 값을 "SME가 문의하기 화면에서 보게 되는 안내"라고 약속하는데 실제로는
   * 어디에도 나오지 않았다(v2 F7). 값이 비어 있으면 줄 자체를 그리지 않는다.
   */
  inquiryContact?: string;
};

/** step은 1~5로 좁혀져 있지만, 배열 밖 접근이 화면 전체를 죽이지 않게 한 번 더 받는다. */
function stepTitle(step: number): string {
  return STEP_TITLES[step - 1] ?? `STEP ${step}`;
}

/** 로그인한 SME의 id. inquiries.sme_id는 RLS가 auth.uid()와 같은지 검사한다(§7-2). */
async function currentSmeId(): Promise<string> {
  const { data, error } = await client().auth.getUser();
  if (error || !data.user) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.');
  return data.user.id;
}

export function InquiryButton({ reviewId, step, jobName, inquiryContact }: InquiryButtonOwnProps) {
  const [open, setOpen] = useState(false);
  // 본문을 모달이 아니라 버튼 쪽에 둔다 — 실수로 닫아도, 저장에 실패해도 쓰던 글이 남는다.
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toast, showToast, dismiss } = useToast();

  const canSend = body.trim().length > 0 && !saving;

  async function send() {
    if (!canSend) return;
    setSaving(true);
    setError('');
    try {
      const smeId = await currentSmeId();
      // 검토 세션이 아직 없으면 review_id는 null로 보낸다. 직무가 안 붙더라도 문의 자체는 남아야 한다.
      await createInquiry(smeId, reviewId, step, body);
      setBody('');
      setOpen(false);
      showToast({
        type: 'success',
        msg: "문의를 남겼습니다. 답변이 등록되면 '내 문의' 화면에서 확인하실 수 있어요.",
        duration: 6000,
      });
    } catch (e) {
      // 삼키지 않는다. 사유를 그대로 보여 주고, 본문을 남긴 채 같은 버튼으로 다시 시도하게 한다.
      setError(e instanceof Error ? e.message : '문의를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/*
        위치 — 왜 이 좌표인가.
        §6-1 카드 ④가 "화면 우측 하단 '문의하기'"를 고정 문언으로 못박고 있어 자리를 옮길 수 없다.
        그런데 그림 6-A의 합계 게이지는 xl 미만에서 하단 고정 바로 내려온다. 같은 자리를 쓰면
        버튼이 게이지를 덮어 둘 다 못 쓰게 되므로 띄울 높이를 셸이 정하게 한다.
         · 하단에서 var(--sme-bottom-bar-h, 1.5rem)만큼 띄운다. 바가 없는 단계에서는 기본값
           1.5rem이고, STEP 3처럼 하단 바가 있는 화면에서는 셸이 그 변수를 바 높이로 덮어쓴다.
         · 폭 구간별로 값을 나누지 않는다. 하단 바는 sm~lg에서도 그대로 떠 있어서, 예전처럼
           sm 이상을 1.5rem으로 고정하면 태블릿 폭에서 버튼이 다시 게이지를 덮는다.
         · env(safe-area-inset-bottom) — iOS 홈 인디케이터 영역에 버튼이 걸리지 않게 더한다.
         · z-drawer — 본문 위, 모달(z-modal) 아래. 모달이 열리면 버튼이 그 아래로 덮인다.
         · pointer-events-none — 토스트가 없을 때 빈 컨테이너가 본문 클릭을 가로채지 않게 한다.
      */}
      <div
        className="pointer-events-none fixed right-4 z-drawer flex w-[min(20rem,calc(100vw-2rem))] flex-col items-end gap-0 bottom-[calc(env(safe-area-inset-bottom,0px)+var(--sme-bottom-bar-h,1.5rem))] sm:right-6"
      >
        <Toast toast={toast} onDismiss={dismiss} className="pointer-events-auto w-full" />
        <Button
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="문의하기 — 지금 보고 있는 직무와 단계가 함께 전달됩니다"
          className="pointer-events-auto shadow-2"
          // Button은 sm 이상에서 컨트롤 높이 40px로 내려간다. 떠 있는 버튼은 주변에 기댈 것이
          // 없어 그 크기면 놓치기 쉬우므로 44px을 유지한다(인라인이라 유틸 순서와 무관하게 이긴다).
          style={{ minHeight: 44 }}
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
          문의하기
        </Button>
      </div>

      {open && (
        <ModalShell
          title="문의하기"
          description="막히는 부분을 적어 주시면 담당자가 확인 후 답변드립니다."
          icon={<MessageSquarePlus size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
          onClose={() => setOpen(false)}
          closeDisabled={saving}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                취소
              </Button>
              <Button onClick={() => void send()} disabled={!canSend} loading={saving}>
                {error ? '다시 보내기' : '문의 남기기'}
              </Button>
            </>
          }
        >
          {/*
            무엇이 함께 전달되는지 먼저 보여 준다. 모르는 채로 쓰면 본문에 같은 정보를 다시 적거나,
            반대로 알려지길 원치 않는 맥락이 붙는다 — 개인정보 최소 수집과 같은 결의 문제다.
          */}
          <p className="rounded-element border border-border bg-muted px-3 py-2.5 t-caption leading-5 text-foreground-muted">
            {jobName && (
              <>
                직무: <span className="font-medium text-foreground">{jobName}</span> ·{' '}
              </>
            )}
            단계: <span className="font-medium text-foreground">{stepTitle(step)}</span> — 이 정보가 함께 전달됩니다.
          </p>

          {inquiryContact && (
            <p className="mt-2 t-caption leading-5 text-foreground-muted">
              문의 담당: <span className="font-medium text-foreground">{inquiryContact}</span>
            </p>
          )}

          {!reviewId && (
            <p className="mt-2 t-caption leading-5 text-foreground-subtle">
              아직 검토를 시작하지 않아 직무는 함께 전달되지 않습니다. 문의 내용에 직무명을 적어 주시면 확인이 빠릅니다.
            </p>
          )}

          <label className="mt-4 block">
            <span className="label">문의 내용</span>
            <AutoTextarea
              value={body}
              onChange={setBody}
              minRows={5}
              maxRows={12}
              disabled={saving}
              placeholder="예) 이 과업이 저희 팀 업무인지 판단이 어렵습니다. 어느 쪽으로 적어야 할까요?"
            />
          </label>

          {/* 오류는 폼 안에 남긴다 — 모달이 닫히면 사유도 본문도 함께 사라진다. */}
          <div aria-live="polite" role="status">
            {error && (
              <div className="mt-3 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2.5 t-caption leading-5 text-destructive">
                {error}
                <span className="mt-1 block text-foreground-muted">
                  작성하신 내용은 그대로 남아 있습니다. 네트워크를 확인한 뒤 다시 보내 주세요.
                </span>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}

export default InquiryButton;
