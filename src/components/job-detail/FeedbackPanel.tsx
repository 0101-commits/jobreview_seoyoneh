/*
 * 직무 상세의 SME 검토 의견 패널과 표시 조각 (v2 D5 파일 분해).
 *
 * JobDetailPage.tsx는 1,379줄이었다. 편집기(직무명·과업·Skill·수행요건)와 이 패널이 한 파일에
 * 있어서, 패널 문구 한 줄을 고칠 때도 편집 상태 30여 개를 스크롤해서 지나야 했다(기획안 §7 D5).
 * 편집기는 그대로 두고, "보여 주는 쪽"만 이 파일로 옮겼다 — 상태를 들지 않으므로 안전한 경계다.
 */
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { mapReviewStatus } from '@/lib/jobApi';
import { toFeedbackState, type SmeReviewFeedback, type SuitabilityLabel } from '@/lib/reviewApi';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';

/**
 * 편집기 쪽 입력 칸의 id 규칙. 패널의 「이 항목으로 이동」이 그 칸을 focus 하려면 같은 규칙이어야 한다.
 * 규칙을 바꿀 때는 JobDetailPage.tsx의 fieldId와 함께 바꾼다(문자열이 계약이다).
 */
const fieldId = (key: string) => `jobfield-${key}`;

const SUIT_STYLE: Record<
  Exclude<SuitabilityLabel, ''> | 'none',
  { cls: string; Icon: typeof CheckCircle2; rank: number }
> = {
  부적합: { cls: 'border-destructive-border bg-destructive-muted text-destructive', Icon: XCircle, rank: 0 },
  '일부 수정 필요': { cls: 'border-warning-border bg-warning-muted text-warning', Icon: AlertTriangle, rank: 1 },
  적합: { cls: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2, rank: 2 },
  none: { cls: 'border-border bg-muted text-foreground-muted', Icon: MessageSquare, rank: 3 },
};

const suitStyle = (label: SuitabilityLabel) => (label ? SUIT_STYLE[label] : SUIT_STYLE.none);

function formatWhen(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface PanelProps {
  data: SmeReviewFeedback[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onFocusField: (key: string) => void;
  labelFor: (key: string) => { kind: string; name: string };
  onRequestRereview: (review: SmeReviewFeedback) => void;
}

export function SmeFeedbackPanel({
  data,
  loading,
  error,
  onRetry,
  onFocusField,
  labelFor,
  onRequestRereview,
  focusSmeId,
}: PanelProps & { focusSmeId?: string | null }) {
  // 검토 현황에서 넘어온 경우 그 SME 카드로 스크롤한다. 목록이 도착한 뒤 한 번만 움직인다.
  useEffect(() => {
    if (!focusSmeId || data.length === 0) return;
    const el = document.getElementById(`sme-card-${focusSmeId}`);
    el?.scrollIntoView({ block: 'center' });
  }, [focusSmeId, data.length]);

  return (
    <aside className="rounded-container border border-border bg-card p-5 shadow-1 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
      <div className="mb-4 flex items-center gap-2">
        <Users size={16} className="text-primary" aria-hidden="true" />
        <h3 className="t-headline text-foreground">SME 검토 의견</h3>
        {!loading && !error && data.length > 0 && (
          <span className="rounded-full bg-primary-subtle px-2 py-0.5 t-caption font-medium text-primary">
            {data.length}명
          </span>
        )}
      </div>

      {loading && (
        <p className="flex items-center gap-2 py-6 t-label text-foreground-subtle">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> 검토 의견을 불러오는 중이에요…
        </p>
      )}

      {!loading && error && (
        <div className="rounded-element border border-destructive-border bg-destructive-muted p-4">
          <p className="flex items-start gap-2 t-label-reading text-destructive">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
            <RefreshCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <p className="rounded-element bg-muted px-4 py-8 text-center t-label text-foreground-subtle">
          아직 제출된 검토가 없습니다.
        </p>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-4">
          {data.map((review) => (
            <ReviewCard
              key={review.review_id}
              focused={review.sme_id === focusSmeId}
              review={review}
              onFocusField={onFocusField}
              labelFor={labelFor}
              onRequestRereview={onRequestRereview}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function ReviewCard({
  review,
  onFocusField,
  labelFor,
  onRequestRereview,
  focused = false,
}: {
  review: SmeReviewFeedback;
  onFocusField: (key: string) => void;
  labelFor: (key: string) => { kind: string; name: string };
  onRequestRereview: (review: SmeReviewFeedback) => void;
  /** 검토 현황에서 이 SME를 보러 온 경우 — 테두리로 표시한다(색만으로 알리지 않게 스크롤도 함께). */
  focused?: boolean;
}) {
  // 저장된 값 → 화면 라벨 변환은 reviewApi의 변환기를 그대로 쓴다.
  const items = Object.entries(toFeedbackState(review.feedback))
    .map(([key, f]) => ({ key, ...f }))
    .sort((a, b) => suitStyle(a.suitability).rank - suitStyle(b.suitability).rank);

  const when = formatWhen(review.submitted_at) || formatWhen(review.last_saved_at);
  const canRerequest = review.status === 'SUBMITTED' || review.status === 'RESUBMITTED';

  return (
    <article
      id={`sme-card-${review.sme_id}`}
      className={`rounded-element border p-4 ${focused ? 'border-primary bg-primary-subtle' : 'border-border'}`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="t-label font-semibold text-foreground">{review.sme_name || '이름 미등록'}</span>
        {review.organization && <span className="t-caption text-foreground-subtle">{review.organization}</span>}
        <StatusBadge status={mapReviewStatus(review.status)} />
        {when && <span className="w-full t-caption text-foreground-subtle">{when}</span>}
      </header>

      {items.length === 0 && review.feedback.newTasks.length === 0 && review.feedback.newSkills.length === 0 ? (
        <p className="t-label text-foreground-subtle">항목별 의견 없이 제출했어요.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const { cls, Icon } = suitStyle(item.suitability);
            const { kind, name } = labelFor(item.key);
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onFocusField(item.key)}
                  className={`w-full rounded-element border p-3 text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${cls}`}
                >
                  <span className="flex items-center gap-1.5 t-caption font-semibold">
                    <Icon size={14} className="shrink-0" aria-hidden="true" />
                    {item.suitability || '의견'}
                    {item.remove && (
                      <span className="ml-1 rounded bg-black/10 px-1.5 py-0.5 t-caption-2">삭제 요청</span>
                    )}
                  </span>
                  <span className="mt-1 block t-caption text-foreground-subtle">{kind}</span>
                  <span className="block t-label font-medium text-foreground">{name}</span>
                  {item.comment && (
                    <span className="mt-1 block t-label-reading text-foreground-muted">{item.comment}</span>
                  )}
                  {item.suggestion && (
                    <span className="mt-1 block t-label-reading text-foreground-muted">
                      <span className="font-medium">제안</span> {item.suggestion}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SuggestionList title="새로 제안한 과업" items={review.feedback.newTasks} />
      <SuggestionList title="새로 제안한 Skill" items={review.feedback.newSkills} />

      {canRerequest && (
        <Button variant="secondary" size="sm" onClick={() => onRequestRereview(review)} className="mt-3 w-full">
          <RotateCcw size={14} aria-hidden="true" /> 재검토 요청
        </Button>
      )}
    </article>
  );
}

function SuggestionList({
  title,
  items,
}: {
  title: string;
  items: { name: string; description: string; reason: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h5 className="mb-1.5 flex items-center gap-1.5 t-caption font-semibold text-foreground-muted">
        <Plus size={13} aria-hidden="true" /> {title}
      </h5>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={`${s.name}-${i}`} className="rounded-element bg-muted px-3 py-2 t-label">
            <span className="block font-medium text-foreground">{s.name}</span>
            {s.description && <span className="block text-foreground-muted">{s.description}</span>}
            {s.reason && <span className="block t-caption text-foreground-subtle">사유: {s.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RereviewModal({
  target,
  jobName,
  onClose,
  onSubmit,
}: {
  target: SmeReviewFeedback;
  jobName: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!note.trim()) {
      setError('SME가 무엇을 다시 봐야 하는지 알 수 있도록 사유를 적어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(note.trim());
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '재검토를 요청하지 못했어요. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="재검토 요청"
      description={`${target.sme_name || 'SME'} 님에게 「${jobName}」 검토를 다시 요청합니다.`}
      size="lg"
      dirty={note.trim().length > 0}
      closeDisabled={busy}
      icon={<RotateCcw size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />}
      onClose={onClose}
      // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
      hideClose
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} loading={busy}>
            재검토 요청
          </Button>
        </>
      }
    >
      <Field
        label="반려 사유"
        required
        error={error ?? undefined}
        description="여기에 적은 내용은 검토 이력에 남고, SME 화면에 그대로 보여요."
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={5}
          className="w-full rounded-element border border-input p-3 t-label-reading text-foreground-muted outline-none focus:border-primary"
          placeholder="예) 3번 과업의 세부활동이 실제 업무와 달라 보여요. 담당하시는 범위 기준으로 다시 봐 주세요."
        />
      </Field>
    </ModalShell>
  );
}

/* ── 공용 조각 ─────────────────────────────────────────────────────── */

/** 순서 이동·삭제 묶음. 모바일 오탭이 곧 데이터 손실이라 삭제는 44px 타깃 + 간격을 둔다. */
export function RowActions({
  label,
  onUp,
  onDown,
  onDelete,
  upDisabled,
  downDisabled,
  deleteDisabled,
}: {
  label: string;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  upDisabled: boolean;
  downDisabled: boolean;
  /** 구조 편집 잠금(v2 F6) — 검토가 시작된 직무는 삭제를 막는다. */
  deleteDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" aria-label={`${label} 위로 이동`} onClick={onUp} disabled={upDisabled}>
        <ArrowUp size={15} aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="sm" aria-label={`${label} 아래로 이동`} onClick={onDown} disabled={downDisabled}>
        <ArrowDown size={15} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${label} 삭제`}
        onClick={onDelete}
        disabled={deleteDisabled}
        className="ml-2 text-destructive hover:bg-destructive-muted"
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-container border border-border bg-card p-6 shadow-1">
      <h3 className="mb-5 t-headline text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-element bg-muted px-4 py-6 text-center t-label text-foreground-subtle">{children}</p>;
}

export function SkillGroup({
  label,
  skills,
  accent,
  highlightClass,
}: {
  label: string;
  skills: { id?: string; name: string }[];
  accent: 'teal' | 'navy';
  highlightClass: (key: string) => string;
}) {
  const chipClass =
    accent === 'teal'
      ? 'bg-primary-subtle text-primary border-primary-border'
      : 'bg-fill-alt text-foreground border-border';
  return (
    <div>
      <h4 className="mb-3 t-label font-semibold text-foreground-muted">{label}</h4>
      {skills.length === 0 ? (
        <p className="t-label text-foreground-subtle">등록된 {label}이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {skills.map((s, i) => (
            <span
              key={s.id ?? `${s.name}-${i}`}
              id={s.id ? fieldId(`skill-${s.id}`) : undefined}
              tabIndex={s.id ? -1 : undefined}
              className={`rounded-full border px-3 py-1.5 t-label font-medium ${chipClass} ${s.id ? highlightClass(`skill-${s.id}`) : ''}`}
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
