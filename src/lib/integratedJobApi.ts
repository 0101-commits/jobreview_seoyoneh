import { supabase } from './supabase';
import { FIXED_COMPANY_NAME, type IntegratedJobRow, type IntegratedSkillRow } from './integratedUploadUtils';

export type UploadMode = 'append' | 'replace';

export interface IntegratedSaveResult {
  jobCount: number;
  taskCount: number;
  activityCount: number;
  skillCount: number;
}

interface RpcSaveResult {
  jobCount?: number;
  taskCount?: number;
  activityCount?: number;
  skillCount?: number;
  requirementCount?: number;
  job_count?: number;
  task_count?: number;
  activity_count?: number;
  skill_count?: number;
  requirement_count?: number;
}

export async function fetchFixedCompanyId(): Promise<string> {
  if (!supabase) throw new Error('데이터베이스 연결이 없습니다.');
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('name', FIXED_COMPANY_NAME)
    .maybeSingle();

  if (companyError) throw new Error(companyError.message);
  if (!company?.id) {
    throw new Error(`회사 정보 ‘${FIXED_COMPANY_NAME}’를 찾을 수 없습니다. companies 테이블을 확인해 주세요.`);
  }
  return company.id;
}

/**
 * 전체 교체 전 화면에 보여줄 "현재 등록된 직무 수".
 * 실패하면 null을 돌려주고, 호출부는 건수 대신 안내 문구를 보여 줍니다.
 */
export async function fetchCurrentJobCount(companyId: string): Promise<number | null> {
  if (!supabase) return null;
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('active', true);
  if (error) {
    console.error(`[integratedJobApi] 현재 직무 수 조회 실패: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

export async function saveIntegratedJobData(params: {
  jobRows: IntegratedJobRow[];
  skillRows: IntegratedSkillRow[];
  mode: 'append' | 'replace';
  companyId: string;
}): Promise<IntegratedSaveResult> {
  if (!supabase) throw new Error('데이터베이스 연결이 없습니다.');

  const { data, error } = await supabase.rpc('save_integrated_job_data', {
    p_company_id: params.companyId,
    p_mode: params.mode,
    p_job_rows: params.jobRows,
    p_skill_rows: params.skillRows,
  });

  if (error) throw new Error(error.message);

  const result = (data || {}) as RpcSaveResult;
  return {
    jobCount: Number(result.jobCount ?? result.job_count ?? 0),
    taskCount: Number(result.taskCount ?? result.task_count ?? 0),
    activityCount: Number(result.activityCount ?? result.activity_count ?? 0),
    skillCount: Number(result.skillCount ?? result.skill_count ?? 0),
  };
}
