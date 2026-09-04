/*
 * 직무 한 건 등록 — '직무정보 관리' 화면의 「직무 추가」 버튼이 연다.
 * 기획서: docs/PLAN_2026-09-04_IMPROVEMENT.md (P2 「직무를 한 건만 추가할 수 없다」).
 *
 * ▣ 왜 필요했나
 *   jobs 에 행을 넣는 경로가 통합 업로드뿐이었다. 직무 하나를 더하려면 엑셀을 다시 만들어
 *   올려야 했고, replace 모드는 그 회사 직무 전체를 갈아엎는다.
 *
 * ▣ 과업·Skill 은 여기서 받지 않는다
 *   직무를 만들자마자 상세 화면으로 보낸다. 과업·세부활동·Skill·수행요건을 한 모달에 다 담으면
 *   업로드 양식을 폼으로 옮긴 꼴이 되고, 이미 그 일을 하는 화면(JobDetailPage 편집)이 있다.
 *
 * ▣ 직군·직렬은 골라 쓰되, 없으면 여기서 만든다
 *   새 직무는 새 직렬을 데려오는 일이 잦다. 그때 다시 엑셀로 돌아가야 하면 이 화면의 존재
 *   이유가 없어진다. 선택 목록 맨 끝의 「+ 직접 입력」이 그 자리에서 만든다(같은 이름이 이미
 *   있으면 새로 만들지 않고 그것을 쓴다).
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import {
  createJob,
  createJobGroup,
  createJobSeries,
  fetchGroupSeriesOptionsResult,
  type Company,
} from '@/lib/jobApi';

/** 선택 목록 맨 끝에 붙는 특수 값. 실제 id 는 uuid 라 겹치지 않는다. */
const NEW = '__new__';

export function JobCreateModal({
  userId,
  companies,
  defaultCompanyId,
  onClose,
  onCreated,
}: {
  userId: string;
  companies: Company[];
  /** 목록 화면의 회사 필터. 'all' 이었으면 null 이 와서 사용자가 직접 고른다. */
  defaultCompanyId: string | null;
  onClose: () => void;
  /** 등록 성공 — 목록을 새로 읽고 그 직무 상세로 보낸다. */
  onCreated: (jobId: string) => void;
}) {
  const [companyId, setCompanyId] = useState(defaultCompanyId || (companies.length === 1 ? companies[0].id : ''));
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [seriesByGroup, setSeriesByGroup] = useState<Map<string, { id: string; name: string }[]>>(new Map());
  const [optionsError, setOptionsError] = useState('');

  const [groupId, setGroupId] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [newSeries, setNewSeries] = useState('');
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // 회사를 바꾸면 그 회사의 직군·직렬만 남는다. 고르고 있던 값은 남의 회사 것이므로 비운다.
  useEffect(() => {
    let alive = true;
    setGroupId('');
    setSeriesId('');
    void fetchGroupSeriesOptionsResult(companyId || null).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        // 조회 실패를 "직군 0건"으로 보여 주지 않는다 — 사용자가 전부 새로 만들게 된다.
        setGroups([]);
        setSeriesByGroup(new Map());
        setOptionsError(`직군·직렬 목록을 불러오지 못했어요. (${res.error})`);
        return;
      }
      setOptionsError('');
      setGroups(res.data.groups);
      setSeriesByGroup(res.data.seriesByGroup);
    });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const seriesOptions = useMemo(
    () => (groupId && groupId !== NEW ? seriesByGroup.get(groupId) || [] : []),
    [groupId, seriesByGroup],
  );

  const creatingGroup = groupId === NEW;
  const creatingSeries = seriesId === NEW || creatingGroup;

  const dirty = Boolean(name || definition || groupId || newGroup || newSeries);

  // 제출을 누르기 전에는 빈 칸에 빨간 글씨를 미리 띄우지 않는다(다른 폼과 같은 태도).
  const show = (v: string) => Boolean(v) || submitted;
  const companyError = show(companyId) || companies.length === 0 ? (companyId ? '' : '회사를 골라 주세요.') : '';
  const groupError = submitted && !groupId ? '직군을 골라 주세요.' : '';
  const newGroupError = submitted && creatingGroup && !newGroup.trim() ? '새 직군 이름을 입력해 주세요.' : '';
  const seriesError = submitted && !creatingGroup && !seriesId ? '직렬을 골라 주세요.' : '';
  const newSeriesError = submitted && creatingSeries && !newSeries.trim() ? '새 직렬 이름을 입력해 주세요.' : '';
  const nameError = submitted && !name.trim() ? '직무명을 입력해 주세요.' : '';
  const definitionError = submitted && !definition.trim() ? '직무 정의를 입력해 주세요.' : '';

  async function handleSubmit() {
    setSubmitted(true);
    setError('');
    if (
      !companyId ||
      !groupId ||
      (creatingGroup && !newGroup.trim()) ||
      (!creatingGroup && !seriesId) ||
      (creatingSeries && !newSeries.trim()) ||
      !name.trim() ||
      !definition.trim()
    ) {
      return;
    }

    setSaving(true);
    try {
      // 직군 → 직렬 → 직무 순서로 만든다. 앞이 실패하면 뒤로 가지 않는다.
      let finalGroupId = groupId;
      if (creatingGroup) {
        const res = await createJobGroup(companyId, newGroup);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        finalGroupId = res.data.id;
      }

      let finalSeriesId = seriesId;
      if (creatingSeries) {
        const res = await createJobSeries(companyId, finalGroupId, newSeries);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        finalSeriesId = res.data.id;
      }

      const created = await createJob({
        companyId,
        groupId: finalGroupId,
        seriesId: finalSeriesId,
        name,
        definition,
        userId,
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      onCreated(created.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="직무 추가"
      description="직무 한 건을 바로 등록합니다. 과업·Skill·수행요건은 등록한 뒤 상세 화면에서 채웁니다."
      icon={<Plus size={18} aria-hidden="true" />}
      size="lg"
      onClose={onClose}
      dirty={dirty}
      closeDisabled={saving}
      hideClose
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            <Plus size={15} aria-hidden="true" /> 등록하고 상세 열기
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3.5 py-2.5 t-label text-destructive"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {optionsError && (
          <div
            role="status"
            className="rounded-element border border-warning-border bg-warning-muted px-3.5 py-2.5 t-label text-warning"
          >
            {optionsError} 아래에서 직군·직렬을 직접 입력해 만들 수 있어요.
          </div>
        )}

        <Field
          label="회사"
          required
          as="select"
          value={companyId}
          onChange={setCompanyId}
          error={companyError}
          disabled={saving}
          options={[
            { value: '', label: '회사를 골라 주세요' },
            ...companies.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <Field
          label="직군"
          required
          as="select"
          value={groupId}
          onChange={(v) => {
            setGroupId(v);
            setSeriesId('');
          }}
          error={groupError}
          disabled={saving}
          description="목록에 없으면 「+ 직접 입력」을 고르세요."
          options={[
            { value: '', label: '직군을 골라 주세요' },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
            { value: NEW, label: '+ 직접 입력' },
          ]}
        />

        {creatingGroup && (
          <Field
            label="새 직군 이름"
            required
            value={newGroup}
            onChange={setNewGroup}
            error={newGroupError}
            disabled={saving}
            placeholder="예: 생산"
          />
        )}

        {!creatingGroup && (
          <Field
            label="직렬"
            required
            as="select"
            value={seriesId}
            onChange={setSeriesId}
            error={seriesError}
            disabled={saving || !groupId}
            description={groupId ? '목록에 없으면 「+ 직접 입력」을 고르세요.' : '직군을 먼저 골라 주세요.'}
            options={[
              { value: '', label: groupId ? '직렬을 골라 주세요' : '직군을 먼저 골라 주세요' },
              ...seriesOptions.map((s) => ({ value: s.id, label: s.name })),
              ...(groupId ? [{ value: NEW, label: '+ 직접 입력' }] : []),
            ]}
          />
        )}

        {creatingSeries && (
          <Field
            label="새 직렬 이름"
            required
            value={newSeries}
            onChange={setNewSeries}
            error={newSeriesError}
            disabled={saving}
            placeholder="예: 생산기술"
          />
        )}

        <Field
          label="직무명"
          required
          value={name}
          onChange={setName}
          error={nameError}
          disabled={saving}
          placeholder="예: 설비보전"
        />

        <Field
          label="직무 정의"
          required
          as="textarea"
          rows={4}
          value={definition}
          onChange={setDefinition}
          error={definitionError}
          disabled={saving}
          description="이 직무가 무엇을 하는 자리인지 한두 문장으로 적습니다. SME 가 검토 화면에서 가장 먼저 보는 문장입니다."
          placeholder="예: 생산설비의 예방정비와 고장 대응을 수행하여 설비 가동률을 유지한다."
        />
      </div>
    </ModalShell>
  );
}
