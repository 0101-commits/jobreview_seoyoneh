// 산출물 파일 생성 — 같은 행 배열 하나를 XLSX·CSV·JSON 세 가지로 내려준다(§9 · §10 P4 · §11-2 Phase 4).
//
// 이 파일이 하는 일은 "받은 것을 파일로 쓰는 것"뿐이다. 조회도 집계도 하지 않고,
// 시트명·열 이름·열 순서도 정하지 않는다 — 전부 src/lib/exportSchema.ts의 계약을 그대로 받아 쓴다.
// 열 이름을 여기서 새로 지으면 §9가 못박은 "화면 = 파일 = 검수 기준"의 동일성이 깨진다.
//
// 세 형식이 왜 다 필요한가(§9)
//   XLSX — 실무용. 고객 TF가 그대로 열어 본다. 첫 시트는 항상 '내보내기 정보'(EXPORT_META_SHEET_NAME).
//   CSV  — 분석·AI 처리용. CSV에는 시트 개념이 없어 시트당 파일 1개로 나눈다.
//   JSON — 분석·AI 처리용. 워크북 전체를 ExportJson 한 덩어리로 담고 schema_version을 싣는다.
//
// XLSX 생성은 이미 있는 xlsx(^0.18.5)로만 한다. 새 의존성은 넣지 않는다.
// 관례는 src/lib/jobApi.ts의 exportAllJobsToExcel을 따른다 —
// 동적 import('xlsx'), json_to_sheet(rows, { header: 열순서 }), '!cols'로 열 너비, XLSX.writeFile로 저장.
import {
  EXPORT_META_COLUMNS,
  EXPORT_META_ROWS,
  EXPORT_META_SHEET_NAME,
  EXPORT_SCHEMA_VERSION,
  FTE_BASIS_LABELS,
  FTE_SCOPE_NOTICE,
  type ExportDefinition,
  type ExportJson,
  type ExportRow,
  type ExportSheetData,
  type FteBasis,
} from './exportSchema';

// ── 산출 형식 ───────────────────────────────────────────────────────

export type ExportFormat = 'XLSX' | 'CSV' | 'JSON';

/** 버튼 라벨. 화면 세 곳에서 같은 글자를 쓰기 위해 여기 둔다. */
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  XLSX: 'XLSX',
  CSV: 'CSV',
  JSON: 'JSON',
};

/**
 * 이 형식으로 내려받게 될 파일 수. CSV 만 여럿이다 — 시트당 1개 + '내보내기 정보' 1개.
 * 화면이 누르기 전에 "파일 N개가 따로 내려갑니다"를 미리 알리는 데 쓴다(아래 saveBlob 주석 참조).
 */
export function expectedFileCount(definition: ExportDefinition, format: ExportFormat): number {
  return format === 'CSV' ? definition.sheets.length + 1 : 1;
}

/**
 * 파일 하나를 만드는 데 필요한 전부. 조회 결과(sheets)와 "누가·언제·어느 기준으로 뽑았는가"다.
 * 뒤의 메타 정보는 장식이 아니라 §9의 요구다 — 파일만 따로 돌아다녀도 그 파일이 어느 계약
 * 산출물의 원천이고 어떤 기준으로 언제 뽑혔는지가 붙어 다녀야 12월 검수에서 증빙이 된다.
 */
export interface ExportPayload {
  /** exportSchema.ts의 EXPORT_DEFINITIONS 중 하나. 시트·열 순서의 원본. */
  definition: ExportDefinition;
  /** 실제 데이터. 순서·열은 definition.sheets와 같아야 한다(맞는지는 assertSheetsMatchDefinition이 본다). */
  sheets: ExportSheetData[];
  /** E2만 값이 있다. 나머지는 null — '집계 기준' 행은 빈칸으로 남는다. */
  basis: FteBasis | null;
  generatedAt: Date;
  /** 실행한 관리자. '성명 <이메일>' 형태로 화면이 만들어 넘긴다. */
  generatedBy: string;
  companyId: string | null;
  /** 계열사 필터 표시값. 전체면 '전체'. */
  companyLabel: string;
}

// ── 행 수 세기 ──────────────────────────────────────────────────────

/** 시트명 → 행 수. JSON의 row_counts, XLSX 메타 시트의 '시트별 행 수'가 같은 값을 쓴다. */
export function rowCounts(sheets: ExportSheetData[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sheet of sheets) counts[sheet.name] = sheet.rows.length;
  return counts;
}

/**
 * 시트 구성이 계약과 어긋나면 그 자리에서 알린다(어긋난 파일을 조용히 내려보내지 않는다).
 * 열이 하나 빠지거나 순서가 바뀐 파일은 받는 쪽이 알아채기 어렵고, 알아챘을 때는 이미
 * 검수 자리다. 어긋남을 발견하면 사유 문자열을 돌려주고, 문제없으면 null.
 */
export function checkSheetsMatchDefinition(payload: ExportPayload): string | null {
  const want = payload.definition.sheets;
  if (payload.sheets.length !== want.length) {
    return `시트 수가 다릅니다(기대 ${want.length}장, 실제 ${payload.sheets.length}장).`;
  }
  for (let i = 0; i < want.length; i += 1) {
    const expected = want[i];
    const actual = payload.sheets[i];
    if (expected.name !== actual.name) {
      return `${i + 1}번째 시트 이름이 다릅니다(기대 「${expected.name}」, 실제 「${actual.name}」).`;
    }
    const expectedCols = expected.columns.map((c) => c.name);
    if (expectedCols.length !== actual.columns.length || expectedCols.some((c, k) => c !== actual.columns[k])) {
      return `「${expected.name}」 시트의 열 구성이 계약과 다릅니다.`;
    }
  }
  return null;
}

// ── 파일명 ──────────────────────────────────────────────────────────

/**
 * 파일명 한 토막을 안전하게 만든다.
 * Windows가 파일명에 금지하는 문자는 \ / : * ? " < > | 와 제어문자다. 시트명에는 이 중
 * 아무것도 없어야 하지만(계약이 이미 걸러 뒀다) 파일명은 시트명·회사명 같은 데이터에서
 * 만들어지므로 여기서 한 번 더 거른다. 금지문자는 지우지 않고 '_'로 바꾼다 —
 * 지우면 서로 다른 두 시트가 같은 파일명이 될 수 있다.
 * 공백은 '_'로 모아 붙인다(메일·URL에서 파일명이 끊기지 않게).
 */
export function sanitizeFileNamePart(part: string): string {
  return part
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80);
}

/** YYYYMMDD. jobApi.exportAllJobsToExcel의 `서연이화_전체_직무정보_20260901.xlsx` 관례와 같은 자리. */
export function fileDateStamp(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 파일명 규칙을 만드는 유일한 곳.
 *   XLSX·JSON  서연이화_E2_직무조직별_투입비중분포_20260901.xlsx
 *   CSV        서연이화_E2_직무조직별_투입비중분포_직무×과업 집계_20260901.csv → 공백은 '_'로 정리된다
 * 시트명(sheetName)은 CSV에만 들어간다. CSV는 시트당 파일 1개이므로 파일명으로만 구분된다.
 */
export function exportFileName(
  fileBase: string,
  ext: 'xlsx' | 'csv' | 'json',
  at: Date,
  sheetName?: string,
): string {
  const parts = ['서연이화', sanitizeFileNamePart(fileBase)];
  if (sheetName) parts.push(sanitizeFileNamePart(sheetName));
  parts.push(fileDateStamp(at));
  return `${parts.join('_')}.${ext}`;
}

// ── '내보내기 정보' 시트 ────────────────────────────────────────────

/** ko-KR 천단위 구분. '검토 목록 1,904' 처럼 읽히게. */
function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

/**
 * EXPORT_META_ROWS 순서 그대로 항목/값 두 열을 만든다. 행 순서를 여기서 바꾸지 말 것 —
 * 다섯 Export가 모두 같은 모양이어야 나란히 놓고 비교·검수할 수 있다(계약의 고정 10줄).
 * '집계 기준'은 E2만 값이 차고 나머지는 빈칸으로 둔다(행 자체는 유지).
 * '범위 종료선'은 다섯 파일 모두에 싣는다 — §2 하단의 종료선은 E2·E3만이 아니라
 * 이 플랫폼 전체에 걸린 경계이고, 빈칸으로 둔 파일이 섞이면 누락처럼 보인다.
 */
export function buildMetaRows(payload: ExportPayload): ExportRow[] {
  const { definition, sheets, basis, generatedAt, generatedBy, companyId, companyLabel } = payload;
  const counts = rowCounts(sheets);
  // 계열사를 골랐는데 그대로 잘리지 않는 시트가 있으면 '대상 회사' 값에 단서를 붙인다(E5 감사 로그).
  // 전체를 고른 경우엔 붙이지 않는다 — 자를 것이 없어 어긋날 일도 없다.
  const companyValue =
    companyId && definition.scopeNote ? `${companyLabel} — ${definition.scopeNote}` : companyLabel;
  const values: Record<string, string> = {
    '스키마 버전': EXPORT_SCHEMA_VERSION,
    'Export ID': definition.id,
    'Export 명': definition.name,
    '산출물 매핑': definition.deliverables.join(' · '),
    '집계 기준': basis ? FTE_BASIS_LABELS[basis] : '',
    '생성 일시': generatedAt.toISOString(),
    '생성자': generatedBy,
    '대상 회사': companyValue,
    '시트별 행 수': sheets.map((s) => `${s.name} ${formatCount(counts[s.name] ?? 0)}`).join(' · '),
    '범위 종료선': FTE_SCOPE_NOTICE,
  };
  const [labelCol, valueCol] = EXPORT_META_COLUMNS;
  return EXPORT_META_ROWS.map((label) => ({ [labelCol]: label, [valueCol]: values[label] ?? '' }));
}

// ── 셀 값 ───────────────────────────────────────────────────────────

/**
 * 셀 하나를 문자열로. null·undefined는 빈칸이다 — 0으로 바꾸지 않는다.
 * (0%와 "응답 없음"은 다른 사실이고, E2·E3의 비중 열에서 이 차이가 곧 산출물의 신뢰다.)
 */
function cellText(value: ExportRow[string] | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value) : value;
}

// ── XLSX ────────────────────────────────────────────────────────────

/** 한글은 라틴 문자보다 넓게 잡힌다. 열 너비를 눈대중으로 맞추기 위한 가중치. */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᇿ⺀-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

/**
 * 열 너비. exportAllJobsToExcel은 시트마다 너비를 손으로 적어 두었지만, 여기 시트는 12종이고
 * §12에서 열이 더 붙을 수 있어 내용에서 뽑는다. 앞 200행만 본다 — 수천 행을 전부 재도 너비는
 * 거의 달라지지 않는데 생성만 느려진다.
 */
function columnWidths(columns: string[], rows: ExportRow[]): { wch: number }[] {
  const sample = rows.slice(0, 200);
  return columns.map((col) => {
    let max = displayWidth(col);
    for (const row of sample) max = Math.max(max, displayWidth(cellText(row[col])));
    return { wch: Math.min(Math.max(max + 2, 10), 50) };
  });
}

async function writeXlsx(payload: ExportPayload): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // 첫 시트는 언제나 '내보내기 정보'.
  const metaRows = buildMetaRows(payload);
  const metaCols = [...EXPORT_META_COLUMNS];
  const metaWs = XLSX.utils.json_to_sheet(metaRows, { header: metaCols });
  metaWs['!cols'] = [{ wch: 14 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, metaWs, EXPORT_META_SHEET_NAME);

  for (const sheet of payload.sheets) {
    // 행이 없어도 머리글은 남긴다. json_to_sheet는 빈 배열이면 열 이름조차 쓰지 않아
    // "열이 뭐였는지 모르는 빈 시트"가 되어 버린다. 빈 시트와 조회 실패는 다른 사건이므로
    // 빈 시트도 열 이름은 보여야 한다(조회 실패는 애초에 파일을 만들지 않는다).
    const ws =
      sheet.rows.length === 0
        ? XLSX.utils.aoa_to_sheet([sheet.columns])
        : XLSX.utils.json_to_sheet(sheet.rows, { header: sheet.columns });
    ws['!cols'] = columnWidths(sheet.columns, sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  const name = exportFileName(payload.definition.fileBase, 'xlsx', payload.generatedAt);
  XLSX.writeFile(wb, name);
  return name;
}

// ── CSV ─────────────────────────────────────────────────────────────

/**
 * UTF-8 BOM. Excel(Windows)은 BOM이 없는 CSV를 시스템 코드페이지(한국어 Windows = CP949)로
 * 읽어 한글이 전부 깨진다. BOM 3바이트가 붙으면 UTF-8로 해석한다. CSV를 실무자가 Excel로
 * 여는 이상 이 3바이트가 없으면 파일이 쓸모없어진다.
 */
const UTF8_BOM = '\uFEFF';

/**
 * RFC 4180 이스케이프. 쉼표·따옴표·줄바꿈(\r 포함)이 있으면 큰따옴표로 감싸고,
 * 값 안의 큰따옴표는 두 개로 늘린다.
 *
 * 앞의 '='·'@'는 작은따옴표를 붙여 무력화한다 — Excel은 이 두 글자로 시작하는 셀을 수식으로
 * 평가하고, SME가 자유 입력한 의견·수정 제안이 그대로 파일에 들어간다(CSV 수식 삽입).
 * '+'·'-'는 건드리지 않는다: 비중 차 같은 음수 값이 훨씬 흔해서, 막아 얻는 것보다
 * 숫자를 문자로 망가뜨려 잃는 것이 크다.
 */
export function csvCell(value: ExportRow[string] | undefined): string {
  let text = cellText(value);
  if (typeof value === 'string' && /^[=@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 시트 한 장 = CSV 한 파일. 첫 줄은 열 이름. 줄바꿈은 CRLF(Excel 관례). */
export function sheetToCsv(sheet: ExportSheetData): string {
  const lines = [sheet.columns.map((c) => csvCell(c)).join(',')];
  for (const row of sheet.rows) lines.push(sheet.columns.map((col) => csvCell(row[col])).join(','));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * CSV에는 시트도 메타도 담을 자리가 없다. '내보내기 정보'도 시트 하나로 취급해 같이 내린다 —
 * 이 파일이 어느 산출물의 원천인지가 빠지면 CSV만 받은 사람은 근거를 잃는다.
 */
function csvSheets(payload: ExportPayload): ExportSheetData[] {
  return [
    { name: EXPORT_META_SHEET_NAME, columns: [...EXPORT_META_COLUMNS], rows: buildMetaRows(payload) },
    ...payload.sheets,
  ];
}

// ── JSON ────────────────────────────────────────────────────────────

/** ExportJson 그대로. schema_version은 exportSchema.ts의 상수를 쓴다(화면에서 다시 적지 않는다). */
export function buildExportJson(payload: ExportPayload): ExportJson {
  const json: ExportJson = {
    schema_version: EXPORT_SCHEMA_VERSION,
    export_id: payload.definition.id,
    export_name: payload.definition.name,
    deliverables: [...payload.definition.deliverables],
    generated_at: payload.generatedAt.toISOString(),
    company_id: payload.companyId,
    row_counts: rowCounts(payload.sheets),
    sheets: Object.fromEntries(payload.sheets.map((s) => [s.name, s.rows])),
  };
  // basis는 E2에만 있다. 없는 Export에 'basis': null을 실으면 받는 쪽이 기준이 있다고 오해한다.
  if (payload.basis) json.basis = payload.basis;
  return json;
}

// ── 저장 ────────────────────────────────────────────────────────────

/**
 * 브라우저에 파일 하나를 내려 준다. 스냅샷(snapshotApi)도 같은 함수를 쓴다 — 저장 방식이 두 곳으로 갈리지 않게.
 *
 * a.click() 에는 성공 신호가 없다. 크롬·엣지는 같은 오리진에서 두 번째부터의 다운로드를
 * '여러 파일 다운로드' 권한으로 묻고, 사용자가 막았거나 사이트 설정에 이미 차단이 걸려 있으면
 * 예외도 콜백도 없이 무시된다. 그래서 이 함수가 돌아온 것은 "저장됐다"가 아니라 "요청했다"까지다 —
 * 부르는 쪽은 그 이상을 단정해서는 안 된다.
 */
export function saveBlob(text: string, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 해제하면 브라우저가 저장을 마치기 전에 URL이 사라지는 경우가 있다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 화면이 부르는 단 하나의 진입점. 내려받기를 요청한 파일 이름을 돌려준다(CSV는 시트 수만큼).
 * 계약과 어긋난 데이터가 오면 파일을 만들지 않고 사유를 담아 throw 한다 —
 * 절반만 맞는 증빙 파일이 12월 검수 자리에서 가장 나쁜 결과다.
 *
 * 돌려주는 이름은 "만들어 요청한 파일"이지 "저장된 파일"이 아니다(saveBlob 주석). CSV 처럼 여러 개를
 * 연속으로 요청하면 브라우저가 두 번째부터 막을 수 있고 여기서는 그 사실을 알 수 없다. 화면은
 * 이 목록을 '내려받기를 요청한 파일'로만 표기해야 한다.
 */
export async function downloadExport(payload: ExportPayload, format: ExportFormat): Promise<string[]> {
  const mismatch = checkSheetsMatchDefinition(payload);
  if (mismatch) throw new Error(`산출물 구성이 계약과 맞지 않습니다. ${mismatch}`);

  if (format === 'XLSX') return [await writeXlsx(payload)];

  if (format === 'CSV') {
    const names: string[] = [];
    for (const sheet of csvSheets(payload)) {
      const name = exportFileName(payload.definition.fileBase, 'csv', payload.generatedAt, sheet.name);
      saveBlob(sheetToCsv(sheet), 'text/csv;charset=utf-8', name);
      names.push(name);
    }
    return names;
  }

  const name = exportFileName(payload.definition.fileBase, 'json', payload.generatedAt);
  saveBlob(JSON.stringify(buildExportJson(payload), null, 2), 'application/json;charset=utf-8', name);
  return [name];
}
