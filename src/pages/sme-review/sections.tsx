// SME 검토 화면의 섹션 렌더러 5종(A 직무명 / B 직무정의 / C 주요과업 / D Skill / E 수행요건).
import React from 'react';
import type { JobDetail } from '@/lib/jobApi';
import type { SuggestionInput } from '@/lib/reviewApi';
import type { Feedback } from '@/types';
import { TermHint } from '@/components/ui/TermHint';
import type { TermId } from './glossary';
import { HINT_STEP4_WHO } from './copy';
import {
  FeedbackNotes,
  ListControls,
  ReviewItemCard,
  SectionHeading,
  SuggestionEditor,
  SuitabilityControl,
} from './controls';

const EMPTY_FEEDBACK: Feedback = { suitability: '', comment: '', suggestion: '' };

/** 항목 카드 목록 공통 로직 — 미평가 필터 / 완료 접기 / 다음 항목 포커스 연결. */
function ItemList({
  items,
  feedback,
  update,
  openIds,
  onOpen,
  collapseDone,
  onlyUnrated,
  suggestionLabel,
}: {
  items: {
    key: string;
    eyebrow: string;
    title: string;
    counter?: string;
    details?: React.ReactNode;
    removeLabel?: string;
  }[];
  feedback: Record<string, Feedback>;
  update: (key: string, v: Partial<Feedback>) => void;
  openIds: Set<string>;
  onOpen: (key: string) => void;
  collapseDone: boolean;
  onlyUnrated: boolean;
  suggestionLabel?: string;
}) {
  const rated = (key: string) => !!feedback[key]?.suitability;
  const visible = onlyUnrated ? items.filter((it) => !rated(it.key)) : items;

  if (visible.length === 0) {
    return (
      <p className="rounded-element bg-muted px-4 py-6 text-center t-label text-foreground-muted">
        {items.length === 0
          ? '등록된 항목이 없습니다.'
          : '남은 항목이 없습니다. 「남은 항목만 보기」를 끄면 전체가 보입니다.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((it, i) => (
        <ReviewItemCard
          key={it.key}
          eyebrow={it.eyebrow}
          title={it.title}
          counter={it.counter}
          details={it.details}
          feedback={feedback[it.key] || EMPTY_FEEDBACK}
          onChange={(v) => {
            // 적합성 외의 입력은 "이 항목을 계속 보고 있다"는 뜻이라 접지 않는다.
            if (v.suitability === undefined) onOpen(it.key);
            update(it.key, v);
          }}
          collapsed={collapseDone && rated(it.key) && !openIds.has(it.key)}
          onExpand={() => onOpen(it.key)}
          focusId={`fb-${it.key}`}
          nextFocusId={visible[i + 1] ? `fb-${visible[i + 1].key}` : undefined}
          suggestionLabel={suggestionLabel}
          removeLabel={it.removeLabel}
        />
      ))}
    </div>
  );
}

// ── A. 직무명 / B. 직무정의 ─────────────────────────────────────────

export function FeedbackSection({
  title,
  term,
  current,
  feedback,
  update,
  suggestionLabel,
  large = false,
  done,
  total,
  hint,
}: {
  title: string;
  /** 제목 옆에 붙일 용어(v4 G1). */
  term?: TermId;
  current: string;
  feedback: Feedback;
  update: (value: Partial<Feedback>) => void;
  suggestionLabel: string;
  large?: boolean;
  done: number;
  total: number;
  /** 적합성 위 한 줄 안내(v4 G6). 첫 항목에만 준다 — 같은 화면에 두 번 나오면 잔소리가 된다. */
  hint?: string;
}) {
  return (
    <div>
      <SectionHeading title={title} done={done} total={total} term={term} />
      <div className="mb-6 rounded-element border border-border bg-muted p-4">
        <p className="mb-2 t-caption font-medium text-foreground-muted">현재 등록 내용</p>
        <p className={`t-label-reading text-foreground ${large ? 'min-h-20' : ''}`}>
          {current || <em className="not-italic text-foreground-subtle">미입력</em>}
        </p>
      </div>
      <span className="label">
        적합성 평가
        <TermHint id="suitability" />
      </span>
      {hint && <p className="mb-2 t-caption text-foreground-subtle">{hint}</p>}
      <div className="mb-5">
        <SuitabilityControl
          value={feedback.suitability}
          onChange={(v) => update({ suitability: v })}
          label={`${title} 적합성 평가`}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <FeedbackNotes feedback={feedback} onChange={update} suggestionLabel={suggestionLabel} minRows={4} />
      </div>
    </div>
  );
}

// ── C. 주요과업 및 세부활동 ─────────────────────────────────────────

export function TaskActivityFeedback({
  tasks,
  feedback,
  update,
  newTasks,
  setNewTasks,
  listState,
  done,
  total,
}: {
  tasks: JobDetail['tasks'];
  feedback: Record<string, Feedback>;
  update: (key: string, v: Partial<Feedback>) => void;
  newTasks: SuggestionInput[];
  setNewTasks: (items: SuggestionInput[]) => void;
  listState: ListState;
  done: number;
  total: number;
}) {
  const items = tasks.map((task, ti) => ({
    key: `task-${task.id}`,
    eyebrow: `주요과업 ${ti + 1}`,
    title: task.name,
    counter: `${ti + 1}/${tasks.length}`,
    removeLabel: '이 과업은 삭제가 필요해요',
    details:
      task.task_activities.length > 0 ? (
        <ul className="mt-3 space-y-1.5 pl-1">
          {task.task_activities.map((act) => (
            <li key={act.id} className="flex items-start gap-2 t-label-reading text-foreground-muted">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" aria-hidden="true" />
              {act.activity_name}
            </li>
          ))}
        </ul>
      ) : null,
  }));

  return (
    <div>
      <SectionHeading title="C. 주요과업 및 세부활동 검토" done={done} total={total} term="task" />
      {tasks.length > 1 && <ListControlsFor state={listState} hiddenCount={done} />}
      <ItemList items={items} feedback={feedback} update={update} {...listState.props} />
      <SuggestionEditor kind="주요과업" items={newTasks} onChange={setNewTasks} />
    </div>
  );
}

// ── D. 필요 Skill ───────────────────────────────────────────────────

export function SkillFeedback({
  softSkills,
  hardSkills,
  feedback,
  update,
  newSkills,
  setNewSkills,
  listState,
  done,
  total,
}: {
  softSkills: { id: string; name: string }[];
  hardSkills: { id: string; name: string }[];
  feedback: Record<string, Feedback>;
  update: (key: string, v: Partial<Feedback>) => void;
  newSkills: SuggestionInput[];
  setNewSkills: (items: SuggestionInput[]) => void;
  listState: ListState;
  done: number;
  total: number;
}) {
  const group = (skills: { id: string; name: string }[], type: string) =>
    skills.map((skill, i) => ({
      key: `skill-${skill.id}`,
      eyebrow: `${type} ${i + 1}`,
      title: skill.name,
      counter: `${i + 1}/${skills.length}`,
      removeLabel: '이 Skill은 삭제가 필요해요',
    }));

  return (
    <div>
      <SectionHeading title="D. 필요 Skill 검토" done={done} total={total} />
      {/* 가장 흔한 오해 — 지금 하시는 분의 스펙을 적는 칸으로 읽는 것(v4 G6). */}
      <p className="-mt-3 mb-4 t-caption text-foreground-subtle">{HINT_STEP4_WHO}</p>
      {total > 1 && <ListControlsFor state={listState} hiddenCount={done} />}
      <div className="mb-6">
        <h4 className="mb-3 font-semibold text-foreground">
          역량 (Soft Skill)
          <TermHint id="soft-skill" />
        </h4>
        <ItemList items={group(softSkills, 'Soft Skill')} feedback={feedback} update={update} {...listState.props} />
      </div>
      <div className="mb-2">
        <h4 className="mb-3 font-semibold text-foreground">
          지식/기술 (Hard Skill)
          <TermHint id="hard-skill" />
        </h4>
        <ItemList items={group(hardSkills, 'Hard Skill')} feedback={feedback} update={update} {...listState.props} />
      </div>
      <SuggestionEditor kind="Skill" items={newSkills} onChange={setNewSkills} />
    </div>
  );
}

// ── E. 수행요건 ─────────────────────────────────────────────────────

const REQ_FIELDS: [string, string][] = [
  ['education', '요구 학력'],
  ['major', '관련 전공'],
  ['certifications', '관련 자격증/면허'],
];

export function RequirementFeedback({
  requirements,
  feedback,
  update,
  listState,
  done,
  total,
}: {
  requirements: JobDetail['requirements'];
  feedback: Record<string, Feedback>;
  update: (key: string, v: Partial<Feedback>) => void;
  listState: ListState;
  done: number;
  total: number;
}) {
  const values = (requirements || {}) as unknown as Record<string, string>;
  const items = REQ_FIELDS.map(([key, label]) => ({
    key: `req-${key}`,
    eyebrow: label,
    title: label,
    details: (
      <p className="mt-2 t-label-reading text-foreground">
        {values[key] || <em className="not-italic text-foreground-subtle">미입력</em>}
      </p>
    ),
  }));

  return (
    <div>
      <SectionHeading title="E. 수행요건 검토" done={done} total={total} term="requirement" />
      <ItemList items={items} feedback={feedback} update={update} {...listState.props} />
    </div>
  );
}

// ── 목록 표시 상태(미평가만 보기 / 완료 접기) ───────────────────────

export interface ListState {
  onlyUnrated: boolean;
  setOnlyUnrated: (v: boolean) => void;
  collapseDone: boolean;
  setCollapseDone: (v: boolean) => void;
  props: {
    openIds: Set<string>;
    onOpen: (key: string) => void;
    collapseDone: boolean;
    onlyUnrated: boolean;
  };
}

function ListControlsFor({ state, hiddenCount }: { state: ListState; hiddenCount: number }) {
  return (
    <ListControls
      onlyUnrated={state.onlyUnrated}
      setOnlyUnrated={state.setOnlyUnrated}
      collapseDone={state.collapseDone}
      setCollapseDone={state.setCollapseDone}
      hiddenCount={hiddenCount}
    />
  );
}
