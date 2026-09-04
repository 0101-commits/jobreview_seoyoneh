import { supabase } from './supabase';
import { type JobMaster } from './uploadUtils';
import { logAudit } from './auditApi';

// ── Types ──────────────────────────────────────────────────────────

export type Status = '미시작' | '작성 중' | '제출 완료' | '재검토 요청' | '재제출 완료';

export interface JobTaskWithActivities {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  task_activities: { id: string; activity_name: string; sort_order: number }[];
}

export interface JobSkillRow {
  id: string;
  name: string;
  skill_type: string;
  sort_order: number;
}

export interface JobRequirementRow {
  id: string;
  education: string;
  major: string;
  certifications: string;
}

export interface JobDetail {
  id: string;
  name: string;
  definition: string;
  group_id: string;
  series_id: string;
  company_id: string | null;
  company_name: string;
  group_name: string;
  series_name: string;
  tasks: JobTaskWithActivities[];
  skills: JobSkillRow[];
  requirements: JobRequirementRow | null;
}

// ── 조회 결과 타입 ──────────────────────────────────────────────────
//
// 기존 조회 함수들은 `if (error || !data) return []` 로 실패를 "데이터 0건"으로 위장하고 있었다.
// 화면이 "등록된 직무가 없습니다"와 "불러오지 못했습니다"를 구분할 수 있도록 `*Result` 함수를 함께 제공한다.
// 기존 함수는 호출부를 깨지 않도록 시그니처를 유지하되, 실패를 최소한 콘솔에 남긴다.
// 화면 쪽에서는 새로 만드는 코드부터 `*Result` 함수를 쓰면 된다.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(where: string, message: string): ApiResult<T> {
  console.error(`[jobApi] ${where} 실패: ${message}`);
  return { ok: false, error: message };
}

/** 기존 호출부 호환용. 실패하면 빈 값을 돌려준다(오류는 fail()이 이미 콘솔에 남겼다). */
function orEmpty<T>(result: ApiResult<T>, empty: T): T {
  return result.ok ? result.data : empty;
}

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

// ── Fetch companies ─────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export async function fetchCompaniesResult(): Promise<ApiResult<Company[]>> {
  if (!supabase) return fail('회사 목록 조회', NO_DB);
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, code, active')
    .eq('active', true)
    .order('sort_order');
  if (error) return fail('회사 목록 조회', error.message);
  return ok((data || []) as Company[]);
}

export async function fetchCompanies(): Promise<Company[]> {
  return orEmpty(await fetchCompaniesResult(), []);
}

// ── Fetch job masters for matching ──────────────────────────────────

export async function fetchJobMasters(): Promise<JobMaster[]> {
  return orEmpty(await fetchJobMastersResult(), []);
}

export async function fetchJobMastersResult(): Promise<ApiResult<JobMaster[]>> {
  if (!supabase) return fail('직무 마스터 조회', NO_DB);
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      id,
      company_id,
      group_id,
      series_id,
      name,
      job_groups!inner(name),
      job_series!inner(name),
      companies!left(name)
    `)
    .eq('active', true);
  if (error) return fail('직무 마스터 조회', error.message);
  return ok((data || []).map((j: Record<string, unknown>) => ({
    id: j.id as string,
    companyName: ((j['companies'] as Record<string, string>) || { name: '' }).name || '',
    groupName: (j['job_groups'] as Record<string, string>).name,
    seriesName: (j['job_series'] as Record<string, string>).name,
    jobName: j.name as string,
  })));
}

// ── Check if any job master exists ──────────────────────────────────

export async function hasJobMasters(): Promise<boolean> {
  if (!supabase) return false;
  const { count, error } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('active', true);
  if (error) { console.error(`[jobApi] 직무 마스터 존재 확인 실패: ${error.message}`); return false; }
  return (count ?? 0) > 0;
}

/*
 * (삭제) saveStep1Data · saveStep2Data — v2 F8.
 * 호출부가 0인데 replace 분기가 회사 필터 없이 jobs·job_tasks·job_task_activities를 전량
 * active=false로 내리고 job_requirements를 전량 삭제했다. 업로드는 saveIntegratedJobData
 * (SECURITY DEFINER RPC, 회사 범위 한정)만 쓴다.
 */

// ── Fetch full job detail for SME review ────────────────────────────

export async function fetchJobDetail(jobId: string): Promise<JobDetail | null> {
  return orEmpty(await fetchJobDetailResult(jobId), null);
}

export async function fetchJobDetailResult(jobId: string): Promise<ApiResult<JobDetail | null>> {
  if (!supabase) return fail('직무 상세 조회', NO_DB);

  const { data: job, error } = await supabase
    .from('jobs')
    .select(`
      id, name, definition, group_id, series_id, company_id,
      job_groups!inner(name),
      job_series!inner(name),
      companies!left(name)
    `)
    .eq('id', jobId)
    .eq('active', true)
    .maybeSingle();
  if (error) return fail('직무 상세 조회', error.message);
  if (!job) return ok(null);

  const j = job as Record<string, unknown>;
  const groupName = (j['job_groups'] as Record<string, string>).name;
  const seriesName = (j['job_series'] as Record<string, string>).name;
  const companyName = ((j['companies'] as Record<string, string>) || { name: '' }).name || '';

  const { data: tasks, error: taskError } = await supabase
    .from('job_tasks')
    .select('id, name, description, sort_order')
    .eq('job_id', jobId)
    .eq('active', true)
    .order('sort_order');
  if (taskError) return fail('주요과업 조회', taskError.message);
  const taskRows = tasks || [];
  const taskIds = taskRows.map((t: Record<string, unknown>) => t.id as string);

  let activities: Record<string, unknown>[] = [];
  if (taskIds.length > 0) {
    const { data: acts, error: actError } = await supabase
      .from('task_activities')
      .select('id, job_task_id, activity_name, sort_order')
      .in('job_task_id', taskIds)
      .eq('active', true)
      .order('sort_order');
    if (actError) return fail('세부활동 조회', actError.message);
    activities = acts || [];
  }

  const tasksWithActivities: JobTaskWithActivities[] = taskRows.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    description: (t.description as string) || '',
    sort_order: t.sort_order as number,
    task_activities: activities
      .filter((a) => a.job_task_id === t.id)
      .map((a) => ({ id: a.id as string, activity_name: a.activity_name as string, sort_order: a.sort_order as number })),
  }));

  const { data: skills, error: skillError } = await supabase
    .from('job_skills')
    .select('id, name, skill_type, sort_order')
    .eq('job_id', jobId)
    .eq('active', true)
    .order('sort_order');
  if (skillError) return fail('필요 Skill 조회', skillError.message);
  const skillRows: JobSkillRow[] = (skills || []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    skill_type: (s.skill_type as string) || '',
    sort_order: s.sort_order as number,
  }));

  const { data: req, error: reqError } = await supabase
    .from('job_requirements')
    .select('id, education, major, certifications')
    .eq('job_id', jobId)
    .maybeSingle();
  if (reqError) return fail('수행요건 조회', reqError.message);

  return ok({
    id: j.id as string,
    name: j.name as string,
    definition: (j.definition as string) || '',
    group_id: j.group_id as string,
    series_id: j.series_id as string,
    company_id: (j.company_id as string) || null,
    company_name: companyName,
    group_name: groupName,
    series_name: seriesName,
    tasks: tasksWithActivities,
    skills: skillRows,
    requirements: req ? { id: (req as Record<string, unknown>).id as string, education: (req as Record<string, unknown>).education as string, major: (req as Record<string, unknown>).major as string, certifications: (req as Record<string, unknown>).certifications as string } : null,
  });
}

// ── Fetch review status for admin dashboard/review table ─────────────

export interface ReviewStatusRow {
  sme_id: string;
  sme_name: string;
  sme_email: string;
  organization: string;
  title: string;
  company_id: string | null;
  company_name: string;
  job_id: string;
  job_name: string;
  group_name: string;
  series_name: string;
  review_status: string;
  review_id: string | null;
  submitted_at: string | null;
  suitable_count: number;
  needs_edit_count: number;
  unsuitable_count: number;
}

const STATUS_MAP: Record<string, Status> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출 완료',
  REVIEW_REQUESTED: '재검토 요청',
  RESUBMITTED: '재제출 완료',
};

export function mapReviewStatus(dbStatus: string): Status {
  return STATUS_MAP[dbStatus] || '미시작';
}

export async function fetchReviewStatusResult(companyId?: string | null): Promise<ApiResult<ReviewStatusRow[]>> {
  if (!supabase) return fail('검토 현황 조회', NO_DB);
  const { data, error } = await supabase.rpc('get_review_status', { p_company_id: companyId ?? null });
  if (error) return fail('검토 현황 조회', error.message);
  return ok((data || []) as ReviewStatusRow[]);
}

export async function fetchReviewStatus(companyId?: string | null): Promise<ReviewStatusRow[]> {
  return orEmpty(await fetchReviewStatusResult(companyId), []);
}

// ── Fetch all job groups and series for edit dropdowns ──────────────

export interface GroupSeriesOption {
  groups: { id: string; name: string }[];
  seriesByGroup: Map<string, { id: string; name: string }[]>;
}

export async function fetchGroupSeriesOptions(companyId?: string | null): Promise<GroupSeriesOption> {
  return orEmpty(await fetchGroupSeriesOptionsResult(companyId), { groups: [], seriesByGroup: new Map() });
}

export async function fetchGroupSeriesOptionsResult(companyId?: string | null): Promise<ApiResult<GroupSeriesOption>> {
  if (!supabase) return fail('직군·직렬 목록 조회', NO_DB);
  let groupQuery = supabase.from('job_groups').select('id, name').eq('active', true).order('name');
  let seriesQuery = supabase.from('job_series').select('id, name, group_id').eq('active', true).order('name');
  if (companyId) {
    groupQuery = groupQuery.eq('company_id', companyId);
    seriesQuery = seriesQuery.eq('company_id', companyId);
  }
  const { data: groups, error: groupError } = await groupQuery;
  if (groupError) return fail('직군 목록 조회', groupError.message);
  const { data: series, error: seriesError } = await seriesQuery;
  if (seriesError) return fail('직렬 목록 조회', seriesError.message);
  const seriesByGroup = new Map<string, { id: string; name: string }[]>();
  for (const s of (series || []) as { id: string; name: string; group_id: string }[]) {
    const arr = seriesByGroup.get(s.group_id) || [];
    arr.push({ id: s.id, name: s.name });
    seriesByGroup.set(s.group_id, arr);
  }
  return ok({
    groups: (groups || []).map((g: Record<string, unknown>) => ({ id: g.id as string, name: g.name as string })),
    seriesByGroup,
  });
}

// ── Check for duplicate job (same company+group+series+name, different id) ──

/**
 * excludeJobId 는 "고치는 중인 그 직무는 빼고 센다"는 뜻이라 신규 등록에는 없다.
 * 빈 값을 그대로 .neq() 에 넣으면 uuid 파싱 오류가 나므로 있을 때만 건다.
 */
export async function checkDuplicateJob(groupId: string, seriesId: string, name: string, excludeJobId: string | null, companyId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  let query = supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('series_id', seriesId)
    .eq('name', name)
    .eq('active', true);
  if (excludeJobId) query = query.neq('id', excludeJobId);
  if (companyId) query = query.eq('company_id', companyId);
  const { count, error } = await query;
  if (error) { console.error(`[jobApi] 직무 중복 확인 실패: ${error.message}`); return false; }
  return (count ?? 0) > 0;
}

// ── Check if a task has SME feedback ────────────────────────────────
//
// 이 두 함수의 결과는 "삭제해도 되는가"를 판단하는 데 쓰인다(JobDetailPage의 삭제 경고).
// 조회가 실패했을 때 false를 돌려주면 검토이력이 있는 항목을 경고 없이 지우게 되므로,
// 실패 시에는 안전한 쪽(true = 이력이 있다고 간주하고 경고)으로 답한다.

export async function hasTaskFeedback(taskId: string): Promise<boolean> {
  if (!supabase) return false;
  const { count, error } = await supabase.from('task_feedback').select('id', { count: 'exact', head: true }).eq('task_id', taskId);
  if (error) { console.error(`[jobApi] 과업 검토이력 확인 실패: ${error.message}`); return true; }
  return (count ?? 0) > 0;
}

// ── Check if a skill has SME feedback ───────────────────────────────

export async function hasSkillFeedback(skillId: string): Promise<boolean> {
  if (!supabase) return false;
  const { count, error } = await supabase.from('skill_feedback').select('id', { count: 'exact', head: true }).eq('skill_id', skillId);
  if (error) { console.error(`[jobApi] Skill 검토이력 확인 실패: ${error.message}`); return true; }
  return (count ?? 0) > 0;
}

/* ── 직무 한 건 등록·비활성 (기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md P2) ──────
 *
 * 지금까지 jobs 에 행을 넣는 경로는 통합 업로드뿐이었다. 직무 하나를 더하려면 엑셀을 다시
 * 만들어 올려야 했고, replace 모드는 그 회사 직무 전체를 갈아엎는다. 빼는 것도 마찬가지라
 * jobs.active 를 토글하는 코드가 앱 어디에도 없었다(SQL Editor 가 유일한 경로였다).
 *
 * RLS 는 이미 관리자에게 열려 있다(jobs_admin_insert · jobs_admin_update, 20260812084909).
 * 그래서 새 정책도 Edge Function 도 필요 없다 — 화면에서 바로 쓴다.
 */

export interface CreateJobInput {
  companyId: string | null;
  groupId: string;
  seriesId: string;
  name: string;
  definition: string;
  userId: string;
}

/** 직군을 새로 만든다. 같은 회사에 같은 이름이 있으면 그 id 를 그대로 돌려준다(중복 생성 방지). */
export async function createJobGroup(companyId: string | null, name: string): Promise<ApiResult<{ id: string; name: string }>> {
  if (!supabase) return fail('직군 등록', NO_DB);
  const trimmed = name.trim();
  if (!trimmed) return fail('직군 등록', '직군 이름을 입력해 주세요.');

  let dup = supabase.from('job_groups').select('id, name').eq('name', trimmed).eq('active', true);
  if (companyId) dup = dup.eq('company_id', companyId);
  const { data: found } = await dup.maybeSingle();
  if (found) return ok({ id: (found as Record<string, unknown>).id as string, name: trimmed });

  const { data, error } = await supabase
    .from('job_groups')
    .insert({ name: trimmed, company_id: companyId })
    .select('id, name')
    .single();
  if (error) return fail('직군 등록', error.message);
  return ok({ id: (data as Record<string, unknown>).id as string, name: trimmed });
}

/** 직렬을 새로 만든다. 같은 직군에 같은 이름이 있으면 그 id 를 그대로 돌려준다. */
export async function createJobSeries(
  companyId: string | null,
  groupId: string,
  name: string,
): Promise<ApiResult<{ id: string; name: string }>> {
  if (!supabase) return fail('직렬 등록', NO_DB);
  const trimmed = name.trim();
  if (!trimmed) return fail('직렬 등록', '직렬 이름을 입력해 주세요.');
  if (!groupId) return fail('직렬 등록', '직군을 먼저 골라 주세요.');

  const { data: found } = await supabase
    .from('job_series')
    .select('id, name')
    .eq('group_id', groupId)
    .eq('name', trimmed)
    .eq('active', true)
    .maybeSingle();
  if (found) return ok({ id: (found as Record<string, unknown>).id as string, name: trimmed });

  const { data, error } = await supabase
    .from('job_series')
    .insert({ name: trimmed, group_id: groupId, company_id: companyId })
    .select('id, name')
    .single();
  if (error) return fail('직렬 등록', error.message);
  return ok({ id: (data as Record<string, unknown>).id as string, name: trimmed });
}

/**
 * 직무 한 건 등록. 과업·Skill·수행요건은 여기서 만들지 않는다 —
 * 등록 직후 상세 화면으로 보내 기존 편집 경로(saveJobEdits)로 채우게 한다.
 * 같은 회사·직군·직렬에 같은 이름이 이미 있으면 거절한다. DB 의 unique 제약이
 * source_version 까지 포함해 느슨하므로, 사람이 읽을 수 있는 사유는 여기서 만든다.
 */
export async function createJob(input: CreateJobInput): Promise<ApiResult<string>> {
  if (!supabase) return fail('직무 등록', NO_DB);
  const name = input.name.trim();
  const definition = input.definition.trim();
  if (!input.groupId || !input.seriesId) return fail('직무 등록', '직군과 직렬을 골라 주세요.');
  if (!name) return fail('직무 등록', '직무명을 입력해 주세요.');
  if (!definition) return fail('직무 등록', '직무 정의를 입력해 주세요.');

  const duplicated = await checkDuplicateJob(input.groupId, input.seriesId, name, null, input.companyId);
  if (duplicated) return fail('직무 등록', `같은 직군·직렬에 「${name}」 직무가 이미 있어요.`);

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      company_id: input.companyId,
      group_id: input.groupId,
      series_id: input.seriesId,
      name,
      definition,
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error) return fail('직무 등록', error.message);

  const jobId = (data as Record<string, unknown>).id as string;
  await logAudit('JOB_CREATED', 'jobs', jobId, { company_id: input.companyId });
  return ok(jobId);
}

/**
 * 직무를 목록에서 내리거나 되돌린다. 지우지 않는다 —
 * job_tasks·reviews·review_assignments 가 이 행을 참조하므로 하드 삭제는 응답을 함께 끊는다.
 * 목록 조회는 이미 active = true 만 읽으므로(fetchAllJobsResult) 끄면 화면에서 사라진다.
 */
export async function setJobActive(jobId: string, active: boolean): Promise<ApiResult<null>> {
  if (!supabase) return fail('직무 상태 변경', NO_DB);
  const { error } = await supabase
    .from('jobs')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) return fail('직무 상태 변경', error.message);
  await logAudit(active ? 'JOB_ACTIVATED' : 'JOB_DEACTIVATED', 'jobs', jobId, {});
  return ok(null);
}

// ── Save job detail edits ───────────────────────────────────────────

export interface SaveJobEditData {
  jobId: string;
  groupId: string;
  seriesId: string;
  name: string;
  definition: string;
  tasks: {
    id?: string;
    name: string;
    description: string;
    sort_order: number;
    activities: { id?: string; activity_name: string; sort_order: number }[];
    _deleted?: boolean;
  }[];
  skills: { id?: string; name: string; skill_type: string; sort_order: number; _deleted?: boolean }[];
  requirements: { education: string; major: string; certifications: string };
  userId: string;
}

export async function saveJobEdits(data: SaveJobEditData): Promise<{ error?: string }> {
  if (!supabase) return { error: '데이터베이스 연결이 없습니다.' };
  try {
    const { error: jErr } = await supabase.from('jobs').update({
      group_id: data.groupId,
      series_id: data.seriesId,
      name: data.name,
      definition: data.definition,
      updated_by: data.userId,
    }).eq('id', data.jobId);
    if (jErr) { console.error('jobs update failed:', jErr); return { error: jErr.message }; }

    const { data: dbTasks } = await supabase.from('job_tasks').select('id').eq('job_id', data.jobId).eq('active', true);
    const dbTaskIds = new Set((dbTasks || []).map((t: Record<string, unknown>) => t.id as string));
    const keptTaskIds = new Set<string>();

    for (const task of data.tasks) {
      if (task._deleted) continue;
      if (task.id) {
        keptTaskIds.add(task.id);
        const { error: tErr } = await supabase.from('job_tasks').update({
          name: task.name, description: task.description, sort_order: task.sort_order, updated_by: data.userId,
        }).eq('id', task.id);
        if (tErr) { console.error('job_tasks update failed:', tErr); return { error: tErr.message }; }

        const { data: dbActs } = await supabase.from('task_activities').select('id').eq('job_task_id', task.id).eq('active', true);
        const dbActIds = new Set((dbActs || []).map((a: Record<string, unknown>) => a.id as string));
        const keptActIds = new Set<string>();

        for (const act of task.activities) {
          if (act.id) {
            keptActIds.add(act.id);
            const { error: aErr } = await supabase.from('task_activities').update({
              activity_name: act.activity_name, sort_order: act.sort_order, updated_by: data.userId,
            }).eq('id', act.id);
            if (aErr) { console.error('task_activities update failed:', aErr); return { error: aErr.message }; }
          } else {
            const { error: aErr } = await supabase.from('task_activities').insert({
              job_task_id: task.id, activity_name: act.activity_name, sort_order: act.sort_order, active: true,
            });
            if (aErr) { console.error('task_activities insert failed:', aErr); return { error: aErr.message }; }
          }
        }
        for (const aid of dbActIds) {
          if (!keptActIds.has(aid)) {
            await supabase.from('task_activities').update({ active: false }).eq('id', aid);
          }
        }
      } else {
        const { data: inserted, error: tErr } = await supabase.from('job_tasks').insert({
          job_id: data.jobId, name: task.name, description: task.description, sort_order: task.sort_order, active: true,
        }).select('id');
        if (tErr || !inserted?.[0]) { console.error('job_tasks insert failed:', tErr); return { error: tErr?.message || '주요과업 생성 실패' }; }
        const newTaskId = (inserted[0] as Record<string, unknown>).id as string;
        for (const act of task.activities) {
          const { error: aErr } = await supabase.from('task_activities').insert({
            job_task_id: newTaskId, activity_name: act.activity_name, sort_order: act.sort_order, active: true,
          });
          if (aErr) { console.error('task_activities insert failed:', aErr); return { error: aErr.message }; }
        }
      }
    }
    for (const tid of dbTaskIds) {
      if (!keptTaskIds.has(tid)) {
        await supabase.from('task_activities').update({ active: false }).eq('job_task_id', tid);
        await supabase.from('job_tasks').update({ active: false }).eq('id', tid);
      }
    }

    const { data: dbSkills } = await supabase.from('job_skills').select('id, name, skill_type').eq('job_id', data.jobId).eq('active', true);
    const dbSkillIds = new Set((dbSkills || []).map((s: Record<string, unknown>) => s.id as string));
    const keptSkillIds = new Set<string>();
    const existingSkillKeys = new Set<string>();
    for (const s of (dbSkills || []) as Record<string, unknown>[]) {
      existingSkillKeys.add(`${(s.skill_type as string) || ''}|${(s.name as string) || ''}`);
    }

    for (const skill of data.skills) {
      if (skill._deleted) continue;
      if (!skill.name.trim()) continue;
      const skillKey = `${skill.skill_type}|${skill.name}`;
      if (skill.id) {
        keptSkillIds.add(skill.id);
        const { error: sErr } = await supabase.from('job_skills').update({
          name: skill.name, skill_type: skill.skill_type, sort_order: skill.sort_order, updated_by: data.userId,
        }).eq('id', skill.id);
        if (sErr) { console.error('job_skills update failed:', sErr); return { error: sErr.message }; }
      } else {
        if (existingSkillKeys.has(skillKey)) continue;
        const { error: sErr } = await supabase.from('job_skills').insert({
          job_id: data.jobId, name: skill.name, skill_type: skill.skill_type, sort_order: skill.sort_order, active: true,
        });
        if (sErr) { console.error('job_skills insert failed:', sErr); return { error: sErr.message }; }
        existingSkillKeys.add(skillKey);
      }
    }
    for (const sid of dbSkillIds) {
      if (!keptSkillIds.has(sid)) {
        await supabase.from('job_skills').update({ active: false }).eq('id', sid);
      }
    }

    const { error: rErr } = await supabase.from('job_requirements').upsert({
      job_id: data.jobId, education: data.requirements.education, major: data.requirements.major, certifications: data.requirements.certifications,
    }, { onConflict: 'job_id' });
    if (rErr) { console.error('job_requirements upsert failed:', rErr); return { error: rErr.message }; }

    return {};
  } catch (e) {
    console.error('saveJobEdits exception:', e);
    return { error: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
  }
}

// ── Export all job data to Excel ────────────────────────────────────

/** companyId가 null이면 전 회사를 내보낸다(v2 F4 — 화면의 회사 필터가 'all'인 경우). */
export async function exportAllJobsToExcel(companyId: string | null): Promise<void> {
  if (!supabase) return;
  const XLSX = await import('xlsx');

  let jobQuery = supabase
    .from('jobs')
    .select(`id, name, definition, group_id, series_id, job_groups!inner(name), job_series!inner(name)`)
    .eq('active', true)
    .order('name');
  if (companyId) jobQuery = jobQuery.eq('company_id', companyId);
  const { data: jobs } = await jobQuery;
  if (!jobs || jobs.length === 0) return;

  const jobIds = jobs.map(j => j.id);

  const { data: tasks } = await supabase
    .from('job_tasks')
    .select('id, job_id, name, sort_order')
    .in('job_id', jobIds)
    .eq('active', true)
    .order('sort_order');

  const taskIds = (tasks || []).map(t => t.id);
  let activities: Record<string, unknown>[] = [];
  if (taskIds.length > 0) {
    const { data: acts } = await supabase
      .from('task_activities')
      .select('id, job_task_id, activity_name, sort_order')
      .in('job_task_id', taskIds)
      .eq('active', true)
      .order('sort_order');
    activities = acts || [];
  }

  const { data: skills } = await supabase
    .from('job_skills')
    .select('id, job_id, name, skill_type, sort_order')
    .in('job_id', jobIds)
    .eq('active', true)
    .order('sort_order');

  const { data: reqs } = await supabase
    .from('job_requirements')
    .select('job_id, education, major, certifications')
    .in('job_id', jobIds);

  const tasksByJob = new Map<string, typeof tasks>();
  for (const t of tasks || []) {
    const arr = tasksByJob.get(t.job_id) || [];
    arr.push(t);
    tasksByJob.set(t.job_id, arr);
  }
  const actsByTask = new Map<string, typeof activities>();
  for (const a of activities) {
    const arr = actsByTask.get(a.job_task_id as string) || [];
    arr.push(a);
    actsByTask.set(a.job_task_id as string, arr);
  }
  const skillsByJob = new Map<string, typeof skills>();
  for (const s of skills || []) {
    const arr = skillsByJob.get(s.job_id) || [];
    arr.push(s);
    skillsByJob.set(s.job_id, arr);
  }
  type RequirementExportRow = {
    job_id: string;
    education: string;
    major: string;
    certifications: string;
  };
  const reqsByJob = new Map<string, RequirementExportRow>();
  for (const r of reqs || []) {
    reqsByJob.set(r.job_id, r as RequirementExportRow);
  }

  const step1Rows: Record<string, string>[] = [];
  for (const job of jobs) {
    const j = job as Record<string, unknown>;
    const groupName = (j['job_groups'] as Record<string, string>).name;
    const seriesName = (j['job_series'] as Record<string, string>).name;
    const jobTasks = tasksByJob.get(job.id) || [];
    for (const task of jobTasks) {
      const taskActs = actsByTask.get(task.id) || [];
      if (taskActs.length === 0) {
        step1Rows.push({
          '직군': groupName, '직렬': seriesName, '직무': job.name,
          '직무정의': job.definition || '', '주요과업': task.name, '세부활동': '',
        });
      } else {
        for (const act of taskActs) {
          step1Rows.push({
            '직군': groupName, '직렬': seriesName, '직무': job.name,
            '직무정의': job.definition || '', '주요과업': task.name,
            '세부활동': act.activity_name as string,
          });
        }
      }
    }
  }

  const step2Rows: Record<string, string>[] = [];
  for (const job of jobs) {
    const j = job as Record<string, unknown>;
    const groupName = (j['job_groups'] as Record<string, string>).name;
    const seriesName = (j['job_series'] as Record<string, string>).name;
    const jobSkills = skillsByJob.get(job.id) || [];
    const req = reqsByJob.get(job.id);
    const education = req?.education || '';
    const major = req?.major || '';
    const certifications = req?.certifications || '';
    if (jobSkills.length === 0) {
      step2Rows.push({
        '직군': groupName, '직렬': seriesName, '직무': job.name,
        'Skill 구분': '', 'Skill': '',
        '요구 학력': education, '관련 전공': major, '관련 자격증/면허': certifications,
      });
    } else {
      for (const skill of jobSkills) {
        step2Rows.push({
          '직군': groupName, '직렬': seriesName, '직무': job.name,
          'Skill 구분': skill.skill_type || '', 'Skill': skill.name,
          '요구 학력': education, '관련 전공': major, '관련 자격증/면허': certifications,
        });
      }
    }
  }

  const step1Cols = ['직군', '직렬', '직무', '직무정의', '주요과업', '세부활동'];
  const step2Cols = ['직군', '직렬', '직무', 'Skill 구분', 'Skill', '요구 학력', '관련 전공', '관련 자격증/면허'];

  const ws1 = XLSX.utils.json_to_sheet(step1Rows, { header: step1Cols });
  ws1['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 50 }, { wch: 24 }, { wch: 40 }];
  const ws2 = XLSX.utils.json_to_sheet(step2Rows, { header: step2Cols });
  ws2['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, '직무 및 과업 정보');
  XLSX.utils.book_append_sheet(wb, ws2, 'Skill 및 수행요건');

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  XLSX.writeFile(wb, `서연이화_전체_직무정보_${date}.xlsx`);
}



// ── Fetch all jobs for SME selection ─────────────────────────────────

export interface JobListItem {
  id: string;
  name: string;
  group_name: string;
  series_name: string;
  company_id: string | null;
  company_name: string;
}

export async function fetchAllJobs(companyId?: string | null): Promise<JobListItem[]> {
  return orEmpty(await fetchAllJobsResult(companyId), []);
}

/**
 * 직무 한 건의 머리(이름·직군·직렬·회사) — v2 D3.
 * 비교 뷰가 직무명 한 줄 때문에 전 직무 목록을 받던 자리를 대신한다.
 */
export async function fetchJobHeader(jobId: string): Promise<ApiResult<JobListItem | null>> {
  if (!supabase) return fail('직무 조회', NO_DB);
  const { data, error } = await supabase
    .from('jobs')
    .select(`id, name, company_id, job_groups!inner(name), job_series!inner(name), companies!left(name)`)
    .eq('id', jobId)
    .maybeSingle();
  if (error) return fail('직무 조회', error.message);
  if (!data) return ok(null);
  const j = data as Record<string, unknown>;
  return ok({
    id: j.id as string,
    name: j.name as string,
    group_name: (j['job_groups'] as Record<string, string>).name,
    series_name: (j['job_series'] as Record<string, string>).name,
    company_id: (j.company_id as string) || null,
    company_name: ((j['companies'] as Record<string, string>) || { name: '' }).name || '',
  });
}

export async function fetchAllJobsResult(companyId?: string | null): Promise<ApiResult<JobListItem[]>> {
  if (!supabase) return fail('직무 목록 조회', NO_DB);
  let query = supabase
    .from('jobs')
    .select(`
      id, name, company_id,
      job_groups!inner(name),
      job_series!inner(name),
      companies!left(name)
    `)
    .eq('active', true)
    .order('name');
  if (companyId) {
    query = query.eq('company_id', companyId);
  }
  const { data, error } = await query;
  if (error) return fail('직무 목록 조회', error.message);
  return ok((data || []).map((j: Record<string, unknown>) => ({
    id: j.id as string,
    name: j.name as string,
    group_name: (j['job_groups'] as Record<string, string>).name,
    series_name: (j['job_series'] as Record<string, string>).name,
    company_id: (j.company_id as string) || null,
    company_name: ((j['companies'] as Record<string, string>) || { name: '' }).name || '',
  })));
}
