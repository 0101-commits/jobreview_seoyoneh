// FTE 분포 — 관리자(ADMIN) /analytics/fte (§6-3 ⓒ · R8 · R10).
//
// §6-3 ⓒ가 요구하는 것: "직무별 과업 비중 평균(SME 평균), 조직별 피벗 표, 상위 과업 순위.
// 화면 하단에 종료선 문구 고정." 그 셋과 종료선이 이 화면의 전부다.
//
// 수치를 여기서 다시 집계하지 않는다 — E2 산출물과 같은 함수(EXPORT_COLLECTORS.E2)를 부른다.
// exportSchema.ts가 '직무×과업 집계' 시트를 두고 "§6-3 ⓒ FTE 분포 화면의 직무별 과업 비중
// 평균·상위 과업 순위와 같은 수치"라고 못박아 두었기 때문이다. 화면이 따로 집계하면 두 수치가
// 갈라지고, 그때 고객이 믿을 근거가 사라진다. 이렇게 두면 §10 P4 DoD ②의 "E2 피벗 수치가
// 원본 수기 검산과 일치"를 이 화면에서 그대로 눈으로 검산할 수 있다.
//
// exportApi.ts의 접점(ExportsPage.tsx와 동일): EXPORT_COLLECTORS.E2(companyId, { basis }).
//   E2는 시트 2장 — [0] 직무×과업×조직 피벗, [1] 직무×과업 집계. 열 이름은 exportSchema.ts가 원본.
//
// 차트 라이브러리는 넣지 않는다. 막대는 div 너비로 그린다(기존 진행률 막대 관례 — sme-review/fte.tsx).
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, RotateCw } from 'lucide-react';
import {
  EXPORT_DEFINITIONS,
  FTE_BASIS_LABELS,
  FTE_SCOPE_NOTICE,
  type ExportRow,
  type ExportSheetData,
  type FteBasis,
} from '@/lib/exportSchema';
import { EXPORT_COLLECTORS } from '@/lib/exportApi';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { FilterChips } from '@/components/ui/FilterChips';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';

// ── 열 이름 ─────────────────────────────────────────────────────────
// 화면에서 열 이름을 새로 짓지 않는다. 계약(exportSchema.ts)의 이름을 그대로 키로 쓴다.

const COL = {
  group: '직군',
  series: '직렬',
  job: '직무',
  taskKind: '과업 구분',
  task: '과업',
  orgCode: '조직코드',
  orgName: '조직명',
  avg: 'SME 평균 비중(%)',
  sd: '표준편차(%p)',
  n: '응답 수',
  rank: '순위',
} as const;

const BASIS_OPTIONS: FteBasis[] = ['APPROVED', 'ALL'];

/** E2 정의 — 시트명·열 순서의 원본. 표 머리글도 여기서 가져온다. */
const E2 = EXPORT_DEFINITIONS.find((d) => d.id === 'E2')!;

// ── 행 읽기 ─────────────────────────────────────────────────────────

function text(row: ExportRow, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? '' : String(v);
}

/**
 * 숫자 칸. 빈칸은 0이 아니라 null이다 — 그 구분이 이 화면의 요지다.
 * (응답이 없어서 비어 있는 칸과 비중이 0인 칸은 다른 사실이다.)
 */
function num(row: ExportRow, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctText(v: number | null): string {
  return v === null ? '' : `${v.toFixed(2)}%`;
}

/** 직무 하나를 가리키는 키. 직무명은 직군·직렬이 다르면 겹칠 수 있다. */
function jobKey(row: ExportRow): string {
  return `${text(row, COL.group)}|${text(row, COL.series)}|${text(row, COL.job)}`;
}

interface JobOption {
  key: string;
  group: string;
  series: string;
  job: string;
}

function jobOptionsOf(rows: ExportRow[]): JobOption[] {
  const map = new Map<string, JobOption>();
  for (const row of rows) {
    const key = jobKey(row);
    if (!map.has(key)) {
      map.set(key, {
        key,
        group: text(row, COL.group),
        series: text(row, COL.series),
        job: text(row, COL.job),
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    `${a.group}${a.series}${a.job}`.localeCompare(`${b.group}${b.series}${b.job}`, 'ko'),
  );
}

/** 상위 과업 순위 — '순위' 열이 있으면 그대로 따르고, 없으면 평균 비중 내림차순. */
function byRank(a: ExportRow, b: ExportRow): number {
  const ra = num(a, COL.rank);
  const rb = num(b, COL.rank);
  if (ra !== null && rb !== null) return ra - rb;
  return (num(b, COL.avg) ?? -1) - (num(a, COL.avg) ?? -1);
}

// ── 조직 피벗(가로 표) ──────────────────────────────────────────────

interface OrgColumn {
  key: string;
  code: string;
  name: string;
}

/**
 * 긴 형태(한 행 = 직무×과업×조직)를 사람이 읽는 피벗으로 돌린다 — 행=과업, 열=조직.
 * E2 시트를 그대로 쭉 나열하면 같은 과업이 조직 수만큼 반복되어 분포가 보이지 않는다.
 * 조직 미지정 응답은 코드·이름이 빈칸인 열 하나에 모인다(계약의 피벗 시트 주석과 같다).
 */
function buildOrgPivot(rows: ExportRow[]): {
  orgs: OrgColumn[];
  tasks: { key: string; task: string; kind: string }[];
  cell: (taskKey: string, orgKey: string) => { avg: number | null; n: number | null } | undefined;
} {
  const orgMap = new Map<string, OrgColumn>();
  const taskMap = new Map<string, { key: string; task: string; kind: string }>();
  const cells = new Map<string, { avg: number | null; n: number | null }>();

  for (const row of rows) {
    const code = text(row, COL.orgCode);
    const name = text(row, COL.orgName);
    const orgKey = `${code}|${name}`;
    if (!orgMap.has(orgKey)) orgMap.set(orgKey, { key: orgKey, code, name });

    const task = text(row, COL.task);
    const kind = text(row, COL.taskKind);
    const taskKey = `${kind}|${task}`;
    if (!taskMap.has(taskKey)) taskMap.set(taskKey, { key: taskKey, task, kind });

    cells.set(`${taskKey}##${orgKey}`, { avg: num(row, COL.avg), n: num(row, COL.n) });
  }

  const orgs = [...orgMap.values()].sort((a, b) => {
    // 조직 미지정(코드 빈칸)은 항상 맨 끝. 있는 조직을 먼저 읽게 한다.
    if (!a.code !== !b.code) return a.code ? -1 : 1;
    return `${a.code}${a.name}`.localeCompare(`${b.code}${b.name}`, 'ko');
  });

  return {
    orgs,
    tasks: [...taskMap.values()],
    cell: (taskKey, orgKey) => cells.get(`${taskKey}##${orgKey}`),
  };
}

// ── 화면 ────────────────────────────────────────────────────────────

export function FteAnalyticsPage({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [sheets, setSheets] = useState<ExportSheetData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  /** §9 E2와 같은 토글. 화면 수치와 내려받은 파일의 수치가 어긋나 보이지 않게 기준을 함께 고른다. */
  const [basis, setBasis] = useState<FteBasis>('APPROVED');
  const [selectedJob, setSelectedJob] = useState('');

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await EXPORT_COLLECTORS.E2(companyFilter === 'all' ? null : companyFilter, { basis });
      if (cancelled) return;
      if (result.ok) {
        setSheets(result.data.sheets);
        setError('');
      } else {
        // 조회 실패를 빈 표(=0건)로 위장하지 않는다. 표는 '불러오지 못함'으로 그린다.
        setSheets(null);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter, basis, reloadKey]);

  // 시트 두 장. useMemo로 감싸는 이유는 sheets가 null일 때 `?? []`가 매 렌더 새 배열을 만들어
  // 아래 useMemo들이 헛돌기 때문이다(계약상 [0] 조직 피벗, [1] 직무×과업 집계).
  const pivotRows = useMemo(() => sheets?.[0]?.rows ?? [], [sheets]);
  const byJobRows = useMemo(() => sheets?.[1]?.rows ?? [], [sheets]);

  const jobs = useMemo(() => jobOptionsOf(byJobRows), [byJobRows]);

  // 조건이 바뀌어 고르던 직무가 사라지면 첫 직무로 되돌린다(빈 화면을 남기지 않는다).
  useEffect(() => {
    if (jobs.length === 0) {
      if (selectedJob) setSelectedJob('');
      return;
    }
    if (!jobs.some((j) => j.key === selectedJob)) setSelectedJob(jobs[0].key);
  }, [jobs, selectedJob]);

  const jobRows = useMemo(
    () => byJobRows.filter((r) => jobKey(r) === selectedJob).sort(byRank),
    [byJobRows, selectedJob],
  );
  const jobPivotRows = useMemo(
    () => pivotRows.filter((r) => jobKey(r) === selectedJob),
    [pivotRows, selectedJob],
  );
  const pivot = useMemo(() => buildOrgPivot(jobPivotRows), [jobPivotRows]);

  /** 막대 길이의 기준. 최대 비중이 곧 100% 너비다(한 과업이 8%뿐이어도 비교가 보이게). */
  const maxAvg = useMemo(
    () => jobRows.reduce((m, r) => Math.max(m, num(r, COL.avg) ?? 0), 0),
    [jobRows],
  );

  const selected = jobs.find((j) => j.key === selectedJob);
  const ready = !loading && !error;

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 t-label text-foreground-subtle">
            {loading ? '불러오는 중…' : error ? '조회 실패' : `직무 ${jobs.length}개 · ${FTE_BASIS_LABELS[basis]}`}
          </p>
          <h2 className="t-title text-foreground">FTE 분포</h2>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        </div>
      </div>

      <div className="mb-5 border border-border bg-muted p-4 t-label text-foreground-muted">
        <p className="flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            업무량은 과업별 투입 비중 배분 방식이며 개인별 시간 실측이 아닙니다. 아래 수치는 SME 응답의 평균이며,
            E2 「직무·조직별 투입 비중 분포」 산출물과 같은 집계입니다.
          </span>
        </p>
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 t-label text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>투입 비중 분포를 불러오지 못했어요. {error} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
            <RotateCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      {/* 조건 — 집계 기준과 직무 선택. 직무 선택은 네이티브 select를 쓴다(모바일에서 그대로 동작). */}
      <div className="mb-5 flex flex-col gap-4 rounded-container border border-border bg-card p-4 shadow-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 t-caption font-medium text-foreground-muted">집계 기준</p>
          <FilterChips
            label="집계 기준 선택"
            value={basis}
            onChange={setBasis}
            options={BASIS_OPTIONS.map((option) => ({ value: option, label: FTE_BASIS_LABELS[option] }))}
          />
        </div>
        <div className="lg:w-96">
          <label htmlFor="fte-job" className="mb-2 block t-caption font-medium text-foreground-muted">
            직무
          </label>
          <select
            id="fte-job"
            value={selectedJob}
            disabled={!ready || jobs.length === 0}
            onChange={(e) => setSelectedJob(e.target.value)}
            className="min-h-11 w-full rounded-element border border-input bg-card px-3 t-label text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 sm:min-h-control-md"
          >
            {jobs.length === 0 ? (
              <option value="">선택할 직무가 없습니다</option>
            ) : (
              jobs.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.job} · {j.group} / {j.series}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* ① 직무별 과업 비중 평균 + 상위 과업 순위 — 한 표에서 순위·막대·편차를 함께 읽는다. */}
      <section className="mb-5 rounded-container border border-border bg-card shadow-1" aria-labelledby="fte-rank-title">
        <div className="border-b border-border p-4">
          <h3 id="fte-rank-title" className="t-body font-semibold text-foreground">
            과업별 SME 평균 비중 · 상위 과업 순위
          </h3>
          <p className="mt-1 t-caption text-foreground-subtle">
            {selected ? `${selected.job} · ${selected.group} / ${selected.series}` : '직무를 선택하세요'} ·{' '}
            {FTE_BASIS_LABELS[basis]}
          </p>
        </div>
        {loading ? (
          <div className="p-4">
            <Skeleton.Table rows={5} cols={5} />
          </div>
        ) : error ? (
          <FallbackView
            kind="error"
            compact
            description="투입 비중 분포를 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요."
          />
        ) : (
          // v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록으로 쌓인다(피벗 표는 예외로 그대로 둔다).
          <DataTable
            caption="선택한 직무의 과업별 SME 평균 투입 비중과 순위. 응답이 1건인 과업은 표준편차 대신 「응답 1건」으로 표시됩니다."
            minWidth="720px"
            className="border-0"
            rows={jobRows}
            rowKey={(row) => `${text(row, COL.taskKind)}|${text(row, COL.task)}`}
            empty={
              <FallbackView
                compact
                heading={`${FTE_BASIS_LABELS[basis]}으로 집계할 응답이 없어요`}
                description={`기준을 「${FTE_BASIS_LABELS[basis === 'APPROVED' ? 'ALL' : 'APPROVED']}」으로 바꿔 보세요.`}
              />
            }
            columns={[
              {
                key: 'rank',
                header: COL.rank,
                className: 'w-14',
                cell: (row) => <span className="text-foreground-subtle">{num(row, COL.rank) ?? ''}</span>,
              },
              {
                key: 'task',
                header: COL.task,
                mobile: 'title',
                className: 'min-w-[14rem]',
                cell: (row) => <span className="text-foreground">{text(row, COL.task)}</span>,
              },
              {
                key: 'kind',
                header: COL.taskKind,
                className: 'w-28',
                cell: (row) => <span className="t-caption">{text(row, COL.taskKind)}</span>,
              },
              {
                key: 'avg',
                header: COL.avg,
                mobile: 'trailing',
                className: 'min-w-[16rem]',
                cell: (row) => {
                  const avg = num(row, COL.avg);
                  const width = avg !== null && maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 tabular-nums text-foreground">{pctText(avg)}</span>
                      <span
                        aria-hidden="true"
                        className="h-2 min-w-[3rem] flex-1 overflow-hidden rounded-inner bg-muted"
                      >
                        <span className="block h-full rounded-inner bg-primary" style={{ width: `${width}%` }} />
                      </span>
                    </div>
                  );
                },
              },
              {
                key: 'sd',
                header: COL.sd,
                className: 'w-32 tabular-nums',
                cell: (row) => {
                  const sd = num(row, COL.sd);
                  const n = num(row, COL.n);
                  /*
                    응답이 1건이면 표준편차는 값이 없는 것이 아니라 "성립하지 않는" 것이다.
                    '—'로 두면 읽는 사람이 이유를 알 수 없으므로 이유를 그대로 적는다(R6 — SME 1~2명).
                  */
                  if (n === 1)
                    return (
                      <span className="rounded-element border border-warning-border bg-warning-muted px-2 py-0.5 t-caption text-warning">
                        응답 1건
                      </span>
                    );
                  if (sd === null) return <span className="t-caption text-foreground-subtle">집계 없음</span>;
                  return <span className="text-foreground">{sd.toFixed(2)}%p</span>;
                },
              },
              {
                key: 'n',
                header: COL.n,
                className: 'w-20 tabular-nums',
                cell: (row) => {
                  const n = num(row, COL.n);
                  return n === null ? '' : `${n}명`;
                },
              },
            ]}
          />
        )}
      </section>

      {/* ② 조직별 피벗 표 — R8(조직 단위 분석)의 축. 행=과업, 열=조직. */}
      <section className="mb-5 rounded-container border border-border bg-card shadow-1" aria-labelledby="fte-pivot-title">
        <div className="border-b border-border p-4">
          <h3 id="fte-pivot-title" className="t-body font-semibold text-foreground">
            조직별 피벗
          </h3>
          <p className="mt-1 t-caption text-foreground-subtle">
            {E2.sheets[0].name} · 같은 과업을 어느 조직이 얼마나 맡고 있는지. 칸의 아래 숫자는 그 평균의 분모(응답
            수)입니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left t-label">
            <caption className="sr-only">
              선택한 직무의 과업별 · 조직별 SME 평균 투입 비중. 행은 과업, 열은 조직입니다.
            </caption>
            <thead>
              <tr className="border-b border-border bg-muted t-caption text-foreground-muted">
                <th
                  scope="col"
                  className="sticky left-0 z-[1] w-56 min-w-[12rem] border-r border-border bg-muted px-4 py-3 font-medium"
                >
                  {COL.task}
                </th>
                {pivot.orgs.map((org) => (
                  <th key={org.key} scope="col" className="w-36 min-w-[9rem] px-3 py-3 font-medium align-top">
                    <span className="block text-foreground">{org.name || '조직 미지정'}</span>
                    <span className="mt-0.5 block t-caption-2 font-normal text-foreground-subtle">
                      {org.code || '조직코드 없음'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={pivot.orgs.length + 1} className="px-4 py-12 text-center text-foreground-subtle">
                    불러오는 중…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={pivot.orgs.length + 1} className="px-4 py-12 text-center text-destructive">
                    투입 비중 분포를 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요.
                  </td>
                </tr>
              ) : pivot.tasks.length === 0 ? (
                <tr>
                  <td colSpan={pivot.orgs.length + 1} className="px-4 py-12 text-center text-foreground-subtle">
                    조직별로 나눌 응답이 없습니다.
                  </td>
                </tr>
              ) : (
                pivot.tasks.map((task) => (
                  <tr key={task.key} className="border-b border-border last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] w-56 min-w-[12rem] border-r border-border bg-card px-4 py-3 text-left font-normal align-top text-foreground"
                    >
                      {task.task}
                      {task.kind && task.kind !== '기존' && (
                        <span className="mt-1 block t-caption-2 text-foreground-subtle">{task.kind}</span>
                      )}
                    </th>
                    {pivot.orgs.map((org) => {
                      const cell = pivot.cell(task.key, org.key);
                      return (
                        <td key={org.key} className="px-3 py-3 align-top tabular-nums">
                          {/* 응답이 없는 칸은 빈칸으로 둔다 — 0%로 적으면 "0%를 배분했다"는 거짓이 된다. */}
                          {!cell || cell.avg === null ? (
                            <span className="text-foreground-subtle">—</span>
                          ) : (
                            <>
                              <span className="block text-foreground">{pctText(cell.avg)}</span>
                              <span className="block t-caption-2 text-foreground-subtle">
                                {cell.n === 1 ? '응답 1건' : cell.n === null ? '' : `응답 ${cell.n}건`}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/*
        범위 종료선 — §6-3 ⓒ의 고정 문언(16면). 화면 하단에 그대로 붙인다.
        착수보고 문언 = 제품 문구(§4-1 P1)이므로 요약·의역하지 않는다. 원문은 exportSchema.ts의 FTE_SCOPE_NOTICE.
      */}
      <p className="mt-6 border-t border-border pt-4 t-label leading-relaxed text-foreground-muted">
        {FTE_SCOPE_NOTICE}
      </p>
    </>
  );
}
