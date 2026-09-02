import {
  ApiResult,
  NO_DB,
  Row,
  currentUserId,
  fail,
  ok,
  one,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 7. 워크숍 플래그 (§6-3 ⓑ · job_workshop_flags)
// ────────────────────────────────────────────────────────────────────

export type WorkshopFlagSource = 'AUTO' | 'MANUAL';

export interface WorkshopFlag {
  jobId: string;
  jobName: string;
  flagged: boolean;
  source: WorkshopFlagSource;
  reasons: string[];
  decidedBy: string | null;
  updatedAt: string | null;
}

export interface WorkshopFlagInput {
  flagged: boolean;
  source: WorkshopFlagSource;
  reasons: string[];
  /**
   * true면 이미 저장된 사유에 이번 사유를 합쳐 넣는다(중복 제거).
   * §7-1 ⑤ "자동 규칙이 다시 돌면 같은 줄을 갱신한다(사유는 reasons에 누적)"와
   * §10 P3 DoD ③ "자동 플래그 사유가 reasons 배열에 축적"이 이것이다.
   * 수동 지정(MANUAL)은 관리자가 사유를 다시 쓰는 것이므로 기본값(false = 교체)을 쓴다.
   */
  mergeReasons?: boolean;
}

/**
 * 회사의 워크숍 플래그 전체(§6-3 ⓑ). 제출 큐 배지와 워크숍 대상 목록(§9 E4)이 쓴다.
 * job_workshop_flags에는 company_id가 없으므로 jobs를 inner join 해서 좁힌다. 쿼리 1회.
 */
export async function fetchWorkshopFlags(companyId?: string | null): Promise<ApiResult<WorkshopFlag[]>> {
  if (!supabase) return fail('워크숍 플래그 조회', NO_DB);
  let query = supabase
    .from('job_workshop_flags')
    .select('job_id, flagged, source, reasons, decided_by, updated_at, jobs!inner(id, name, company_id, active)')
    .eq('jobs.active', true);
  if (companyId) query = query.eq('jobs.company_id', companyId);

  const { data, error } = await query;
  if (error) return fail('워크숍 플래그 조회', error.message);

  return ok(
    (data || []).map((raw) => {
      const r = raw as Row;
      const job = one(r.jobs);
      return {
        jobId: str(r.job_id),
        jobName: str(job.name),
        flagged: r.flagged !== false,
        source: str(r.source) === 'MANUAL' ? 'MANUAL' : 'AUTO',
        reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).map(str).filter(Boolean) : [],
        decidedBy: str(r.decided_by) || null,
        updatedAt: str(r.updated_at) || null,
      } satisfies WorkshopFlag;
    }),
  );
}

/**
 * 워크숍 플래그 한 건(v2 D3). 비교 뷰가 직무 하나를 보려고 전 직무의 플래그를 받던 것을 대신한다.
 * 저장된 결정이 없으면 ok(null)이다 — 조회 실패(fail)와 구분해야 화면이 오류를 오해하지 않는다.
 */
export async function fetchWorkshopFlag(jobId: string): Promise<ApiResult<WorkshopFlag | null>> {
  if (!supabase) return fail('워크숍 플래그 조회', NO_DB);
  const { data, error } = await supabase
    .from('job_workshop_flags')
    .select('job_id, flagged, source, reasons, decided_by, updated_at, jobs!inner(id, name, company_id, active)')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) return fail('워크숍 플래그 조회', error.message);
  if (!data) return ok(null);

  const r = data as Row;
  const job = one(r.jobs);
  return ok({
    jobId: str(r.job_id),
    jobName: str(job.name),
    flagged: r.flagged !== false,
    source: str(r.source) === 'MANUAL' ? 'MANUAL' : 'AUTO',
    reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).map(str).filter(Boolean) : [],
    decidedBy: str(r.decided_by) || null,
    updatedAt: str(r.updated_at) || null,
  } satisfies WorkshopFlag);
}

/**
 * 워크숍 플래그 저장(§6-3 ⓑ). 자동 규칙 실행과 수동 지정 버튼이 함께 쓴다.
 * 직무당 한 줄(job_id가 PK)이라 upsert 한 번이다.
 *
 * ponytail: mergeReasons=true일 때만 기존 사유를 읽어 합치므로 그 경우 쿼리 2회이고
 * 두 호출 사이에 다른 관리자가 같은 직무를 고치면 나중 것이 이긴다. 관리자 화면 하나에서
 * 순차로 도는 작업이라 지금은 이걸로 충분하다. 동시 실행이 생기면 배열 병합을 RPC로 내린다.
 */
export async function upsertWorkshopFlag(jobId: string, input: WorkshopFlagInput): Promise<ApiResult<void>> {
  if (!supabase) return fail('워크숍 대상 지정', NO_DB);

  let reasons = input.reasons.map((r) => r.trim()).filter(Boolean);
  if (input.mergeReasons) {
    const { data, error } = await supabase
      .from('job_workshop_flags')
      .select('reasons')
      .eq('job_id', jobId)
      .maybeSingle();
    if (error) return fail('워크숍 대상 지정', error.message);
    const before = Array.isArray((data as Row | null)?.reasons)
      ? ((data as Row).reasons as unknown[]).map(str).filter(Boolean)
      : [];
    reasons = [...new Set([...before, ...reasons])];
  }

  const { error } = await supabase.from('job_workshop_flags').upsert(
    {
      job_id: jobId,
      flagged: input.flagged,
      source: input.source,
      reasons,
      decided_by: await currentUserId(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id' },
  );
  if (error) return fail('워크숍 대상 지정', error.message);
  return ok(undefined);
}
