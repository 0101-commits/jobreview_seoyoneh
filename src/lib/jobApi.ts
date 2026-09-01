import { supabase } from './supabase';
import { normalize, type Step1Row, type Step2Row, type JobMaster } from './uploadUtils';

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

// ── Save STEP 1 data ────────────────────────────────────────────────

export async function saveStep1Data(rows: Step1Row[], mode: 'append' | 'replace', userId: string): Promise<{ saved: number; error?: string }> {
  if (!supabase) return { saved: 0, error: '데이터베이스 연결이 없습니다.' };

  // Fetch company master for name → id mapping
  const { data: companies } = await supabase.from('companies').select('id, name').eq('active', true);
  const companyMap = new Map<string, string>();
  for (const c of (companies || []) as { id: string; name: string }[]) {
    companyMap.set(normalize(c.name).toLowerCase(), c.id);
  }

  // Validate all company names exist
  const unknownCompanies = new Set<string>();
  for (const r of rows) {
    const key = normalize(r.회사).toLowerCase();
    if (!companyMap.has(key)) unknownCompanies.add(r.회사);
  }
  if (unknownCompanies.size > 0) {
    return { saved: 0, error: `등록되지 않은 회사입니다: ${[...unknownCompanies].join(', ')}` };
  }

  // Group rows by 회사 → 직군 → 직렬 → 직무 → 주요과업 → 세부활동
  const groupMap = new Map<string, { name: string; companyId: string }>();
  const seriesMap = new Map<string, { name: string; companyId: string; groupId: string }>();
  const jobMap = new Map<string, { name: string; definition: string; companyId: string; groupId: string; seriesId: string }>();
  const taskMap = new Map<string, { name: string; jobKey: string; sortOrder: number }>();
  const activityList: { jobTaskKey: string; name: string; sortOrder: number }[] = [];

  let taskCounter = 0;
  rows.forEach((r) => {
    const companyId = companyMap.get(normalize(r.회사).toLowerCase())!;
    const gKey = `${companyId}|${normalize(r.직군)}`;
    const sKey = `${gKey}|${normalize(r.직렬)}`;
    const jKey = `${sKey}|${normalize(r.직무)}`;
    const tKey = `${jKey}|${normalize(r.주요과업)}`;

    if (!groupMap.has(gKey)) groupMap.set(gKey, { name: normalize(r.직군), companyId });
    if (!seriesMap.has(sKey)) seriesMap.set(sKey, { name: normalize(r.직렬), companyId, groupId: gKey });
    if (!jobMap.has(jKey)) jobMap.set(jKey, { name: normalize(r.직무), definition: normalize(r.직무정의), companyId, groupId: gKey, seriesId: sKey });
    if (!taskMap.has(tKey)) {
      taskMap.set(tKey, { name: normalize(r.주요과업), jobKey: jKey, sortOrder: taskCounter });
      taskCounter++;
    }
    activityList.push({ jobTaskKey: tKey, name: normalize(r.세부활동), sortOrder: activityList.length });
  });

  try {
    if (mode === 'replace') {
      await supabase.from('task_activities').update({ active: false }).eq('active', true);
      await supabase.from('job_tasks').update({ active: false }).eq('active', true);
      await supabase.from('job_skills').update({ active: false }).eq('active', true);
      await supabase.from('job_requirements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('jobs').update({ active: false }).eq('active', true);
      await supabase.from('job_series').update({ active: false }).eq('active', true);
      await supabase.from('job_groups').update({ active: false }).eq('active', true);
    }

    // 1. Upsert job_groups (with company_id)
    const groupRows = [...groupMap.entries()].map(([, val]) => ({ company_id: val.companyId, name: val.name, active: true, source_version: 1, created_by: userId }));
    const { data: insertedGroups, error: gErr } = await supabase.from('job_groups').upsert(groupRows, { onConflict: 'company_id,name,source_version', ignoreDuplicates: false }).select('id, name, company_id');
    if (gErr) return { saved: 0, error: gErr.message };
    const groupIdMap = new Map((insertedGroups || []).map((g: Record<string, unknown>) => [`${(g.company_id as string) || ''}|${g.name as string}`, g.id as string]));

    // 2. Upsert job_series (with company_id)
    const seriesRows = [...seriesMap.entries()].map(([, val]) => {
      const groupId = groupIdMap.get(val.groupId)!;
      return { company_id: val.companyId, group_id: groupId, name: val.name, active: true, source_version: 1, created_by: userId };
    });
    const { data: insertedSeries, error: sErr } = await supabase.from('job_series').upsert(seriesRows, { onConflict: 'company_id,group_id,name,source_version', ignoreDuplicates: false }).select('id, name, group_id, company_id');
    if (sErr) return { saved: 0, error: sErr.message };
    const seriesIdMap = new Map((insertedSeries || []).map((s: Record<string, unknown>) => [`${(s.company_id as string) || ''}|${s.group_id as string}|${s.name as string}`, s.id as string]));

    // 3. Upsert jobs (with company_id)
    const jobRows = [...jobMap.entries()].map(([, val]) => {
      const groupId = groupIdMap.get(val.groupId)!;
      const seriesId = seriesIdMap.get(`${val.companyId}|${groupId}|${seriesMap.get(val.seriesId)!.name}`)!;
      return { company_id: val.companyId, group_id: groupId, series_id: seriesId, name: val.name, definition: val.definition, active: true, source_version: 1, created_by: userId };
    });
    const { data: insertedJobs, error: jErr } = await supabase.from('jobs').upsert(jobRows, { onConflict: 'company_id,series_id,name,source_version', ignoreDuplicates: false }).select('id, name, group_id, series_id, company_id');
    if (jErr) return { saved: 0, error: jErr.message };
    const jobIdMap = new Map((insertedJobs || []).map((j: Record<string, unknown>) => [`${(j.company_id as string) || ''}|${j.group_id as string}|${j.series_id as string}|${j.name as string}`, j.id as string]));

    // 4. Insert job_tasks
    const taskRows = [...taskMap.entries()].map(([, val]) => {
      const jobKey = val.jobKey;
      const job = jobMap.get(jobKey)!;
      const groupId = groupIdMap.get(job.groupId)!;
      const seriesId = seriesIdMap.get(`${job.companyId}|${groupId}|${seriesMap.get(job.seriesId)!.name}`)!;
      const jKey = `${job.companyId}|${groupId}|${seriesId}|${job.name}`;
      const jobId = jobIdMap.get(jKey)!;
      return { job_id: jobId, name: val.name, sort_order: val.sortOrder, active: true };
    });
    const { data: insertedTasks, error: tErr } = await supabase.from('job_tasks').insert(taskRows).select('id, name, job_id, sort_order');
    if (tErr) return { saved: 0, error: tErr.message };

    const taskIdMap = new Map<string, string>();
    (insertedTasks || []).forEach((t: Record<string, unknown>) => {
      taskIdMap.set(`${t.job_id as string}|${t.name as string}`, t.id as string);
    });

    // 5. Insert task_activities
    const activityRows = activityList.map((a) => {
      const taskKey = a.jobTaskKey;
      const jKey = taskKey.split('|').slice(0, 4).join('|');
      const taskName = taskKey.split('|')[4];
      const job = jobMap.get(jKey)!;
      const groupId = groupIdMap.get(job.groupId)!;
      const seriesId = seriesIdMap.get(`${job.companyId}|${groupId}|${seriesMap.get(job.seriesId)!.name}`)!;
      const jobId = jobIdMap.get(`${job.companyId}|${groupId}|${seriesId}|${job.name}`)!;
      const taskId = taskIdMap.get(`${jobId}|${taskName}`)!;
      return { job_task_id: taskId, activity_name: a.name, sort_order: a.sortOrder, active: true };
    });
    if (activityRows.length > 0) {
      const { error: aErr } = await supabase.from('task_activities').insert(activityRows);
      if (aErr) return { saved: 0, error: aErr.message };
    }

    return { saved: rows.length };
  } catch (e) {
    return { saved: 0, error: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
  }
}

// ── Save STEP 2 data ────────────────────────────────────────────────

export async function saveStep2Data(
  rows: Step2Row[],
  matchResults: { row: number; status: string; jobId?: string }[],
  mode: 'append' | 'replace',
): Promise<{ saved: number; error?: string }> {
  if (!supabase) return { saved: 0, error: '데이터베이스 연결이 없습니다.' };

  try {
    const rowToJobId = new Map<number, string>();
    matchResults.forEach((r) => {
      if (r.status === 'matched' && r.jobId) rowToJobId.set(r.row, r.jobId);
    });

    const skillsByJob = new Map<string, { skill_type: string; name: string; sort_order: number }[]>();
    const reqsByJob = new Map<string, { education: string; major: string; certifications: string }>();
    const reqConflicts: string[] = [];
    const reqRowsByJob = new Map<string, { row: number; education: string; major: string; certifications: string }[]>();

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const jobId = rowToJobId.get(rowNum);
      if (!jobId) return;

      const skillType = normalize(row['Skill 구분']);
      const skillName = normalize(row.Skill);
      if (skillName) {
        const arr = skillsByJob.get(jobId) || [];
        arr.push({ skill_type: skillType, name: skillName, sort_order: arr.length });
        skillsByJob.set(jobId, arr);
      }

      const education = normalize(row['요구 학력']);
      const major = normalize(row['관련 전공']);
      const certifications = normalize(row['관련 자격증/면허']);
      const list = reqRowsByJob.get(jobId) || [];
      list.push({ row: rowNum, education, major, certifications });
      reqRowsByJob.set(jobId, list);
    });

    for (const [jobId, entries] of reqRowsByJob) {
      const merged = { education: '', major: '', certifications: '' };
      const seenVals: Record<string, Map<string, number>> = {
        education: new Map(),
        major: new Map(),
        certifications: new Map(),
      };
      for (const e of entries) {
        (['education', 'major', 'certifications'] as const).forEach((f) => {
          if (e[f]) {
            const rowsForVal = seenVals[f].get(e[f]);
            if (rowsForVal === undefined) seenVals[f].set(e[f], e.row);
          }
        });
      }
      let conflict = false;
      const fieldLabel: Record<string, string> = { education: '요구 학력', major: '관련 전공', certifications: '관련 자격증/면허' };
      (['education', 'major', 'certifications'] as const).forEach((f) => {
        const vals = [...seenVals[f].keys()];
        if (vals.length > 1) {
          conflict = true;
          const detail = vals.map((v) => `${seenVals[f].get(v)}행: ${v}`).join(', ');
          reqConflicts.push(`${fieldLabel[f]} - ${detail}`);
        } else if (vals.length === 1) {
          merged[f] = vals[0];
        }
      });
      if (conflict) continue;
      reqsByJob.set(jobId, merged);
    }

    if (reqConflicts.length > 0) {
      return { saved: 0, error: `동일 직무에 서로 다른 수행요건이 입력되어 있습니다.\n${reqConflicts.join('\n')}` };
    }

    if (mode === 'replace') {
      await supabase.from('job_skills').update({ active: false }).eq('active', true);
      await supabase.from('job_requirements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    let skillCount = 0;
    for (const [jobId, skills] of skillsByJob) {
      const skillRows = skills.map((s) => ({ job_id: jobId, skill_type: s.skill_type, name: s.name, sort_order: s.sort_order, active: true }));
      const { error } = await supabase.from('job_skills').insert(skillRows);
      if (error) return { saved: 0, error: error.message };
      skillCount += skillRows.length;
    }

    let reqCount = 0;
    for (const [jobId, req] of reqsByJob) {
      const { error } = await supabase.from('job_requirements').upsert(
        { job_id: jobId, education: req.education, major: req.major, certifications: req.certifications },
        { onConflict: 'job_id' },
      );
      if (error) return { saved: 0, error: error.message };
      reqCount++;
    }

    return { saved: skillCount + reqCount };
  } catch (e) {
    return { saved: 0, error: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
  }
}

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

export async function checkDuplicateJob(groupId: string, seriesId: string, name: string, excludeJobId: string, companyId?: string | null): Promise<boolean> {
  if (!supabase) return false;
  let query = supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('series_id', seriesId)
    .eq('name', name)
    .eq('active', true)
    .neq('id', excludeJobId);
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

export async function exportAllJobsToExcel(companyId: string): Promise<void> {
  if (!supabase) return;
  const XLSX = await import('xlsx');

  const { data: jobs } = await supabase
    .from('jobs')
    .select(`id, name, definition, group_id, series_id, job_groups!inner(name), job_series!inner(name)`)
    .eq('company_id', companyId)
    .eq('active', true)
    .order('name');
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
