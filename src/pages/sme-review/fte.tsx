/*
 * STEP 3 — 투입 비중(FTE) 배분 화면 (§6-2 "STEP 3 상세" · 그림 6-A).
 *
 * 이 개편에서 전례가 없는 유일한 화면이라(§4 "두 레포 모두 부재"), 기획안 명세를 그대로 옮긴다.
 * 대상 목록·입력 방식·합계 게이지·품질 가드 ⓐⓑⓒ·겸직 표기 다섯 덩어리가 그 명세다.
 *
 * 상태를 여기서 들지 않는다. 대상(targets)과 값(rows)은 셸(SmeReviewPage)이 들고 내려 준다.
 *  - 대상: STEP 2의 삭제 제안·신규 제안이 바뀌는 즉시 다시 계산돼야 한다(§10 P2 DoD ①).
 *    그래서 이 파일은 사본을 만들지 않고 props에서 파생만 한다. 셸이 대상을 만들 때 쓰라고
 *    buildFteTargets를 함께 내보낸다 — 같은 규칙이 두 벌로 갈라지지 않게 하려는 것이다.
 *  - 값: 바꾸면 setRows로 셸에 올리고 onDirty()를 부른다. 저장은 셸의 자동 저장(2.5초)이 한다.
 *    여기서 따로 저장하면 상단 저장 칩과 실제 저장 시점이 어긋난다.
 *
 * 신규 제안 과업의 저장 — 임시저장 전에는 DB의 suggestion_id가 아직 없다. 그래서 화면은
 * newTasks 배열의 인덱스(FteTarget.suggestionIndex)로만 식별하고, 저장은 셸이
 *   ① saveReviewDraft로 신규 제안을 먼저 저장해 suggestion_id를 얻고
 *   ② 그 id로 rows의 'sug-{index}'를 치환해 surveyApi.saveFteAllocations를 부른다
 * 순서로 처리한다. id를 얻기 전에는 SUGGESTED 행을 보내지 않는다(참조할 행이 없어 어차피 들어가지 않는다).
 */
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import type { JobDetail } from '@/lib/jobApi';
import type { SuggestionInput } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import {
  FTE_EQUAL_SPLIT_BUTTON,
  FTE_INTRO,
  FTE_MOONLIGHTING_NOTE,
  FTE_NEXT_BLOCKED_BUTTON,
  FTE_PERIOD_BASIS,
  FTE_SINGLE_100_MODAL,
  FTE_STEP_PCT,
  FTE_SUGGESTED_BADGE,
  FTE_TOTAL_LABEL,
  GATE_STEP2_NEW_TASK_NAME,
  NEXT_STEP_BUTTON,
  PREV_STEP_BUTTON,
  STEP_TITLES,
  fteExcludedLine,
  fteOverLine,
  fteRemainingLine,
  fteTooManySmallNote,
  fteZeroPctNote,
} from './copy';
import type { FteRow, FteStepProps, FteTarget, StepNo } from './wizardTypes';

// ── 계산 (화면 밖에서도 쓴다: 셸의 단계 게이트, STEP 5 제출 요약) ───

/**
 * 0~100 정수로 자른다. 붙여넣기·소수점·음수·빈 칸·문자 섞인 입력을 전부 여기서 정규화한다.
 * 합계 판정이 부동소수 오차를 타지 않도록 값은 언제나 정수로만 보관한다(§6-2 "0~100, 정수").
 */
function normalizePct(raw: string | number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * 대상 기준으로 값을 맞춘 지도. 대상에 없는 값(STEP 2에서 삭제 제안한 과업의 옛 비중)은
 * 여기서 버려진다 — 화면 합계와 서버가 보는 합계가 갈라지지 않게 하는 지점이다.
 */
function ftePctMap(targets: FteTarget[], rows: FteRow[]): Map<string, number> {
  const saved = new Map(rows.map((r) => [r.key, normalizePct(r.pct)]));
  return new Map(targets.map((t) => [t.key, saved.get(t.key) ?? 0]));
}

/** 배분 합계. 정수 합이라 100 판정에 오차가 없다. */
export function fteTotal(targets: FteTarget[], rows: FteRow[]): number {
  let sum = 0;
  for (const pct of ftePctMap(targets, rows).values()) sum += pct;
  return sum;
}

/** 품질 가드 ⓑ — 0%인 과업 목록. STEP 5 제출 요약이 그대로 나열한다(허용하되 인지시킴). */
export function fteZeroTargets(targets: FteTarget[], rows: FteRow[]): FteTarget[] {
  const pcts = ftePctMap(targets, rows);
  return targets.filter((t) => (pcts.get(t.key) ?? 0) === 0);
}

/** 잔여 없이 n등분한다. 나누어떨어지지 않으면 나머지를 앞쪽부터 1씩 얹어 합계를 정확히 100으로 맞춘다. */
function equalSplit(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const extra = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * STEP 2 결과 → 배분 대상(§6-2 "대상 목록"). 셸이 STEP 2 상태에서 이 함수로 targets를 만든다.
 * 유지 Task + 이름이 있는 신규 제안 Task만 남기고, 삭제 제안한 Task는 목록에서 빼고 건수만 돌려준다.
 * 이름이 빈 신규 제안은 애초에 저장되지 않는 항목이라(reviewApi.buildDraftPayload) 대상에서 뺀다.
 */
export function buildFteTargets(
  tasks: JobDetail['tasks'],
  feedback: Record<string, Feedback>,
  newTasks: SuggestionInput[],
): { targets: FteTarget[]; excludedCount: number } {
  const targets: FteTarget[] = [];
  let excludedCount = 0;

  for (const task of tasks) {
    if (feedback[`task-${task.id}`]?.remove) {
      excludedCount += 1;
      continue;
    }
    targets.push({
      key: `task-${task.id}`,
      targetType: 'EXISTING',
      taskId: task.id,
      suggestionIndex: null,
      name: task.name,
      description: task.description,
      isNew: false,
    });
  }

  // 키가 배열 인덱스라, 중간 제안을 지우면 뒤 제안의 키가 한 칸 당겨진다(제안 편집기가 filter로
  // 지운다 — controls.tsx SuggestionEditor). 그래서 셸(SmeReviewPage)의 targets 동기화 effect는
  // SUGGESTED 대상의 값을 키보다 이름으로 먼저 찾는다. 그러지 않으면 밀려온 제안이 방금 지운
  // 제안의 비중을 그대로 물려받는다.
  //
  // 같은 이름의 제안은 한 줄만 대상으로 잡는다. 서버 save_review_draft가 신규 제안을 이름 기준
  // (DISTINCT ON)으로 저장해 같은 이름 두 줄이 DB에서는 한 행이 되기 때문이다. 두 줄을 그대로
  // 대상에 넣으면 저장 때 같은 suggestion_id로 두 번 insert 하게 되고, 부분 unique 인덱스
  // (idx_fte_review_suggestion)에 걸려 자동 저장이 매번 실패한다.
  const seenNames = new Set<string>();
  newTasks.forEach((item, index) => {
    const name = item.name.trim();
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);
    targets.push({
      key: `sug-${index}`,
      targetType: 'SUGGESTED',
      taskId: null,
      suggestionIndex: index,
      name,
      description: item.description,
      isNew: true,
    });
  });

  return { targets, excludedCount };
}

// ── 합계 게이지 ─────────────────────────────────────────────────────

/** 100% 미만이면 잔여, 초과면 초과분을 안내한다. 색만으로 알리지 않도록 아이콘을 함께 둔다. */
function statusOf(total: number) {
  if (total > 100) return { text: fteOverLine(total - 100), tone: 'text-destructive', Icon: AlertTriangle };
  if (total < 100) return { text: fteRemainingLine(100 - total), tone: 'text-foreground-muted', Icon: Info };
  return { text: '', tone: 'text-success', Icon: CheckCircle2 };
}

/**
 * 그림 6-A 우측 패널(xl 이상) / 모바일 하단 고정 바. 같은 내용을 배치만 바꿔 두 번 그린다.
 * 숨겨진 쪽은 display:none이라 보조기기가 읽지 않으므로 aria-live가 두 번 읽히지 않는다.
 */
function TotalGauge({
  layout,
  total,
  showNav,
  goToStep,
}: {
  layout: 'side' | 'bar';
  total: number;
  showNav: boolean;
  goToStep: (step: StepNo) => void;
}) {
  const status = statusOf(total);
  const done = total === 100;
  const filled = Math.min(total, 100);
  const fillTone = total > 100 ? 'bg-destructive' : done ? 'bg-success' : 'bg-primary';

  // 합계 변화는 화면을 보지 않아도 알아야 한다 — 숫자와 사유를 한 덩어리로 읽힌다.
  const readout = (
    <div aria-live="polite" className={layout === 'side' ? 'mt-3 text-center' : 'min-w-0'}>
      <p className="text-sm font-semibold text-foreground">
        {total}% <span className="font-normal text-foreground-subtle">/ 100%</span>
      </p>
      {status.text && (
        <p
          className={`mt-1 flex items-start gap-1.5 text-xs ${status.tone} ${
            layout === 'side' ? 'justify-center' : ''
          }`}
        >
          <status.Icon size={14} aria-hidden="true" className="mt-px shrink-0" />
          <span>{status.text}</span>
        </p>
      )}
    </div>
  );

  const nav = showNav ? (
    <div className={layout === 'side' ? 'mt-4 grid gap-2' : 'flex shrink-0 gap-2'}>
      <Button variant="secondary" size="sm" onClick={() => goToStep(2)}>
        {PREV_STEP_BUTTON}
      </Button>
      {/* 게이트는 합계 100%만 본다. 제출 완료(readOnly) 검토도 읽으려면 단계를 넘어갈 수 있어야 한다. */}
      <Button size="sm" onClick={() => goToStep(4)} disabled={!done}>
        {done ? NEXT_STEP_BUTTON : FTE_NEXT_BLOCKED_BUTTON}
      </Button>
    </div>
  ) : null;

  if (layout === 'bar') {
    return (
      // lg 이상에서는 좌측에 고정 사이드바(w-64)가 있다. inset-x-0으로 두면 바가 그 위를 덮어
      // 사이드바 하단의 로그아웃 버튼을 가린다(같은 z-30이라 나중에 그려지는 바가 이긴다).
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card px-4 py-3 lg:left-64 xl:hidden">
        <div
          role="progressbar"
          aria-label={FTE_TOTAL_LABEL}
          aria-valuenow={total}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-inner bg-muted"
        >
          <div className={`h-full rounded-inner ${fillTone}`} style={{ width: `${filled}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          {readout}
          {nav}
        </div>
      </div>
    );
  }

  return (
    <div className="hidden xl:sticky xl:top-4 xl:block xl:rounded-container xl:border xl:border-border xl:bg-card xl:p-5">
      <p className="text-sm font-semibold text-foreground">{FTE_TOTAL_LABEL}</p>
      <div
        role="progressbar"
        aria-label={FTE_TOTAL_LABEL}
        aria-valuenow={total}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mx-auto mt-4 grid h-28 w-28 place-items-center rounded-full"
        style={{
          background: `conic-gradient(${
            total > 100 ? 'rgb(var(--destructive))' : done ? 'rgb(var(--success))' : 'rgb(var(--primary))'
          } ${filled * 3.6}deg, rgb(var(--muted)) 0deg)`,
        }}
      >
        <span
          aria-hidden="true"
          className="grid h-20 w-20 place-items-center rounded-full bg-card text-lg font-semibold text-foreground"
        >
          {total}%
        </span>
      </div>
      {readout}
      {nav}
    </div>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────

/**
 * showNav — 그림 6-A는 이전/다음 버튼을 합계 패널 안에 둔다. 마법사 셸이 공용 내비를 따로 그린다면
 * 셸에서 showNav={false}로 끄면 된다(같은 버튼이 두 벌 나오지 않게).
 */
export function FteStep({
  readOnly,
  targets,
  rows,
  setRows,
  excludedCount,
  newTasks,
  onDirty,
  goToStep,
  showNav = true,
}: FteStepProps & { showNav?: boolean }) {
  // 사본을 만들지 않는다. 대상이 바뀌면(STEP 2 편집) 이 파생값이 같은 렌더에서 함께 바뀐다.
  const pcts = useMemo(() => ftePctMap(targets, rows), [targets, rows]);
  const total = useMemo(() => {
    let sum = 0;
    for (const pct of pcts.values()) sum += pct;
    return sum;
  }, [pcts]);

  /** 가드 ⓐ에서 "다시 배분할게요"를 누르면 돌아갈 직전 값. null이면 모달이 닫힌 상태다. */
  const [revertTo, setRevertTo] = useState<FteRow[] | null>(null);

  const unnamedCount = useMemo(() => newTasks.filter((t) => !t.name.trim()).length, [newTasks]);
  const zeroCount = useMemo(() => targets.filter((t) => (pcts.get(t.key) ?? 0) === 0).length, [targets, pcts]);
  const smallCount = useMemo(
    () =>
      targets.filter((t) => {
        const pct = pcts.get(t.key) ?? 0;
        return pct > 0 && pct < FTE_STEP_PCT;
      }).length,
    [targets, pcts],
  );

  const toRows = useCallback(
    (map: Map<string, number>): FteRow[] => targets.map((t) => ({ key: t.key, pct: map.get(t.key) ?? 0 })),
    [targets],
  );

  // 대상과 값을 맞추는 일은 셸(SmeReviewPage)의 targets 동기화 effect 한 곳에서만 한다.
  // 여기에도 같은 가드를 두었더니 키(sug-{index})만 비교해, 앞의 신규 제안을 지워 인덱스가 밀린
  // 값을 교정하기는커녕 셸이 이름으로 되찾아 놓은 값을 다시 덮어썼다. 화면 표시는 ftePctMap이
  // 대상 기준으로 걸러 주므로 이 단계가 따로 손대야 할 것은 없다.

  const write = useCallback(
    (next: Map<string, number>) => {
      setRows(toRows(next));
      onDirty();
    },
    [toRows, setRows, onDirty],
  );

  /**
   * 한 과업에만 100%가 몰렸는지 — 한 행이 100%이고 합계도 100%인 상태(나머지가 전부 0%)만 해당한다.
   * 초과 배분(예: 100% + 20%)은 초과 안내가 맡는 몫이라 여기서 묻지 않는다.
   */
  const isSingle100 = useCallback(
    (map: Map<string, number>) => {
      if (targets.length <= 1) return false;
      let sum = 0;
      let hasFull = false;
      for (const t of targets) {
        const pct = map.get(t.key) ?? 0;
        sum += pct;
        if (pct === 100) hasFull = true;
      }
      return hasFull && sum === 100;
    },
    [targets],
  );

  const setPct = useCallback(
    (key: string, value: number) => {
      if (readOnly) return;
      const pct = normalizePct(value);
      // 0에서 '−', 100에서 '+'처럼 값이 그대로인 조작은 여기서 끝낸다(공연히 dirty가 되지 않게).
      if ((pcts.get(key) ?? 0) === pct) return;
      const next = new Map(pcts);
      next.set(key, pct);
      // 품질 가드 ⓐ — 100%로 "들어서는" 순간에만 묻는다. 이미 100%인 채로 다른 행을 만지면 묻지 않는다.
      if (isSingle100(next) && !isSingle100(pcts)) setRevertTo(toRows(pcts));
      write(next);
    },
    [readOnly, pcts, isSingle100, toRows, write],
  );

  const bump = (key: string, delta: number) => setPct(key, (pcts.get(key) ?? 0) + delta);

  const onEqualSplit = () => {
    if (readOnly || targets.length === 0) return;
    // 덮어쓰기 확인 — 문구는 기획안에 없어 새로 씀. 이미 배분한 값이 말없이 사라지지 않게 한 번 묻는다.
    if (total > 0 && !window.confirm('이미 입력한 비중을 지우고 균등하게 다시 배분할까요?')) return;
    const parts = equalSplit(targets.length);
    setRows(targets.map((t, i) => ({ key: t.key, pct: parts[i] })));
    onDirty();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>, key: string) => {
    const step = e.key === 'ArrowUp' ? FTE_STEP_PCT : e.key === 'ArrowDown' ? -FTE_STEP_PCT : 0;
    if (!step) return;
    e.preventDefault();
    bump(key, step);
  };

  return (
    // 모바일 하단 고정 바가 가리는 만큼의 여백은 셸(SmeReviewPage)이 페이지 맨 아래에 준다.
    // 여기서 주면 이 단계의 목록 아래에만 붙어, 셸이 그 뒤에 그리는 이전/다음 버튼이 그대로 바에 덮인다.
    <section aria-labelledby="fte-heading">
      <h3 id="fte-heading" className="sr-only">
        {STEP_TITLES[2]}
      </h3>

      {/* 겸직·비중 인식 지원(§6-2) — 기간 기준과 겸직 안내는 접지 않고 항상 보이게 둔다. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-element bg-muted px-4 py-3">
        <span className="rounded-inner bg-card px-2 py-1 text-xs font-semibold text-primary">{FTE_PERIOD_BASIS}</span>
        <span className="text-xs leading-5 text-foreground-muted">{FTE_MOONLIGHTING_NOTE}</span>
      </div>

      <p className="mb-5 text-sm leading-6 text-foreground-muted">{FTE_INTRO}</p>

      <div className="grid gap-6 xl:grid-cols-[1fr_16rem] xl:items-start">
        <div>
          {targets.length === 0 ? (
            // 배분할 과업이 하나도 없는 경우 — 문구는 기획안에 없어 새로 씀.
            <p className="rounded-element bg-muted px-4 py-6 text-center text-sm text-foreground-muted">
              배분할 과업이 없어요.{' '}
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="font-medium text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {STEP_TITLES[1]}
              </button>
              에서 과업을 확인해 주세요.
            </p>
          ) : (
            <ul className="space-y-3">
              {targets.map((t) => {
                const pct = pcts.get(t.key) ?? 0;
                return (
                  <li key={t.key} className="rounded-element border border-border bg-card p-3 sm:p-4">
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                      <p className="min-w-0 flex-1 font-medium text-foreground">{t.name}</p>
                      {t.isNew && (
                        <span className="shrink-0 rounded-inner bg-primary-subtle px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {FTE_SUGGESTED_BADGE}
                        </span>
                      )}
                    </div>
                    {t.description && <p className="mt-1 text-xs leading-5 text-foreground-muted">{t.description}</p>}

                    {/* 좁은 폭·큰 글꼴에서는 줄을 바꿔 넘치지 않게 한다(막대가 flex-1이라 스스로 다음 줄을 채운다). */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => bump(t.key, -FTE_STEP_PCT)}
                        disabled={readOnly}
                        aria-disabled={pct === 0}
                        aria-label={`${t.name} ${FTE_STEP_PCT}% 줄이기`}
                        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-element border border-border bg-card text-foreground-muted transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                          pct === 0 ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <Minus size={16} aria-hidden="true" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(pct)}
                        disabled={readOnly}
                        aria-label={t.name}
                        // 완전 제어 입력이라 칸이 비지 않는다("0"). 캐럿이 숫자 앞이나 사이에 있으면
                        // 25%를 치는 도중 "250"이 만들어지는데, 그대로 정규화하면 말없이 100%가 된다.
                        // 100을 넘는 입력은 무시해 직전 값을 그대로 둔다(React가 DOM 값을 되돌린다).
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '');
                          const n = digits === '' ? 0 : Number(digits);
                          if (n > 100) return;
                          setPct(t.key, n);
                        }}
                        // 칸을 누르면 전체를 선택한다 — 캐럿 위치에 따라 앞자리가 끼어드는 것을 막는다.
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => onInputKeyDown(e, t.key)}
                        className="input w-16 shrink-0 px-2 text-center tabular-nums disabled:opacity-60"
                      />
                      <span className="shrink-0 text-sm font-semibold text-foreground">%</span>
                      <button
                        type="button"
                        onClick={() => bump(t.key, FTE_STEP_PCT)}
                        disabled={readOnly}
                        aria-disabled={pct === 100}
                        aria-label={`${t.name} ${FTE_STEP_PCT}% 늘리기`}
                        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-element border border-border bg-card text-foreground-muted transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                          pct === 100 ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                      <span
                        aria-hidden="true"
                        className="ml-1 h-2 min-w-[3rem] flex-1 overflow-hidden rounded-inner bg-muted"
                      >
                        <span className="block h-full rounded-inner bg-primary" style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 그림 6-A 목록 아래 줄 — 삭제 제안 제외 안내 · 균등 배분으로 시작 */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {excludedCount > 0 && <span className="text-xs text-foreground-muted">{fteExcludedLine(excludedCount)}</span>}
            <Button variant="secondary" size="sm" onClick={onEqualSplit} disabled={readOnly || targets.length === 0}>
              {FTE_EQUAL_SPLIT_BUTTON}
            </Button>
          </div>

          {/* 품질 가드 ⓑ·ⓒ — 막지 않고 알리기만 한다(§6-2 "허용은 하되 인지시킴"). */}
          <div className="mt-4 space-y-2">
            {zeroCount > 0 && total > 0 && (
              <p className="flex items-start gap-2 rounded-element bg-muted px-4 py-3 text-xs leading-5 text-foreground-muted">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{fteZeroPctNote(zeroCount)}</span>
              </p>
            )}
            {/* 5% 미만이 3건 이상이면 "다수 분산"으로 본다(임계값은 §12에서 확정). */}
            {smallCount >= 3 && (
              <p className="flex items-start gap-2 rounded-element bg-muted px-4 py-3 text-xs leading-5 text-foreground-muted">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{fteTooManySmallNote(smallCount)}</span>
              </p>
            )}
            {/* 이름이 빈 신규 제안은 저장되지 않아 배분 대상에서도 빠진다 — STEP 2로 돌아갈 길을 준다. */}
            {unnamedCount > 0 && (
              <p className="flex items-start gap-2 rounded-element bg-warning-muted px-4 py-3 text-xs leading-5 text-warning">
                <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  {GATE_STEP2_NEW_TASK_NAME}{' '}
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
                  >
                    {STEP_TITLES[1]}
                  </button>
                </span>
              </p>
            )}
          </div>
        </div>

        <TotalGauge layout="side" total={total} showNav={showNav} goToStep={goToStep} />
      </div>

      <TotalGauge layout="bar" total={total} showNav={showNav} goToStep={goToStep} />

      {revertTo && (
        <ModalShell
          title={FTE_SINGLE_100_MODAL.title}
          onClose={() => setRevertTo(null)}
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setRows(revertTo);
                  onDirty();
                  setRevertTo(null);
                }}
              >
                {FTE_SINGLE_100_MODAL.cancel}
              </Button>
              <Button onClick={() => setRevertTo(null)}>{FTE_SINGLE_100_MODAL.confirm}</Button>
            </>
          }
        >
          <p className="text-sm leading-6 text-foreground-muted">{FTE_SINGLE_100_MODAL.body}</p>
        </ModalShell>
      )}
    </section>
  );
}

export default FteStep;
