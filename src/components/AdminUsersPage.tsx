// 관리자 계정 관리 — 관리자(ADMIN) 화면.
// 모달 안에서 벌어진 실패는 모달 안에서 보여 준다(모달 뒤 토스트로 보내면 사실상 보이지 않는다).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, RotateCw, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { resetRedirectUrl, supabase } from '@/lib/supabase';
import { fetchCompaniesResult, type Company } from '@/lib/jobApi';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { callAdminFn, errorMessage } from '@/components/modals/edgeApi';
import { AccountAdminPanel } from '@/components/modals/AccountAdminPanel';

interface User {
  id: string;
  name: string;
  email: string;
  organization: string;
  title: string;
  role: string;
  company?: string;
}

interface AdminProfile {
  id: string;
  name: string;
  email: string;
  active: boolean;
  created_at: string;
  /** 관리자도 소속·직급·사번·회사를 가질 수 있다(기획서 §3 F8). 없으면 빈 문자열·null이다. */
  organization: string;
  title: string;
  employee_number: string;
  company_id: string | null;
  /** undefined = 아직 확인 전. 확인 전에는 '로그인 가능'으로 보수적으로 간주한다. */
  hasAuth?: boolean;
}

interface Props {
  currentUser: User;
}

function Alert({ tone, children }: { tone: 'error' | 'warning' | 'success'; children: React.ReactNode }) {
  const styles = {
    error: 'border-destructive-border bg-destructive-muted text-destructive',
    warning: 'border-warning-border bg-warning-muted text-warning',
    success: 'border-success-border bg-success-muted text-success',
  }[tone];
  const Icon = tone === 'success' ? ShieldCheck : AlertTriangle;
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-element border px-3.5 py-2.5 t-label ${styles}`}>
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AdminUsersPage({ currentUser }: Props) {
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  /**
   * 관리 모달의 대상은 id로만 들고 있다. 객체 스냅샷을 들고 있으면 모달 안에서 역할·상태를 바꿔
   * 목록을 새로고침해도 모달은 예전 값을 계속 보여 준다(기획서 §3 F5·F6이 필요한 그 자리다).
   */
  const [manageId, setManageId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const { toast, showToast, dismiss } = useToast();

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    if (!supabase) {
      setLoading(false);
      setLoadError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, active, created_at, organization, title, employee_number, company_id')
      .eq('role', 'admin')
      .order('created_at', { ascending: true });
    if (error) {
      // 조회 실패를 '계정 0건'으로 보여 주지 않는다.
      setAdmins([]);
      setLoadError(`관리자 목록을 불러오지 못했어요. (${error.message}) 잠시 후 다시 시도해 주세요.`);
      setLoading(false);
      return;
    }
    // 컬럼이 NULL인 계정이 있다(관리자는 소속·사번 없이 만들어진다). 빈 문자열로 정규화해
    // 입력 칸이 value={null}로 비제어 전환되는 것을 막는다.
    setAdmins(
      (data || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        email: p.email as string,
        active: p.active as boolean,
        created_at: (p.created_at as string) || '',
        organization: (p.organization as string) || '',
        title: (p.title as string) || '',
        employee_number: (p.employee_number as string) || '',
        company_id: (p.company_id as string) || null,
      })),
    );
    setLoading(false);

    // 로그인 계정(auth) 존재 여부는 Edge Function으로 따로 확인한다.
    try {
      const checkData = await callAdminFn<{ profiles?: { id: string; hasAuth: boolean }[] }>({ mode: 'check-auth' });
      if (Array.isArray(checkData.profiles)) {
        const authMap = new Map(checkData.profiles.map((p) => [p.id, p.hasAuth]));
        setAdmins((prev) => prev.map((a) => ({ ...a, hasAuth: authMap.get(a.id) ?? false })));
      }
    } catch (err) {
      console.error('check-auth failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  // 회사 목록은 관리자 계정의 소속 회사 지정(F8)과 SME 강등 가능 여부 판정에 쓴다.
  // 실패하면 선택 칸이 비지만 이름·비밀번호 같은 나머지 조작은 그대로 되어야 하므로 화면을 막지 않는다.
  useEffect(() => {
    void fetchCompaniesResult().then((res) => setCompanies(res.ok ? res.data : []));
  }, []);

  function formatDate(d: string) {
    try {
      const dt = new Date(d);
      return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
    } catch {
      return d;
    }
  }

  // 로그인 계정이 없는 프로필은 '활성'이어도 실제로는 로그인할 수 없다 — 이 수를 기준으로 막는다.
  const loginableCount = admins.filter((a) => a.active && a.hasAuth !== false).length;

  const manageTarget = manageId ? admins.find((a) => a.id === manageId) : undefined;

  function closeManage(msg?: string) {
    setManageId(null);
    if (msg) {
      fetchAdmins();
      showToast({ type: 'success', msg });
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="t-heading text-foreground">관리자 계정 관리</h2>
          <p className="mt-1 t-label text-foreground-muted">시스템 관리자 계정을 등록하고 관리합니다.</p>
        </div>
        <Button onClick={() => setShowRegister(true)}>
          <Plus size={16} aria-hidden="true" /> 관리자 계정 등록
        </Button>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {/* v2 §6-5: 표를 공용 DataTable로 옮겼다 — 좁은 화면에서 가로 스크롤 대신 줄 목록(ListCell)이 된다. */}
      {loading ? (
        <Skeleton.Table rows={4} cols={5} />
      ) : loadError ? (
        <FallbackView
          kind="error"
          heading="관리자 목록을 불러오지 못했어요"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={fetchAdmins}>
              <RotateCw size={14} aria-hidden="true" /> 다시 불러오기
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="관리자 계정 목록"
          minWidth="720px"
          rows={admins}
          rowKey={(a) => a.id}
          empty={
            <FallbackView
              heading="등록된 관리자 계정이 없어요"
              description="「관리자 계정 등록」으로 첫 계정을 만들어 주세요."
            />
          }
          columns={[
            {
              key: 'name',
              header: '이름',
              mobile: 'title',
              cell: (a) => (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{a.name}</span>
                  {a.id === currentUser.id && (
                    <span className="rounded-inner bg-primary-subtle px-2 py-0.5 t-caption font-medium text-primary">
                      현재 로그인
                    </span>
                  )}
                </div>
              ),
            },
            { key: 'email', header: '이메일', cell: (a) => a.email },
            {
              key: 'status',
              header: '상태',
              mobile: 'trailing',
              cell: (a) => (
                <div className="flex flex-col gap-1">
                  <StatusBadge status={a.active ? '활성' : '비활성'} domain="account" size="sm" />
                  {/*
                    로그인 계정(auth)만 없는 프로필. 화면에서 재생성하면 profile.id ≠ auth.uid인 계정이
                    생겨 로그인 자체가 막혔다(v2 F3). 그래서 복구 경로는 문서화된 SQL 절차 하나로 둔다.
                  */}
                  {a.hasAuth === false && (
                    <span
                      title="supabase/BOOTSTRAP_2026-09-02_admin.sql 절차로 복구해 주세요."
                      className="flex w-fit items-center gap-1 rounded-inner bg-warning-muted px-2 py-0.5 t-caption font-medium text-warning"
                    >
                      <AlertTriangle size={12} aria-hidden="true" /> 로그인 계정 미생성 · SQL 복구 필요
                    </span>
                  )}
                </div>
              ),
            },
            { key: 'created', header: '등록일', cell: (a) => formatDate(a.created_at) },
            {
              key: 'manage',
              header: '관리',
              align: 'center',
              mobile: 'trailing',
              cell: (a) => (
                <Button variant="secondary" size="sm" onClick={() => setManageId(a.id)}>
                  관리
                </Button>
              ),
            },
          ]}
        />
      )}

      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSuccess={(loginId) => {
            setShowRegister(false);
            // 로그인 ID를 함께 알린다 — 이메일 대신 ID를 넣으면 서버가 도메인을 붙이므로
            // 실제로 로그인할 주소가 입력값과 다르다.
            showToast({ type: 'success', msg: `관리자 계정을 등록했어요. 로그인 ID: ${loginId}` });
            fetchAdmins();
          }}
        />
      )}


      {manageTarget && (
        <ManageModal
          // key로 대상을 고정한다 — 다른 행의 '관리'를 눌렀을 때 입력 칸이 예전 계정 값을 들고 있지 않게.
          key={manageTarget.id}
          admin={manageTarget}
          companies={companies}
          isSelf={manageTarget.id === currentUser.id}
          isLastLoginable={manageTarget.active && manageTarget.hasAuth !== false && loginableCount <= 1}
          onClose={closeManage}
          onRefresh={fetchAdmins}
        />
      )}
    </div>
  );
}

// ── 관리자 계정 등록 ─────────────────────────────────────────

const REGISTER_FORM_ID = 'admin-register-form';

function RegisterModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (loginId: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (!name.trim() || !email.trim() || !password) {
      setLocalError('이름, 이메일(또는 로그인 ID), 비밀번호를 모두 입력해 주세요.');
      return;
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await callAdminFn<{ email?: string }>({ name: name.trim(), email: email.trim(), password });
      onSuccess(res.email || email.trim().toLowerCase());
    } catch (err) {
      setLocalError(errorMessage(err, '관리자 계정을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="관리자 계정 등록"
      icon={<UserCog size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={onClose}
      // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
      hideClose
      // 여러 필드·목록을 담는 폼이라 large(480px)를 쓴다. montage medium(400px)은 모바일 폭 기준이다.
      size="lg"
      dirty={Boolean(name || email || password) && !submitting}
      closeDisabled={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button type="submit" form={REGISTER_FORM_ID} loading={submitting}>
            {submitting ? '등록 중...' : '관리자 계정 등록'}
          </Button>
        </>
      }
    >
      <form id={REGISTER_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
        <Field label="이름" required value={name} onChange={setName} placeholder="이름을 입력해 주세요" />
        {/* 메일 주소가 없는 파일럿 계정을 위해 로그인 ID도 받는다(2026-09-03 결정).
            type을 email로 두면 'hcg-admin' 같은 ID에서 브라우저 기본 검증이 제출을 막는다. */}
        <Field
          label="이메일 또는 로그인 ID"
          required
          description="메일 주소가 없으면 영문·숫자 ID만 넣어 주세요. 로그인은 ID@seoyoneh.local 로 합니다."
          type="text"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com 또는 hcg-admin"
          autoComplete="off"
        />
        {/*
          감싼 div는 눈 아이콘 버튼을 겹쳐 놓기 위해 필요하다. 그래서 div를 없애는 대신
          함수형 children으로 라벨·설명(aria-describedby)·필수 여부의 연결 대상만 입력 칸으로 내렸다.
          (예전에는 Field가 이 div에 id를 달아 라벨이 div를 가리키고, 비밀번호 규칙 설명이 입력 칸에 닿지 않았다.)
        */}
        <Field label="비밀번호" required description="8자 이상, 영문과 숫자를 포함해 주세요.">
          {(a11y) => (
            <div className="relative">
              <input
                {...a11y}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력해 주세요"
                autoComplete="new-password"
                className="input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-element text-foreground-subtle transition hover:text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          )}
        </Field>

        {localError && <Alert tone="error">{localError}</Alert>}
      </form>
    </ModalShell>
  );
}

// ── 관리자 계정 관리 ─────────────────────────────────────────

function ManageModal({
  admin,
  companies,
  isSelf,
  isLastLoginable,
  onClose,
  onRefresh,
}: {
  admin: AdminProfile;
  companies: Company[];
  isSelf: boolean;
  /** 이 계정을 비활성화·강등·삭제하면 로그인 가능한 관리자가 0명이 된다. */
  isLastLoginable: boolean;
  /** msg를 주면 목록 새로고침 + 성공 토스트, 없으면 조용히 닫는다. */
  onClose: (msg?: string) => void;
  /** 모달을 닫지 않고 목록만 다시 불러온다(전권 패널이 쓴다). */
  onRefresh: () => void;
}) {
  const [editName, setEditName] = useState(admin.name);
  const [editCompany, setEditCompany] = useState(admin.company_id || '');
  const [editOrg, setEditOrg] = useState(admin.organization);
  const [editTitle, setEditTitle] = useState(admin.title);
  const [editEmpNum, setEditEmpNum] = useState(admin.employee_number);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 전권 패널이 요청을 도는 동안 닫기·저장을 잠근다(임시 비밀번호가 화면에 남아 있어야 한다).
  const [panelBusy, setPanelBusy] = useState(false);

  const dirty =
    editName.trim() !== admin.name ||
    editCompany !== (admin.company_id || '') ||
    editOrg !== admin.organization ||
    editTitle !== admin.title ||
    editEmpNum !== admin.employee_number;
  const busy = saving || deleting || resetting || panelBusy;
  // 삭제만 이 사유로 막는다. 비활성화·역할 변경은 전권 패널이 같은 규칙으로 스스로 판정한다.
  const deleteBlockReason = isSelf
    ? '현재 로그인한 계정이에요. 삭제할 수 없어요.'
    : isLastLoginable
      ? '로그인할 수 있는 마지막 관리자예요. 다른 관리자를 먼저 활성화한 뒤에 삭제해 주세요.'
      : '';

  /** 이름·회사·조직·직급·사번을 한 번에 저장한다(기획서 §3 F8 — 예전에는 이름만 고칠 수 있었다). */
  async function handleSaveProfile() {
    setError('');
    setNotice('');
    if (!editName.trim()) {
      setError('이름을 입력해 주세요.');
      return;
    }
    if (!dirty) {
      // 바뀐 게 없으면 "저장했습니다"를 띄우지 않는다.
      onClose();
      return;
    }
    setSaving(true);
    try {
      // 모드 이름은 update-sme지만 서버가 role을 보지 않아 관리자 계정에도 그대로 쓴다.
      await callAdminFn({
        mode: 'update-sme',
        profileId: admin.id,
        name: editName.trim(),
        // 관리자는 회사가 없어도 된다(계열사 전체를 본다). 빈 값은 서버에서 null이 된다.
        company_id: editCompany,
        organization: editOrg,
        title: editTitle,
        employee_number: editEmpNum,
      });
      onClose('관리자 계정 정보를 수정했어요.');
    } catch (err) {
      setError(errorMessage(err, '계정 정보를 수정하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setSaving(false);
    }
  }

  /**
   * 재설정 메일. 관리자가 값을 알 필요가 없을 때(실제 메일 주소가 있는 계정) 이쪽이 낫다.
   * 다만 파일럿 로그인 ID(@seoyoneh.local)는 메일이 닿지 않으므로 그때는 아래 전권 패널의
   * 「임시 비밀번호 발급」을 쓴다 — 그 사유를 문구로 적어 둔다.
   */
  async function handleResetPassword() {
    setError('');
    setNotice('');
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setResetting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(admin.email, {
      redirectTo: resetRedirectUrl(),
    });
    setResetting(false);
    if (resetError) {
      setError('비밀번호 재설정 메일을 보내지 못했어요. 잠시 후 다시 시도하거나 메일 발송 설정을 확인해 주세요.');
      return;
    }
    setNotice(`${admin.email} 으로 비밀번호 재설정 메일을 보냈어요. 메일의 링크에서 새 비밀번호를 지정하면 됩니다.`);
  }

  async function handleDelete() {
    setError('');
    setDeleting(true);
    try {
      await callAdminFn({ mode: 'delete', profileId: admin.id });
      onClose('관리자 계정을 삭제했어요.');
    } catch (err) {
      setError(errorMessage(err, '계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setDeleting(false);
    }
  }

  return (
    <ModalShell
      title="관리자 계정 관리"
      description="소속 정보와 비밀번호·로그인 ID·역할·상태까지 이 창에서 모두 바꿉니다."
      icon={<UserCog size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={() => onClose()}
      // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
      hideClose
      // 여러 필드·목록을 담는 폼이라 large(480px)를 쓴다. montage medium(400px)은 모바일 폭 기준이다.
      size="lg"
      dirty={dirty && !busy}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
            취소
          </Button>
          <Button onClick={handleSaveProfile} loading={saving} disabled={busy && !saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {admin.hasAuth === false && (
          <Alert tone="warning">
            이 프로필에는 로그인 계정(auth)이 없어 비밀번호·로그인 ID를 바꿀 수 없어요.
            supabase/BOOTSTRAP_2026-09-02_admin.sql 절차로 먼저 복구해 주세요.
          </Alert>
        )}

        <Field label="이름" required value={editName} onChange={setEditName} />

        <Field label="소속 회사 (선택)" description="비워 두면 계열사 전체를 담당하는 관리자입니다.">
          {(a11y) => (
            <select
              {...a11y}
              value={editCompany}
              onChange={(e) => setEditCompany(e.target.value)}
              className="input"
              disabled={busy}
            >
              <option value="">회사 미지정 (전체 담당)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="조직" value={editOrg} onChange={setEditOrg} placeholder="예: 인사기획팀" />
          <Field label="직급" value={editTitle} onChange={setEditTitle} placeholder="예: 팀장" />
        </div>
        <Field label="사번" value={editEmpNum} onChange={setEditEmpNum} placeholder="사번" />

        {/* 비밀번호 재설정 · 로그인 ID · 역할 · 활성 (기획서 §3 F1~F6).
            SME 계정 관리 화면과 같은 컴포넌트를 쓴다. */}
        <AccountAdminPanel
          target={{
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: 'admin',
            active: admin.active,
            companyId: admin.company_id,
          }}
          isSelf={isSelf}
          isLastLoginableAdmin={isLastLoginable}
          onRefresh={onRefresh}
          onBusyChange={setPanelBusy}
        />

        <div className="border-t border-border pt-4">
          <span className="mb-1.5 block t-label font-medium text-foreground">비밀번호 재설정 메일</span>
          <p className="mb-2 t-caption leading-5 text-foreground-muted">
            실제 메일 주소를 쓰는 계정이라면 이쪽이 낫습니다 — 본인만 새 비밀번호를 알게 됩니다. 파일럿 로그인
            ID(@seoyoneh.local)는 메일이 닿지 않으니 위의 「임시 비밀번호 발급」을 써 주세요.
          </p>
          <Button variant="secondary" size="sm" onClick={handleResetPassword} loading={resetting} disabled={busy}>
            <KeyRound size={15} aria-hidden="true" /> 비밀번호 재설정 메일 보내기
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          {deleteBlockReason && <Alert tone="warning">{deleteBlockReason}</Alert>}
          {!confirmDelete ? (
            <Button
              variant="danger"
              className={deleteBlockReason ? 'mt-3' : undefined}
              onClick={() => setConfirmDelete(true)}
              disabled={busy || Boolean(deleteBlockReason)}
            >
              <Trash2 size={15} aria-hidden="true" /> 관리자 계정 삭제
            </Button>
          ) : (
            <div className="mt-3 rounded-element border border-destructive-border bg-destructive-muted p-4">
              <div className="flex items-start gap-2 t-label text-destructive">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>관리자 계정을 삭제할까요? 삭제하면 해당 계정으로 더 이상 로그인할 수 없어요.</p>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  취소
                </Button>
                <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
