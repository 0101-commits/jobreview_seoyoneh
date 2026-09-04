/*
 * 검토 화면 첫 진입 안내 (기획서 GUIDE v4 §5 G4).
 *
 * 검토 화면에 처음 들어온 응답자에게 화면의 네 요소 이름을 한 번만 알려 준다.
 * 시작 가이드 카드 ⑤와 같은 넷·같은 문장이다 — 가이드에서 읽은 말을 화면에서 다시 만나야
 * 이름이 붙는다.
 *
 * 왜 스포트라이트(요소를 실제로 가리키는 코치마크)가 아닌가.
 *   가리키려면 네 요소의 위치를 매 렌더 재고, 스크롤을 옮기고, 화면 폭에 따라 자리를 바꾸는
 *   요소(하단 고정 바·문의 버튼)를 따라다녀야 한다. 그 장치가 흔들리면 첫 화면이 통째로
 *   무너지는데, 얻는 것은 "어디에 있는지"뿐이다. 그건 문장으로 말할 수 있다(COACH_STEPS.where).
 *   그래서 본문 위에 접히는 안내 한 장을 두고, 화면을 덮지도 입력을 막지도 않는다(원칙 P4).
 *
 * 기록 실패는 화면을 막지 않는다. 다음에 한 번 더 뜰 뿐이다(GuidePage.handleFinish와 같은 판단).
 */
import { useState } from 'react';
import { Compass, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/auditApi';
import { COACH_DONE, COACH_INTRO, COACH_STEPS, COACH_TITLE } from './copy';

/** 통과 기록. 실패해도 삼키지 않고 콘솔에 남긴다 — 조용히 매번 뜨는 것이 더 이상하다. */
async function markSeen(userId: string) {
  if (!supabase) return;
  const { error } = await supabase
    .from('profiles')
    .update({ coach_completed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    console.warn('[coachmarks] 첫 진입 안내 기록을 저장하지 못했습니다.', error.message);
    return;
  }
  await logAudit('COACH_COMPLETED', 'profiles', userId);
}

export function FirstVisitNotice({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [closing, setClosing] = useState(false);

  const close = () => {
    if (closing) return;
    setClosing(true);
    // 화면에서는 곧바로 치운다. 기록은 뒤에서 끝난다 — 저장을 기다리게 할 이유가 없다.
    onDone();
    void markSeen(userId);
  };

  return (
    <section
      aria-label={COACH_TITLE}
      className="mb-5 rounded-element border border-primary-border bg-primary-subtle p-4"
    >
      <div className="flex items-start gap-2">
        <Compass size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="t-label font-semibold text-primary">
            {COACH_TITLE} — <span className="font-normal">{COACH_INTRO}</span>
          </p>
          <ul className="mt-3 space-y-2">
            {COACH_STEPS.map((s, i) => (
              <li key={s.label} className="flex items-start gap-2 t-caption leading-5 text-foreground-muted">
                <span
                  aria-hidden="true"
                  className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary t-caption-2 font-semibold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-foreground">
                    {s.where} 「{s.label}」
                  </span>{' '}
                  — {s.note}
                </span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-4" onClick={close}>
            {COACH_DONE}
          </Button>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={COACH_DONE}
          className="-mr-1 -mt-1 shrink-0 rounded-element p-1.5 text-primary transition hover:bg-primary-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export default FirstVisitNotice;
