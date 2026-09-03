/*
 * SME 검증 마법사(§6-2)의 셸 부품 — 단계 목록(StepChecklist) · 저장 상태 칩 · 단계 게이트 판정.
 *
 * 화면 조립은 SmeReviewPage.tsx가 하고, 이 파일에는 그 화면이 쓰는 조각과 판정 규칙만 둔다.
 * 판정 규칙을 화면 안에 두지 않는 이유는 하나다 — 게이트 조건은 서버 submit_review(§7-2)가
 * 같은 내용을 다시 검사한다. 두 곳이 갈라지면 "화면에서는 넘어가는데 제출만 막히는" 상태가 되므로
 * 클라이언트 쪽 조건은 한 함수(evaluateStep)에만 적는다.
 *
 * 화면 문구는 여기서 짓지 않는다. 전부 copy.ts(§6 고정 문언 단일 원천)에서 가져온다.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProgressTracker } from '@/components/ui/ProgressTracker';
import type { SuggestionInput } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import {
  GATE_BLOCKED_HEADING,
  GATE_STEP1_NOTE_REQUIRED,
  GATE_STEP1_SUITABILITY,
  GATE_STEP2_NEW_TASK_NAME,
  SAVE_CHIP_DIRTY,
  SAVE_CHIP_ERROR,
  SAVE_CHIP_ERROR_HELP,
  SAVE_CHIP_IDLE,
  SAVE_CHIP_JUST_NOW,
  SAVE_CHIP_RETRY,
  SAVE_CHIP_SAVED,
  SAVE_CHIP_SAVING,
  STEP_LABELS,
  STEP_NAV_LABEL,
  gateStep2Unrated,
  gateStep3Total,
  gateStep4Unrated,
  savedHoursAgo,
  savedMinutesAgo,
} from './copy';
import type { StepGateResult, StepNo } from './wizardTypes';

/** 저장 상태 4+1단계. 자동 저장(2.5초) 타이머가 'dirty'를 보고 돈다. */
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** 단계 번호 목록. 화면이 map으로 돌 때 쓴다. */
export const STEPS: readonly StepNo[] = [1, 2, 3, 4, 5] as const;

/**
 * 수행요건 3항목의 feedback 키.
 * STEP 4 게이트와 진행률이 같은 목록을 봐야 해서(둘이 갈라지면 "100%인데 못 넘어감"이 된다) 여기 둔다.
 */
export const REQ_KEYS = ['req-education', 'req-major', 'req-certifications'];

// ── 단계 게이트 ─────────────────────────────────────────────────────

/**
 * 게이트가 보는 값. JobDetail 전체가 아니라 id 목록만 받는다 —
 * 직무 상세를 아직 못 불러온 상태(null)에서도 훅 순서를 흔들지 않고 판정할 수 있어야 한다.
 */
export interface GateInput {
  tasks: { id: string }[];
  skills: { id: string }[];
  feedback: Record<string, Feedback>;
  newTasks: SuggestionInput[];
  /** STEP 3 배분 합계(%). 계산은 화면이 하고 이 함수는 판단만 한다. */
  fteTotal: number;
  /** STEP 3 배분 대상 수(fte.buildFteTargets 결과). 0이면 배분할 것이 없어 100% 규칙을 적용하지 않는다. */
  fteTargetCount: number;
}

/** numeric(5,2)와 같은 자리에서 비교한다. 0.1 + 0.2 같은 부동소수 오차로 100%가 99.999…가 되는 것을 막는다. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const isRated = (f: Feedback | undefined) => !!f?.suitability;

/** '부적합'·'일부 수정 필요'인데 의견도 수정안도 비어 있는 항목(§6-2 STEP 1 게이트). */
const needsNote = (f: Feedback | undefined) =>
  !!f &&
  (f.suitability === '부적합' || f.suitability === '일부 수정 필요') &&
  !f.comment.trim() &&
  !f.suggestion.trim();

/**
 * 단계별 다음 이동 게이트(§6-2 표).
 * reasons는 사용자에게 그대로 보여 줄 문구다(copy.ts의 GATE_* 문구).
 *
 * STEP 1은 §6-2 표에서 "직무 개요"로 한 덩어리지만 이 저장소의 화면은 A 직무명 / B 직무정의로 나뉜다.
 * 둘 다 STEP 1에 들어가므로 두 항목 모두를 같은 조건으로 본다.
 * STEP 5는 게이트가 없다 — 제출 버튼이 서버 submit_review를 부르고 그쪽이 최종 판정을 한다.
 */
export function evaluateStep(step: StepNo, s: GateInput): StepGateResult {
  const reasons: string[] = [];

  if (step === 1) {
    const items = [s.feedback.name, s.feedback.definition];
    if (items.some((f) => !isRated(f))) reasons.push(GATE_STEP1_SUITABILITY);
    if (items.some(needsNote)) reasons.push(GATE_STEP1_NOTE_REQUIRED);
  }

  if (step === 2) {
    const unrated = s.tasks.filter((t) => !isRated(s.feedback[`task-${t.id}`])).length;
    if (unrated > 0) reasons.push(gateStep2Unrated(unrated));
    if (s.newTasks.some((t) => !t.name.trim())) reasons.push(GATE_STEP2_NEW_TASK_NAME);
  }

  if (step === 3) {
    // 배분할 과업이 하나도 없는 직무(초안에 Task가 없고 신규 제안도 없는 경우)는 이 게이트를 건너뛴다.
    // 걸어 두면 사용자가 화면에서 할 수 있는 일이 없는데 다음 단계로도 못 가는 막다른 길이 된다.
    // 그런 검토는 서버 submit_review가 FTE_EMPTY로 잡아 STEP 5에서 사유와 함께 알려 준다.
    const total = round2(s.fteTotal);
    if (s.fteTargetCount > 0 && total !== 100) reasons.push(gateStep3Total(total));
  }

  if (step === 4) {
    const keys = [...s.skills.map((k) => `skill-${k.id}`), ...REQ_KEYS];
    const unrated = keys.filter((k) => !isRated(s.feedback[k])).length;
    if (unrated > 0) reasons.push(gateStep4Unrated(unrated));
  }

  return { ok: reasons.length === 0, reasons };
}

// ── StepChecklist ───────────────────────────────────────────────────

export interface StepChecklistItem {
  step: StepNo;
  /** 게이트 통과 여부. STEP 5는 제출 완료 여부를 넣는다(게이트가 없어 늘 통과이기 때문). */
  complete: boolean;
  /** 눌러서 갈 수 있는 단계인가. 이미 지난 단계와 앞 단계가 모두 통과한 단계만 열린다. */
  reachable: boolean;
  done: number;
  total: number;
}

/**
 * 단계 목록 — xl 이상에서는 좌측 세로, 그 아래에서는 상단 가로 배열(그림 6-A).
 * 기존 "검토 섹션" 목록의 마크업을 그대로 이어받아 같은 시각 언어를 유지한다.
 * 색만으로 상태를 알리지 않도록 완료는 체크 아이콘 + sr-only "완료"를 함께 둔다.
 */
export function StepChecklist({
  items,
  current,
  onSelect,
}: {
  items: StepChecklistItem[];
  current: StepNo;
  onSelect: (step: StepNo) => void;
}) {
  /*
    v2 §6-4: 단계 표시가 두 벌이었다(이 목록과 업로드 화면의 StepIndicator).
    표시는 공용 ProgressTracker 하나로 그리고, 이 파일은 마법사 사정만 남긴다 —
    라벨 사전(STEP_LABELS)·게이트로 결정되는 reachable·"3/12" 진행 표기·현재 단계 스크롤.

    가로/세로: xl 이상은 세로 목록, 그 아래는 가로 한 줄이다. ProgressTracker의 orientation을
    화면 폭에 따라 바꿔야 하므로 두 번 그리고 CSS로 하나만 보인다 —
    JS로 폭을 재면 첫 렌더에서 잘못된 방향이 한 번 그려진다.
  */
  const trackerItems = items.map((it) => ({
    step: it.step,
    label: STEP_LABELS[it.step - 1],
    complete: it.complete,
    reachable: it.reachable || it.step === current,
    hint: it.total > 0 ? `${it.done}/${it.total}` : undefined,
  }));

  // 가로 한 줄에서 현재 단계를 가운데로 끌어온다(390px에서는 2~3개만 보인다).
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current?.querySelector('[aria-current="step"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);

  return (
    <nav aria-label={STEP_NAV_LABEL} className="rounded-container border border-border bg-card p-3 shadow-1">
      <p className="hidden px-3 pb-2 t-caption font-semibold uppercase tracking-wider text-foreground-subtle xl:block">
        {STEP_NAV_LABEL}
      </p>
      <div ref={scrollerRef} className="overflow-x-auto pb-1 xl:hidden">
        <ProgressTracker
          items={trackerItems}
          current={current}
          orientation="horizontal"
          onSelect={(step) => onSelect(step as StepNo)}
          label={STEP_NAV_LABEL}
          className="min-w-max"
        />
      </div>
      <div className="hidden xl:block">
        <ProgressTracker
          items={trackerItems}
          current={current}
          orientation="vertical"
          onSelect={(step) => onSelect(step as StepNo)}
          label={STEP_NAV_LABEL}
        />
      </div>
    </nav>
  );
}

// ── 저장 상태 칩 ────────────────────────────────────────────────────

/** "방금 / 3분 전 / 2시간 전" — 그림 6-A의 "자동 저장됨 · 방금" 표기. 문언은 copy.ts에 있다. */
function relativeTime(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 60) return SAVE_CHIP_JUST_NOW;
  if (seconds < 3600) return savedMinutesAgo(Math.floor(seconds / 60));
  if (seconds < 86400) return savedHoursAgo(Math.floor(seconds / 3600));
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

/** 저장 시각이 화면에 그대로 굳지 않도록 30초마다 다시 그린다. */
function useRelativeTime(iso: string | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? relativeTime(iso) : '';
}

/**
 * 헤더 옆에 놓는 저장 상태 칩(그림 6-A). 기존 SaveIndicator를 칩 형태로 옮긴 것이다.
 * 실패했을 때만 "다시 저장" 버튼을 함께 띄운다 — 자동 저장은 실패를 알려 주지 않으면
 * 사용자가 저장된 줄 알고 화면을 떠난다.
 */
export function SaveStatusChip({
  state,
  error,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  error: string;
  savedAt: string | null;
  onRetry: () => void;
}) {
  const when = useRelativeTime(savedAt);

  // '다시 저장'을 누르면 곧바로 state가 'saving'이 된다. 그때 이 블록을 통째로 '저장 중…' 문단으로
  // 바꾸면 방금 누른 버튼이 언마운트되어 키보드 포커스가 body로 떨어진다(저장할 때마다 Tab을
  // 처음부터 다시 밟게 된다). 그래서 그 저장이 끝날 때까지 버튼 노드를 그대로 유지한다.
  // (저장이 아예 시작되지 않은 경우까지 받으려고 retrying도 함께 본다 — 그러지 않으면 state가
  //  'error' 그대로여서 effect가 다시 돌지 않고 '저장 중…'이 남는다.)
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (retrying && state !== 'saving') setRetrying(false);
  }, [state, retrying]);

  // 컨테이너는 항상 그린다 — aria-live 영역이 도중에 사라지면 이후 변화를 읽어 주지 않는다.
  return (
    <div role="status" aria-live="polite" className="min-w-0">
      {state === 'error' || retrying ? (
        <div className="flex flex-wrap items-center gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-1.5 t-caption text-destructive">
          <span className="flex items-center gap-1 font-medium">
            {retrying ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <CloudOff size={13} aria-hidden="true" />
            )}
            {retrying ? SAVE_CHIP_SAVING : SAVE_CHIP_ERROR}
          </span>
          {/* 사유(서버 메시지)만으로는 "내가 쓴 내용이 사라졌는지"를 알 수 없다.
              무엇이 잘못됐는지와 무엇을 하면 되는지를 한 덩어리로 붙여 준다. */}
          {!retrying && (
            <span className="min-w-0">
              {error} {SAVE_CHIP_ERROR_HELP}
            </span>
          )}
          {/* 저장 중에도 비활성으로 만들지 않는다 — 중복 호출은 셸의 savingRef가 이미 막는다. */}
          <Button
            size="sm"
            variant="secondary"
            aria-busy={retrying || undefined}
            onClick={() => {
              setRetrying(true);
              onRetry();
            }}
          >
            <RefreshCw size={13} aria-hidden="true" /> {SAVE_CHIP_RETRY}
          </Button>
        </div>
      ) : state === 'saving' ? (
        <p className="inline-flex items-center gap-1 rounded-element bg-muted px-3 py-1.5 t-caption text-foreground-muted">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" /> {SAVE_CHIP_SAVING}
        </p>
      ) : state === 'saved' ? (
        <p className="inline-flex items-center gap-1 rounded-element bg-success-muted px-3 py-1.5 t-caption text-success">
          <Check size={13} aria-hidden="true" /> {SAVE_CHIP_SAVED}
          {when ? ` · ${when}` : ''}
        </p>
      ) : state === 'dirty' ? (
        <p className="inline-flex items-center gap-1 rounded-element bg-warning-muted px-3 py-1.5 t-caption text-warning">
          <Loader2 size={13} aria-hidden="true" /> {SAVE_CHIP_DIRTY}
        </p>
      ) : (
        <p className="inline-flex items-center gap-1 rounded-element bg-muted px-3 py-1.5 t-caption text-foreground-subtle">
          {SAVE_CHIP_IDLE}
        </p>
      )}
    </div>
  );
}

// ── 게이트 안내 ─────────────────────────────────────────────────────

/**
 * "다음 단계"에서 막혔을 때 그 자리에 띄우는 사유 목록.
 * role="alert"라 화면 낭독기가 즉시 읽는다 — 버튼을 비활성으로 두면 왜 막혔는지 알 방법이 없다.
 *
 * 포커스도 함께 옮긴다(나타난 순간 한 번만 — 아래 주석). 사유는 버튼 위쪽에 나타나므로, 포커스가 '다음 단계' 버튼에 남아 있으면
 * 확대경 사용자는 화면 밖에 뜬 안내를 못 보고, 키보드 사용자는 사유를 읽으려고 Shift+Tab을 되짚어야 한다.
 *
 * 두 겹으로 나눈 이유 — 바깥 상자(tabIndex=-1)로 포커스를 옮기고 role="alert"는 안쪽에 둔다.
 * 한 요소에 둘을 겹치면 낭독기가 alert로 한 번, 포커스 이동으로 또 한 번 같은 내용을 읽는다.
 * (GOV.UK 오류 요약 패턴과 같은 구조다.)
 */
export function GateNotice({ reasons }: { reasons: string[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 포커스는 "이 안내가 화면에 나타난 순간" 한 번만 옮긴다.
  //
  // 사유 문구를 의존성으로 두면 안 된다. 사유는 입력에 따라 실시간으로 다시 쓰이므로
  // ("잔여 5%" → "잔여 3%"), 안내가 떠 있는 동안 STEP 3 비중 칸에 한 글자를 치거나 ± 스텝퍼를
  // 누를 때마다 포커스가 이 상자로 끌려온다. 그 상태에서는 키보드·화면 낭독기 사용자가 값을
  // 아예 입력할 수 없다(WCAG 2.1.1 키보드 · 3.2.2 입력 시 변화). 문구가 바뀐 사실은 안쪽
  // role="alert"가 알아서 다시 읽어 주므로 포커스를 뺏을 이유가 없다.
  //
  // "사용자가 명시적으로 요청한 순간"과 "문구만 갱신된 순간"의 구분은 마운트로 한다.
  // 이 컴포넌트는 SmeReviewPage의 showGate가 true일 때만 그려지고, showGate는 단계를 옮길 때마다
  // false로 돌아간다(goToStep · step 변경 useEffect). 즉 '다음 단계'를 눌러 게이트가 방금 실패로
  // 전환된 순간이 곧 이 컴포넌트의 마운트다. 반대로 안내가 이미 떠 있는데 버튼을 다시 누르면
  // setShowGate(true)가 같은 값이라 부모가 다시 그리지 않으므로, 그 재요청은 이 안에서 관측할
  // 방법이 없다 — 다만 그때는 안내가 이미 버튼 바로 위에 보이는 상태다.
  const focusMoved = useRef(false);
  useEffect(() => {
    if (focusMoved.current || reasons.length === 0) return;
    focusMoved.current = true;
    boxRef.current?.focus();
  }, [reasons.length]);

  if (reasons.length === 0) return null;
  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      className="mt-5 rounded-element border border-warning-border bg-warning-muted px-4 py-3 t-label text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
    >
      <div role="alert">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
          {GATE_BLOCKED_HEADING}
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 t-caption leading-5">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
