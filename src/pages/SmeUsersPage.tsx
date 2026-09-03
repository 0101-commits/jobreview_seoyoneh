// SME 계정 관리 — 관리자(ADMIN) 화면. SME 계정 목록(검색·정렬·페이지네이션)과 개별 추가·전체 업로드 모달을 띄운다.
// 파괴적인 '전체 삭제'는 1차 버튼이 아니라 ⋯ 메뉴 안에 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCompaniesResult } from '@/lib/jobApi';
import { Button } from '@/components/ui/Button';
import { Toast, useToast } from '@/components/ui/Toast';
import { Snackbar, useSnackbar } from '@/components/ui/Snackbar';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';
import { SectionMessage } from '@/components/ui/SectionMessage';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SmeManageButton } from '@/components/modals/SmeManageButton';
import { SmeSingleCreateModal } from '@/components/modals/SmeSingleCreateModal';
import { SmeBulkUploadModal } from '@/components/modals/SmeBulkUploadModal';
import { SmeBulkDeleteModal } from '@/components/modals/SmeBulkDeleteModal';
import type { SmeListItem } from '@/types';

const PAGE_SIZE = 20;

type SortKey = 'name' | 'company_name' | 'organization' | 'employee_number' | 'active';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'company_name', label: '회사' },
  { key: 'organization', label: '소속조직 / 직급' },
  { key: 'employee_number', label: '사번' },
  { key: 'active', label: '상태' },
];

function compare(a: SmeListItem, b: SmeListItem, key: SortKey): number {
  if (key === 'active') return Number(b.active) - Number(a.active);
  return String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'ko');
}

export function UsersPage({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [smeList, setSmeList] = useState<SmeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyError, setCompanyError] = useState('');
  const [showSingleCreate, setShowSingleCreate] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });
  const [page, setPage] = useState(1);
  const { toast, showToast, dismiss } = useToast();
  // 닫기가 필요한 알림은 Snackbar로 낸다 — Toast에는 닫기 버튼이 없다(v3 T3).
  const { snackbar, showSnackbar, dismiss: dismissSnackbar } = useSnackbar();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const loadCompanies = useCallback(async () => {
    const result = await fetchCompaniesResult();
    if (result.ok) {
      setCompanies(result.data);
      setCompanyError('');
    } else {
      setCompanies([]);
      setCompanyError(
        `회사 목록을 불러오지 못했어요. ${result.error} 새로고침 후에도 계속되면 관리자에게 알려 주세요.`,
      );
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const fetchSmes = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    if (!supabase) {
      setLoading(false);
      setLoadError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    let q = supabase
      .from('profiles')
      .select('id, name, email, organization, title, active, created_at, company_id, employee_number')
      .eq('role', 'sme')
      .order('created_at', { ascending: true });
    if (companyFilter !== 'all') q = q.eq('company_id', companyFilter);

    const { data, error } = await q;
    if (error) {
      // 조회 실패를 '0건'으로 보여 주지 않는다.
      setSmeList([]);
      setLoadError(`SME 목록을 불러오지 못했어요. (${error.message}) 잠시 후 다시 시도해 주세요.`);
      setLoading(false);
      return;
    }

    const { data: comps } = await supabase.from('companies').select('id, name');
    const compMap = new Map((comps || []).map((c: { id: string; name: string }) => [c.id, c.name]));
    setSmeList(
      (data || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        email: p.email as string,
        organization: (p.organization as string) || '',
        title: (p.title as string) || '',
        active: p.active as boolean,
        created_at: (p.created_at as string) || '',
        company_id: (p.company_id as string) || null,
        company_name: (p.company_id as string) ? compMap.get(p.company_id as string) || '' : '',
        employee_number: (p.employee_number as string) || '',
      })),
    );
    setLoading(false);
  }, [companyFilter]);

  useEffect(() => {
    fetchSmes();
  }, [fetchSmes]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? smeList.filter((s) =>
          `${s.name}${s.email}${s.organization}${s.title}${s.company_name}${s.employee_number}`
            .toLowerCase()
            .includes(q),
        )
      : smeList.slice();
    rows.sort((a, b) => (sort.asc ? compare(a, b, sort.key) : -compare(a, b, sort.key)));
    return rows;
  }, [smeList, query, sort]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, companyFilter, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, asc: !prev.asc } : { key, asc: true }));
  }

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 t-label text-foreground-subtle">
            총 {smeList.length}명{query && ` · 검색 결과 ${visible.length}명`}
          </p>
          <h2 className="t-title text-foreground">SME 계정 관리</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
          <Button variant="secondary" onClick={() => setShowSingleCreate(true)}>
            <Plus size={16} aria-hidden="true" /> SME 개별 추가
          </Button>
          <Button onClick={() => setShowBulkUpload(true)}>
            <Upload size={16} aria-hidden="true" /> Excel 전체 업로드
          </Button>

          {/* 되돌릴 수 없는 작업은 1차 버튼 줄에서 빼고 ⋯ 메뉴 안에 둔다. */}
          <div
            className="relative"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenuOpen(false);
            }}
          >
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="추가 작업 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-element border border-border bg-card text-foreground-muted transition hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-control-md sm:min-w-[40px]"
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-popover mt-1 w-56 rounded-element border border-border bg-elevated py-1 shadow-2"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setMenuOpen(false);
                    menuButtonRef.current?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={smeList.length === 0}
                  onClick={() => {
                    setMenuOpen(false);
                    setShowBulkDelete(true);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 text-left t-label text-destructive transition hover:bg-destructive-muted disabled:cursor-not-allowed disabled:text-foreground-subtle disabled:hover:bg-transparent"
                >
                  <Trash2 size={15} aria-hidden="true" /> SME 계정 전체 삭제
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
      <Snackbar snackbar={snackbar} onDismiss={dismissSnackbar} />

      {companyError && (
        <SectionMessage variant="cautionary" className="mb-4">
          {companyError}
        </SectionMessage>
      )}

      <div className="mb-4 rounded-element border border-border bg-muted px-4 py-3 t-caption text-foreground-muted">
        개별 추가는 1명씩 등록할 때, 수정은 각 행의 '관리' 버튼을 이용할 때, Excel 전체 업로드는 여러 SME 계정을 한 번에
        등록할 때 사용합니다.
      </div>

      <div className="rounded-container border border-border bg-card shadow-1">
        <div className="border-b border-border p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-3 text-foreground-subtle" size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-10"
              placeholder="이름, 이메일, 소속조직, 사번 검색"
              aria-label="SME 계정 검색"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-5">
            <Skeleton.Table rows={6} cols={6} />
          </div>
        ) : loadError ? (
          <FallbackView
            kind="error"
            heading="SME 계정을 불러오지 못했어요"
            description={loadError}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  loadCompanies();
                  fetchSmes();
                }}
              >
                <RotateCw size={14} aria-hidden="true" /> 다시 불러오기
              </Button>
            }
          />
        ) : (
          <>
            {/* v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록으로 쌓인다. 정렬 버튼은 헤더로 넘긴다. */}
            <DataTable
              caption="SME 계정 목록"
              minWidth="900px"
              className="border-0"
              rows={pageRows}
              rowKey={(row) => row.id}
              empty={
                <FallbackView
                  heading={query ? '검색 조건에 맞는 SME 계정이 없어요' : '등록된 SME 계정이 없어요'}
                  description={
                    query ? '검색어나 회사 필터를 바꿔 보세요.' : '「SME 개별 추가」 또는 Excel 일괄 업로드로 등록해 주세요.'
                  }
                />
              }
              columns={[
                ...SORT_COLUMNS.map((col) => {
                  const activeSort = sort.key === col.key;
                  const Icon = !activeSort ? ChevronsUpDown : sort.asc ? ArrowUp : ArrowDown;
                  const header = (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`${col.label} 기준으로 정렬`}
                      className="inline-flex items-center gap-1 rounded-inner transition hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {col.label}
                      <Icon size={13} aria-hidden="true" className={activeSort ? 'text-primary' : 'opacity-50'} />
                    </button>
                  );
                  if (col.key === 'name')
                    return {
                      key: col.key,
                      header,
                      mobile: 'title' as const,
                      cell: (row: SmeListItem) => (
                        <>
                          <span className="font-medium text-foreground">{row.name}</span>
                          <p className="mt-1 t-caption font-normal text-foreground-subtle">{row.email}</p>
                        </>
                      ),
                    };
                  if (col.key === 'company_name')
                    return {
                      key: col.key,
                      header,
                      cell: (row: SmeListItem) =>
                        row.company_name || (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <AlertTriangle size={13} aria-hidden="true" /> 회사 미지정
                          </span>
                        ),
                    };
                  if (col.key === 'organization')
                    return {
                      key: col.key,
                      header,
                      cell: (row: SmeListItem) => (
                        <>
                          {row.organization}
                          <p className="mt-1 t-caption text-foreground-subtle">{row.title}</p>
                        </>
                      ),
                    };
                  if (col.key === 'employee_number')
                    return { key: col.key, header, cell: (row: SmeListItem) => row.employee_number || '-' };
                  return {
                    key: col.key,
                    header,
                    mobile: 'trailing' as const,
                    cell: (row: SmeListItem) => (
                      <StatusBadge status={row.active ? '활성' : '비활성'} domain="account" size="sm" />
                    ),
                  };
                }),
                {
                  key: 'manage',
                  header: '관리',
                  mobile: 'trailing' as const,
                  cell: (row: SmeListItem) => (
                    <SmeManageButton sme={row} companies={companies} onChanged={fetchSmes} onToast={showToast} />
                  ),
                },
              ]}
            />

            {visible.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 t-label">
                <p className="text-foreground-muted">
                  {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} / 총{' '}
                  {visible.length}명
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                  >
                    이전
                  </Button>
                  <span className="text-foreground-muted">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                  >
                    다음
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showSingleCreate && (
        <SmeSingleCreateModal
          companies={companies}
          onClose={() => setShowSingleCreate(false)}
          onSuccess={(opts) => {
            // keepOpen: 모달이 임시 비밀번호를 보여 주는 동안 목록만 새로고침한다(v2 S2).
            if (!opts?.keepOpen) setShowSingleCreate(false);
            showToast({ type: 'success', msg: 'SME 계정을 추가했어요.' });
            fetchSmes();
          }}
        />
      )}

      {showBulkUpload && (
        <SmeBulkUploadModal
          companies={companies}
          onClose={() => setShowBulkUpload(false)}
          onCompleted={({ created, failed, aborted }) => {
            if (created > 0) fetchSmes();
            showSnackbar({
              type: failed === 0 && !aborted ? 'success' : 'warning',
              msg:
                failed === 0 && !aborted
                  ? `SME ${created}명을 등록했어요.`
                  : `SME ${created}명 등록, ${failed}명 실패${aborted ? ' (중단됨)' : ''} — 실패 목록은 모달에서 확인해 주세요.`,
              duration: 'long',
            });
          }}
        />
      )}

      {showBulkDelete && (
        <SmeBulkDeleteModal
          smeList={smeList}
          companyFilter={companyFilter}
          companies={companies}
          onClose={() => setShowBulkDelete(false)}
          onCompleted={({ deleted, failed, aborted }) => {
            if (deleted > 0) fetchSmes();
            showSnackbar({
              type: failed === 0 && !aborted ? 'success' : 'warning',
              msg:
                failed === 0 && !aborted
                  ? `SME ${deleted}명을 삭제했어요.`
                  : `SME ${deleted}명 삭제, ${failed}명 실패${aborted ? ' (중단됨)' : ''} — 실패 목록은 모달에서 확인해 주세요.`,
              duration: 'long',
            });
          }}
        />
      )}
    </>
  );
}
