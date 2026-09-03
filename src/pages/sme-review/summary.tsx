/*
 * SME 검토 화면의 표시 조각 — 접이식 안내 · 제출 요약 · 오류 패널 (v2 D5 파일 분해).
 *
 * SmeReviewPage.tsx는 1,182줄이었다. 저장·게이트·소요 기록 같은 "상태를 다루는 코드"와
 * 이 표시 조각들이 한 파일에 있어서, 제출 요약 문구를 고칠 때도 자동저장 로직을 지나야 했다
 * (기획안 §7 D5). 상태를 들지 않는 조각만 이 파일로 옮겼다.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { fteZeroTargets } from './fte';
import { STEP_TITLES, fteZeroPctNote, gateStep5Missing } from './copy';
import { SectionHeading } from './controls';
import type { MissingItem } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import type { FteRow, FteTarget, StepNo } from './wizardTypes';
import type { StepChecklistItem } from './wizard';

/** 서버가 돌려준 부족 항목의 step은 0(가이드)이나 범위 밖일 수 있다. 화면 이동은 1~5로만 한다. */
const toStepNo = (n: number): StepNo => (n >= 1 && n <= 5 ? (n as StepNo) : 5);


/**
 * 접이식 안내 상자 — §6-1 "각 단계 상단에도 해당 단계 축약 가이드를 접이식으로 상시 노출"과
 * §6-2 STEP 2의 "직군별 작성 예시 팝오버"가 쓴다.
 * <details>를 그대로 쓴다 — 열고 닫기·키보드 조작·보조기기 노출을 브라우저가 이미 한다
 * (fieldset disabled 안에서도 폼 컨트롤이 아니라 그대로 열린다).
 */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mb-5 rounded-element border border-border bg-muted">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {summary}
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm leading-6 text-foreground-muted">{children}</div>
    </details>
  );
}

// ── STEP 5 제출 요약(§6-2 STEP 5) ───────────────────────────────────
//
// 아래 라벨·안내 문장은 기획안 §6에 고정 문언이 없어 새로 쓴 것이다(§6-2는 "제출 요약"의 구성만 정한다).
// 0% 과업 안내와 부족 항목 문구만 copy.ts의 문장을 쓴다.

export function SubmitSummary({
  checklist,
  feedback,
  newTaskCount,
  newSkillCount,
  targets,
  rows,
  fteTotal,
  missing,
  goToStep,
  done,
  total,
}: {
  checklist: StepChecklistItem[];
  feedback: Record<string, Feedback>;
  newTaskCount: number;
  newSkillCount: number;
  targets: FteTarget[];
  rows: FteRow[];
  fteTotal: number;
  missing: MissingItem[];
  goToStep: (step: StepNo) => void;
  done: number;
  total: number;
}) {
  const entries = Object.values(feedback);
  const revisedCount = entries.filter((f) => f.suggestion.trim()).length;
  const removeCount = entries.filter((f) => f.remove).length;

  const pctByKey = new Map(rows.map((r) => [r.key, r.pct]));
  const top3 = targets
    .map((t) => ({ name: t.name, pct: pctByKey.get(t.key) || 0 }))
    .filter((t) => t.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  // 품질 가드 ⓑ — 0% 과업 목록은 STEP 3 화면과 같은 함수로 뽑는다.
  const zero = fteZeroTargets(targets, rows);

  // 서버 게이트에 걸리면 이 패널이 화면 맨 위에 그려진다. 사용자는 그 800~1200px 아래의
  // '최종 제출'을 누른 참이라, 끌어오지 않으면 모달만 닫히고 아무 일도 없었던 것처럼 보인다.
  const missingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (missing.length === 0) return;
    missingRef.current?.focus({ preventScroll: true });
    missingRef.current?.scrollIntoView({ block: 'center' });
  }, [missing]);

  // 서버가 돌려준 부족 항목을 단계별로 묶는다. 어느 단계로 가야 하는지가 목록의 핵심이다.
  const byStep = new Map<StepNo, MissingItem[]>();
  for (const item of missing) {
    const step = toStepNo(item.step);
    byStep.set(step, [...(byStep.get(step) || []), item]);
  }

  return (
    <div>
      <SectionHeading title={STEP_TITLES[4]} done={done} total={total} />

      {missing.length > 0 && (
        <div
          ref={missingRef}
          tabIndex={-1}
          role="alert"
          className="mb-6 rounded-element border border-warning-border bg-warning-muted px-4 py-3 text-sm text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
        >
          <p className="font-medium">{gateStep5Missing(missing.length)}</p>
          <div className="mt-3 space-y-3">
            {[...byStep.entries()].map(([step, items]) => (
              <div key={step}>
                <p className="text-xs font-semibold">{STEP_TITLES[step - 1]}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5">
                  {items.map((m, i) => (
                    <li key={`${m.kind}-${i}`}>{m.label}</li>
                  ))}
                </ul>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => goToStep(step)}>
                  STEP {step}으로 이동
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h4 className="mb-3 font-semibold text-foreground">단계별 완료 현황</h4>
      <ul className="mb-8 space-y-2">
        {checklist.slice(0, 4).map((it) => (
          <li
            key={it.step}
            className="flex flex-wrap items-center justify-between gap-2 rounded-element border border-border px-4 py-3"
          >
            <span className="min-w-0 text-sm text-foreground">{STEP_TITLES[it.step - 1]}</span>
            <span className="flex items-center gap-3">
              <span className={`text-xs font-medium ${it.complete ? 'text-success' : 'text-warning'}`}>
                {it.complete ? '완료' : '미완료'}
                {it.total > 0 ? ` · ${it.done}/${it.total}` : ''}
              </span>
              {!it.complete && (
                <Button size="sm" variant="secondary" onClick={() => goToStep(it.step)}>
                  STEP {it.step}으로 이동
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <h4 className="mb-3 font-semibold text-foreground">제안 요약</h4>
      <ul className="mb-8 grid gap-2 sm:grid-cols-3">
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          수정 제안 <strong className="text-foreground">{revisedCount}</strong>건
        </li>
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          신규 제안 과업 <strong className="text-foreground">{newTaskCount}</strong>건 · Skill{' '}
          <strong className="text-foreground">{newSkillCount}</strong>건
        </li>
        <li className="rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          삭제 제안 <strong className="text-foreground">{removeCount}</strong>건
        </li>
      </ul>

      <h4 className="mb-3 font-semibold text-foreground">투입 비중 상위 과업 (합계 {fteTotal}%)</h4>
      {top3.length === 0 ? (
        <p className="mb-8 rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted">
          아직 투입 비중을 배분하지 않았어요.
        </p>
      ) : (
        <ol className="mb-8 space-y-2">
          {top3.map((t, i) => (
            <li
              key={t.name}
              className="flex items-center justify-between gap-3 rounded-element border border-border px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm text-foreground">
                {i + 1}. {t.name}
              </span>
              <span className="shrink-0 text-sm font-semibold text-primary">{t.pct}%</span>
            </li>
          ))}
        </ol>
      )}

      {zero.length > 0 && (
        <div className="rounded-element border border-border bg-muted px-4 py-3">
          <p className="text-sm text-foreground-muted">{fteZeroPctNote(zero.length)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-foreground-subtle">
            {zero.map((t) => (
              <li key={t.name}>{t.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ErrorPanel({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return (
    <div className="rounded-element border border-destructive-border bg-destructive-muted p-8 text-center">
      <AlertCircle size={20} className="mx-auto mb-2 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="mt-1 text-xs text-destructive">{detail}</p>
      <p className="mt-1 text-xs text-foreground-muted">
        네트워크 상태를 확인한 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.
      </p>
      <Button variant="secondary" onClick={onRetry} className="mt-4">
        <RefreshCw size={14} aria-hidden="true" /> 다시 시도
      </Button>
    </div>
  );
}
