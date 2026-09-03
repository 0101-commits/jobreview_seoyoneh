/*
 * STEP 3 — 투입 비중(FTE) 배분 화면 (§6-2 "STEP 3 상세" · 그림 6-A · v2 §5-3).
 *
 * 대상 목록·입력 방식·합계 게이지·품질 가드 ⓐⓑⓒ·겸직 표기가 원래 명세이고,
 * v2에서 「이 과업 다시 보기」가 더해졌다 — STEP 2로 돌아가지 않고 이 자리에서
 * 적합성·의견·수정 제안·삭제 제안·세부활동 의견을 고칠 수 있다(옵션 C).
 *
 * 상태를 여기서 들지 않는다. 대상(targets)과 값(rows)은 셸(SmeReviewPage)이 들고 내려 준다.
 *  - 대상: STEP 2의 삭제 제안·신규 제안이 바뀌는 즉시 다시 계산된다(§10 P2 DoD ①).
 *    셸이 대상을 만들 때 쓰라고 buildFteTargets를 함께 내보낸다 — 규칙이 두 벌로 갈라지지 않게.
 *  - 값: 바꾸면 setRows로 셸에 올리고 onDirty()를 부른다. 저장은 셸의 자동 저장(2.5초)이 한다.
 *  - 펼침 안의 편집은 STEP 2와 같은 상태를 고친다(update / setNewTasks). 저장 경로도 같다.
 *
 * 신규 제안 배분의 연결고리는 client_key다(v2 F5). 화면 키가 `sug-{client_key}`이고
 * 서버(save_review_draft p_fte)가 같은 트랜잭션에서 그 키로 제안 행을 찾는다 —
 * 이름으로 되짚거나 배열 인덱스를 보정하는 코드는 모두 사라졌다.
 */
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import type { JobDetail } from '@/lib/jobApi';
import { newSuggestion, type SuggestionInput } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import { AutoTextarea, FeedbackNotes, SuitabilityControl } from './controls';
import {
  FTE_DONE_LINE,
  FTE_EQUAL_SPLIT_BUTTON,
  FTE_INPUT_HINT,
  FTE_INTRO,
  FTE_MOONLIGHTING_NOTE,
  FTE_NEXT_BLOCKED_BUTTON,
  FTE_PERIOD_BASIS,
  FTE_SINGLE_100_MODAL,
  FTE_STEP_PCT,
  FTE_SUGGESTED_BADGE,
  FTE_TOTAL_LABEL,
  ACTIVITY_NOTE_HINT,
  ACTIVITY_REMOVE_LABEL,
  ACTIVITY_SECTION_LABEL,
  FTE_ADD_TASK_BUTTON,
  FTE_REOPEN_BUTTON,
  FTE_REOPEN_CLOSE_BUTTON,
  FTE_REOPEN_NOTE,
  FTE_RESTORE_BUTTON,
  GATE_STEP2_NEW_TASK_NAME,
  NEXT_STEP_BUTTON,
  PREV_STEP_BUTTON,
  STEP_TITLES,
  activityCommentLabel,
  fteExcludedRestoreLine,
  fteGaugeValueText,
  fteInputLabel,
  fteOverLine,
  fteRemainingLine,
  fteStepDownLabel,
  fteStepUpLabel,
  fteSuggestedNameChip,
  fteTooManySmallNote,
  fteZeroPctNote,
} from './copy';
import type { FteExcluded, FteRow, FteStepProps, FteTarget, StepNo } from './wizardTypes';

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
 * STEP 2 결과 → 배분 대상(§6-2 "대상 목록" · v2 §5-3). 셸이 STEP 2 상태에서 이 함수로 targets를 만든다.
 *
 * 유지 과업 + 이름이 있는 신규 제안만 대상이고, 삭제 제안한 과업은 excluded로 따로 돌려준다
 * (STEP 3에서 되살릴 수 있어야 이름이 필요하다).
 * 이름이 빈 신규 제안은 저장되지 않는 항목이라(reviewApi.buildDraftPayload) 대상에서 뺀다.
 *
 * 같은 이름의 제안 두 줄도 각각 대상이 된다 — 키가 client_key이고 서버도 같은 키로 맞추므로,
 * 이름 중복이 더 이상 한 줄로 합쳐지지 않는다(v2 F5).
 */
export function buildFteTargets(
  tasks: JobDetail['tasks'],
  feedback: Record<string, Feedback>,
  newTasks: SuggestionInput[],
): { targets: FteTarget[]; excluded: FteExcluded[] } {
  const targets: FteTarget[] = [];
  const excluded: FteExcluded[] = [];

  for (const task of tasks) {
    const f = feedback[`task-${task.id}`];
    if (f?.remove) {
      excluded.push({ taskId: task.id, name: task.name });
      continue;
    }
    targets.push({
      key: `task-${task.id}`,
      targetType: 'EXISTING',
      taskId: task.id,
      clientKey: null,
      name: task.name,
      description: task.description,
      isNew: false,
      suitability: f?.suitability || '',
      suggestedName: (f?.suggestion || '').trim(),
      activities: (task.task_activities || []).map((a) => ({ id: a.id, name: a.activity_name })),
    });
  }

  for (const item of newTasks) {
    const name = item.name.trim();
    if (!name) continue;
    targets.push({
      key: `sug-${item.client_key}`,
      targetType: 'SUGGESTED',
      taskId: null,
      clientKey: item.client_key,
      name,
      description: item.description,
      isNew: true,
      suitability: '',
      suggestedName: '',
      activities: [],
    });
  }

  return { targets, excluded };
}

// ── 합계 게이지 ─────────────────────────────────────────────────────

/**
 * 100% 미만이면 잔여, 초과면 초과분을 안내한다. 색만으로 알리지 않도록 아이콘·문구를 함께 둔다.
 * 100%(완료)도 문구를 비워 두지 않는다 — 비워 두면 "다 됐다"를 알리는 단서가 초록색 하나뿐이라
 * 색각 이상 사용자와 화면 낭독기 사용자에게는 미달 상태와 구분되지 않는다.
 */
function statusOf(total: number) {
  if (total > 100) return { text: fteOverLine(total - 100), tone: 'text-destructive', Icon: AlertTriangle };
  if (total < 100) return { text: fteRemainingLine(100 - total), tone: 'text-foreground-muted', Icon: Info };
  return { text: FTE_DONE_LINE, tone: 'text-success', Icon: CheckCircle2 };
}

/** 비중 입력 칸이 모두 함께 참조하는 단위·범위 안내(aria-describedby)의 id. 화면에는 한 번만 그린다. */
const PCT_HINT_ID = 'fte-pct-hint';

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
  //
  // 알림을 어디에 걸었는가: progressbar가 아니라 이 읽기 영역에 aria-live="polite"를 건다.
  // progressbar 자체에 aria-live를 걸면 값이 바뀔 때마다 낭독기가 "배분 합계 95%"를 한 번,
  // 바로 아래 문단("95% / 100%, 잔여 5%를 배분해 주세요")을 또 한 번 읽어 같은 내용이 겹친다.
  // 진행 막대는 값을 들고만 있고(aria-valuenow·valuetext), 변화를 말하는 일은 이 영역이 맡는다.
  const readout = (
    <div aria-live="polite" className={layout === 'side' ? 'mt-3 text-center' : 'min-w-0'}>
      <p className="t-label font-semibold text-foreground">
        {total}% <span className="font-normal text-foreground-subtle">/ 100%</span>
      </p>
      {status.text && (
        <p
          className={`mt-1 flex items-start gap-1.5 t-caption ${status.tone} ${
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
      // 사이드바 하단의 로그아웃 버튼을 가린다(같은 z-drawer라 나중에 그려지는 바가 이긴다).
      <div className="fixed bottom-0 left-0 right-0 z-drawer border-t border-border bg-elevated px-4 py-3 lg:left-64 xl:hidden">
        {/* aria-valuenow는 filled(0~100)로 자른다 — 105%처럼 max를 넘는 값은 ARIA가 정의하지 않은
            상태라 낭독기마다 다르게(또는 아예 읽지 않고) 처리한다. 실제 합계와 사유는 valuetext가 말한다. */}
        <div
          role="progressbar"
          aria-label={FTE_TOTAL_LABEL}
          aria-valuenow={filled}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={fteGaugeValueText(total)}
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
      <p className="t-label font-semibold text-foreground">{FTE_TOTAL_LABEL}</p>
      <div
        role="progressbar"
        aria-label={FTE_TOTAL_LABEL}
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={fteGaugeValueText(total)}
        className="mx-auto mt-4 grid h-28 w-28 place-items-center rounded-full"
        style={{
          background: `conic-gradient(${
            total > 100 ? 'rgb(var(--destructive))' : done ? 'rgb(var(--success))' : 'rgb(var(--primary))'
          } ${filled * 3.6}deg, rgb(var(--muted)) 0deg)`,
        }}
      >
        <span
          aria-hidden="true"
          className="grid h-20 w-20 place-items-center rounded-full bg-card t-headline text-foreground"
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
  excluded,
  feedback,
  update,
  newTasks,
  setNewTasks,
  onDirty,
  goToStep,
  showNav = true,
}: FteStepProps & { showNav?: boolean }) {
  /** 「다시 보기」로 펼친 행. 기본은 전부 접힘이다(모바일 390px에서 행 밀도를 지키기 위해). */
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const toggleOpen = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // 사본을 만들지 않는다. 대상이 바뀌면(STEP 2 편집) 이 파생값이 같은 렌더에서 함께 바뀐다.
  const pcts = useMemo(() => ftePctMap(targets, rows), [targets, rows]);
  const total = useMemo(() => {
    let sum = 0;
    for (const pct of pcts.values()) sum += pct;
    return sum;
  }, [pcts]);

  /** 가드 ⓐ에서 "다시 배분할게요"를 누르면 돌아갈 직전 값. null이면 모달이 닫힌 상태다. */
  const [revertTo, setRevertTo] = useState<FteRow[] | null>(null);
  // 균등 배분 덮어쓰기 확인(v2 §6-4 — window.confirm 대체).
  const { confirm, dialog } = useConfirm();

  /*
    삭제 제안으로 대상에서 빠진 행의 이전 비중. 셸이 rows에 그대로 남겨 두므로(주차) 되살리면
    같은 값이 돌아온다 — 자동 재배분은 하지 않는다(응답자의 판단을 기계가 대신하면 E2가 왜곡된다).
  */
  const parkedPct = useMemo(() => {
    const keys = new Set(excluded.map((ex) => `task-${ex.taskId}`));
    return rows.filter((r) => keys.has(r.key)).reduce((sum, r) => sum + normalizePct(r.pct), 0);
  }, [excluded, rows]);

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

  const onEqualSplit = async () => {
    if (readOnly || targets.length === 0) return;
    // 덮어쓰기 확인 — 문구는 기획안에 없어 새로 씀. 이미 배분한 값이 말없이 사라지지 않게 한 번 묻는다.
    if (
      total > 0 &&
      !(await confirm({
        title: '균등하게 다시 배분할까요?',
        body: '이미 입력한 비중이 지워지고 과업 수에 맞춰 고르게 나눠집니다.',
        confirmLabel: '다시 배분',
        tone: 'negative',
      }))
    )
      return;
    const parts = equalSplit(targets.length);
    setRows(targets.map((t, i) => ({ key: t.key, pct: parts[i] })));
    onDirty();
  };

  /*
   * 키보드 조작(v3 T6). montage Slider 키보드 규약을 이 스텝퍼에 옮긴 것이다 —
   * 방향키 ±step, Shift·PageUp/PageDown ±step×10, Home은 최소, End는 최대.
   *
   * v2는 위·아래 화살표 두 키만 받았다. 과업이 스무 개인 직무를 키보드만으로 배분하려면
   * 5%씩 스무 번을 눌러야 했다. 안내 문구(FTE_INPUT_HINT)도 함께 고쳤다.
   */
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>, key: string) => {
    const big = FTE_STEP_PCT * 10;
    const current = pcts.get(key) ?? 0;

    if (e.key === 'Home') {
      e.preventDefault();
      setPct(key, 0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setPct(key, 100);
      return;
    }

    const dir =
      e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0;
    if (!dir) return;
    const jump = e.key === 'PageUp' || e.key === 'PageDown' || e.shiftKey;
    e.preventDefault();
    setPct(key, current + dir * (jump ? big : FTE_STEP_PCT));
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
        <span className="rounded-inner bg-card px-2 py-1 t-caption font-semibold text-primary">{FTE_PERIOD_BASIS}</span>
        <span className="t-caption leading-5 text-foreground-muted">{FTE_MOONLIGHTING_NOTE}</span>
      </div>

      <p className="mb-5 t-label-reading text-foreground-muted">{FTE_INTRO}</p>

      {/* 입력 칸 공통 안내. 그림 6-A에 이 문장을 놓을 자리가 없어 화면에는 감추고 보조기기에만 읽힌다
          (모든 입력 칸이 aria-describedby로 이 한 문장을 가리킨다). */}
      <p id={PCT_HINT_ID} className="sr-only">
        {FTE_INPUT_HINT}
      </p>

      <div className="grid gap-6 xl:grid-cols-[1fr_16rem] xl:items-start">
        <div>
          {targets.length === 0 ? (
            // 배분할 과업이 하나도 없는 경우 — 문구는 기획안에 없어 새로 씀.
            <p className="rounded-element bg-muted px-4 py-6 text-center t-label text-foreground-muted">
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
                const open = openKeys.has(t.key);
                return (
                  <li key={t.key} className="rounded-element border border-border bg-card p-3 sm:p-4">
                    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                      <p className="min-w-0 flex-1 font-medium text-foreground">{t.name}</p>
                      {/* STEP 2 판정을 배분 행에서도 읽을 수 있게 한다(v2 §5-3 "행 머리에 STEP 2 결과"). */}
                      {t.suitability && <SuitabilityChip value={t.suitability} />}
                      {t.isNew && (
                        <span className="shrink-0 rounded-inner bg-primary-subtle px-2 py-0.5 t-caption-2 font-semibold text-primary">
                          {FTE_SUGGESTED_BADGE}
                        </span>
                      )}
                    </div>
                    {/* 수정 제안명 — 관리자 비교 뷰와 같은 문언으로 붙인다. */}
                    {t.suggestedName && (
                      <p className="mt-1 t-caption font-medium text-primary">{fteSuggestedNameChip(t.suggestedName)}</p>
                    )}
                    {t.description && <p className="mt-1 t-caption leading-5 text-foreground-muted">{t.description}</p>}

                    {/* 좁은 폭·큰 글꼴에서는 줄을 바꿔 넘치지 않게 한다(막대가 flex-1이라 스스로 다음 줄을 채운다). */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => bump(t.key, -FTE_STEP_PCT)}
                        disabled={readOnly}
                        aria-disabled={pct === 0}
                        // 아이콘만 있는 버튼이라 이름을 직접 준다. 과업명이 빠지면 목록의 스텝퍼가
                        // 전부 "5% 줄이기 버튼"으로 똑같이 읽혀 어느 과업인지 알 수 없다.
                        aria-label={fteStepDownLabel(t.name)}
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
                        // 과업명만으로는 무엇을 넣는 칸인지 알 수 없어 "투입 비중"을 붙인다.
                        // 단위·범위·화살표 키 조작은 목록 위 안내(PCT_HINT_ID)가 대신 읽힌다 —
                        // 25개 행마다 같은 문장을 되풀이하지 않으려고 한 문장을 모두가 참조한다.
                        aria-label={fteInputLabel(t.name)}
                        aria-describedby={PCT_HINT_ID}
                        /*
                          숫자를 올리고 내리는 칸이라는 사실과 값의 범위를 보조기기에 알린다(v3 T6).
                          v2는 aria-label만 있어 "지금 몇 %인지 · 어디까지 갈 수 있는지"가
                          낭독기에 전달되지 않았다. 막대는 aria-hidden이라 그 정보를 대신하지 못한다.
                        */
                        role="spinbutton"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuetext={`${pct}%`}
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
                      <span className="shrink-0 t-label font-semibold text-foreground">%</span>
                      <button
                        type="button"
                        onClick={() => bump(t.key, FTE_STEP_PCT)}
                        disabled={readOnly}
                        aria-disabled={pct === 100}
                        aria-label={fteStepUpLabel(t.name)}
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
                      {/* 「다시 보기」 — STEP 2로 왕복하지 않고 이 자리에서 고친다(v2 옵션 C). */}
                      <button
                        type="button"
                        onClick={() => toggleOpen(t.key)}
                        aria-expanded={open}
                        className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 rounded-element px-2 t-caption font-medium text-primary transition hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {open ? FTE_REOPEN_CLOSE_BUTTON : FTE_REOPEN_BUTTON}
                        {open ? (
                          <ChevronUp size={14} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={14} aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {open && (
                      <TargetEditor
                        target={t}
                        readOnly={readOnly}
                        feedback={feedback}
                        update={update}
                        newTasks={newTasks}
                        setNewTasks={setNewTasks}
                        onDirty={onDirty}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 목록 하단 — 과업 추가 제안(v2 §5-3) */}
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => {
                setNewTasks([...newTasks, newSuggestion()]);
                onDirty();
              }}
              disabled={readOnly}
              className="w-full border-dashed"
            >
              <Plus size={15} aria-hidden="true" /> {FTE_ADD_TASK_BUTTON}
            </Button>
          </div>

          {/* 삭제 제안 제외 안내 · 되살리기 · 균등 배분으로 시작 */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {excluded.length > 0 && (
              <span className="t-caption text-foreground-muted">
                {fteExcludedRestoreLine(excluded.length, parkedPct)}
                {excluded.map((ex) => (
                  <button
                    key={ex.taskId}
                    type="button"
                    onClick={() => {
                      // STEP 2의 삭제 제안 체크를 그대로 해제한다 — 같은 상태, 같은 저장이다.
                      update(`task-${ex.taskId}`, { remove: false });
                    }}
                    disabled={readOnly}
                    className="ml-2 font-medium text-primary underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ex.name} {FTE_RESTORE_BUTTON}
                  </button>
                ))}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={onEqualSplit} disabled={readOnly || targets.length === 0}>
              {FTE_EQUAL_SPLIT_BUTTON}
            </Button>
          </div>

          {/*
            품질 가드 ⓑ·ⓒ — 막지 않고 알리기만 한다(§6-2 "허용은 하되 인지시킴").

            v3 T6: 한 번에 한 건만 띄운다. v2는 세 안내가 동시에 뜰 수 있었고(0% 과업 ·
            5% 미만 다수 분산 · 이름 빈 신규 제안), 상자 셋이 겹치면 무엇을 먼저 손대야
            하는지가 흐려졌다. montage 규약 — 한 화면에 여러 건이면 우선순위 하나만 남긴다.

            순서는 "손대야 하는 정도"다.
             ① 이름 빈 신규 제안 — 저장되지 않아 배분 대상에서 빠진다. 고치지 않으면 값이 사라진다.
             ② 0% 과업        — 허용되지만 제출 요약에 목록으로 남는다.
             ③ 5% 미만 다수     — 알려만 준다.
          */}
          <div className="mt-4">
            {unnamedCount > 0 ? (
              <p className="flex items-start gap-2 rounded-element bg-warning-muted px-4 py-3 t-caption leading-5 text-warning">
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
            ) : zeroCount > 0 && total > 0 ? (
              <p className="flex items-start gap-2 rounded-element bg-muted px-4 py-3 t-caption leading-5 text-foreground-muted">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{fteZeroPctNote(zeroCount)}</span>
              </p>
            ) : smallCount >= 3 ? (
              // 5% 미만이 3건 이상이면 "다수 분산"으로 본다(임계값은 §12에서 확정).
              <p className="flex items-start gap-2 rounded-element bg-muted px-4 py-3 t-caption leading-5 text-foreground-muted">
                <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{fteTooManySmallNote(smallCount)}</span>
              </p>
            ) : null}
          </div>
        </div>

        <TotalGauge layout="side" total={total} showNav={showNav} goToStep={goToStep} />
      </div>

      <TotalGauge layout="bar" total={total} showNav={showNav} goToStep={goToStep} />

      {dialog}

      {revertTo && (
        <ModalShell
          title={FTE_SINGLE_100_MODAL.title}
          onClose={() => setRevertTo(null)}
          // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
          hideClose
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
          <p className="t-label-reading text-foreground-muted">{FTE_SINGLE_100_MODAL.body}</p>
        </ModalShell>
      )}
    </section>
  );
}

// ── 행 머리 판정 칩 / 「다시 보기」 펼침 ─────────────────────────────

/** STEP 2 판정을 배분 행 머리에 작게 다시 보여 준다. 색만으로 알리지 않도록 문구를 그대로 쓴다. */
function SuitabilityChip({ value }: { value: string }) {
  const tone =
    value === '적합'
      ? 'bg-success-muted text-success'
      : value === '부적합'
        ? 'bg-destructive-muted text-destructive'
        : 'bg-warning-muted text-warning';
  return <span className={`shrink-0 rounded-inner px-2 py-0.5 t-caption font-semibold ${tone}`}>{value}</span>;
}

/**
 * 「다시 보기」 펼침(v2 §5-3). STEP 2의 편집 표면을 그대로 이 자리에 놓는다.
 *  · 기존 과업: 적합성·의견·수정 제안·삭제 제안 — feedback[`task-{id}`] 한 상태를 고친다.
 *  · 신규 제안: 이름·설명·이유 — newTasks의 그 줄(client_key로 찾는다)을 고친다.
 *  · 세부활동(결정 D2): 줄마다 의견·삭제 제안 — feedback[`act-{id}`]로 저장된다.
 * 새 상태를 만들지 않는 것이 핵심이다. 게이트·진행률·자동 저장은 그대로 셸의 것을 쓴다.
 */
function TargetEditor({
  target,
  readOnly,
  feedback,
  update,
  newTasks,
  setNewTasks,
  onDirty,
}: {
  target: FteTarget;
  readOnly: boolean;
  feedback: Record<string, Feedback>;
  update: (key: string, value: Partial<Feedback>) => void;
  newTasks: SuggestionInput[];
  setNewTasks: (items: SuggestionInput[]) => void;
  onDirty: () => void;
}) {
  const emptyFeedback: Feedback = { suitability: '', comment: '', suggestion: '' };

  if (target.targetType === 'SUGGESTED') {
    const index = newTasks.findIndex((t) => t.client_key === target.clientKey);
    if (index < 0) return null;
    const item = newTasks[index];
    const patch = (v: Partial<SuggestionInput>) => {
      setNewTasks(newTasks.map((t, i) => (i === index ? { ...t, ...v } : t)));
      onDirty();
    };
    return (
      <div className="mt-3 rounded-element border border-dashed border-primary-border bg-primary-subtle p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="t-caption font-semibold text-primary">신규 주요과업 제안</span>
          <button
            type="button"
            aria-label={`신규 주요과업 제안 ${item.name || index + 1} 삭제`}
            disabled={readOnly}
            onClick={() => {
              setNewTasks(newTasks.filter((_, i) => i !== index));
              onDirty();
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-element text-foreground-subtle transition hover:bg-destructive-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <label>
            <span className="label">과업명</span>
            <input
              className="input"
              value={item.name}
              disabled={readOnly}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="추가할 과업명을 입력해 주세요."
            />
          </label>
          <label>
            <span className="label">설명</span>
            <AutoTextarea
              value={item.description}
              onChange={(v) => patch({ description: v })}
              placeholder="어떤 일인지 적어 주세요."
            />
          </label>
          <label>
            <span className="label">추가가 필요한 이유</span>
            <AutoTextarea
              value={item.reason}
              onChange={(v) => patch({ reason: v })}
              placeholder="왜 필요한지 적어 주세요."
            />
          </label>
        </div>
        <p className="mt-3 t-caption text-primary">{FTE_REOPEN_NOTE}</p>
      </div>
    );
  }

  const key = `task-${target.taskId}`;
  const f = feedback[key] || emptyFeedback;
  return (
    <div className="mt-3 rounded-element border border-border bg-muted p-3 sm:p-4">
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_1fr]">
        <div>
          <span className="label">적합성 평가</span>
          <SuitabilityControl
            value={f.suitability}
            onChange={(v) => update(key, { suitability: v })}
            label={`${target.name} 적합성 평가`}
          />
          <label className="mt-3 flex min-h-11 items-center gap-2 t-caption text-foreground-muted">
            <input
              type="checkbox"
              checked={!!f.remove}
              disabled={readOnly}
              onChange={(e) => update(key, { remove: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--destructive))]"
            />
            이 과업은 삭제가 필요해요
          </label>
        </div>
        <FeedbackNotes feedback={f} onChange={(v) => update(key, v)} suggestionLabel="수정 제안" />
      </div>

      {/* 세부활동 — 배분 단위가 아니라 의견 단위다(결정 D2 · 계약 E3 과업 단위 유지). */}
      {target.activities.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="t-label-2 font-semibold text-foreground">{ACTIVITY_SECTION_LABEL}</p>
          <p className="mt-1 t-caption text-foreground-muted">{ACTIVITY_NOTE_HINT}</p>
          <ul className="mt-3 space-y-3">
            {target.activities.map((act) => {
              const actKey = `act-${act.id}`;
              const af = feedback[actKey] || emptyFeedback;
              return (
                <li key={act.id} className="rounded-element bg-card p-3">
                  <p className="t-label-2 font-medium text-foreground">{act.name}</p>
                  <div className="mt-2">
                    <AutoTextarea
                      value={af.comment}
                      onChange={(v) => update(actKey, { comment: v })}
                      placeholder="고칠 점이 있으면 적어 주세요."
                      aria-label={activityCommentLabel(act.name)}
                    />
                  </div>
                  <label className="mt-2 flex min-h-11 items-center gap-2 t-caption text-foreground-muted">
                    <input
                      type="checkbox"
                      checked={!!af.remove}
                      disabled={readOnly}
                      onChange={(e) => update(actKey, { remove: e.target.checked })}
                      className="h-4 w-4 accent-[rgb(var(--destructive))]"
                    />
                    {ACTIVITY_REMOVE_LABEL}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 t-caption text-foreground-muted">{FTE_REOPEN_NOTE}</p>
    </div>
  );
}

export default FteStep;
