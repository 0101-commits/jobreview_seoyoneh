// 진행 매트릭스 — 관리자(ADMIN) '진행 현황' 화면(§6-3 ⓐ).
// 행=조직(org_units 트리), 열=직무, 셀=상태. 셀을 누르면 그 직무의 검토 워크벤치로 넘어간다.
//
// 조회·집계는 전부 src/lib/adminApi.ts의 fetchProgressMatrix가 한다. 이 파일은 그리기만 한다.
// 상태 라벨(미시작/작성 중/제출/승인/반려)도 adminApi의 CELL_STATUS_LABELS를 그대로 쓴다 —
// 화면에서 다시 적으면 두 곳이 갈라진다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Mail,
  PenLine,
  RotateCw,
  Send,
  XCircle,
} from 'lucide-react';
import {
  CELL_STATUS_LABELS,
  fetchProgressMatrix,
  progressCellKey,
  type CellStatus,
  type OrgNode,
  type ProgressCell,
  type ProgressCellReview,
  type ProgressMatrix,
} from '@/lib/adminApi';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { fetchOperationSettings, type OperationSettings } from '@/lib/settingsApi';
import { DEFAULT_TEMPLATES, type MailRecipient } from '@/lib/mailApi';
import { MailSendPanel } from '@/pages/admin/MailSendPanel';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { FilterChips } from '@/components/ui/FilterChips';
import { Button } from '@/components/ui/Button';

// ── 표시용 상수 ─────────────────────────────────────────────────────

/** 셀 안에서 상태 칩을 늘어놓는 순서. 진행 순서대로 둔다. */
const STATUS_ORDER: CellStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED'];

/**
 * 상태 표시. 색만으로 알리지 않도록 아이콘·한국어 라벨을 항상 함께 그린다(§8 S8).
 * 색은 tailwind.config.js의 기존 토큰만 쓴다.
 */
const STATUS_STYLE: Record<CellStatus, { chip: string; Icon: typeof Circle }> = {
  NOT_STARTED: { chip: 'border-border bg-muted text-foreground-muted', Icon: Circle },
  IN_PROGRESS: { chip: 'border-warning-border bg-warning-muted text-warning', Icon: PenLine },
  SUBMITTED: { chip: 'border-primary-border bg-primary-subtle text-primary', Icon: Send },
  APPROVED: { chip: 'border-success-border bg-success-muted text-success', Icon: CheckCircle2 },
  REJECTED: { chip: 'border-destructive-border bg-destructive-muted text-destructive', Icon: XCircle },
};

type MatrixFilter = 'ALL' | 'NOT_STARTED' | 'UNSUBMITTED';

const FILTERS: { key: MatrixFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'NOT_STARTED', label: '미시작' },
  { key: 'UNSUBMITTED', label: '미제출' },
];

/**
 * '미제출'은 아직 제출에 도달하지 못한 상태 전부다 — 미시작·작성 중에 더해 반려까지 포함한다.
 * 반려된 검토는 SME가 다시 손봐 제출해야 하므로 리마인더 대상이라는 점에서 미제출과 같다.
 */
const UNSUBMITTED_STATUSES: CellStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'REJECTED'];

/** 필터별 리마인더 대상 상태. '전체'에서도 대상은 미제출로 본다(제출·승인은 보낼 이유가 없다). */
function targetStatusesOf(filter: MatrixFilter): CellStatus[] {
  return filter === 'NOT_STARTED' ? ['NOT_STARTED'] : UNSUBMITTED_STATUSES;
}

/** R6 — 직무별 SME 1~2명. 0명·3명 이상이면 경고로 알린다. */
export function r6Of(count: number): { violation: boolean; tone: string; note: string } {
  if (count === 0) return { violation: true, tone: 'text-destructive', note: '배정 없음' };
  if (count > 2) return { violation: true, tone: 'text-warning', note: '1~2명 초과' };
  return { violation: false, tone: 'text-foreground-subtle', note: '' };
}

// ── 조직 트리 접기 ──────────────────────────────────────────────────
// 세 함수 모두 순수하다. 접기·숨기기는 여기서만 판단한다.

export type OrgMeta = Map<string, { parentId: string | null; childCount: number }>;

/**
 * 조직 id → 부모·자식 수. org_units.parent_id를 그대로 믿지 않고 실제 트리를 걸어 만든다 —
 * buildOrgTree가 순환·고아·자기참조를 이미 뿌리로 올려 두었기 때문에 원본 parent_id와 트리가 다를 수 있다.
 */
export function buildOrgMeta(roots: OrgNode[]): OrgMeta {
  const map: OrgMeta = new Map();
  const walk = (nodes: OrgNode[], parentId: string | null) => {
    for (const n of nodes) {
      map.set(n.id, { parentId, childCount: n.children.length });
      walk(n.children, n.id);
    }
  };
  walk(roots, null);
  return map;
}

/** 주어진 조직 집합에 조상을 더한다. 조상을 빼면 트리가 중간에서 끊긴다. */
export function withAncestors(ids: Iterable<string>, orgMeta: OrgMeta): Set<string> {
  const has = new Set(ids);
  for (const id of [...has]) {
    let p = orgMeta.get(id)?.parentId ?? null;
    while (p && !has.has(p)) {
      has.add(p);
      p = orgMeta.get(p)?.parentId ?? null;
    }
  }
  return has;
}

/** 접힌 조상이 하나라도 있으면 이 행은 숨긴다. 트리 밖 행(조직 미지정 등)은 접기 대상이 아니다. */
export function isHiddenByCollapse(orgUnitId: string | null, orgMeta: OrgMeta, collapsed: Set<string>): boolean {
  if (!orgUnitId) return false;
  let p = orgMeta.get(orgUnitId)?.parentId ?? null;
  while (p) {
    if (collapsed.has(p)) return true;
    p = orgMeta.get(p)?.parentId ?? null;
  }
  return false;
}

// ── 발송 대상 ───────────────────────────────────────────────────────

/**
 * 고른 칸 → 리마인더 수신자. (SME, 직무) 한 쌍당 한 통이다.
 *
 * 같은 사람에게 같은 직무 안내가 두 번 나가면 그건 리마인더가 아니라 스팸이다(배정이 중복
 * 등록된 경우 한 칸 안에 같은 (SME, 직무)가 두 줄로 들어올 수 있다).
 * 반대로 한 사람이 두 직무를 맡았으면 직무별로 한 통씩 간다 — 안내 문구의 {{직무}}가 다르다.
 */
export function toRecipients(
  cells: ProgressCell[],
  targetsOf: (cell: ProgressCell) => ProgressCellReview[],
): MailRecipient[] {
  const out: MailRecipient[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const r of targetsOf(cell)) {
      const key = `${r.smeId}::${cell.jobId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: r.smeId, name: r.smeName, jobName: cell.jobName, orgName: cell.orgName });
    }
  }
  return out;
}

// ── 화면 ────────────────────────────────────────────────────────────

export function ProgressMatrixPage({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [matrix, setMatrix] = useState<ProgressMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const [filter, setFilter] = useState<MatrixFilter>('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showEmptyOrgs, setShowEmptyOrgs] = useState(false);
  /** 리마인더 대상으로 고른 칸. 키는 progressCellKey. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 발송 패널을 펼쳤는가. 문구를 고치는 자리라 항상 펼쳐 두면 표가 화면 밖으로 밀린다. */
  const [mailOpen, setMailOpen] = useState(false);
  /**
   * 템플릿 치환에 쓰는 운영 설정(마감일·예상 소요·문의 담당).
   * survey_settings는 회사당 한 행이라 '전체 회사'에서는 어느 행인지 정해지지 않는다 —
   * 그때는 조회하지 않고 null로 둔다(mailApi가 '미정'으로 치환한다). 숫자를 지어내지 않는다.
   */
  const [settings, setSettings] = useState<OperationSettings | null>(null);
  /** 설정 조회 실패. 값이 없는 것(미설정)과 못 읽은 것을 화면에서 구분하기 위해 따로 든다. */
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  useEffect(() => {
    if (companyFilter === 'all') {
      setSettings(null);
      setSettingsError('');
      return;
    }
    let cancelled = false;
    void fetchOperationSettings(companyFilter).then((res) => {
      if (cancelled) return;
      // 못 읽은 것을 '미설정'으로 위장하지 않는다 — 그대로 두면 마감일 없는 메일이 조용히 나간다.
      setSettings(res.ok ? res.data : null);
      setSettingsError(res.ok ? '' : res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [companyFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await fetchProgressMatrix(companyFilter === 'all' ? null : companyFilter);
      if (cancelled) return;
      if (result.ok) {
        setMatrix(result.data);
        setError('');
      } else {
        // 조회 실패를 빈 매트릭스로 위장하지 않는다. 표는 '불러오지 못함'으로 그린다.
        setMatrix(null);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter, reloadKey]);

  // 조건이 바뀌면 선택은 무효다(보이지 않는 칸이 선택된 채 남으면 건수가 거짓이 된다).
  useEffect(() => {
    setSelected(new Set());
    setMailOpen(false);
  }, [companyFilter, filter, reloadKey]);

  const orgMeta = useMemo(() => buildOrgMeta(matrix?.orgRoots ?? []), [matrix]);

  /** 배정이 하나라도 걸린 조직 + 그 조상. */
  const orgsWithData = useMemo(() => {
    const ids: string[] = [];
    for (const cell of matrix?.cells.values() ?? []) if (cell.orgUnitId) ids.push(cell.orgUnitId);
    return withAncestors(ids, orgMeta);
  }, [matrix, orgMeta]);

  const cellOf = useCallback(
    (orgUnitId: string | null, jobId: string): ProgressCell | undefined =>
      matrix?.cells.get(progressCellKey(orgUnitId, jobId)),
    [matrix],
  );

  const targetStatuses = targetStatusesOf(filter);
  const targetsIn = useCallback(
    (cell: ProgressCell | undefined) => (cell ? cell.reviews.filter((r) => targetStatuses.includes(r.status)) : []),
    // targetStatuses는 filter에서만 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter],
  );

  /** 필터가 걸리면 대상이 하나도 없는 행·열은 접어 둔다(빈 매트릭스를 훑게 하지 않는다). */
  const visibleJobs = useMemo(() => {
    const jobs = matrix?.jobs ?? [];
    if (filter === 'ALL') return jobs;
    return jobs.filter((job) => (matrix?.rows ?? []).some((row) => targetsIn(cellOf(row.orgUnitId, job.id)).length > 0));
  }, [matrix, filter, cellOf, targetsIn]);

  const visibleRows = useMemo(() => {
    const rows = matrix?.rows ?? [];
    return rows.filter((row) => {
      if (row.orgUnitId && !showEmptyOrgs && !orgsWithData.has(row.orgUnitId)) return false;
      if (isHiddenByCollapse(row.orgUnitId, orgMeta, collapsed)) return false;
      if (filter === 'ALL') return true;
      return visibleJobs.some((job) => targetsIn(cellOf(row.orgUnitId, job.id)).length > 0);
    });
  }, [matrix, showEmptyOrgs, orgsWithData, orgMeta, collapsed, filter, visibleJobs, cellOf, targetsIn]);

  /** 직무별 SME 배정 수(R6 점검). 조직을 가로질러 합산한다. */
  const smeCountByJob = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of matrix?.cells.values() ?? []) map.set(cell.jobId, (map.get(cell.jobId) ?? 0) + cell.assignedSme);
    return map;
  }, [matrix]);

  const r6Violations = useMemo(
    () => (matrix?.jobs ?? []).filter((job) => r6Of(smeCountByJob.get(job.id) ?? 0).violation),
    [matrix, smeCountByJob],
  );

  /** 상태별 검토 건수 — 필터 칩 옆 숫자. */
  const statusTotals = useMemo(() => {
    const totals: Record<CellStatus, number> = {
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    for (const cell of matrix?.cells.values() ?? [])
      for (const s of STATUS_ORDER) totals[s] += cell.counts[s];
    return totals;
  }, [matrix]);

  const filterCount = (key: MatrixFilter) => {
    if (key === 'NOT_STARTED') return statusTotals.NOT_STARTED;
    if (key === 'UNSUBMITTED') return UNSUBMITTED_STATUSES.reduce((n, s) => n + statusTotals[s], 0);
    return STATUS_ORDER.reduce((n, s) => n + statusTotals[s], 0);
  };

  /** 지금 화면에 보이는 칸 중 리마인더 대상이 있는 칸의 키. 전체 선택이 쓴다. */
  const selectableKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of visibleRows)
      for (const job of visibleJobs) {
        const cell = cellOf(row.orgUnitId, job.id);
        if (targetsIn(cell).length > 0) keys.push(progressCellKey(row.orgUnitId, job.id));
      }
    return keys;
  }, [visibleRows, visibleJobs, cellOf, targetsIn]);

  /**
   * 선택 건수 — 검토 건수와 사람 수를 함께 센다(한 SME가 두 직무를 맡을 수 있다).
   * selected가 아니라 지금 보이는 칸(selectableKeys)만 센다. 조직을 접으면 그 하위 행의
   * 체크박스는 화면에서 사라지지만 선택은 그대로 남아, selected를 그대로 세면 보이지 않는
   * 칸이 건수에 계속 잡힌다(위 초기화 effect가 막으려던 바로 그 거짓 건수다).
   * 접기는 선택을 지우지 않는다 — 다시 펼치면 고르던 칸이 그대로 돌아온다.
   */
  const selection = useMemo(() => {
    let reviews = 0;
    const smes = new Set<string>();
    for (const key of selectableKeys) {
      if (!selected.has(key)) continue;
      const cell = matrix?.cells.get(key);
      if (!cell) continue;
      for (const r of targetsIn(cell)) {
        reviews += 1;
        smes.add(r.smeId);
      }
    }
    return { reviews, smes: smes.size };
  }, [selected, selectableKeys, matrix, targetsIn]);

  /** 발송 대상. selection과 똑같이 "지금 보이면서 선택된 칸"만 센다(접힌 칸은 대상이 아니다). */
  const recipients = useMemo(() => {
    const cells: ProgressCell[] = [];
    for (const key of selectableKeys) {
      if (!selected.has(key)) continue;
      const cell = matrix?.cells.get(key);
      if (cell) cells.push(cell);
    }
    return toRecipients(cells, targetsIn);
  }, [selected, selectableKeys, matrix, targetsIn]);

  /*
   * 저장된 리마인더 템플릿(운영 설정 §6-3 ⓓ). 제목·본문을 각각 따로 폴백한다.
   * 둘 다 있을 때만 넘기면, 제목만 저장한 관리자의 제목이 조용히 버려지고 기본 문구가 그대로 나간다
   * (설정 화면은 두 칸을 각각 저장할 수 있고, 안내문도 "비워 두면 기본 문구가 쓰입니다"라는 칸 단위 약속이다).
   * useMemo 로 묶는 이유: 매 렌더 새 객체가 되면 패널의 문구 동기화가 쉬지 않고 돈다.
   */
  const mailTemplates = useMemo(
    () => ({
      REMINDER: {
        subject: settings?.reminder_subject || DEFAULT_TEMPLATES.REMINDER.subject,
        body: settings?.reminder_body_md || DEFAULT_TEMPLATES.REMINDER.body,
      },
    }),
    [settings],
  );

  const toggleCell = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleOrg = (orgUnitId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(orgUnitId)) next.delete(orgUnitId);
      else next.add(orgUnitId);
      return next;
    });

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));
  const ready = !loading && !error && matrix !== null;
  const colCount = visibleJobs.length + 1;

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            {loading
              ? '불러오는 중…'
              : error
                ? '조회 실패'
                : `조직 ${visibleRows.length}개 · 직무 ${visibleJobs.length}개`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">진행 현황</h2>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        </div>
      </div>

      {error && (
        <div className="mb-5 flex flex-col gap-3 border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>진행 현황을 불러오지 못했어요. {error} 잠시 후 다시 시도해 주세요.</span>
          </p>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)} className="shrink-0">
            <RotateCw size={14} /> 다시 시도
          </Button>
        </div>
      )}

      {ready && r6Violations.length > 0 && (
        <div className="mb-5 border border-warning-border bg-warning-muted p-4 text-sm text-warning">
          <p className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <b className="font-semibold">SME 배정 1~2명 규칙에 어긋나는 직무 {r6Violations.length}건</b> —{' '}
              {r6Violations
                .slice(0, 6)
                .map((job) => `${job.name}(${smeCountByJob.get(job.id) ?? 0}명)`)
                .join(' · ')}
              {r6Violations.length > 6 ? ` 외 ${r6Violations.length - 6}건` : ''}
            </span>
          </p>
        </div>
      )}

      <div className="rounded-container border border-border bg-card shadow-1">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <FilterChips
            label="진행 상태 필터"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map(({ key, label }) => ({ value: key, label, count: filterCount(key) }))}
          />
          <label className="inline-flex min-h-11 items-center gap-2 text-xs text-foreground-muted">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={showEmptyOrgs}
              onChange={(e) => setShowEmptyOrgs(e.target.checked)}
            />
            배정 없는 조직도 표시
          </label>
        </div>

        {/* 리마인더 — 대상 선택까지만 만든다. 실제 발송은 운영 설정에서 메일을 연결한 뒤에 열린다. */}
        <div className="flex flex-col gap-3 border-b border-border bg-muted p-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allSelected}
              disabled={!ready || selectableKeys.length === 0}
              onChange={(e) => setSelected(e.target.checked ? new Set(selectableKeys) : new Set())}
            />
            미시작·미제출 전체 선택
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground-muted">
              선택 <b className="font-semibold text-foreground">{selection.reviews}건</b> · SME{' '}
              <b className="font-semibold text-foreground">{selection.smes}명</b>
            </p>
            <Button
              variant="secondary"
              size="sm"
              // 패널이 열려 있는 동안에는 잠그지 않는다 — 대상이 0이 되어도 닫을 수는 있어야 한다.
              disabled={recipients.length === 0 && !mailOpen}
              aria-expanded={mailOpen}
              aria-controls="reminder-mail-panel"
              title={recipients.length === 0 && !mailOpen ? '먼저 보낼 대상을 선택해 주세요' : undefined}
              onClick={() => setMailOpen((v) => !v)}
            >
              <Mail size={14} aria-hidden="true" /> 리마인더 발송
            </Button>
            {recipients.length === 0 && (
              <p className="text-xs text-foreground-subtle">보낼 대상을 먼저 선택해 주세요</p>
            )}
          </div>
        </div>

        {/*
          발송 패널(§11-2 Phase 4 3번). 문구 편집·미리보기·발송·이력은 전부 MailSendPanel이 한다.
          대상 수를 조건에 넣지 않는다: 선택이 0이 되는 순간 패널이 언마운트되면 고쳐 쓰던 본문과
          방금 받은 발송 결과(실패자 다시 보내기 목록 포함)가 경고 없이 사라진다. 대상이 없을 때의
          빈 상태와 발송 버튼 잠금은 패널이 이미 스스로 그린다.
        */}
        {mailOpen && (
          <div id="reminder-mail-panel" className="border-b border-border p-4">
            {settingsError && (
              <p
                role="alert"
                className="mb-3 flex items-start gap-2 border border-destructive-border bg-destructive-muted p-3 text-xs leading-5 text-destructive"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {settingsError} 마감일·예상 소요·문의 담당이 &lsquo;미정&rsquo;으로 나갑니다. 값을 채워 보내려면
                  새로고침한 뒤 다시 시도해 주세요.
                </span>
              </p>
            )}
            {companyFilter === 'all' && (
              <p className="mb-3 flex items-start gap-2 border border-border bg-muted p-3 text-xs leading-5 text-foreground-muted">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  계열사가 &lsquo;전체&rsquo;라 마감일·예상 소요·문의 담당을 어느 회사 설정에서 가져올지 정할 수
                  없습니다. 해당 문구는 &lsquo;미정&rsquo;으로 나갑니다 — 계열사를 하나 고르면 그 회사의 운영 설정이
                  들어갑니다.
                </span>
              </p>
            )}
            <MailSendPanel
              recipients={recipients}
              dueDate={settings?.due_date ?? null}
              expectedMinutes={settings?.expected_minutes ?? null}
              inquiryContact={settings?.inquiry_contact ?? null}
              templates={mailTemplates}
            />
          </div>
        )}

        {/* 표 컨테이너 안에서만 가로로 스크롤한다. 첫 열(조직명)은 고정. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <caption className="sr-only">
              조직별 · 직무별 검토 진행 현황. 행은 조직, 열은 직무이며 각 칸은 배정된 SME의 검토 상태입니다.
            </caption>
            <thead>
              <tr className="border-b border-border bg-muted text-xs text-foreground-muted">
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-56 min-w-[11rem] max-w-[14rem] border-r border-border bg-muted px-4 py-3 font-medium"
                >
                  조직
                </th>
                {visibleJobs.map((job) => {
                  const count = smeCountByJob.get(job.id) ?? 0;
                  const r6 = r6Of(count);
                  return (
                    <th key={job.id} scope="col" className="w-44 min-w-[11rem] px-3 py-3 font-medium align-top">
                      <span className="block text-foreground">{job.name}</span>
                      <span className={`mt-1 flex items-center gap-1 text-[11px] font-normal ${r6.tone}`}>
                        {r6.violation && <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />}
                        SME {count}명{r6.note ? ` · ${r6.note}` : ''}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-foreground-subtle">
                    불러오는 중…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-destructive">
                    진행 현황을 불러오지 못했어요. 위의 「다시 시도」를 눌러 주세요.
                  </td>
                </tr>
              ) : visibleRows.length === 0 || visibleJobs.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-foreground-subtle">
                    {(matrix?.cells.size ?? 0) === 0
                      ? '배정된 검토가 없습니다. 직무정보를 업로드하고 SME에게 배정해 주세요.'
                      : '조건에 맞는 검토가 없어요. 상태 필터를 바꿔 보세요.'}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const meta = row.orgUnitId ? orgMeta.get(row.orgUnitId) : undefined;
                  const hasChildren = (meta?.childCount ?? 0) > 0;
                  const isCollapsed = row.orgUnitId ? collapsed.has(row.orgUnitId) : false;
                  return (
                    <tr key={row.orgUnitId ?? "unassigned"} className="border-b border-border last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 w-56 min-w-[11rem] max-w-[14rem] border-r border-border bg-card px-2 py-2 text-left font-normal align-top"
                      >
                        <div
                          className="flex items-start gap-1"
                          style={{ paddingLeft: `${Math.min(row.depth, 6) * 14}px` }}
                        >
                          {hasChildren && row.orgUnitId ? (
                            <button
                              type="button"
                              onClick={() => toggleOrg(row.orgUnitId as string)}
                              aria-expanded={!isCollapsed}
                              className="flex min-h-11 w-6 shrink-0 items-center justify-center text-foreground-subtle hover:text-primary"
                            >
                              {isCollapsed ? (
                                <ChevronRight size={14} aria-hidden="true" />
                              ) : (
                                <ChevronDown size={14} aria-hidden="true" />
                              )}
                              <span className="sr-only">
                                {row.orgName} 하위 조직 {meta?.childCount ?? 0}개 {isCollapsed ? '펼치기' : '접기'}
                              </span>
                            </button>
                          ) : (
                            <span className="w-6 shrink-0" aria-hidden="true" />
                          )}
                          <span className="min-h-11 py-2.5 text-sm font-medium text-foreground">
                            {row.orgName}
                            {isCollapsed && (
                              <span className="ml-1 text-[11px] font-normal text-foreground-subtle">
                                (하위 {meta?.childCount ?? 0}개 접힘)
                              </span>
                            )}
                          </span>
                        </div>
                      </th>

                      {visibleJobs.map((job) => {
                        const cell = cellOf(row.orgUnitId, job.id);
                        const key = progressCellKey(row.orgUnitId, job.id);
                        const targets = targetsIn(cell);
                        if (!cell) {
                          return (
                            <td key={job.id} className="px-3 py-2 text-center text-foreground-subtle">
                              <span aria-hidden="true">–</span>
                              <span className="sr-only">
                                {row.orgName} · {job.name} 배정 없음
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={job.id} className="px-2 py-2 align-top">
                            <div className="flex items-start gap-1">
                              {targets.length > 0 && (
                                <label className="flex min-h-11 w-6 shrink-0 items-center justify-center">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={selected.has(key)}
                                    onChange={() => toggleCell(key)}
                                  />
                                  <span className="sr-only">
                                    {row.orgName} · {job.name} 리마인더 대상 {targets.length}건 선택
                                  </span>
                                </label>
                              )}
                              <Link
                                to={`/workbench/${cell.jobId}`}
                                className={`flex min-h-11 flex-1 flex-col gap-1 rounded-element border px-2 py-2 transition hover:border-primary hover:bg-primary-subtle ${
                                  selected.has(key) ? 'border-primary bg-primary-subtle' : 'border-transparent'
                                }`}
                              >
                                <span className="flex flex-wrap gap-1">
                                  {STATUS_ORDER.filter((s) => cell.counts[s] > 0).map((s) => {
                                    const { chip, Icon } = STATUS_STYLE[s];
                                    return (
                                      <span
                                        key={s}
                                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}
                                      >
                                        <Icon size={11} className="shrink-0" aria-hidden="true" />
                                        {CELL_STATUS_LABELS[s]} {cell.counts[s]}
                                      </span>
                                    );
                                  })}
                                </span>
                                {/* R6(직무별 SME 1~2명)은 직무 단위 규칙이라 칸이 아니라 열 머리에서만 판정한다.
                                    칸은 조직×직무라 한 직무가 여러 조직에 나뉘면 칸마다 2명이어도 직무 합계는
                                    초과일 수 있다 — 칸에 같은 배지를 달면 두 곳이 다른 말을 한다. */}
                                <span className="flex items-center gap-1 text-[11px] text-foreground-subtle">
                                  SME {cell.assignedSme}명
                                </span>
                                <span className="sr-only">
                                  {row.orgName} · {job.name} 검토 워크벤치 열기
                                </span>
                              </Link>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border p-4 text-[11px] text-foreground-muted">
          <span className="text-foreground-subtle">상태 표시</span>
          {STATUS_ORDER.map((s) => {
            const { chip, Icon } = STATUS_STYLE[s];
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-medium ${chip}`}
              >
                <Icon size={11} className="shrink-0" aria-hidden="true" />
                {CELL_STATUS_LABELS[s]}
              </span>
            );
          })}
          <span className="text-foreground-subtle">칸을 누르면 그 직무의 검토 워크벤치가 열립니다.</span>
        </div>
      </div>
    </>
  );
}

export default ProgressMatrixPage;
