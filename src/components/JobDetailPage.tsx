import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ChevronRight, Pencil, X, Save, Plus, Trash2, ArrowUp, ArrowDown, Loader2, AlertTriangle } from 'lucide-react';
import {
  fetchJobDetail,
  fetchGroupSeriesOptions,
  checkDuplicateJob,
  hasTaskFeedback,
  hasSkillFeedback,
  saveJobEdits,
  type JobDetail,
  type GroupSeriesOption,
} from '@/lib/jobApi';

interface Props {
  jobId: string;
  onBack: () => void;
  userId: string;
  companyId?: string | null;
}

interface EditTask {
  id?: string;
  name: string;
  description: string;
  sort_order: number;
  activities: { id?: string; activity_name: string; sort_order: number }[];
  _deleted?: boolean;
}
interface EditSkill {
  id?: string;
  name: string;
  skill_type: string;
  sort_order: number;
  _deleted?: boolean;
}

export function JobDetailPage({ jobId, onBack, userId, companyId }: Props) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [options, setOptions] = useState<GroupSeriesOption | null>(null);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editGroupId, setEditGroupId] = useState('');
  const [editSeriesId, setEditSeriesId] = useState('');
  const [editDefinition, setEditDefinition] = useState('');
  const [editTasks, setEditTasks] = useState<EditTask[]>([]);
  const [editSkills, setEditSkills] = useState<EditSkill[]>([]);
  const [editReq, setEditReq] = useState({ education: '', major: '', certifications: '' });
  const [dupError, setDupError] = useState<string | null>(null);

  const backRef = useRef(onBack);
  backRef.current = onBack;

  useEffect(() => {
    setLoading(true);
    setSaveSuccess(false);
    setSaveError(null);
    fetchJobDetail(jobId).then((d) => {
      setDetail(d);
      setLoading(false);
    });
  }, [jobId]);

  // Unsaved changes guard
  useEffect(() => {
    if (!dirty || !editMode) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, editMode]);

  function handleBack() {
    if (dirty && editMode) {
      if (!window.confirm('저장하지 않은 변경사항이 있습니다.\n페이지를 이동하시겠습니까?')) return;
    }
    backRef.current();
  }

  async function enterEditMode() {
    if (!detail) return;
    if (!options) {
      const opt = await fetchGroupSeriesOptions(companyId ?? null);
      setOptions(opt);
    }
    setEditName(detail.name);
    setEditGroupId(detail.group_id);
    setEditSeriesId(detail.series_id);
    setEditDefinition(detail.definition);
    setEditTasks(
      (detail?.tasks || []).map((t, ti) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        sort_order: ti,
        activities: t.task_activities.map((a, ai) => ({
          id: a.id,
          activity_name: a.activity_name,
          sort_order: ai,
        })),
      })),
    );
    setEditSkills(
      (detail?.skills || []).map((s, si) => ({
        id: s.id,
        name: s.name,
        skill_type: s.skill_type,
        sort_order: si,
      })),
    );
    setEditReq({
      education: detail?.requirements?.education || '',
      major: detail?.requirements?.major || '',
      certifications: detail?.requirements?.certifications || '',
    });
    setDirty(false);
    setSaveSuccess(false);
    setSaveError(null);
    setDupError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    if (!detail) { setEditMode(false); return; }
    setEditName(detail.name);
    setEditGroupId(detail.group_id);
    setEditSeriesId(detail.series_id);
    setEditDefinition(detail.definition);
    setEditTasks(
      detail.tasks.map((t, ti) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        sort_order: ti,
        activities: t.task_activities.map((a, ai) => ({
          id: a.id,
          activity_name: a.activity_name,
          sort_order: ai,
        })),
      })),
    );
    setEditSkills(
      detail.skills.map((s, si) => ({
        id: s.id,
        name: s.name,
        skill_type: s.skill_type,
        sort_order: si,
      })),
    );
    setEditReq({
      education: detail.requirements?.education || '',
      major: detail.requirements?.major || '',
      certifications: detail.requirements?.certifications || '',
    });
    setEditMode(false);
    setDirty(false);
    setSaveError(null);
    setDupError(null);
  }

  // ── Task helpers ──
  function updateTask(idx: number, patch: Partial<EditTask>) {
    setEditTasks(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
    setDirty(true);
  }
  function addTask() {
    setEditTasks(prev => [...prev, { name: '', description: '', sort_order: prev.length, activities: [] }]);
    setDirty(true);
  }
  async function deleteTask(idx: number) {
    const task = editTasks[idx];
    if (task.id) {
      const hasFb = await hasTaskFeedback(task.id);
      if (hasFb) {
        if (!window.confirm('해당 항목에는 기존 SME 검토이력이 연결되어 있습니다.\n삭제할 경우 원본 항목과 검토이력의 연결에 영향을 줄 수 있습니다.\n\n계속 삭제하시겠습니까?')) return;
      }
    }
    setEditTasks(prev => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, sort_order: i })));
    setDirty(true);
  }
  function moveTask(idx: number, dir: -1 | 1) {
    setEditTasks(prev => {
      const arr = [...prev];
      const ni = idx + dir;
      if (ni < 0 || ni >= arr.length) return arr;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return arr.map((t, i) => ({ ...t, sort_order: i }));
    });
    setDirty(true);
  }

  // ── Activity helpers ──
  function updateActivity(ti: number, ai: number, value: string) {
    setEditTasks(prev => prev.map((t, i) => i === ti ? {
      ...t,
      activities: t.activities.map((a, j) => j === ai ? { ...a, activity_name: value } : a),
    } : t));
    setDirty(true);
  }
  function addActivity(ti: number) {
    setEditTasks(prev => prev.map((t, i) => i === ti ? {
      ...t,
      activities: [...t.activities, { activity_name: '', sort_order: t.activities.length }],
    } : t));
    setDirty(true);
  }
  function deleteActivity(ti: number, ai: number) {
    setEditTasks(prev => prev.map((t, i) => i === ti ? {
      ...t,
      activities: t.activities.filter((_, j) => j !== ai).map((a, j) => ({ ...a, sort_order: j })),
    } : t));
    setDirty(true);
  }
  function moveActivity(ti: number, ai: number, dir: -1 | 1) {
    setEditTasks(prev => prev.map((t, i) => i === ti ? {
      ...t,
      activities: (() => {
        const arr = [...t.activities];
        const ni = ai + dir;
        if (ni < 0 || ni >= arr.length) return arr;
        [arr[ai], arr[ni]] = [arr[ni], arr[ai]];
        return arr.map((a, j) => ({ ...a, sort_order: j }));
      })(),
    } : t));
    setDirty(true);
  }

  // ── Skill helpers ──
  function addSkill(type: 'Soft Skill' | 'Hard Skill') {
    const sameType = editSkills.filter(s => s.skill_type === type && !s._deleted);
    setEditSkills(prev => [...prev, { name: '', skill_type: type, sort_order: sameType.length }]);
    setDirty(true);
  }
  function updateSkill(idx: number, name: string) {
    setEditSkills(prev => prev.map((s, i) => i === idx ? { ...s, name } : s));
    setDirty(true);
  }
  async function deleteSkill(idx: number) {
    const skill = editSkills[idx];
    if (skill.id) {
      const hasFb = await hasSkillFeedback(skill.id);
      if (hasFb) {
        if (!window.confirm('해당 항목에는 기존 SME 검토이력이 연결되어 있습니다.\n삭제할 경우 원본 항목과 검토이력의 연결에 영향을 줄 수 있습니다.\n\n계속 삭제하시겠습니까?')) return;
      }
    }
    setEditSkills(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  // ── Save ──
  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setDupError(null);

    // Check duplicate job
    if (editName !== detail.name || editGroupId !== detail.group_id || editSeriesId !== detail.series_id) {
      const isDup = await checkDuplicateJob(editGroupId, editSeriesId, editName, jobId, companyId ?? null);
      if (isDup) {
        setDupError('동일한 직군/직렬/직무 조합이 이미 존재합니다.');
        setSaving(false);
        return;
      }
    }

    const result = await saveJobEdits({
      jobId,
      groupId: editGroupId,
      seriesId: editSeriesId,
      name: editName,
      definition: editDefinition,
      tasks: editTasks,
      skills: editSkills,
      requirements: editReq,
      userId,
    });

    if (result.error) {
      console.error('Job edit save error:', result.error);
      setSaveError('직무정보 저장 중 오류가 발생했습니다.');
      setSaving(false);
      return;
    }

    // Refetch detail
    const updated = await fetchJobDetail(jobId);
    setDetail(updated);
    setEditMode(false);
    setDirty(false);
    setSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-sm text-slate-400">직무 상세 정보를 불러오는 중…</div>;
  }

  if (!detail) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-12 text-center">
        <p className="text-sm text-slate-500">직무 정보를 불러올 수 없습니다.</p>
        <button onClick={onBack} className="mt-4 text-sm font-medium text-[#247d7c]">목록으로 돌아가기</button>
      </div>
    );
  }

  const softSkills = editMode
    ? editSkills.filter(s => s.skill_type === 'Soft Skill')
    : detail.skills.filter(s => s.skill_type === 'Soft Skill');
  const hardSkills = editMode
    ? editSkills.filter(s => s.skill_type === 'Hard Skill')
    : detail.skills.filter(s => s.skill_type === 'Hard Skill');

  const reqFields: [string, string][] = [
    ['education', '요구 학력'],
    ['major', '관련 전공'],
    ['certifications', '관련 자격증/면허'],
  ];

  const seriesOptions = options?.seriesByGroup.get(editGroupId) || [];

  return (
    <>
      {/* Breadcrumb */}
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-slate-400">
        <button onClick={handleBack} className="flex items-center gap-1 transition hover:text-[#247d7c]">
          <ArrowLeft size={15} /> 직무정보 관리
        </button>
        <ChevronRight size={14} className="text-slate-300" />
        <span className="font-medium text-slate-700">{editMode ? editName : detail.name}</span>
      </nav>

      {/* Top header */}
      <div className="mb-7 flex items-start justify-between rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex-1">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">직무 상세정보</h2>
          <div className="mt-4 flex flex-wrap gap-x-10 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">직군</span>
              {editMode ? (
                <select
                  value={editGroupId}
                  onChange={(e) => { setEditGroupId(e.target.value); setEditSeriesId(''); setDirty(true); }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#247d7c]"
                >
                  {options?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              ) : (
                <span className="text-sm text-slate-700">{detail.group_name}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">직렬</span>
              {editMode ? (
                <select
                  value={editSeriesId}
                  onChange={(e) => { setEditSeriesId(e.target.value); setDirty(true); }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#247d7c]"
                >
                  <option value="">선택</option>
                  {seriesOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                <span className="text-sm text-slate-700">{detail.series_name}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">직무</span>
              {editMode ? (
                <input
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                  className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:border-[#247d7c]"
                />
              ) : (
                <span className="text-sm font-semibold text-slate-900">{detail.name}</span>
              )}
            </div>
          </div>
          {dupError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
              <AlertTriangle size={14} /> {dupError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">활성</span>
          {!editMode ? (
            <button
              onClick={enterEditMode}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867]"
            >
              <Pencil size={15} /> 직무정보 수정
            </button>
          ) : (
            <>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <X size={15} /> 취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867] disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {saving ? '저장 중...' : '변경사항 저장'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save status messages */}
      {saveSuccess && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          직무정보가 저장되었습니다.
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {saveError}
        </div>
      )}

      {/* Section 1: 직무분류체계 */}
      <Section title="1. 직무분류체계">
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {[
                ['직군', editMode ? (options?.groups.find(g => g.id === editGroupId)?.name || '') : detail.group_name],
                ['직렬', editMode ? (seriesOptions.find(s => s.id === editSeriesId)?.name || '') : detail.series_name],
                ['직무', editMode ? editName : detail.name],
              ].map(([label, value], i) => (
                <tr key={label} className={i > 0 ? 'border-t border-slate-100' : ''}>
                  <td className="w-32 bg-slate-50 px-5 py-3.5 text-xs font-medium text-slate-500">{label}</td>
                  <td className="px-5 py-3.5 font-medium text-slate-800">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Section 2: 직무 목적 및 정의 */}
      <Section title="2. 직무 목적 및 정의">
        {editMode ? (
          <textarea
            value={editDefinition}
            onChange={(e) => { setEditDefinition(e.target.value); setDirty(true); }}
            rows={4}
            className="w-full rounded-md border border-slate-300 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-[#247d7c]"
            placeholder="직무 정의를 입력하세요"
          />
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-5">
            {detail.definition ? (
              <p className="text-sm leading-7 text-slate-700">{detail.definition}</p>
            ) : (
              <p className="text-sm text-slate-400">등록된 직무정의 정보가 없습니다.</p>
            )}
          </div>
        )}
      </Section>

      {/* Section 3: 주요 책임 및 과업 */}
      <Section title="3. 주요 책임 및 과업">
        {editMode ? (
          <div className="space-y-4">
            {editTasks.map((task, ti) => (
              <div key={ti} className="rounded-md border border-slate-200 p-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#edf8f7] text-xs font-semibold text-[#247d7c]">{ti + 1}</span>
                  <input
                    value={task.name}
                    onChange={(e) => updateTask(ti, { name: e.target.value })}
                    className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:border-[#247d7c]"
                    placeholder="주요과업명"
                  />
                  <button onClick={() => moveTask(ti, -1)} disabled={ti === 0} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowUp size={15} /></button>
                  <button onClick={() => moveTask(ti, 1)} disabled={ti === editTasks.length - 1} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowDown size={15} /></button>
                  <button onClick={() => deleteTask(ti)} className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
                <div className="mt-3 space-y-2 pl-8">
                  {task.activities.map((act, ai) => (
                    <div key={ai} className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{ai + 1}.</span>
                      <input
                        value={act.activity_name}
                        onChange={(e) => updateActivity(ti, ai, e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-[#247d7c]"
                        placeholder="세부활동"
                      />
                      <button onClick={() => moveActivity(ti, ai, -1)} disabled={ai === 0} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={14} /></button>
                      <button onClick={() => moveActivity(ti, ai, 1)} disabled={ai === task.activities.length - 1} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={14} /></button>
                      <button onClick={() => deleteActivity(ti, ai)} className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button onClick={() => addActivity(ti)} className="flex items-center gap-1 text-sm text-[#247d7c] hover:underline">
                    <Plus size={15} /> 세부활동 추가
                  </button>
                </div>
              </div>
            ))}
            <button onClick={addTask} className="flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:border-[#247d7c] hover:text-[#247d7c]">
              <Plus size={16} /> 주요과업 추가
            </button>
          </div>
        ) : (
          detail.tasks.length === 0 ? (
            <EmptyMessage>등록된 주요과업 정보가 없습니다.</EmptyMessage>
          ) : (
            <div className="space-y-4">
              {detail.tasks.map((task, ti) => (
                <div key={task.id} className="rounded-md border border-slate-200 p-5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#edf8f7] text-xs font-semibold text-[#247d7c]">{ti + 1}</span>
                    <h4 className="font-semibold text-slate-900">{task.name}</h4>
                  </div>
                  {task.task_activities.length === 0 ? (
                    <p className="mt-3 pl-8 text-sm text-slate-400">등록된 세부활동 정보가 없습니다.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 pl-8">
                      {task.task_activities.map((act) => (
                        <li key={act.id} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                          {act.activity_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </Section>

      {/* Section 4: 관련 Skill */}
      <Section title="4. 관련 Skill">
        {editMode ? (
          <div className="space-y-6">
            {/* Soft Skill */}
            <div>
              <h4 className="mb-3 text-sm font-semibold text-slate-700">역량 (Soft Skill)</h4>
              <div className="space-y-2">
                {editSkills.filter(s => s.skill_type === 'Soft Skill').map((s, idx) => {
                  const realIdx = editSkills.indexOf(s);
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={s.name}
                        onChange={(e) => updateSkill(realIdx, e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#247d7c]"
                        placeholder="Skill명"
                      />
                      <button onClick={() => deleteSkill(realIdx)} className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  );
                })}
                <button onClick={() => addSkill('Soft Skill')} className="flex items-center gap-1 text-sm text-[#247d7c] hover:underline">
                  <Plus size={15} /> Skill 추가
                </button>
              </div>
            </div>
            {/* Hard Skill */}
            <div>
              <h4 className="mb-3 text-sm font-semibold text-slate-700">지식/기술 (Hard Skill)</h4>
              <div className="space-y-2">
                {editSkills.filter(s => s.skill_type === 'Hard Skill').map((s, idx) => {
                  const realIdx = editSkills.indexOf(s);
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={s.name}
                        onChange={(e) => updateSkill(realIdx, e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#247d7c]"
                        placeholder="Skill명"
                      />
                      <button onClick={() => deleteSkill(realIdx)} className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                    </div>
                  );
                })}
                <button onClick={() => addSkill('Hard Skill')} className="flex items-center gap-1 text-sm text-[#247d7c] hover:underline">
                  <Plus size={15} /> Skill 추가
                </button>
              </div>
            </div>
          </div>
        ) : (
          detail.skills.length === 0 ? (
            <EmptyMessage>등록된 Skill 정보가 없습니다.</EmptyMessage>
          ) : (
            <div className="space-y-6">
              <SkillGroup label="역량 (Soft Skill)" skills={softSkills} accent="teal" />
              <SkillGroup label="지식/기술 (Hard Skill)" skills={hardSkills} accent="navy" />
            </div>
          )
        )}
      </Section>

      {/* Section 5: 수행요건 */}
      <Section title="5. 수행요건">
        {(() => {
          const r = editMode ? editReq : detail.requirements;
          const hasAny = r && (r.education || r.major || r.certifications);
          if (!hasAny && !editMode) return <EmptyMessage>등록된 수행요건 정보가 없습니다.</EmptyMessage>;
          if (editMode) {
            return (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <tbody>
                    {reqFields.map(([key, label], i) => (
                      <tr key={key} className={i > 0 ? 'border-t border-slate-100' : ''}>
                        <td className="w-40 bg-slate-50 px-5 py-4 text-xs font-medium text-slate-500">{label}</td>
                        <td className="px-5 py-4">
                          <input
                            value={editReq[key as keyof typeof editReq]}
                            onChange={(e) => { setEditReq(prev => ({ ...prev, [key]: e.target.value })); setDirty(true); }}
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-[#247d7c]"
                            placeholder={label}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <tbody>
                  {reqFields.map(([key, label], i) => {
                    const value = (r as Record<string, string>)[key] || '';
                    return (
                      <tr key={key} className={i > 0 ? 'border-t border-slate-100' : ''}>
                        <td className="w-40 bg-slate-50 px-5 py-4 text-xs font-medium text-slate-500">{label}</td>
                        <td className="px-5 py-4 text-slate-700">{value || <em className="text-slate-400">등록된 정보 없음</em>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-5 text-base font-bold text-[#182635]">{title}</h3>
      {children}
    </section>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

function SkillGroup({ label, skills, accent }: { label: string; skills: { id: string; name: string }[]; accent: 'teal' | 'navy' }) {
  const chipClass = accent === 'teal'
    ? 'bg-[#edf8f7] text-[#247d7c] border-[#b8e5e2]'
    : 'bg-slate-100 text-[#182635] border-slate-200';
  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-slate-700">{label}</h4>
      {skills.length === 0 ? (
        <p className="text-sm text-slate-400">등록된 {label}이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <span key={s.id} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${chipClass}`}>{s.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
