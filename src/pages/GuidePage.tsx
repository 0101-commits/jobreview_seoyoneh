// SME 시작 가이드 — §6-1. 4장 카드를 한 장씩 가로로 넘기고, 마지막 카드에서 통과를 기록한다.
// 최초 로그인 시 필수 통과(마지막 카드의 "시작하기"), 이후 "가이드 다시 보기"로 재열람한다.
//
// 화면 문구는 이 파일에 적지 않는다 — §6-1 고정 문언은 전부 sme-review/copy.ts에 있다.
// (아래 PREV_CARD·NEXT_CARD·CLOSE_BUTTON 세 개만 예외다. 이유는 상수 주석에 적었다.)
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, Clock, ListChecks, PieChart } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/auditApi';
import { fetchSurveySettings } from '@/lib/surveyApi';
import { Button } from '@/components/ui/Button';
import { guideCards, GUIDE_START_BUTTON } from '@/pages/sme-review/copy';
import type { GuidePageProps } from '@/pages/sme-review/wizardTypes';

/*
 * 카드 이동·닫기 버튼 라벨. 기획안에도 copy.ts에도 없어 여기서 새로 씀.
 * copy.ts의 '이전 단계'/'다음 단계'를 그대로 쓰지 않는 이유는, 그 둘이 마법사 5단계의 이동 버튼이라
 * 가이드 카드에 같은 라벨을 붙이면 "카드 4장"과 "단계 5개"가 한 화면에서 뒤섞여 읽히기 때문이다.
 */
const PREV_CARD = '이전';
const NEXT_CARD = '다음';
const CLOSE_BUTTON = '닫기';

/** 카드 순서와 짝을 맞춘 장식 아이콘(§6-1 카드 ①~④). 새 그래픽을 만들지 않고 lucide 것만 쓴다. */
const CARD_ICONS = [BookOpen, ListChecks, PieChart, Clock];

/**
 * copy.ts가 emphasis로 표시한 구간만 <strong>으로 감싼다(§6-1 원문의 굵은 글씨).
 * 문장은 자르지도 바꾸지도 않는다 — 같은 문자열을 강조 구간에서만 나눠 다시 잇는다.
 */
function withEmphasis(body: string, marks?: readonly string[]) {
  if (!marks?.length) return body;
  const pattern = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return body.split(pattern).map((part, i) =>
    marks.includes(part) ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export function GuidePage({ user, onDone }: GuidePageProps) {
  const [index, setIndex] = useState(0);
  // 관리자 설정값(survey_settings.expected_minutes). 없으면 null 그대로 둔다 —
  // copy.ts가 소요 문장을 통째로 빼 준다. 앱이 숫자를 지어내면 착수보고 11면의 근거가 사라진다.
  const [expectedMinutes, setExpectedMinutes] = useState<number | null>(null);
  // 관리자가 /settings에 적어 둔 추가 안내(survey_settings.guide_md).
  // §6-1 고정 문언 4장을 대체하지 않고 마지막 카드 아래에 덧붙인다 —
  // 원칙 P1이 착수보고 문언을 그대로 쓰라고 못박아, 통째로 갈아치울 수 있으면 이행 증빙이 무너진다.
  const [guideMd, setGuideMd] = useState('');
  // 재열람 여부. 계약 props(GuidePageProps)에 통과 여부가 없어 본인 프로필에서 직접 읽는다.
  // 읽기는 profile_self_or_admin_select 정책으로 열려 있다.
  const [reopened, setReopened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const cards = useMemo(() => guideCards(expectedMinutes), [expectedMinutes]);
  const card = cards[index];
  const isLast = index === cards.length - 1;
  const CardIcon = CARD_ICONS[index] ?? BookOpen;

  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 첫 렌더에서까지 제목으로 포커스를 끌어오면 화면에 들어오자마자 스크롤이 튄다. 전환일 때만 옮긴다.
  const mounted = useRef(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (supabase) {
          const { data, error } = await supabase
            .from('profiles')
            .select('guide_completed_at')
            .eq('id', user.id)
            .maybeSingle();
          // 읽기 실패는 화면을 막지 않는다 — 최초 통과로 보고 진행하면 기록을 한 번 더 쓸 뿐이다.
          if (error) console.error(`[GuidePage] 가이드 통과 기록을 불러오지 못했습니다. ${error.message}`);
          if (alive && data?.guide_completed_at) setReopened(true);
        }
      } catch (e) {
        console.error(`[GuidePage] 가이드 통과 기록을 불러오지 못했습니다. ${e instanceof Error ? e.message : e}`);
      }

      try {
        const settings = user.company_id ? await fetchSurveySettings(user.company_id) : null;
        if (alive) {
          setExpectedMinutes(settings?.expected_minutes ?? null);
          setGuideMd(settings?.guide_md ?? '');
        }
      } catch (e) {
        // 설정값을 못 읽은 것과 설정값이 없는 것은 화면에서 같다 — 소요 문장을 뺀다.
        console.error(`[GuidePage] 조사 설정을 불러오지 못했습니다. ${e instanceof Error ? e.message : e}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user.id, user.company_id]);

  const move = useCallback(
    (delta: number) => setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta))),
    [cards.length],
  );

  // 좌/우 화살표로도 카드를 넘긴다.
  // '/guide' 재열람 경로에서는 이 화면이 앱 셸(헤더·사이드바·모바일 드로어) 안에 있다. 리스너는
  // window에 붙으므로, 열린 드로어(<dialog showModal>) 안에서 누른 방향키까지 여기로 버블링해
  // 모달 뒤의 카드가 조용히 넘어간다. 모달과 입력 칸에서 온 키는 그대로 흘려보낸다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('dialog[open], input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    titleRef.current?.focus();
  }, [index]);

  async function handleFinish() {
    // 재열람은 통과 시각을 다시 쓰지 않는다. 처음 읽은 시점이 R3의 근거이기 때문이다.
    if (reopened) {
      onDone();
      return;
    }
    if (!supabase) {
      setSaveError('데이터베이스에 연결되어 있지 않습니다.');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      // profiles는 REVOKE UPDATE 후 컬럼 단위 GRANT만 열려 있다.
      // guide_completed_at의 GRANT는 phase1 마이그레이션에 들어 있고, 행 조건은 RLS가 다시 본다.
      const { error } = await supabase
        .from('profiles')
        .update({ guide_completed_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) {
        setSaveError(error.message);
        return;
      }
      await logAudit('GUIDE_COMPLETED', 'profiles', user.id);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[560px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2e9b9a] text-white">
            <ClipboardCheck size={21} aria-hidden="true" />
          </div>
          <span className="font-semibold text-foreground">Job Review Architecture</span>
        </div>

        {/* 진행 표시. 막대는 장식이라 숨기고, 몇 번째 카드인지는 옆 문구가 읽어 준다.
            그 문구가 화면에서 위치를 알려 주는 유일한 단서라, 배경 대비가 4.5:1을 넘는
            foreground-muted로 적는다(foreground-subtle은 약 2.4:1로 WCAG 1.4.3에 못 미친다). */}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            {cards.map((c, i) => (
              <span
                key={c.title}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-7 bg-primary' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>
          <p aria-live="polite" className="text-xs font-medium text-foreground-muted">
            {index + 1} / {cards.length}
          </p>
        </div>

        <section
          aria-labelledby={titleId}
          className="rounded-container border border-border bg-card p-6 shadow-sm sm:p-8"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-element bg-primary-subtle text-primary">
              <CardIcon size={20} aria-hidden="true" />
            </div>
            <h1
              id={titleId}
              ref={titleRef}
              tabIndex={-1}
              className="mt-1.5 text-lg font-semibold tracking-tight text-foreground outline-none sm:text-xl"
            >
              {card.title}
            </h1>
          </div>

          {card.body && (
            <p className="mt-4 text-sm leading-relaxed text-foreground-muted">
              {withEmphasis(card.body, card.emphasis)}
            </p>
          )}

          {card.steps && (
            <ul className="mt-4 space-y-2">
              {card.steps.map((step) => (
                <li
                  key={step}
                  className="rounded-element border border-border bg-background px-3.5 py-2.5 text-sm text-foreground"
                >
                  {step}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/*
          추가 안내(§6-3 ⓒ 설정의 '가이드 문구'). 마지막 카드에서만 보여 준다 — 회차마다 달라지는
          운영 공지라 고정 문언 카드 안에 섞으면 §6-1의 문언이 어디까지인지 흐려진다.
          마크다운 렌더러는 들이지 않는다. 줄바꿈만 살려 원문 그대로 보여 준다(새 의존성 금지).
        */}
        {isLast && guideMd.trim() && (
          <section
            aria-label="추가 안내"
            className="mt-4 rounded-container border border-border bg-muted p-5 text-sm leading-relaxed text-foreground-muted"
          >
            <h2 className="mb-2 text-sm font-semibold text-foreground">추가 안내</h2>
            <p className="whitespace-pre-line">{guideMd}</p>
          </section>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button variant="ghost" size="md" onClick={() => move(-1)} disabled={index === 0 || saving}>
            <ChevronLeft size={16} aria-hidden="true" /> {PREV_CARD}
          </Button>
          {isLast ? (
            <Button size="lg" loading={saving} onClick={handleFinish}>
              {reopened ? CLOSE_BUTTON : GUIDE_START_BUTTON}
            </Button>
          ) : (
            <Button size="lg" onClick={() => move(1)}>
              {NEXT_CARD} <ChevronRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>

        {/*
          가이드는 접근 통제가 아니다(§6-1은 "각인"이 목적이다). 기록에 실패했다고 화면에 가두면
          그 순간 조사 자체가 멈추므로, 원인을 그대로 보여 주고 다시 시도할 길과 그냥 진행할 길을 함께 둔다.
        */}
        {saveError && (
          <div
            role="alert"
            className="mt-4 rounded-element border border-destructive-border bg-destructive-muted px-4 py-3 text-sm"
          >
            <p className="flex items-start gap-2 text-destructive">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">가이드를 읽으신 기록을 저장하지 못했습니다. {saveError}</span>
            </p>
            <p className="mt-2 text-foreground-muted">
              '{GUIDE_START_BUTTON}'를 한 번 더 눌러 다시 시도하실 수 있습니다. 같은 오류가 계속되면 관리자에게
              문의해 주세요. 기록이 남지 않아도 검토는 그대로 진행하실 수 있습니다.
            </p>
            <Button variant="secondary" size="md" className="mt-3" onClick={onDone}>
              기록 없이 계속하기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GuidePage;
