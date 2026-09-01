import * as XLSX from 'xlsx';
import { normalize, parseWorkbook } from './uploadUtils';

export { normalize, parseWorkbook };

export const FIXED_COMPANY_NAME = '서연이화';
export const JOB_SHEET_NAME = '직무 및 과업 정보';
export const SKILL_SHEET_NAME = 'Skill 및 수행요건';

/*
 * 시트 ③④는 선택 시트다(PLAN §6-3 ⓒ · §11-2 Phase 1 4항).
 * 없으면 기존 2시트 파일과 완전히 동일하게 동작해야 한다 — 이것이 회귀 없음의 기준선이다.
 * 이 Phase의 저장 범위는 조직 마스터까지다. SME 명부는 계정 생성(Edge Function)과 배정이
 * 얽혀 있어 여기서는 검증·미리보기·정규화 결과 다운로드까지만 하고 계정은 만들지 않는다.
 */
export const ORG_SHEET_NAME = '조직 마스터';
export const SME_SHEET_NAME = 'SME 명부';

export const KNOWN_SHEET_NAMES = [JOB_SHEET_NAME, SKILL_SHEET_NAME, ORG_SHEET_NAME, SME_SHEET_NAME] as const;

export const JOB_HEADERS = ['직군', '직렬', '직무', '직무정의', '주요과업', '세부활동'] as const;

export const SKILL_HEADERS = [
  '직군',
  '직렬',
  '직무',
  'Skill 구분',
  'Skill',
  '요구 학력',
  '관련 전공',
  '관련 자격증/면허',
] as const;

export const ORG_HEADERS = ['조직코드', '조직명', '상위조직코드'] as const;

export const SME_HEADERS = ['성명', '이메일', '조직코드', '직급', '배정직무'] as const;

export interface IntegratedJobRow {
  직군: string;
  직렬: string;
  직무: string;
  직무정의: string;
  주요과업: string;
  세부활동: string;
}

export interface IntegratedSkillRow {
  직군: string;
  직렬: string;
  직무: string;
  'Skill 구분': string;
  Skill: string;
  '요구 학력': string;
  '관련 전공': string;
  '관련 자격증/면허': string;
}

export interface IntegratedOrgRow {
  조직코드: string;
  조직명: string;
  /** 비어 있으면 최상위 조직이다. */
  상위조직코드: string;
}

export interface IntegratedSmeRow {
  성명: string;
  이메일: string;
  조직코드: string;
  직급: string;
  배정직무: string;
  /** 쉼표로 나눠 정규화·중복 제거한 배정직무 목록. 계정 생성 화면이 그대로 쓸 수 있는 형태다. */
  배정직무목록: string[];
}

export interface IntegratedValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  jobRows: IntegratedJobRow[];
  skillRows: IntegratedSkillRow[];
  /** jobRows/skillRows와 같은 순서의 엑셀 행 번호(미리보기·오류 표시용). */
  jobRowNumbers: number[];
  skillRowNumbers: number[];
  jobCount: number;
  taskCount: number;
  activityCount: number;
  skillCount: number;
  requirementCount: number;
  matchedJobCount: number;
  jobErrorCount: number;
  skillErrorCount: number;
  /** 필수값 누락 건수(선택 항목 공백 경고는 포함하지 않습니다). */
  jobMissingCount: number;
  skillMissingCount: number;
  /** 업로드를 막지 않는 확인 필요 건수. */
  jobWarningCount: number;
  skillWarningCount: number;
  duplicateJobRowCount: number;
  duplicateSkillRowCount: number;
  /** 선택 시트 ③④의 포함 여부. false면 화면에서 해당 카드·미리보기를 아예 그리지 않습니다. */
  hasOrgSheet: boolean;
  hasSmeSheet: boolean;
  orgRows: IntegratedOrgRow[];
  smeRows: IntegratedSmeRow[];
  orgRowNumbers: number[];
  smeRowNumbers: number[];
  orgCount: number;
  smeCount: number;
  /** 명부에서 파싱한 배정직무 건수(사람 수가 아니라 직무명 개수). */
  assignmentCount: number;
  orgErrorCount: number;
  smeErrorCount: number;
  orgMissingCount: number;
  smeMissingCount: number;
  orgWarningCount: number;
  smeWarningCount: number;
}

type DataSheetName =
  | typeof JOB_SHEET_NAME
  | typeof SKILL_SHEET_NAME
  | typeof ORG_SHEET_NAME
  | typeof SME_SHEET_NAME;

type IntegratedSheetName = DataSheetName | '파일';

interface NumberedSheetRow<T> {
  rowNumber: number;
  data: T;
}

const VALID_SKILL_TYPES = new Set(['Hard Skill', 'Soft Skill']);

/** 이메일 형식 검사. 로컬·도메인·점 하나만 본다(과한 정규식은 정상 주소를 막습니다). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function makeJobKey(group: unknown, series: unknown, job: unknown): string {
  return [normalize(group), normalize(series), normalize(job)].join('|');
}

function getHeaders(wb: XLSX.WorkBook, sheetName: string): string[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });
  return (rows[0] || []).map(normalize).filter(Boolean);
}

function headersEqual(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function sheetToRows<T extends Record<string, unknown>>(wb: XLSX.WorkBook, sheetName: string): NumberedSheetRow<T>[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  });
  const headers = (matrix[0] || []).map(normalize);

  return matrix
    .slice(1)
    .map((cells, index) => {
      const data = Object.fromEntries(headers.map((header, columnIndex) => [header, cells[columnIndex] ?? ''])) as T;
      return { rowNumber: index + 2, data };
    })
    .filter(({ data }) => Object.values(data).some((value) => normalize(value) !== ''));
}

/** 한글이 아닌 항목명은 읽는 소리를 등록해 두고 그 받침으로 판정합니다. */
const READING: Record<string, string> = { skill: '스킬' };

function hasBatchim(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  const reading = READING[word.trim().toLowerCase()];
  return reading ? hasBatchim(reading) : false;
}

/** 「직군이 / 직무가 / Skill이」처럼 받침 유무로 조사를 고릅니다. */
export function withJosa(word: string, withBatchim: string, withoutBatchim: string): string {
  return `${word}${hasBatchim(word) ? withBatchim : withoutBatchim}`;
}

function addRequiredError(
  errors: string[],
  sheet: DataSheetName,
  row: number,
  field: string,
  value: string,
): number {
  if (value) return 0;
  errors.push(formatMessage(sheet, row, `${withJosa(field, '이', '가')} 입력되지 않았습니다.`));
  return 1;
}

function formatMessage(sheet: IntegratedSheetName, row: number, message: string): string {
  return `${sheet}${row > 0 ? ` ${row}행` : ''}: ${message}`;
}

/**
 * @param loadKnownJobNames SME 명부의 「배정직무」를 대조할 기존 DB 직무명 공급자(선택).
 *   시트 ④가 있을 때만 호출하고, 실패해도 검증을 멈추지 않습니다(경고 한 줄로 알리고 파일 안 직무명만 사용).
 *   넘기지 않으면 기존 2시트 흐름과 동일하게 네트워크를 전혀 타지 않습니다.
 */
export async function parseAndValidateIntegratedWorkbook(
  file: File,
  loadKnownJobNames?: () => Promise<string[]>,
): Promise<IntegratedValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let jobMissingCount = 0;
  let skillMissingCount = 0;
  let orgMissingCount = 0;
  let smeMissingCount = 0;
  let hasOrgSheet = false;
  let hasSmeSheet = false;
  const emptyResult = (): IntegratedValidationResult => ({
    valid: false,
    errors,
    warnings,
    jobRows: [],
    skillRows: [],
    jobRowNumbers: [],
    skillRowNumbers: [],
    jobCount: 0,
    taskCount: 0,
    activityCount: 0,
    skillCount: 0,
    requirementCount: 0,
    matchedJobCount: 0,
    jobErrorCount: errors.filter((message) => message.startsWith(JOB_SHEET_NAME)).length,
    skillErrorCount: errors.filter((message) => message.startsWith(SKILL_SHEET_NAME)).length,
    jobMissingCount,
    skillMissingCount,
    jobWarningCount: warnings.filter((message) => message.startsWith(JOB_SHEET_NAME)).length,
    skillWarningCount: warnings.filter((message) => message.startsWith(SKILL_SHEET_NAME)).length,
    duplicateJobRowCount: 0,
    duplicateSkillRowCount: 0,
    hasOrgSheet,
    hasSmeSheet,
    orgRows: [],
    smeRows: [],
    orgRowNumbers: [],
    smeRowNumbers: [],
    orgCount: 0,
    smeCount: 0,
    assignmentCount: 0,
    orgErrorCount: errors.filter((message) => message.startsWith(ORG_SHEET_NAME)).length,
    smeErrorCount: errors.filter((message) => message.startsWith(SME_SHEET_NAME)).length,
    orgMissingCount,
    smeMissingCount,
    orgWarningCount: warnings.filter((message) => message.startsWith(ORG_SHEET_NAME)).length,
    smeWarningCount: warnings.filter((message) => message.startsWith(SME_SHEET_NAME)).length,
  });

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    errors.push(formatMessage('파일', 0, 'xlsx 또는 xls 파일만 업로드할 수 있습니다.'));
    return emptyResult();
  }

  const wb = await parseWorkbook(file);

  hasOrgSheet = wb.SheetNames.includes(ORG_SHEET_NAME);
  hasSmeSheet = wb.SheetNames.includes(SME_SHEET_NAME);

  // Sheet 개수는 더 이상 고정하지 않습니다. 필수 2개가 있고 나머지가 아는 이름이면 통과합니다.
  const unknownSheets = wb.SheetNames.filter(
    (name) => !(KNOWN_SHEET_NAMES as readonly string[]).includes(name),
  );
  if (unknownSheets.length > 0) {
    errors.push(
      formatMessage(
        '파일',
        0,
        `‘${unknownSheets.join('’, ‘')}’ Sheet는 이 양식에서 사용하지 않습니다. Sheet 이름은 ${KNOWN_SHEET_NAMES.join(' · ')}만 사용할 수 있습니다.`,
      ),
    );
  }

  for (const requiredSheet of [JOB_SHEET_NAME, SKILL_SHEET_NAME] as const) {
    if (!wb.SheetNames.includes(requiredSheet)) {
      errors.push(formatMessage('파일', 0, `'${requiredSheet}' Sheet가 없습니다.`));
    }
  }

  // 명부의 조직코드는 조직 마스터가 있어야 검증할 수 있습니다. 확인할 수 없는 값을 통과시키지 않습니다.
  if (hasSmeSheet && !hasOrgSheet) {
    errors.push(
      formatMessage(
        '파일',
        0,
        `‘${SME_SHEET_NAME}’ Sheet를 넣으려면 ‘${ORG_SHEET_NAME}’ Sheet도 함께 넣어 주세요. 조직코드를 확인할 수 없습니다.`,
      ),
    );
  }
  if (errors.length > 0) return emptyResult();

  const jobHeaders = getHeaders(wb, JOB_SHEET_NAME);
  const skillHeaders = getHeaders(wb, SKILL_SHEET_NAME);

  if (jobHeaders.includes('회사') || skillHeaders.includes('회사')) {
    errors.push(formatMessage('파일', 1, '새로운 통합 양식을 사용해 주세요. 회사 열은 입력하지 않습니다.'));
    return emptyResult();
  }

  if (!headersEqual(jobHeaders, JOB_HEADERS)) {
    errors.push(
      formatMessage(JOB_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${JOB_HEADERS.join(', ')} 순서로 입력해 주세요.`),
    );
  }
  if (!headersEqual(skillHeaders, SKILL_HEADERS)) {
    errors.push(
      formatMessage(SKILL_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${SKILL_HEADERS.join(', ')} 순서로 입력해 주세요.`),
    );
  }
  if (hasOrgSheet && !headersEqual(getHeaders(wb, ORG_SHEET_NAME), ORG_HEADERS)) {
    errors.push(
      formatMessage(ORG_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${ORG_HEADERS.join(', ')} 순서로 입력해 주세요.`),
    );
  }
  if (hasSmeSheet && !headersEqual(getHeaders(wb, SME_SHEET_NAME), SME_HEADERS)) {
    errors.push(
      formatMessage(SME_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${SME_HEADERS.join(', ')} 순서로 입력해 주세요.`),
    );
  }
  if (errors.length > 0) return emptyResult();

  const rawJobRows = sheetToRows<Record<string, unknown>>(wb, JOB_SHEET_NAME);
  const rawSkillRows = sheetToRows<Record<string, unknown>>(wb, SKILL_SHEET_NAME);

  if (rawJobRows.length === 0) {
    errors.push(formatMessage(JOB_SHEET_NAME, 0, '데이터 행이 없습니다.'));
  }
  if (rawSkillRows.length === 0) {
    errors.push(formatMessage(SKILL_SHEET_NAME, 0, '데이터 행이 없습니다.'));
  }

  const jobRows: IntegratedJobRow[] = [];
  const jobRowNumbers: number[] = [];
  const jobDefinitions = new Map<string, { value: string; row: number }>();
  const jobRowKeys = new Set<string>();
  let duplicateJobRowCount = 0;

  rawJobRows.forEach(({ data: raw, rowNumber: excelRow }) => {
    const row: IntegratedJobRow = {
      직군: normalize(raw['직군']),
      직렬: normalize(raw['직렬']),
      직무: normalize(raw['직무']),
      직무정의: normalize(raw['직무정의']),
      주요과업: normalize(raw['주요과업']),
      세부활동: normalize(raw['세부활동']),
    };

    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '직군', row.직군);
    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '직렬', row.직렬);
    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '직무', row.직무);
    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '직무정의', row.직무정의);
    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '주요과업', row.주요과업);
    jobMissingCount += addRequiredError(errors, JOB_SHEET_NAME, excelRow, '세부활동', row.세부활동);

    const jobKey = makeJobKey(row.직군, row.직렬, row.직무);
    const priorDefinition = jobDefinitions.get(jobKey);
    if (row.직무정의 && priorDefinition && priorDefinition.value !== row.직무정의) {
      errors.push(
        formatMessage(JOB_SHEET_NAME, excelRow, `동일 직무의 직무정의가 ${priorDefinition.row}행과 다릅니다.`),
      );
    } else if (row.직무정의 && !priorDefinition) {
      jobDefinitions.set(jobKey, { value: row.직무정의, row: excelRow });
    }

    const rowKey = `${jobKey}|${row.주요과업}|${row.세부활동}`;
    if (jobRowKeys.has(rowKey)) {
      duplicateJobRowCount += 1;
      warnings.push(formatMessage(JOB_SHEET_NAME, excelRow, '중복 세부활동 행을 제외했습니다.'));
      return;
    }
    jobRowKeys.add(rowKey);
    jobRows.push(row);
    jobRowNumbers.push(excelRow);
  });

  const availableJobs = new Set(jobRows.map((row) => makeJobKey(row.직군, row.직렬, row.직무)));
  const skillRows: IntegratedSkillRow[] = [];
  const skillRowNumbers: number[] = [];
  const skillRowKeys = new Set<string>();
  const requirementByJob = new Map<string, { education: string; major: string; certifications: string; row: number }>();
  let duplicateSkillRowCount = 0;

  rawSkillRows.forEach(({ data: raw, rowNumber: excelRow }) => {
    const row: IntegratedSkillRow = {
      직군: normalize(raw['직군']),
      직렬: normalize(raw['직렬']),
      직무: normalize(raw['직무']),
      'Skill 구분': normalize(raw['Skill 구분']),
      Skill: normalize(raw['Skill']),
      '요구 학력': normalize(raw['요구 학력']),
      '관련 전공': normalize(raw['관련 전공']),
      '관련 자격증/면허': normalize(raw['관련 자격증/면허']),
    };

    skillMissingCount += addRequiredError(errors, SKILL_SHEET_NAME, excelRow, '직군', row.직군);
    skillMissingCount += addRequiredError(errors, SKILL_SHEET_NAME, excelRow, '직렬', row.직렬);
    skillMissingCount += addRequiredError(errors, SKILL_SHEET_NAME, excelRow, '직무', row.직무);
    skillMissingCount += addRequiredError(errors, SKILL_SHEET_NAME, excelRow, 'Skill 구분', row['Skill 구분']);
    skillMissingCount += addRequiredError(errors, SKILL_SHEET_NAME, excelRow, 'Skill', row.Skill);

    if (row['Skill 구분'] && !VALID_SKILL_TYPES.has(row['Skill 구분'])) {
      errors.push(formatMessage(SKILL_SHEET_NAME, excelRow, 'Skill 구분은 Hard Skill 또는 Soft Skill이어야 합니다.'));
    }

    const jobKey = makeJobKey(row.직군, row.직렬, row.직무);
    if (!availableJobs.has(jobKey)) {
      errors.push(
        formatMessage(
          SKILL_SHEET_NAME,
          excelRow,
          `‘${row.직군} > ${row.직렬} > ${row.직무}’ 직무가 ${JOB_SHEET_NAME} Sheet에 없습니다.`,
        ),
      );
    }

    const emptyRequirementFields = [
      ['요구 학력', row['요구 학력']],
      ['관련 전공', row['관련 전공']],
      ['관련 자격증/면허', row['관련 자격증/면허']],
    ]
      .filter(([, value]) => !value)
      .map(([field]) => field);
    // 선택 항목 공백은 업로드를 막지 않으므로 '누락'이 아니라 '확인 필요'로만 셉니다.
    if (emptyRequirementFields.length > 0) {
      warnings.push(
        formatMessage(SKILL_SHEET_NAME, excelRow, `${emptyRequirementFields.join(', ')} 항목이 비어 있습니다.`),
      );
    }

    const currentRequirement = {
      education: row['요구 학력'],
      major: row['관련 전공'],
      certifications: row['관련 자격증/면허'],
      row: excelRow,
    };
    const priorRequirement = requirementByJob.get(jobKey);
    if (!priorRequirement) {
      requirementByJob.set(jobKey, currentRequirement);
    } else {
      const conflicts = [
        ['요구 학력', priorRequirement.education, currentRequirement.education],
        ['관련 전공', priorRequirement.major, currentRequirement.major],
        ['관련 자격증/면허', priorRequirement.certifications, currentRequirement.certifications],
      ].filter(([, prior, current]) => prior !== current);
      if (conflicts.length > 0) {
        errors.push(
          formatMessage(
            SKILL_SHEET_NAME,
            excelRow,
            `동일 직무의 ${conflicts.map(([field]) => field).join(', ')} 값이 ${priorRequirement.row}행과 다릅니다.`,
          ),
        );
      }
    }

    const skillKey = `${jobKey}|${row['Skill 구분']}|${row.Skill}`;
    if (skillRowKeys.has(skillKey)) {
      duplicateSkillRowCount += 1;
      warnings.push(formatMessage(SKILL_SHEET_NAME, excelRow, '중복 Skill 행을 제외했습니다.'));
      return;
    }
    skillRowKeys.add(skillKey);
    skillRows.push(row);
    skillRowNumbers.push(excelRow);
  });

  // ── 시트 ③ 조직 마스터(선택) ──────────────────────────────────────
  const orgRows: IntegratedOrgRow[] = [];
  const orgRowNumbers: number[] = [];
  /** 조직코드 → 그 코드가 처음 나온 엑셀 행. 중복·고아 판정과 명부의 조직코드 대조에 함께 씁니다. */
  const orgRowByCode = new Map<string, number>();

  if (hasOrgSheet) {
    const rawOrgRows = sheetToRows<Record<string, unknown>>(wb, ORG_SHEET_NAME);
    if (rawOrgRows.length === 0) {
      warnings.push(formatMessage(ORG_SHEET_NAME, 0, '데이터 행이 없어 조직 마스터는 저장하지 않습니다.'));
    }

    rawOrgRows.forEach(({ data: raw, rowNumber: excelRow }) => {
      const row: IntegratedOrgRow = {
        조직코드: normalize(raw['조직코드']),
        조직명: normalize(raw['조직명']),
        상위조직코드: normalize(raw['상위조직코드']),
      };

      orgMissingCount += addRequiredError(errors, ORG_SHEET_NAME, excelRow, '조직코드', row.조직코드);
      orgMissingCount += addRequiredError(errors, ORG_SHEET_NAME, excelRow, '조직명', row.조직명);

      if (row.조직코드) {
        const priorRow = orgRowByCode.get(row.조직코드);
        if (priorRow !== undefined) {
          // 중복 코드는 어느 쪽이 맞는지 파일만 봐서는 알 수 없으므로 저장 대상에서 빼고 오류로 알립니다.
          errors.push(
            formatMessage(ORG_SHEET_NAME, excelRow, `조직코드 ‘${row.조직코드}’가 ${priorRow}행과 중복됩니다.`),
          );
          return;
        }
        orgRowByCode.set(row.조직코드, excelRow);
      }

      orgRows.push(row);
      orgRowNumbers.push(excelRow);
    });

    // 상위조직 검사는 코드가 모두 모인 뒤에 돕니다. 파일 뒤쪽에 정의된 상위조직도 정상으로 봅니다.
    const parentByCode = new Map(orgRows.filter((row) => row.조직코드).map((row) => [row.조직코드, row.상위조직코드]));
    orgRows.forEach((row, index) => {
      const excelRow = orgRowNumbers[index];
      if (!row.상위조직코드) return;

      if (row.상위조직코드 === row.조직코드) {
        errors.push(
          formatMessage(ORG_SHEET_NAME, excelRow, '상위조직코드가 자기 자신입니다. 최상위 조직이면 비워 주세요.'),
        );
        return;
      }
      if (!orgRowByCode.has(row.상위조직코드)) {
        errors.push(
          formatMessage(
            ORG_SHEET_NAME,
            excelRow,
            `상위조직코드 ‘${row.상위조직코드}’가 같은 파일 안에 없습니다. 해당 조직 행을 추가하거나 값을 비워 주세요.`,
          ),
        );
        return;
      }
      // 두 단계 이상 돌아 자기 자신으로 오는 순환도 막습니다(트리가 되지 않아 상위조직 연결이 불가능합니다).
      let cursor = row.상위조직코드;
      for (let step = 0; step < parentByCode.size; step += 1) {
        const parent = parentByCode.get(cursor);
        if (!parent) return;
        if (parent === row.조직코드) {
          errors.push(
            formatMessage(
              ORG_SHEET_NAME,
              excelRow,
              '상위조직을 따라가면 자기 자신으로 돌아옵니다. 상위조직코드를 확인해 주세요.',
            ),
          );
          return;
        }
        cursor = parent;
      }
    });
  }

  // ── 시트 ④ SME 명부(선택) — 검증만, 계정 생성 없음 ────────────────
  const smeRows: IntegratedSmeRow[] = [];
  const smeRowNumbers: number[] = [];

  if (hasSmeSheet) {
    const rawSmeRows = sheetToRows<Record<string, unknown>>(wb, SME_SHEET_NAME);
    if (rawSmeRows.length === 0) {
      warnings.push(formatMessage(SME_SHEET_NAME, 0, '데이터 행이 없습니다.'));
    }

    // 배정직무 대조 대상 = 이 파일 시트 ①의 직무명 + (있으면) 이미 등록된 직무명.
    const knownJobNames = new Set(jobRows.map((row) => row.직무));
    if (loadKnownJobNames) {
      try {
        (await loadKnownJobNames()).forEach((name) => {
          const normalized = normalize(name);
          if (normalized) knownJobNames.add(normalized);
        });
      } catch {
        warnings.push(
          formatMessage(
            SME_SHEET_NAME,
            0,
            '이미 등록된 직무 목록을 불러오지 못해 이 파일의 직무명만으로 배정직무를 확인했습니다.',
          ),
        );
      }
    }

    const emailRowByAddress = new Map<string, number>();
    rawSmeRows.forEach(({ data: raw, rowNumber: excelRow }) => {
      const assignedText = normalize(raw['배정직무']);
      const row: IntegratedSmeRow = {
        성명: normalize(raw['성명']),
        이메일: normalize(raw['이메일']),
        조직코드: normalize(raw['조직코드']),
        직급: normalize(raw['직급']),
        배정직무: assignedText,
        // 여러 개면 쉼표로 구분합니다. 빈 조각과 중복은 여기서 정리해 계정 생성 단계로 그대로 넘길 수 있게 합니다.
        배정직무목록: [...new Set(assignedText.split(',').map(normalize).filter(Boolean))],
      };

      smeMissingCount += addRequiredError(errors, SME_SHEET_NAME, excelRow, '성명', row.성명);
      smeMissingCount += addRequiredError(errors, SME_SHEET_NAME, excelRow, '이메일', row.이메일);
      smeMissingCount += addRequiredError(errors, SME_SHEET_NAME, excelRow, '조직코드', row.조직코드);

      if (row.이메일 && !EMAIL_PATTERN.test(row.이메일)) {
        errors.push(formatMessage(SME_SHEET_NAME, excelRow, `이메일 ‘${row.이메일}’의 형식이 올바르지 않습니다.`));
      }
      if (row.이메일) {
        // 계정 키는 대소문자를 가리지 않으므로 소문자로 맞춰 비교합니다.
        const address = row.이메일.toLowerCase();
        const priorRow = emailRowByAddress.get(address);
        if (priorRow !== undefined) {
          errors.push(
            formatMessage(SME_SHEET_NAME, excelRow, `이메일 ‘${row.이메일}’이 ${priorRow}행과 중복됩니다.`),
          );
        } else {
          emailRowByAddress.set(address, excelRow);
        }
      }
      if (row.조직코드 && !orgRowByCode.has(row.조직코드)) {
        errors.push(
          formatMessage(
            SME_SHEET_NAME,
            excelRow,
            `조직코드 ‘${row.조직코드}’가 ${ORG_SHEET_NAME} Sheet에 없습니다.`,
          ),
        );
      }
      // 직급 공백은 업로드를 막지 않습니다(선택 항목 공백 = 확인 필요).
      if (!row.직급) {
        warnings.push(formatMessage(SME_SHEET_NAME, excelRow, '직급 항목이 비어 있습니다.'));
      }

      const unknownJobs = row.배정직무목록.filter((name) => !knownJobNames.has(name));
      if (unknownJobs.length > 0) {
        warnings.push(
          formatMessage(
            SME_SHEET_NAME,
            excelRow,
            `배정직무 ‘${unknownJobs.join('’, ‘')}’와 같은 이름의 직무를 찾지 못했습니다. 직무명을 확인해 주세요.`,
          ),
        );
      }

      smeRows.push(row);
      smeRowNumbers.push(excelRow);
    });
  }

  const jobCount = new Set(jobRows.map((row) => makeJobKey(row.직군, row.직렬, row.직무))).size;
  const taskCount = new Set(jobRows.map((row) => `${makeJobKey(row.직군, row.직렬, row.직무)}|${row.주요과업}`)).size;
  const requirementCount = new Set(
    skillRows
      .filter((row) => row['요구 학력'] || row['관련 전공'] || row['관련 자격증/면허'])
      .map((row) => makeJobKey(row.직군, row.직렬, row.직무)),
  ).size;

  return {
    valid: errors.length === 0 && jobRows.length > 0 && skillRows.length > 0,
    errors,
    warnings,
    jobRows,
    skillRows,
    jobRowNumbers,
    skillRowNumbers,
    jobCount,
    taskCount,
    activityCount: jobRows.length,
    skillCount: skillRows.length,
    requirementCount,
    matchedJobCount: new Set(
      skillRows
        .filter((row) => availableJobs.has(makeJobKey(row.직군, row.직렬, row.직무)))
        .map((row) => makeJobKey(row.직군, row.직렬, row.직무)),
    ).size,
    jobErrorCount: errors.filter((message) => message.startsWith(JOB_SHEET_NAME)).length,
    skillErrorCount: errors.filter((message) => message.startsWith(SKILL_SHEET_NAME)).length,
    jobMissingCount,
    skillMissingCount,
    jobWarningCount: warnings.filter((message) => message.startsWith(JOB_SHEET_NAME)).length,
    skillWarningCount: warnings.filter((message) => message.startsWith(SKILL_SHEET_NAME)).length,
    duplicateJobRowCount,
    duplicateSkillRowCount,
    hasOrgSheet,
    hasSmeSheet,
    orgRows,
    smeRows,
    orgRowNumbers,
    smeRowNumbers,
    orgCount: orgRows.length,
    smeCount: smeRows.length,
    assignmentCount: smeRows.reduce((total, row) => total + row.배정직무목록.length, 0),
    orgErrorCount: errors.filter((message) => message.startsWith(ORG_SHEET_NAME)).length,
    smeErrorCount: errors.filter((message) => message.startsWith(SME_SHEET_NAME)).length,
    orgMissingCount,
    smeMissingCount,
    orgWarningCount: warnings.filter((message) => message.startsWith(ORG_SHEET_NAME)).length,
    smeWarningCount: warnings.filter((message) => message.startsWith(SME_SHEET_NAME)).length,
  };
}

export function downloadIntegratedTemplate(): void {
  const jobData: IntegratedJobRow[] = [
    {
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      직무정의: '제조 공정의 설계, 개선 및 표준화를 통해 생산성과 품질을 향상시키는 직무',
      주요과업: '제조공정 설계 및 개선',
      세부활동: '설비·치공구 조건 검토',
    },
    {
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      직무정의: '제조 공정의 설계, 개선 및 표준화를 통해 생산성과 품질을 향상시키는 직무',
      주요과업: '제조공정 설계 및 개선',
      세부활동: '공정 흐름 분석 및 병목 공정 개선',
    },
  ];

  const skillData: IntegratedSkillRow[] = [
    {
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      'Skill 구분': 'Hard Skill',
      Skill: '공정 분석',
      '요구 학력': '전문학사 이상',
      '관련 전공': '기계공학, 산업공학',
      '관련 자격증/면허': '산업안전기사 우대',
    },
    {
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      'Skill 구분': 'Soft Skill',
      Skill: '문제해결',
      '요구 학력': '전문학사 이상',
      '관련 전공': '기계공학, 산업공학',
      '관련 자격증/면허': '산업안전기사 우대',
    },
  ];

  /*
   * 시트 ③④는 선택 시트지만 양식에는 넣어 둡니다. 지우고 올려도 그대로 통과합니다.
   * 조직 마스터 예시가 두 줄인 것은 의도입니다 — 상위조직코드를 보여주려면 상위 조직 행이
   * 같은 파일에 있어야 하고, 한 줄만 두면 그 양식을 그대로 올렸을 때 고아 오류가 납니다.
   * 명부 예시의 조직코드·배정직무도 위 시트의 값과 맞춰 두어 양식 그대로 업로드해도 통과합니다.
   */
  const orgData: IntegratedOrgRow[] = [
    { 조직코드: 'SY1000', 조직명: '생산본부', 상위조직코드: '' },
    { 조직코드: 'SY1100', 조직명: '공정기술팀', 상위조직코드: 'SY1000' },
  ];

  const smeData = [
    {
      성명: '홍길동',
      이메일: 'hong@example.com',
      조직코드: 'SY1100',
      직급: '책임',
      배정직무: '공정기술',
    },
  ];

  const jobSheet = XLSX.utils.json_to_sheet(jobData, { header: [...JOB_HEADERS] });
  const skillSheet = XLSX.utils.json_to_sheet(skillData, { header: [...SKILL_HEADERS] });
  jobSheet['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 52 }, { wch: 28 }, { wch: 42 }];
  skillSheet['!cols'] = [
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
    { wch: 28 },
  ];

  const orgSheet = XLSX.utils.json_to_sheet(orgData, { header: [...ORG_HEADERS] });
  const smeSheet = XLSX.utils.json_to_sheet(smeData, { header: [...SME_HEADERS] });
  orgSheet['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }];
  smeSheet['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 36 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, jobSheet, JOB_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, skillSheet, SKILL_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, orgSheet, ORG_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, smeSheet, SME_SHEET_NAME);
  XLSX.writeFile(wb, '서연이화_직무정보_통합업로드_양식.xlsx');
}

/**
 * 검증을 통과한 SME 명부의 정규화 결과를 파일로 내려받습니다.
 * 이 Phase는 명부를 저장하지 않습니다 — 계정 생성은 SME 계정 관리 화면의 몫이고,
 * 그 화면에 그대로 옮겨 쓸 수 있도록 배정직무를 정리한 형태를 남기는 것이 이 파일의 용도입니다.
 */
export function downloadNormalizedSmeRoster(rows: IntegratedSmeRow[]): void {
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row, index) => ({
      번호: index + 1,
      성명: row.성명,
      이메일: row.이메일,
      조직코드: row.조직코드,
      직급: row.직급,
      배정직무: row.배정직무목록.join(', '),
      '배정직무 수': row.배정직무목록.length,
    })),
    { header: ['번호', '성명', '이메일', '조직코드', '직급', '배정직무', '배정직무 수'] },
  );
  sheet['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 40 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, SME_SHEET_NAME);
  XLSX.writeFile(wb, `서연이화_SME명부_검증결과_${rows.length}건.xlsx`);
}
