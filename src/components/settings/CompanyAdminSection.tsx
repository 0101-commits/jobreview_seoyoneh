/*
 * 계열사 관리 — 운영 설정(/settings) 안의 관리자 전용 섹션.
 * 기획서: docs/PLAN_ADMIN_FULL_CONTROL.md §3 F9 · §5.
 *
 * ▣ 왜 이 화면이 필요한가
 *   `companies`를 쓰는 코드는 조회뿐이었고 삽입·수정 경로는 seed SQL 하나였다. 계열사를 하나
 *   늘리려면 Supabase SQL Editor를 열어야 했다 — "관리자 페이지에서 모든 것을 설정한다"에 어긋난다.
 *
 * ▣ 왜 /settings 안인가
 *   운영 설정 화면이 이미 "이 회사 하나"를 고르는 화면이다. 고를 대상의 목록이 같은 자리에 있는
 *   편이 읽힌다. 새 메뉴를 만들면 계열사를 만지려면 어디로 가야 하는지가 두 곳으로 갈린다.
 *
 * ▣ 왜 삭제가 없는가(§5)
 *   `companies`를 참조하는 외래키가 여러 갈래다(profiles·jobs·survey_settings …). 하드 삭제는
 *   대부분 FK 위반으로 실패하고, 성공하는 경우가 더 위험하다(그 회사의 직무·계정·설정이 함께
 *   사라진다). 그래서 활성 토글만 둔다 — 비활성 회사는 fetchCompaniesResult가 이미 걸러 내므로
 *   선택 목록에서 사라진다.
 *
 * ▣ 권한
 *   `companies`에는 관리자용 INSERT/UPDATE 정책이 이미 있어(20260812153755) 화면에서 바로 쓴다.
 *   Edge Function을 거치지 않는 이유는 profiles와 달리 컬럼 단위 REVOKE가 걸려 있지 않기 때문이다.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, Plus, RotateCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/auditApi';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';

type CompanyRow = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  sort_order: number;
};

/** 저장 실패 사유를 한국어로 바꾼다. 코드 중복(23505)이 사실상 유일한 사용자 오류다. */
function toKoreanError(message: string, code?: string): string {
  if (code === '23505' || message.includes('duplicate key') || message.includes('companies_code_key'))
    return '이미 쓰고 있는 회사 코드예요. 다른 코드를 넣어 주세요.';
  if (code === '42501' || message.includes('row-level security'))
    return '권한이 없어 저장하지 못했어요. 관리자 계정으로 다시 로그인한 뒤 시도해 주세요.';
  return `저장하지 못했어요. (${message}) 잠시 후 다시 시도해 주세요.`;
}

export function CompanyAdminSection({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** 지금 편집 중인 행. 한 번에 한 줄만 연다 — 여러 줄을 동시에 고치면 무엇을 저장했는지 흐려진다. */
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    if (!supabase) {
      setLoading(false);
      setLoadError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    // 비활성 회사도 함께 가져온다 — 여기서 다시 켜야 하므로 목록에 보여야 한다.
    const { data, error: qErr } = await supabase
      .from('companies')
      .select('id, name, code, active, sort_order')
      .order('sort_order', { ascending: true });
    if (qErr) {
      // 조회 실패를 '계열사 0건'으로 보여 주지 않는다.
      setRows([]);
      setLoadError(`계열사 목록을 불러오지 못했어요. (${qErr.message}) 잠시 후 다시 시도해 주세요.`);
      setLoading(false);
      return;
    }
    setRows((data || []) as CompanyRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 목록을 다시 읽고, 상위 화면의 회사 드롭다운도 함께 갱신한다. */
  async function reload() {
    await load();
    onChanged?.();
  }

  async function handleCreate() {
    setError('');
    setNotice('');
    const name = newName.trim();
    const code = newCode.trim().toLowerCase();
    if (!name || !code) {
      setError('회사명과 회사 코드를 모두 입력해 주세요.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(code)) {
      setError('회사 코드에는 영문 소문자·숫자·하이픈(-)만 쓸 수 있어요. 업로드 파일과 맞춰야 하는 식별자입니다.');
      return;
    }
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setCreating(true);
    // 표시 순서는 맨 뒤로 붙인다. 관리자가 숫자를 직접 정하게 하면 첫 등록부터 순서를 고민해야 한다.
    const nextOrder = rows.reduce((max, r) => Math.max(max, r.sort_order), 0) + 1;
    const { data, error: insErr } = await supabase
      .from('companies')
      .insert({ name, code, sort_order: nextOrder, active: true })
      .select('id')
      .maybeSingle();
    setCreating(false);
    if (insErr) {
      setError(toKoreanError(insErr.message, insErr.code));
      return;
    }
    // meta에 개인정보는 없다. 회사명·코드는 조직 식별자라 추적에 필요하다(§8 S6의 개인정보가 아니다).
    await logAudit('COMPANY_CREATED', 'companies', data?.id ?? null, { code });
    setNewName('');
    setNewCode('');
    setAdding(false);
    setNotice(`${name} 계열사를 추가했어요. 이제 SME·직무 등록에서 이 회사를 고를 수 있습니다.`);
    await reload();
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setError('');
    setNotice('');
    const name = editing.name.trim();
    const code = editing.code.trim().toLowerCase();
    if (!name || !code) {
      setError('회사명과 회사 코드를 모두 입력해 주세요.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(code)) {
      setError('회사 코드에는 영문 소문자·숫자·하이픈(-)만 쓸 수 있어요.');
      return;
    }
    if (!Number.isFinite(editing.sort_order)) {
      setError('표시 순서는 숫자로 입력해 주세요.');
      return;
    }
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setBusyId(editing.id);
    const { error: updErr } = await supabase
      .from('companies')
      .update({ name, code, sort_order: editing.sort_order, updated_at: new Date().toISOString() })
      .eq('id', editing.id);
    setBusyId(null);
    if (updErr) {
      setError(toKoreanError(updErr.message, updErr.code));
      return;
    }
    await logAudit('COMPANY_UPDATED', 'companies', editing.id, { code });
    setEditing(null);
    setNotice(`${name} 계열사 정보를 수정했어요.`);
    await reload();
  }

  async function handleToggleActive(row: CompanyRow) {
    setError('');
    setNotice('');
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setBusyId(row.id);
    const { error: updErr } = await supabase
      .from('companies')
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setBusyId(null);
    if (updErr) {
      setError(toKoreanError(updErr.message, updErr.code));
      return;
    }
    await logAudit('COMPANY_UPDATED', 'companies', row.id, { active: !row.active });
    setNotice(
      row.active
        ? `${row.name}을(를) 비활성으로 바꿨어요. 새 SME·직무 등록에서 더 이상 고를 수 없습니다(기존 데이터는 그대로 남습니다).`
        : `${row.name}을(를) 다시 활성으로 바꿨어요.`,
    );
    await reload();
  }

  const busy = creating || busyId !== null;

  return (
    <section className="rounded-container border border-border bg-card p-5 shadow-1">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 t-label font-semibold text-foreground">
            <Building2 size={16} className="text-primary" aria-hidden="true" /> 계열사 관리
          </h3>
          <p className="mt-1 t-caption leading-5 text-foreground-muted">
            여기서 추가한 회사가 SME 계정 등록·직무정보 업로드·운영 설정의 회사 목록에 나옵니다. 이 섹션은 회사
            선택과 무관하게 늘 전체 목록을 보여 줍니다.
          </p>
        </div>
        {!adding && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAdding(true);
              setError('');
              setNotice('');
            }}
            disabled={busy}
          >
            <Plus size={15} aria-hidden="true" /> 계열사 추가
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3.5 py-2.5 t-label text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 rounded-element border border-success-border bg-success-muted px-3.5 py-2.5 t-label text-success"
        >
          <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {adding && (
        <div className="mb-4 rounded-element border border-primary-border bg-primary-subtle p-4">
          <p className="mb-3 t-label font-medium text-foreground">새 계열사</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="회사명" required value={newName} onChange={setNewName} placeholder="예: 서연오토비전" />
            <Field
              label="회사 코드"
              required
              description="영문 소문자·숫자·하이픈. 업로드 파일과 맞춰야 하는 식별자예요."
              value={newCode}
              onChange={setNewCode}
              placeholder="예: seoyeon-autovision"
              autoComplete="off"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAdding(false);
                setNewName('');
                setNewCode('');
              }}
              disabled={creating}
            >
              취소
            </Button>
            <Button size="sm" onClick={() => void handleCreate()} loading={creating}>
              {creating ? '추가 중...' : '계열사 추가'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton.Table rows={4} cols={4} />
      ) : loadError ? (
        <FallbackView
          kind="error"
          heading="계열사 목록을 불러오지 못했어요"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              <RotateCw size={14} aria-hidden="true" /> 다시 불러오기
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="계열사 목록"
          minWidth="640px"
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <FallbackView
              heading="등록된 계열사가 없어요"
              description="「계열사 추가」로 첫 회사를 만들어 주세요. 회사가 없으면 SME 계정도 직무도 등록할 수 없습니다."
            />
          }
          columns={[
            {
              key: 'name',
              header: '회사명',
              mobile: 'title',
              cell: (r) =>
                editing?.id === r.id ? (
                  <input
                    className="input"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    aria-label="회사명"
                  />
                ) : (
                  <span className="font-medium text-foreground">{r.name}</span>
                ),
            },
            {
              key: 'code',
              header: '회사 코드',
              cell: (r) =>
                editing?.id === r.id ? (
                  <input
                    className="input"
                    value={editing.code}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    aria-label="회사 코드"
                    autoComplete="off"
                  />
                ) : (
                  <span className="font-mono t-caption text-foreground-muted">{r.code}</span>
                ),
            },
            {
              key: 'sort_order',
              header: '표시 순서',
              cell: (r) =>
                editing?.id === r.id ? (
                  <input
                    className="input"
                    type="number"
                    value={String(editing.sort_order)}
                    onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                    aria-label="표시 순서"
                  />
                ) : (
                  r.sort_order
                ),
            },
            {
              key: 'active',
              header: '상태',
              mobile: 'trailing',
              cell: (r) => <StatusBadge status={r.active ? '활성' : '비활성'} domain="account" size="sm" />,
            },
            {
              key: 'manage',
              header: '관리',
              align: 'center',
              mobile: 'trailing',
              cell: (r) => (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {editing?.id === r.id ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busyId === r.id}>
                        취소
                      </Button>
                      <Button size="sm" onClick={() => void handleSaveEdit()} loading={busyId === r.id}>
                        저장
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditing({ ...r });
                          setError('');
                          setNotice('');
                        }}
                        disabled={busy || editing !== null}
                      >
                        수정
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleToggleActive(r)}
                        loading={busyId === r.id}
                        disabled={busy || editing !== null}
                      >
                        {r.active ? '비활성화' : '활성화'}
                      </Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <p className="mt-3 t-caption leading-5 text-foreground-subtle">
        삭제는 화면에 두지 않았습니다. 계열사를 지우면 그 회사의 직무·계정·설정이 함께 사라지거나 외래키 제약으로
        실패합니다. 실제 삭제가 필요하면 운영 절차서(docs/OPERATIONS.md)의 SQL 절차로 진행해 주세요.
      </p>
    </section>
  );
}
