import {
  ApiResult,
  CollectOptions,
  CollectedExport,
  ExportRow,
  FteBasis,
  FteTargetType,
  OrgLabel,
  TARGET_LABELS,
  UNKNOWN_ORG_LABEL,
  byKorean,
  collect,
  isComparableReview,
  loadFteFacts,
  loadJobs,
  loadOrgUnits,
  loadScope,
  loadTaskSuggestions,
  loadTasks,
  mean,
  packed,
  round2,
  sampleStdev,
  sheetOf,
  str,
} from './shared';

// E2 직무·조직별 투입 비중 분포 — 계약 1-(4) · 3-(4) 원천 · 16면 (R8 · R10)
// ────────────────────────────────────────────────────────────────────

/** 한 칸(직무×과업×조직 또는 직무×과업)의 응답 묶음. */
interface FteCell {
  jobId: string;
  taskKey: string;
  taskName: string;
  targetType: FteTargetType;
  orgUnitId: string | null;
  /** 조직 이름을 찾지 못한 org_unit_id 인지. 조직 미지정과 섞이면 안 된다. */
  orgUnknown: boolean;
  values: number[];
}

/**
 * E2(§9). 시트 2장: '직무×과업×조직 피벗' · '직무×과업 집계'.
 * 이 Phase 의 핵심 산출물이다 — 계약 1-(4)·3-(4)의 원천이고 §10 P4 DoD ②의 검산 대상이다.
 *
 * 쿼리 6종(+페이지·청크): 직무 1 · 배정 1 · 조직 1 · 과업 1 · 신규 제안 1 · FTE 1.
 *
 * 기준(§9 "승인 응답 기준/전체 기준 토글")
 *   'APPROVED' — reviews.approved_at IS NOT NULL 인 검토만. 기본값이자 §9 의 검수 기준이다.
 *   'ALL'      — 제출된 검토 전체(SUBMITTED·RESUBMITTED). 작성 중인 초안은 어느 기준에도 넣지 않는다.
 *                제출 전 값은 SME 가 아직 고치는 중이라 "응답"이 아니다.
 *   승인된 검토도 status 는 SUBMITTED·RESUBMITTED 그대로다(decide_review 는 approved_at 만 찍는다).
 *   그래서 APPROVED ⊂ ALL 이고, 두 기준의 차이는 "관리자가 확인했는가" 하나다.
 *
 * 조직축은 profiles.org_unit_id 다. 값이 비어 있는 SME 의 응답을 버리지 않고 조직코드·조직명이 빈
 * 행으로 모은다(계약 E2 피벗 시트 주석). 버리면 조직 피벗의 합계가 '직무×과업 집계'와 어긋나
 * §10 P4 DoD ②의 수기 검산이 실패한다.
 */
export async function collectE2(companyId: string | null, opts: CollectOptions = {}): Promise<ApiResult<CollectedExport>> {
  const basis: FteBasis = opts.basis ?? 'APPROVED';

  return collect('E2 직무·조직별 투입 비중 분포 조회', async () => {
    const [jobs, scope] = await Promise.all([loadJobs(companyId), loadScope(companyId)]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const included = scope.filter((s) => {
      if (!s.reviewId) return false;
      return basis === 'APPROVED' ? Boolean(s.approvedAt) : isComparableReview(s.status);
    });
    const reviewIds = included.map((s) => s.reviewId);
    const scopeByReview = new Map(included.map((s) => [s.reviewId, s]));

    const [orgUnits, tasks, suggestions] = await Promise.all([
      loadOrgUnits(companyId),
      loadTasks(jobs.map((j) => j.id)),
      loadTaskSuggestions(reviewIds),
    ]);
    const facts = await loadFteFacts(
      reviewIds,
      new Map(tasks.map((t) => [t.id, t.name])),
      new Map(suggestions.map((s) => [str(s.id), str(s.name)])),
    );

    // ── 칸 모으기 ──
    const pivot = new Map<string, FteCell>();
    const byJob = new Map<string, FteCell>();

    for (const f of facts) {
      const s = scopeByReview.get(f.reviewId);
      if (!s) continue; // 기준 밖 검토(작성 중·미승인)
      const org = s.orgUnitId ? orgUnits.get(s.orgUnitId) : undefined;
      const orgUnknown = Boolean(s.orgUnitId) && !org;

      const pivotKey = `${s.jobId}|${f.taskKey}|${s.orgUnitId ?? ''}`;
      let cell = pivot.get(pivotKey);
      if (!cell) {
        cell = {
          jobId: s.jobId,
          taskKey: f.taskKey,
          taskName: f.taskName,
          targetType: f.targetType,
          orgUnitId: s.orgUnitId,
          orgUnknown,
          values: [],
        };
        pivot.set(pivotKey, cell);
      }
      cell.values.push(f.pct);

      const jobKey = `${s.jobId}|${f.taskKey}`;
      let jobCell = byJob.get(jobKey);
      if (!jobCell) {
        jobCell = {
          jobId: s.jobId,
          taskKey: f.taskKey,
          taskName: f.taskName,
          targetType: f.targetType,
          orgUnitId: null,
          orgUnknown: false,
          values: [],
        };
        byJob.set(jobKey, jobCell);
      }
      jobCell.values.push(f.pct);
    }

    const jobName = (id: string) => jobById.get(id)?.name ?? '';
    const sortCells = (a: FteCell, b: FteCell) =>
      byKorean(jobName(a.jobId), jobName(b.jobId)) || byKorean(a.taskName, b.taskName);

    // ── 시트 1: 직무×과업×조직 피벗 ──
    const pivotRows: ExportRow[] = [...pivot.values()]
      .sort((a, b) => sortCells(a, b) || byKorean(orgNameOf(a, orgUnits), orgNameOf(b, orgUnits)))
      .map((cell) => {
        const job = jobById.get(cell.jobId);
        const org = cell.orgUnitId ? orgUnits.get(cell.orgUnitId) : undefined;
        const sd = sampleStdev(cell.values);
        return {
          직군: job?.group_name ?? '',
          직렬: job?.series_name ?? '',
          직무: job?.name ?? '',
          '과업 구분': TARGET_LABELS[cell.targetType],
          과업: cell.taskName,
          // 조직 미지정은 빈칸(계약 주석). 이름만 못 찾은 조직은 '알 수 없는 조직'으로 남긴다 —
          // 미지정과 한 칸에 섞으면 서로 다른 조직의 응답이 한 줄로 합쳐진다.
          조직코드: org?.code ?? '',
          조직명: org?.name ?? (cell.orgUnknown ? UNKNOWN_ORG_LABEL : ''),
          'SME 평균 비중(%)': round2(mean(cell.values) ?? 0),
          '표준편차(%p)': sd === null ? null : round2(sd),
          '응답 수': cell.values.length,
        } satisfies ExportRow;
      });

    // ── 시트 2: 직무×과업 집계(+순위) ──
    const jobCells = [...byJob.values()].sort(sortCells);
    /** 직무 안에서 평균 비중이 큰 순서(§6-3 ⓒ "상위 과업 순위"). 동점은 같은 순위를 준다. */
    const rankByKey = new Map<string, number>();
    const groupedByJob = new Map<string, FteCell[]>();
    for (const cell of jobCells) {
      const list = groupedByJob.get(cell.jobId);
      if (list) list.push(cell);
      else groupedByJob.set(cell.jobId, [cell]);
    }
    for (const [jobId, cells] of groupedByJob) {
      const ordered = [...cells].sort((a, b) => (mean(b.values) ?? 0) - (mean(a.values) ?? 0) || byKorean(a.taskName, b.taskName));
      let rank = 0;
      let previous: number | null = null;
      ordered.forEach((cell, index) => {
        const avg = round2(mean(cell.values) ?? 0);
        // 동점이면 앞 행과 같은 순위, 다음 순위는 건너뛴다(1,2,2,4).
        if (previous === null || avg !== previous) rank = index + 1;
        previous = avg;
        rankByKey.set(`${jobId}|${cell.taskKey}`, rank);
      });
    }

    const byJobRows: ExportRow[] = jobCells.map((cell) => {
      const job = jobById.get(cell.jobId);
      const sd = sampleStdev(cell.values);
      return {
        직군: job?.group_name ?? '',
        직렬: job?.series_name ?? '',
        직무: job?.name ?? '',
        '과업 구분': TARGET_LABELS[cell.targetType],
        과업: cell.taskName,
        'SME 평균 비중(%)': round2(mean(cell.values) ?? 0),
        '표준편차(%p)': sd === null ? null : round2(sd),
        '응답 수': cell.values.length,
        순위: rankByKey.get(`${cell.jobId}|${cell.taskKey}`) ?? null,
      } satisfies ExportRow;
    });

    return packed(
      'E2',
      [sheetOf('E2', '직무×과업×조직 피벗', pivotRows), sheetOf('E2', '직무×과업 집계', byJobRows)],
      basis,
    );
  });
}

function orgNameOf(cell: FteCell, orgUnits: Map<string, OrgLabel>): string {
  if (!cell.orgUnitId) return '';
  return orgUnits.get(cell.orgUnitId)?.name ?? UNKNOWN_ORG_LABEL;
}

// ────────────────────────────────────────────────────────────────────
