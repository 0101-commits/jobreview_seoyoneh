import { supabase } from './supabase';
import { logAudit } from './auditApi';
import {
  FIXED_COMPANY_NAME,
  type IntegratedJobRow,
  type IntegratedOrgRow,
  type IntegratedSkillRow,
} from './integratedUploadUtils';

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

/**
 * SME 명부의 「배정직무」를 대조할 기존 등록 직무명.
 * 검증은 이 목록 없이도 성립하므로(파일 안 직무명만으로도 판정 가능) 실패는 호출부가 경고로 처리합니다.
 */
export async function fetchExistingJobNames(companyId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('jobs')
    .select('name')
    .eq('company_id', companyId)
    .eq('active', true);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => String((row as Record<string, unknown>).name ?? '')).filter(Boolean);
}

/**
 * 조직 마스터(시트 ③) 저장. 이 Phase에서 실제로 DB에 반영하는 것은 여기까지입니다.
 * SME 명부(시트 ④)는 계정 생성(Edge Function)·배정과 얽혀 있어 검증까지만 하고 저장하지 않습니다.
 *
 * 상위조직은 2패스로 연결합니다 — 1패스에서 코드·이름을 먼저 넣어 id를 확보하고,
 * 2패스에서 코드→id 표로 parent_id를 채웁니다. 파일 뒤쪽에 정의된 상위조직도 이 순서로 해결됩니다.
 * 업로드 방식(추가/전체 교체)과 무관하게 upsert만 하며 조직을 지우지 않습니다.
 * 조직 삭제는 profiles.org_unit_id 등 참조가 걸려 있어 이 Phase의 범위 밖입니다.
 */
export async function saveOrgUnits(params: { companyId: string; rows: IntegratedOrgRow[] }): Promise<number> {
  if (!supabase) throw new Error('데이터베이스 연결이 없습니다.');

  const rows = params.rows.filter((row) => row.조직코드 && row.조직명);
  if (rows.length === 0) return 0;

  const { data, error } = await supabase
    .from('org_units')
    .upsert(
      rows.map((row) => ({
        company_id: params.companyId,
        code: row.조직코드,
        name: row.조직명,
        active: true,
      })),
      { onConflict: 'company_id,code' },
    )
    .select('id, code');
  if (error) throw new Error(`조직 마스터를 저장하지 못했습니다. ${error.message}`);

  const idByCode = new Map(
    (data || []).map((row) => {
      const record = row as Record<string, unknown>;
      return [String(record.code), String(record.id)];
    }),
  );

  // 파일을 조직 트리의 기준으로 삼습니다. 상위조직코드가 비어 있으면 parent_id도 비워 최상위로 되돌립니다.
  const { error: parentError } = await supabase.from('org_units').upsert(
    rows.map((row) => ({
      company_id: params.companyId,
      code: row.조직코드,
      name: row.조직명,
      parent_id: row.상위조직코드 ? (idByCode.get(row.상위조직코드) ?? null) : null,
    })),
    { onConflict: 'company_id,code' },
  );
  if (parentError) throw new Error(`상위조직을 연결하지 못했습니다. ${parentError.message}`);

  await logAudit('ORG_UNITS_UPLOADED', 'org_units', params.companyId, { count: rows.length });
  return rows.length;
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
