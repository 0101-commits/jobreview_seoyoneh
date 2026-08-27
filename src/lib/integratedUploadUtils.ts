import * as XLSX from 'xlsx';
import { normalize, parseWorkbook } from './uploadUtils';

export { normalize, parseWorkbook };

export const FIXED_COMPANY_NAME = '서연이화';
export const JOB_SHEET_NAME = '직무 및 과업 정보';
export const SKILL_SHEET_NAME = 'Skill 및 수행요건';

export const JOB_HEADERS = [
  '직군',
  '직렬',
  '직무',
  '직무정의',
  '주요과업',
  '세부활동',
] as const;

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

export interface IntegratedValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  jobRows: IntegratedJobRow[];
  skillRows: IntegratedSkillRow[];
  jobCount: number;
  taskCount: number;
  activityCount: number;
  skillCount: number;
  requirementCount: number;
  matchedJobCount: number;
  jobErrorCount: number;
  skillErrorCount: number;
  jobMissingCount: number;
  skillMissingCount: number;
  duplicateJobRowCount: number;
  duplicateSkillRowCount: number;
}

type IntegratedSheetName = typeof JOB_SHEET_NAME | typeof SKILL_SHEET_NAME | '파일';

interface NumberedSheetRow<T> {
  rowNumber: number;
  data: T;
}

const VALID_SKILL_TYPES = new Set(['Hard Skill', 'Soft Skill']);

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

function sheetToRows<T extends Record<string, unknown>>(
  wb: XLSX.WorkBook,
  sheetName: string,
): NumberedSheetRow<T>[] {
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
      const data = Object.fromEntries(
        headers.map((header, columnIndex) => [header, cells[columnIndex] ?? '']),
      ) as T;
      return { rowNumber: index + 2, data };
    })
    .filter(({ data }) => Object.values(data).some((value) => normalize(value) !== ''));
}

function addRequiredError(
  errors: string[],
  sheet: typeof JOB_SHEET_NAME | typeof SKILL_SHEET_NAME,
  row: number,
  field: string,
  value: string,
): number {
  if (value) return 0;
  errors.push(formatMessage(sheet, row, `${field}이(가) 입력되지 않았습니다.`));
  return 1;
}

function formatMessage(sheet: IntegratedSheetName, row: number, message: string): string {
  return `${sheet}${row > 0 ? ` ${row}행` : ''}: ${message}`;
}

export async function parseAndValidateIntegratedWorkbook(file: File): Promise<IntegratedValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let jobMissingCount = 0;
  let skillMissingCount = 0;
  const emptyResult = (): IntegratedValidationResult => ({
    valid: false,
    errors,
    warnings,
    jobRows: [],
    skillRows: [],
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
    duplicateJobRowCount: 0,
    duplicateSkillRowCount: 0,
  });

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    errors.push(formatMessage('파일', 0, 'xlsx 또는 xls 파일만 업로드할 수 있습니다.'));
    return emptyResult();
  }

  const wb = await parseWorkbook(file);

  if (wb.SheetNames.length !== 2) {
    errors.push(formatMessage('파일', 0, `Sheet는 정확히 2개여야 합니다. 현재 ${wb.SheetNames.length}개입니다.`));
  }

  for (const requiredSheet of [JOB_SHEET_NAME, SKILL_SHEET_NAME] as const) {
    if (!wb.SheetNames.includes(requiredSheet)) {
      errors.push(formatMessage('파일', 0, `'${requiredSheet}' Sheet가 없습니다.`));
    }
  }
  if (errors.length > 0) return emptyResult();

  const jobHeaders = getHeaders(wb, JOB_SHEET_NAME);
  const skillHeaders = getHeaders(wb, SKILL_SHEET_NAME);

  if (jobHeaders.includes('회사') || skillHeaders.includes('회사')) {
    errors.push(formatMessage('파일', 1, '새로운 통합 양식을 사용해 주세요. 회사 열은 입력하지 않습니다.'));
    return emptyResult();
  }

  if (!headersEqual(jobHeaders, JOB_HEADERS)) {
    errors.push(formatMessage(JOB_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${JOB_HEADERS.join(', ')} 순서로 입력해 주세요.`));
  }
  if (!headersEqual(skillHeaders, SKILL_HEADERS)) {
    errors.push(formatMessage(SKILL_SHEET_NAME, 1, `헤더가 올바르지 않습니다. ${SKILL_HEADERS.join(', ')} 순서로 입력해 주세요.`));
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
      errors.push(formatMessage(JOB_SHEET_NAME, excelRow, `동일 직무의 직무정의가 ${priorDefinition.row}행과 다릅니다.`));
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
  });

  const availableJobs = new Set(jobRows.map((row) => makeJobKey(row.직군, row.직렬, row.직무)));
  const skillRows: IntegratedSkillRow[] = [];
  const skillRowKeys = new Set<string>();
  const requirementByJob = new Map<
    string,
    { education: string; major: string; certifications: string; row: number }
  >();
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
      errors.push(formatMessage(SKILL_SHEET_NAME, excelRow, `‘${row.직군} > ${row.직렬} > ${row.직무}’ 직무가 ${JOB_SHEET_NAME} Sheet에 없습니다.`));
    }

    const emptyRequirementFields = [
      ['요구 학력', row['요구 학력']],
      ['관련 전공', row['관련 전공']],
      ['관련 자격증/면허', row['관련 자격증/면허']],
    ].filter(([, value]) => !value).map(([field]) => field);
    if (emptyRequirementFields.length > 0) {
      skillMissingCount += emptyRequirementFields.length;
      warnings.push(formatMessage(SKILL_SHEET_NAME, excelRow, `${emptyRequirementFields.join(', ')} 항목이 비어 있습니다.`));
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
        errors.push(formatMessage(SKILL_SHEET_NAME, excelRow, `동일 직무의 ${conflicts.map(([field]) => field).join(', ')} 값이 ${priorRequirement.row}행과 다릅니다.`));
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
  });

  const jobCount = new Set(jobRows.map((row) => makeJobKey(row.직군, row.직렬, row.직무))).size;
  const taskCount = new Set(
    jobRows.map((row) => `${makeJobKey(row.직군, row.직렬, row.직무)}|${row.주요과업}`),
  ).size;
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
    duplicateJobRowCount,
    duplicateSkillRowCount,
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

  const jobSheet = XLSX.utils.json_to_sheet(jobData, { header: [...JOB_HEADERS] });
  const skillSheet = XLSX.utils.json_to_sheet(skillData, { header: [...SKILL_HEADERS] });
  jobSheet['!cols'] = [
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 52 }, { wch: 28 }, { wch: 42 },
  ];
  skillSheet['!cols'] = [
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
    { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, jobSheet, JOB_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, skillSheet, SKILL_SHEET_NAME);
  XLSX.writeFile(wb, '서연이화_직무정보_통합업로드_양식.xlsx');
}
