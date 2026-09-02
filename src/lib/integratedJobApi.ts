import { supabase } from './supabase';
import { logAudit } from './auditApi';
import {
  FIXED_COMPANY_NAME,
  type IntegratedJobRow,
  type IntegratedOrgRow,
  type IntegratedSkillRow,
  type IntegratedSmeRow,
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
 * 조직 마스터(시트 ③) 저장. SME 명부(시트 ④)의 조직코드를 풀 수 있는 유일한 원천이므로
 * 명부 반영(linkSmeRoster)보다 반드시 먼저 저장합니다.
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

/** SME 명부(시트 ④) 반영 결과. 못 찾은 값은 버리지 않고 그대로 화면에 나열합니다. */
export interface SmeRosterLinkResult {
  /** 소속 조직이 연결된 계정 수(이미 같은 조직이던 계정 포함). */
  linkedCount: number;
  /** 그중 이번 반영에서 실제로 조직이 바뀐 계정 수. */
  changedCount: number;
  /** 회사 범위 안에서 계정을 찾지 못한 이메일. 계정 생성은 SME 계정 관리 화면의 몫입니다. */
  unmatchedEmails: string[];
  /** org_units에 없어 소속 조직을 연결하지 못한 조직코드. */
  missingOrgCodes: string[];
  /** 새로 만들어진 배정 수. 이미 있던 배정은 손대지 않으므로 여기에 세지 않습니다. */
  assignmentCreatedCount: number;
  /** 등록된 활성 직무에서 찾지 못해 배정하지 못한 직무명. */
  unknownJobNames: string[];
  /** 새 배정에 붙인 검토(NOT_STARTED) 행 수. */
  reviewCreatedCount: number;
}

const EMPTY_ROSTER_RESULT: SmeRosterLinkResult = {
  linkedCount: 0,
  changedCount: 0,
  unmatchedEmails: [],
  missingOrgCodes: [],
  assignmentCreatedCount: 0,
  unknownJobNames: [],
  reviewCreatedCount: 0,
};

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

/**
 * SME 명부(시트 ④) 반영. 이미 등록된 계정의 소속 조직(profiles.org_unit_id)을 조직코드로 연결하고
 * 「배정직무」를 review_assignments에 추가합니다. 계정은 만들지 않습니다 —
 * 계정 생성은 지금까지처럼 SME 계정 관리 화면의 몫입니다.
 *
 * org_unit_id는 profiles의 컬럼 단위 GRANT 목록에 없어(REVOKE UPDATE 후 여섯 컬럼만 열려 있습니다)
 * 클라이언트에서 직접 UPDATE할 수 없습니다. 그 컬럼을 authenticated에 열면 SME가 자기 소속 조직을
 * 스스로 바꿀 수 있어 §9 E2의 조직축이 응답자 손에서 흔들리므로, 열지 않고 SECURITY DEFINER RPC로 갑니다
 * (근거는 마이그레이션 20260902010000의 3항).
 *
 * 조직 마스터(시트 ③) 저장 이후에 부릅니다. 조직코드를 org_units에서 풀지 못하면 그 사람의
 * 소속 조직만 비어 있는 채로 남고, 어떤 조직코드가 없었는지는 결과로 돌려줍니다.
 */
export async function linkSmeRoster(params: {
  companyId: string;
  rows: IntegratedSmeRow[];
}): Promise<SmeRosterLinkResult> {
  if (!supabase) throw new Error('데이터베이스 연결이 없습니다.');

  const rows = params.rows.filter((row) => row.이메일);
  if (rows.length === 0) return EMPTY_ROSTER_RESULT;

  // 인자명은 마이그레이션의 link_sme_roster(p_company_id, p_rows)와 정확히 같아야 합니다.
  const { data, error } = await supabase.rpc('link_sme_roster', {
    p_company_id: params.companyId,
    p_rows: rows,
  });
  if (error) throw new Error(`SME 명부를 반영하지 못했습니다. ${error.message}`);

  const raw = (data || {}) as Record<string, unknown>;
  const result: SmeRosterLinkResult = {
    linkedCount: Number(raw.linkedCount ?? 0),
    changedCount: Number(raw.changedCount ?? 0),
    unmatchedEmails: toStringList(raw.unmatchedEmails),
    missingOrgCodes: toStringList(raw.missingOrgCodes),
    assignmentCreatedCount: Number(raw.assignmentCreatedCount ?? 0),
    unknownJobNames: toStringList(raw.unknownJobNames),
    reviewCreatedCount: Number(raw.reviewCreatedCount ?? 0),
  };

  // §8 S5. 조직 연결과 배정 생성은 한 번의 명부 반영이므로 한 건으로 남깁니다.
  // 이메일·직무명 원문은 남기지 않고 건수만 남깁니다(감사 로그에 명부를 통째로 복사하지 않습니다).
  await logAudit('SME_ROSTER_LINKED', 'profiles', params.companyId, {
    rowCount: rows.length,
    linked: result.linkedCount,
    changed: result.changedCount,
    unmatched: result.unmatchedEmails.length,
    missingOrgCodes: result.missingOrgCodes.length,
    assignmentsCreated: result.assignmentCreatedCount,
    unknownJobs: result.unknownJobNames.length,
  });

  return result;
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
