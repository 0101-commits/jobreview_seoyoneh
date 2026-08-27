import * as XLSX from 'xlsx';

// ── Types ──────────────────────────────────────────────────────────

export interface Step1Row {
  회사: string;
  직군: string;
  직렬: string;
  직무: string;
  직무정의: string;
  주요과업: string;
  세부활동: string;
}

export interface Step2Row {
  회사: string;
  직군: string;
  직렬: string;
  직무: string;
  'Skill 구분': string;
  Skill: string;
  '요구 학력': string;
  '관련 전공': string;
  '관련 자격증/면허': string;
}

export interface ValidationError {
  row: number;
  message: string;
  step: 1 | 2;
}

export interface Step1Preview {
  companies: number;
  groups: number;
  series: number;
  jobs: number;
  tasks: number;
  activities: number;
}

export interface MatchResult {
  row: number;
  회사: string;
  직군: string;
  직렬: string;
  직무: string;
  status: 'matched' | 'needs-review' | 'failed';
  jobId?: string;
  reason?: string;
}

export interface Step2Preview {
  totalJobs: number;
  softSkills: number;
  hardSkills: number;
  requirementsCount: number;
  matched: number;
  needsReview: number;
  failed: number;
  matchRate: number;
}

// ── Normalization ───────────────────────────────────────────────────

export function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ── Excel Parsing ──────────────────────────────────────────────────

export function parseWorkbook(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        resolve(wb);
      } catch {
        reject(new Error('파일을 읽을 수 없습니다. xlsx 또는 xls 파일인지 확인해 주세요.'));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기에 실패했습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

export function sheetToRows<T extends Record<string, unknown>>(wb: XLSX.WorkBook, sheetName: string): T[] {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: '' });
}

// ── Validation: STEP 1 ──────────────────────────────────────────────

const STEP1_COLS = ['회사', '직군', '직렬', '직무', '직무정의', '주요과업', '세부활동'];
const OLD_STEP1_COLS = ['직군', '직렬', '직무', '직무정의', '주요과업', '세부활동'];

export function validateStep1(rows: Step1Row[]): { errors: ValidationError[]; cleaned: Step1Row[] } {
  const errors: ValidationError[] = [];
  const cleaned: Step1Row[] = [];

  if (rows.length === 0) {
    return { errors: [{ row: 0, message: '데이터 행이 없습니다.', step: 1 }], cleaned: [] };
  }

  // Check required columns — 회사 must be present
  const firstRow = rows[0] as unknown as Record<string, unknown>;
  if (!('회사' in firstRow)) {
    return {
      errors: [{ row: 0, message: "새로운 업로드 양식에서는 '회사' 컬럼이 필수입니다.\n최신 양식을 다운로드하여 사용해 주세요.", step: 1 }],
      cleaned: [],
    };
  }
  const missingCols = STEP1_COLS.filter((c) => !(c in firstRow));
  if (missingCols.length > 0) {
    return { errors: [{ row: 0, message: `필수 열 누락: ${missingCols.join(', ')}`, step: 1 }], cleaned: [] };
  }

  // Track definitions per job (회사+직군+직렬+직무) to detect conflicts
  const jobDefMap = new Map<string, string>();
  // Track activities per task to detect duplicates
  const taskActivitySet = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNum = i + 2; // Excel row 1 is header
    const row: Step1Row = {
      회사: normalize(raw['회사']),
      직군: normalize(raw['직군']),
      직렬: normalize(raw['직렬']),
      직무: normalize(raw['직무']),
      직무정의: normalize(raw['직무정의']),
      주요과업: normalize(raw['주요과업']),
      세부활동: normalize(raw['세부활동']),
    };

    // Check required fields
    if (!row.회사) errors.push({ row: rowNum, message: '회사가 입력되지 않았습니다.', step: 1 });
    if (!row.직군) errors.push({ row: rowNum, message: '직군이 입력되지 않았습니다.', step: 1 });
    if (!row.직렬) errors.push({ row: rowNum, message: '직렬이 입력되지 않았습니다.', step: 1 });
    if (!row.직무) errors.push({ row: rowNum, message: '직무명이 입력되지 않았습니다.', step: 1 });
    if (!row.직무정의) errors.push({ row: rowNum, message: '직무정의가 입력되지 않았습니다.', step: 1 });
    if (!row.주요과업) errors.push({ row: rowNum, message: '주요과업이 입력되지 않았습니다.', step: 1 });
    if (!row.세부활동) errors.push({ row: rowNum, message: '세부활동이 입력되지 않았습니다.', step: 1 });

    // Check definition consistency
    const jobKey = `${row.회사}|${row.직군}|${row.직렬}|${row.직무}`;
    if (row.직무정의) {
      const existing = jobDefMap.get(jobKey);
      if (existing && existing !== row.직무정의) {
        errors.push({ row: rowNum, message: `동일 직무의 직무정의가 다릅니다. (기존: "${existing.slice(0, 30)}...")`, step: 1 });
      } else if (!existing) {
        jobDefMap.set(jobKey, row.직무정의);
      }
    }

    // Check duplicate activities
    const activityKey = `${jobKey}|${row.주요과업}|${row.세부활동}`;
    if (row.세부활동) {
      if (taskActivitySet.has(activityKey)) {
        errors.push({ row: rowNum, message: '동일한 세부활동이 중복되었습니다.', step: 1 });
      } else {
        taskActivitySet.add(activityKey);
      }
    }

    cleaned.push(row);
  });

  return { errors, cleaned };
}

// ── Validation: STEP 2 ──────────────────────────────────────────────

const STEP2_COLS = ['회사', '직군', '직렬', '직무', 'Skill 구분', 'Skill', '요구 학력', '관련 전공', '관련 자격증/면허'];
const VALID_SKILL_TYPES = ['Soft Skill', 'Hard Skill'];

export function validateStep2(rows: Step2Row[]): { errors: ValidationError[]; cleaned: Step2Row[] } {
  const errors: ValidationError[] = [];
  const cleaned: Step2Row[] = [];

  if (rows.length === 0) {
    return { errors: [{ row: 0, message: '데이터 행이 없습니다.', step: 2 }], cleaned: [] };
  }

  const firstRow = rows[0] as unknown as Record<string, unknown>;
  if (!('회사' in firstRow)) {
    return {
      errors: [{ row: 0, message: "새로운 업로드 양식에서는 '회사' 컬럼이 필수입니다.\n최신 양식을 다운로드하여 사용해 주세요.", step: 2 }],
      cleaned: [],
    };
  }
  const missingCols = STEP2_COLS.filter((c) => !(c in firstRow));
  if (missingCols.length > 0) {
    return { errors: [{ row: 0, message: `필수 열 누락: ${missingCols.join(', ')}`, step: 2 }], cleaned: [] };
  }

  rows.forEach((raw, i) => {
    const rowNum = i + 2;
    const row: Step2Row = {
      회사: normalize(raw['회사']),
      직군: normalize(raw['직군']),
      직렬: normalize(raw['직렬']),
      직무: normalize(raw['직무']),
      'Skill 구분': normalize(raw['Skill 구분']),
      Skill: normalize(raw['Skill']),
      '요구 학력': normalize(raw['요구 학력']),
      '관련 전공': normalize(raw['관련 전공']),
      '관련 자격증/면허': normalize(raw['관련 자격증/면허']),
    };

    if (!row.회사) errors.push({ row: rowNum, message: '회사가 입력되지 않았습니다.', step: 2 });
    if (!row.직군) errors.push({ row: rowNum, message: '직군이 입력되지 않았습니다.', step: 2 });
    if (!row.직렬) errors.push({ row: rowNum, message: '직렬이 입력되지 않았습니다.', step: 2 });
    if (!row.직무) errors.push({ row: rowNum, message: '직무명이 입력되지 않았습니다.', step: 2 });
    if (!row['Skill 구분']) {
      errors.push({ row: rowNum, message: 'Skill 구분이 입력되지 않았습니다.', step: 2 });
    } else if (!VALID_SKILL_TYPES.includes(row['Skill 구분'])) {
      errors.push({ row: rowNum, message: 'Skill 구분은 Soft Skill 또는 Hard Skill이어야 합니다.', step: 2 });
    }
    if (!row.Skill) errors.push({ row: rowNum, message: 'Skill이 입력되지 않았습니다.', step: 2 });

    cleaned.push(row);
  });

  return { errors, cleaned };
}

// ── Preview: STEP 1 ─────────────────────────────────────────────────

export function buildStep1Preview(rows: Step1Row[]): Step1Preview {
  const companies = new Set(rows.map((r) => r.회사));
  const groups = new Set(rows.map((r) => `${r.회사}|${r.직군}`));
  const series = new Set(rows.map((r) => `${r.회사}|${r.직군}|${r.직렬}`));
  const jobs = new Set(rows.map((r) => `${r.회사}|${r.직군}|${r.직렬}|${r.직무}`));
  const tasks = new Set(rows.map((r) => `${r.회사}|${r.직군}|${r.직렬}|${r.직무}|${r.주요과업}`));
  return {
    companies: companies.size,
    groups: groups.size,
    series: series.size,
    jobs: jobs.size,
    tasks: tasks.size,
    activities: rows.length,
  };
}

// ── Matching: STEP 2 → STEP 1 ────────────────────────────────────────

export interface JobMaster {
  id: string;
  companyName: string;
  groupName: string;
  seriesName: string;
  jobName: string;
}

export function matchStep2ToJobs(
  rows: Step2Row[],
  jobMasters: JobMaster[],
): { results: MatchResult[]; preview: Step2Preview } {
  // Build lookup: key = normalized company|group|series|job → array of matching jobs
  const lookup = new Map<string, JobMaster[]>();
  for (const jm of jobMasters) {
    const key = `${normalize(jm.companyName)}|${normalize(jm.groupName)}|${normalize(jm.seriesName)}|${normalize(jm.jobName)}`;
    const arr = lookup.get(key) || [];
    arr.push(jm);
    lookup.set(key, arr);
  }

  const results: MatchResult[] = [];
  let matched = 0;
  let needsReview = 0;
  let failed = 0;
  let softCount = 0;
  let hardCount = 0;
  const jobsWithReqs = new Set<string>();

  rows.forEach((row, i) => {
    const key = `${normalize(row.회사)}|${normalize(row.직군)}|${normalize(row.직렬)}|${normalize(row.직무)}`;
    const matches = lookup.get(key);

    if (row['Skill 구분'] === 'Soft Skill') softCount++;
    else if (row['Skill 구분'] === 'Hard Skill') hardCount++;

    if (!matches || matches.length === 0) {
      results.push({
        row: i + 2,
        회사: row.회사,
        직군: row.직군,
        직렬: row.직렬,
        직무: row.직무,
        status: 'failed',
        reason: '동일한 회사/직군/직렬/직무 조합을 찾을 수 없습니다.',
      });
      failed++;
    } else if (matches.length > 1) {
      results.push({
        row: i + 2,
        회사: row.회사,
        직군: row.직군,
        직렬: row.직렬,
        직무: row.직무,
        status: 'needs-review',
        reason: '동일한 회사/직군/직렬/직무 조합이 2개 이상 검색되었습니다.',
      });
      needsReview++;
    } else {
      results.push({
        row: i + 2,
        회사: row.회사,
        직군: row.직군,
        직렬: row.직렬,
        직무: row.직무,
        status: 'matched',
        jobId: matches[0].id,
      });
      matched++;
      if (row['요구 학력'] || row['관련 전공'] || row['관련 자격증/면허']) {
        jobsWithReqs.add(matches[0].id);
      }
    }
  });

  const totalJobs = new Set(rows.map((r) => `${r.회사}|${r.직군}|${r.직렬}|${r.직무}`)).size;
  const total = matched + needsReview + failed;
  const matchRate = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

  return {
    results,
    preview: {
      totalJobs,
      softSkills: softCount,
      hardSkills: hardCount,
      requirementsCount: jobsWithReqs.size,
      matched,
      needsReview,
      failed,
      matchRate,
    },
  };
}

// ── SME Excel Upload ────────────────────────────────────────────────

export interface SmeUploadRow {
  회사: string;
  조직: string;
  직급: string;
  사번: string;
  이름: string;
  이메일: string;
  비밀번호: string;
}

export interface SmeValidationResult {
  total: number;
  valid: number;
  errors: number;
  errorList: { row: number; message: string }[];
  validRows: SmeUploadRow[];
}

const SME_COLS = ['회사', '조직', '직급', '사번', '이름', '이메일', '비밀번호'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSmeRows(
  rows: Record<string, unknown>[],
  existingEmails: Set<string>,
  existingEmpNums: Set<string>,
  companyNames: Set<string>,
): SmeValidationResult {
  const errorList: { row: number; message: string }[] = [];
  const validRows: SmeUploadRow[] = [];
  const seenEmails = new Set<string>();
  const seenEmpNums = new Set<string>();

  if (rows.length === 0) {
    return { total: 0, valid: 0, errors: 1, errorList: [{ row: 0, message: '데이터 행이 없습니다.' }], validRows: [] };
  }

  // Check required columns
  const firstRow = rows[0];
  const missingCols = SME_COLS.filter((c) => !(c in firstRow));
  if (missingCols.length > 0) {
    return { total: 0, valid: 0, errors: 1, errorList: [{ row: 0, message: `필수 열 누락: ${missingCols.join(', ')}` }], validRows: [] };
  }

  rows.forEach((raw, i) => {
    const rowNum = i + 2;
    const row: SmeUploadRow = {
      회사: normalize(raw['회사']),
      조직: normalize(raw['조직']),
      직급: normalize(raw['직급']),
      사번: normalize(raw['사번']),
      이름: normalize(raw['이름']),
      이메일: normalize(raw['이메일']).toLowerCase(),
      비밀번호: String(raw['비밀번호'] ?? '').trim(),
    };

    let hasError = false;

    if (!row.회사) { errorList.push({ row: rowNum, message: '회사가 입력되지 않았습니다.' }); hasError = true; }
    else if (!companyNames.has(row.회사)) { errorList.push({ row: rowNum, message: `등록되지 않은 회사입니다. (${row.회사})` }); hasError = true; }

    if (!row.조직) { errorList.push({ row: rowNum, message: '조직이 입력되지 않았습니다.' }); hasError = true; }
    if (!row.직급) { errorList.push({ row: rowNum, message: '직급이 입력되지 않았습니다.' }); hasError = true; }
    if (!row.사번) { errorList.push({ row: rowNum, message: '사번이 입력되지 않았습니다.' }); hasError = true; }
    if (!row.이름) { errorList.push({ row: rowNum, message: '이름이 입력되지 않았습니다.' }); hasError = true; }

    if (!row.이메일) { errorList.push({ row: rowNum, message: '이메일이 입력되지 않았습니다.' }); hasError = true; }
    else if (!EMAIL_RE.test(row.이메일)) { errorList.push({ row: rowNum, message: `이메일 형식이 올바르지 않습니다. (${row.이메일})` }); hasError = true; }
    else if (existingEmails.has(row.이메일)) { errorList.push({ row: rowNum, message: `이미 등록된 이메일입니다. (${row.이메일})` }); hasError = true; }
    else if (seenEmails.has(row.이메일)) { errorList.push({ row: rowNum, message: `Excel 내 중복 이메일입니다. (${row.이메일})` }); hasError = true; }
    else { seenEmails.add(row.이메일); }

    if (!row.비밀번호) { errorList.push({ row: rowNum, message: '비밀번호가 입력되지 않았습니다.' }); hasError = true; }
    else if (row.비밀번호.length < 8 || !/[a-zA-Z]/.test(row.비밀번호) || !/[0-9]/.test(row.비밀번호)) {
      errorList.push({ row: rowNum, message: '비밀번호는 8자 이상이며 영문과 숫자를 포함해야 합니다.' }); hasError = true;
    }

    if (row.사번 && row.회사) {
      const empKey = `${row.회사}|${row.사번}`;
      if (existingEmpNums.has(empKey)) { errorList.push({ row: rowNum, message: `이미 등록된 사번입니다. (${row.회사} ${row.사번})` }); hasError = true; }
      else if (seenEmpNums.has(empKey)) { errorList.push({ row: rowNum, message: `Excel 내 중복 사번입니다. (${row.회사} ${row.사번})` }); hasError = true; }
      else { seenEmpNums.add(empKey); }
    }

    if (!hasError) validRows.push(row);
  });

  return { total: rows.length, valid: validRows.length, errors: errorList.length, errorList, validRows };
}

export function downloadSmeTemplate() {
  const data: SmeUploadRow[] = [
    { 회사: '서연이화', 조직: '생산기술팀', 직급: '대리', 사번: '2024001', 이름: '김서연', 이메일: 'seoyeon@example.com', 비밀번호: 'Test1234' },
    { 회사: '서연탑메탈', 조직: '품질팀', 직급: '과장', 사번: '2024002', 이름: '이탑', 이메일: 'topmetal@example.com', 비밀번호: 'Test5678' },
  ];
  const ws = XLSX.utils.json_to_sheet(data, { header: SME_COLS });
  ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SME 계정');
  XLSX.writeFile(wb, 'SME계정_업로드_양식.xlsx');
}

// ── Format Validation ────────────────────────────────────────────────

export function checkStep1Format(wb: XLSX.WorkBook): string | null {
  const sheetName = wb.SheetNames.includes('직무 및 과업 정보') ? '직무 및 과업 정보' : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return '직무 및 과업 정보 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rows.length === 0) return '직무 및 과업 정보 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  // Check for 회사 column — if missing, show new format message
  if (!('회사' in rows[0])) {
    return "새로운 업로드 양식에서는 '회사' 컬럼이 필수입니다.\n최신 양식을 다운로드하여 사용해 주세요.";
  }
  const missing = STEP1_COLS.filter((c) => !(c in rows[0]));
  if (missing.length > 0) return '직무 및 과업 정보 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  return null;
}

export function checkStep2Format(wb: XLSX.WorkBook): string | null {
  const sheetName = wb.SheetNames.includes('Skill 및 수행요건') ? 'Skill 및 수행요건' : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return 'Skill 및 수행요건 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rows.length === 0) return 'Skill 및 수행요건 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  if (!('회사' in rows[0])) {
    return "새로운 업로드 양식에서는 '회사' 컬럼이 필수입니다.\n최신 양식을 다운로드하여 사용해 주세요.";
  }
  const missing = STEP2_COLS.filter((c) => !(c in rows[0]));
  if (missing.length > 0) return 'Skill 및 수행요건 업로드 양식이 아닙니다. 필수 컬럼을 확인해 주세요.';
  return null;
}

// ── Template Download ───────────────────────────────────────────────

export function downloadStep1Template() {
  const data: Step1Row[] = [
    {
      회사: '서연이화',
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      직무정의: '제조 공정의 설계, 개선 및 표준화를 통해 생산성과 품질을 향상시키는 직무',
      주요과업: '제조공정 설계 및 개선',
      세부활동: '설비·치공구 조건 검토',
    },
    {
      회사: '서연이화',
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      직무정의: '제조 공정의 설계, 개선 및 표준화를 통해 생산성과 품질을 향상시키는 직무',
      주요과업: '제조공정 설계 및 개선',
      세부활동: '공정 흐름 분석 및 병목 공정 개선',
    },
    {
      회사: '서연이화',
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      직무정의: '제조 공정의 설계, 개선 및 표준화를 통해 생산성과 품질을 향상시키는 직무',
      주요과업: '공정 표준화 관리',
      세부활동: '표준작업지침서(SOP) 작성 및 개정',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(data, { header: STEP1_COLS });
  ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 50 }, { wch: 24 }, { wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '직무 및 과업 정보');
  XLSX.writeFile(wb, '직무및과업정보_업로드_양식.xlsx');
}

export function downloadStep2Template() {
  const data: Step2Row[] = [
    {
      회사: '서연이화',
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      'Skill 구분': 'Soft Skill',
      Skill: '문제해결',
      '요구 학력': '전문학사 이상',
      '관련 전공': '기계공학, 화학공학, 전기공학',
      '관련 자격증/면허': '기술사, 산업안전기사',
    },
    {
      회사: '서연이화',
      직군: '생산기술',
      직렬: '공정기술',
      직무: '공정기술',
      'Skill 구분': 'Hard Skill',
      Skill: 'P&ID 해독',
      '요구 학력': '',
      '관련 전공': '',
      '관련 자격증/면허': '',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(data, { header: STEP2_COLS });
  ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Skill 및 수행요건');
  XLSX.writeFile(wb, 'Skill및수행요건_업로드_양식.xlsx');
}
