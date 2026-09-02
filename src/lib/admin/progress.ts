import {
  OrgNode,
  fetchOrgTree,
  flattenOrgTree,
} from './org';
import {
  ApiResult,
  NO_DB,
  ReviewStatus,
  Row,
  byKorean,
  fail,
  fetchAllJobsResult,
  fetchAllPages,
  ok,
  one,
  str,
  supabase,
} from './shared';

// ────────────────────────────────────────────────────────────────────
// 2. 진행 매트릭스 (§6-3 ⓐ)
// ────────────────────────────────────────────────────────────────────

/** 셀 상태. §6-3 ⓐ의 "미시작/작성 중/제출/승인/반려" 그대로다. */
export type CellStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/** 색만으로 상태를 알리지 않기 위해 화면이 함께 쓰는 한국어 라벨(§6-3 ⓐ 문언). */
export const CELL_STATUS_LABELS: Record<CellStatus, string> = {
  NOT_STARTED: '미시작',
  IN_PROGRESS: '작성 중',
  SUBMITTED: '제출',
  APPROVED: '승인',
  REJECTED: '반려',
};

export type StatusCounts = Record<CellStatus, number>;

const emptyCounts = (): StatusCounts => ({
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  SUBMITTED: 0,
  APPROVED: 0,
  REJECTED: 0,
});

/**
 * 검토 한 건의 셀 상태.
 * 승인은 별도 status가 아니라 reviews.approved_at으로 표현된다(20260901030000 주석 참조).
 * 반려는 status='REVIEW_REQUESTED'이며, 이때 approved_at은 서버가 비운다.
 */
export function cellStatusOf(status: ReviewStatus | null, approvedAt: string | null): CellStatus {
  if (approvedAt) return 'APPROVED';
  if (status === 'REVIEW_REQUESTED') return 'REJECTED';
  if (status === 'SUBMITTED' || status === 'RESUBMITTED') return 'SUBMITTED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** 조직 × 직무 한 칸. */
export interface ProgressCell {
  jobId: string;
  jobName: string;
  orgUnitId: string | null;
  orgName: string;
  /** 이 칸에 배정된 SME 수. R6(직무별 1~2명) 준수 여부 점검용이다. */
  assignedSme: number;
  counts: StatusCounts;
  /** 이 칸에서 가장 최근 저장 시각. 아무도 손대지 않았으면 null. */
  lastSavedAt: string | null;
  /** 셀 클릭 → 검토로 이동(§6-3 ⓐ). 화면이 이 목록으로 이동 대상을 고른다. */
  reviews: ProgressCellReview[];
}

export interface ProgressCellReview {
  reviewId: string | null;
  smeId: string;
  smeName: string;
  status: CellStatus;
}

export interface ProgressRow {
  orgUnitId: string | null;
  orgName: string;
  depth: number;
}

export interface ProgressMatrix {
  /** 행 렌더링용 트리(들여쓰기·접기). rows와 같은 조직을 가리킨다. */
  orgRoots: OrgNode[];
  /** 행. 트리 순서 → 트리에 없는 조직 → 마지막에 "조직 미지정". */
  rows: ProgressRow[];
  /** 열. 이름 순. */
  jobs: { id: string; name: string }[];
  /** 셀. 키는 progressCellKey(orgUnitId, jobId). 배정이 없는 칸은 아예 없다. */
  cells: Map<string, ProgressCell>;
}

export function progressCellKey(orgUnitId: string | null, jobId: string): string {
  return `${orgUnitId ?? ''}::${jobId}`;
}

/** profiles.org_unit_id가 비어 있는 SME를 모으는 행(§6-3 ⓐ). 감추지 않고 한 행으로 보여 준다. */
export const UNASSIGNED_ORG_LABEL = '조직 미지정';
/** 다른 계열사 조직처럼 이번 조회 범위에서 이름을 찾지 못한 org_unit_id. */
export const UNKNOWN_ORG_LABEL = '알 수 없는 조직';

/**
 * 진행 매트릭스(§6-3 ⓐ). 행=조직, 열=직무, 셀=상태 집계.
 * 쿼리 3회(조직 트리 1 + 직무 목록 1 + 배정·프로필·직무·검토 1). SME 수·직무 수와 무관하다 —
 * 배정 한 번에 profiles·jobs·reviews를 함께 embed 해서 가져오고 집계는 브라우저에서 한다.
 *
 * 조직은 profiles.org_unit_id 기준이다. 아직 비어 있는 계정이 많으므로 org_unit_id가 없는 SME는
 * "조직 미지정" 행으로 모은다. 배정이 하나도 없는 조직도 행으로 남긴다(빈 조직을 숨기려면 화면이 접는다).
 *
 * 열도 같은 이유로 배정과 따로 조회한다. 배정 행에서만 열을 만들면 SME가 한 명도 배정되지 않은
 * 직무는 표에 아예 나타나지 않아, §6-3 ⓐ가 이 화면에 맡긴 R6(직무별 1~2명) 점검 중 가장 심한
 * 위반인 "배정 0명"을 영영 볼 수 없다. 그 칸은 셀이 없으므로 화면에서 '–'로 그려진다.
 */
export async function fetchProgressMatrix(companyId?: string | null): Promise<ApiResult<ProgressMatrix>> {
  if (!supabase) return fail('진행 현황 조회', NO_DB);

  const [tree, jobList] = await Promise.all([fetchOrgTree(companyId), fetchAllJobsResult(companyId)]);
  if (!tree.ok) return tree;
  if (!jobList.ok) return jobList;

  // 배정은 1,000행을 넘길 수 있다(직무 251 × SME 1~2명이면 이미 근접한다).
  // 잘린 응답은 화면에서 "미배정"으로 보이므로 끝까지 읽는다(v2 D1 — lib/paging.ts).
  const { rows: data, error } = await fetchAllPages(() => {
    let query = supabase!
      .from('review_assignments')
      .select(
        `
      id, sme_id, job_id,
      profiles!inner(id, name, org_unit_id),
      jobs!inner(id, name, company_id, active),
      reviews(id, status, last_saved_at, approved_at)
    `,
      )
      .eq('active', true)
      .eq('jobs.active', true);
    if (companyId) query = query.eq('jobs.company_id', companyId);
    return query;
  });
  if (error) return fail('진행 현황 조회', error);

  const orgNodes = flattenOrgTree(tree.data);
  const orgNameById = new Map(orgNodes.map((n) => [n.id, n.name]));

  const cells = new Map<string, ProgressCell>();
  /** 열은 활성 직무 전체다. 배정이 있는 직무만 담으면 "배정 0명"이 화면에서 사라진다. */
  const jobs = new Map<string, string>(jobList.data.map((j) => [j.id, j.name]));
  /** 트리에 없는 org_unit_id도 행으로 남긴다. 값이 있는데 화면에서 사라지는 편이 더 위험하다. */
  const extraOrgIds = new Set<string>();
  let hasUnassigned = false;

  for (const raw of data || []) {
    const r = raw as Row;
    const profile = one(r.profiles);
    const job = one(r.jobs);
    const review = one(r.reviews);

    const jobId = str(job.id) || str(r.job_id);
    if (!jobId) continue;
    jobs.set(jobId, str(job.name));

    const orgUnitId = str(profile.org_unit_id) || null;
    if (!orgUnitId) hasUnassigned = true;
    else if (!orgNameById.has(orgUnitId)) extraOrgIds.add(orgUnitId);

    const key = progressCellKey(orgUnitId, jobId);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        jobId,
        jobName: str(job.name),
        orgUnitId,
        orgName: orgUnitId ? orgNameById.get(orgUnitId) ?? UNKNOWN_ORG_LABEL : UNASSIGNED_ORG_LABEL,
        assignedSme: 0,
        counts: emptyCounts(),
        lastSavedAt: null,
        reviews: [],
      };
      cells.set(key, cell);
    }

    const status = cellStatusOf((str(review.status) as ReviewStatus) || null, str(review.approved_at) || null);
    cell.assignedSme += 1;
    cell.counts[status] += 1;
    cell.reviews.push({
      reviewId: str(review.id) || null,
      smeId: str(profile.id) || str(r.sme_id),
      smeName: str(profile.name),
      status,
    });

    const savedAt = str(review.last_saved_at);
    if (savedAt && (!cell.lastSavedAt || savedAt > cell.lastSavedAt)) cell.lastSavedAt = savedAt;
  }

  const rows: ProgressRow[] = orgNodes.map((n) => ({ orgUnitId: n.id, orgName: n.name, depth: n.depth }));
  for (const id of [...extraOrgIds].sort()) {
    rows.push({ orgUnitId: id, orgName: UNKNOWN_ORG_LABEL, depth: 0 });
  }
  if (hasUnassigned) rows.push({ orgUnitId: null, orgName: UNASSIGNED_ORG_LABEL, depth: 0 });

  return ok({
    orgRoots: tree.data,
    rows,
    jobs: [...jobs.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => byKorean(a.name, b.name)),
    cells,
  });
}
