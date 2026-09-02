// 관리자 계정 관리 — 관리자(ADMIN) 화면.
// 모달 안에서 벌어진 실패는 모달 안에서 보여 준다(모달 뒤 토스트로 보내면 사실상 보이지 않는다).
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, RotateCw, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import { Toast, useToast } from '@/components/ui/Toast';
import { callAdminFn, errorMessage } from '@/components/modals/edgeApi';

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
    <div role="alert" className={`flex items-start gap-2 rounded-element border px-3.5 py-2.5 text-sm ${styles}`}>
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
  const [showManage, setShowManage] = useState<AdminProfile | null>(null);
  const [showRecreate, setShowRecreate] = useState<AdminProfile | null>(null);
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
      .select('id, name, email, active, created_at')
      .eq('role', 'admin')
      .order('created_at', { ascending: true });
    if (error) {
      // 조회 실패를 '계정 0건'으로 보여 주지 않는다.
      setAdmins([]);
      setLoadError(`관리자 목록을 불러오지 못했어요. (${error.message}) 잠시 후 다시 시도해 주세요.`);
      setLoading(false);
      return;
    }
    setAdmins((data || []) as AdminProfile[]);
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

  function closeManage(msg?: string) {
    setShowManage(null);
    if (msg) {
      fetchAdmins();
      showToast({ type: 'success', msg });
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">관리자 계정 관리</h2>
          <p className="mt-1 text-sm text-foreground-muted">시스템 관리자 계정을 등록하고 관리합니다.</p>
        </div>
        <Button onClick={() => setShowRegister(true)}>
          <Plus size={16} aria-hidden="true" /> 관리자 계정 등록
        </Button>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      <div className="overflow-x-auto rounded-container border border-border bg-card shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-foreground-muted">
                이름
              </th>
              <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-foreground-muted">
                이메일
              </th>
              <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-foreground-muted">
                상태
              </th>
              <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-foreground-muted">
                등록일
              </th>
              <th scope="col" className="px-6 py-3.5 text-center text-xs font-semibold text-foreground-muted">
                관리
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-foreground-subtle">
                  불러오는 중…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <AlertTriangle size={22} className="mx-auto mb-3 text-destructive" aria-hidden="true" />
                  <p className="mb-3 text-sm text-destructive">{loadError}</p>
                  <Button variant="secondary" size="sm" onClick={fetchAdmins}>
                    <RotateCw size={14} aria-hidden="true" /> 다시 불러오기
                  </Button>
                </td>
              </tr>
            ) : admins.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-foreground-subtle">
                  등록된 관리자 계정이 없어요.
                </td>
              </tr>
            ) : (
              admins.map((a) => (
                <tr key={a.id} className="border-b border-border transition hover:bg-muted">
                  <th scope="row" className="px-6 py-4 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{a.name}</span>
                      {a.id === currentUser.id && (
                        <span className="rounded-inner bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
                          현재 로그인
                        </span>
                      )}
                    </div>
                  </th>
                  <td className="px-6 py-4 text-foreground-muted">{a.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${
                          a.active ? 'bg-success-muted text-success' : 'bg-muted text-foreground-muted'
                        }`}
                      >
                        {a.active ? '● 활성' : '○ 비활성'}
                      </span>
                      {a.hasAuth === false && (
                        <span className="flex w-fit items-center gap-1 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning">
                          <AlertTriangle size={12} aria-hidden="true" /> 로그인 계정 미생성
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-foreground-muted">{formatDate(a.created_at)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-2">
                      {a.hasAuth === false && (
                        <Button variant="secondary" size="sm" onClick={() => setShowRecreate(a)}>
                          로그인 계정 재생성
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onClick={() => setShowManage(a)}>
                        관리
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSuccess={() => {
            setShowRegister(false);
            showToast({ type: 'success', msg: '관리자 계정을 등록했어요.' });
            fetchAdmins();
          }}
        />
      )}

      {showRecreate && (
        <RecreateAuthModal
          admin={showRecreate}
          onClose={() => setShowRecreate(null)}
          onSuccess={() => {
            setShowRecreate(null);
            showToast({ type: 'success', msg: '로그인 계정을 생성했어요.' });
            fetchAdmins();
          }}
        />
      )}

      {showManage && (
        <ManageModal
          admin={showManage}
          isSelf={showManage.id === currentUser.id}
          isLastLoginable={showManage.active && showManage.hasAuth !== false && loginableCount <= 1}
          onClose={closeManage}
        />
      )}
    </div>
  );
}

// ── 관리자 계정 등록 ─────────────────────────────────────────

const REGISTER_FORM_ID = 'admin-register-form';

function RegisterModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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
      setLocalError('이름, 이메일, 비밀번호를 모두 입력해 주세요.');
      return;
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      await callAdminFn({ name: name.trim(), email: email.trim(), password });
      onSuccess();
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
        <Field
          label="이메일"
          required
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com"
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
  isSelf,
  isLastLoginable,
  onClose,
}: {
  admin: AdminProfile;
  isSelf: boolean;
  /** 이 계정을 비활성화·삭제하면 로그인 가능한 관리자가 0명이 된다. */
  isLastLoginable: boolean;
  /** msg를 주면 목록 새로고침 + 성공 토스트, 없으면 조용히 닫는다. */
  onClose: (msg?: string) => void;
}) {
  const [editName, setEditName] = useState(admin.name);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const nameChanged = editName.trim() !== admin.name;
  const busy = saving || toggling || deleting || resetting;
  const blockReason = isSelf
    ? '현재 로그인한 계정이에요. 비활성화하거나 삭제할 수 없어요.'
    : isLastLoginable
      ? '로그인할 수 있는 마지막 관리자예요. 다른 관리자를 먼저 활성화한 뒤에 변경해 주세요.'
      : '';

  async function handleSaveName() {
    setError('');
    setNotice('');
    if (!editName.trim()) {
      setError('이름을 입력해 주세요.');
      return;
    }
    if (!nameChanged) {
      // 바뀐 게 없으면 "업데이트되었습니다"를 띄우지 않는다.
      onClose();
      return;
    }
    setSaving(true);
    try {
      await callAdminFn({ mode: 'update', profileId: admin.id, name: editName.trim() });
      onClose('관리자 이름을 수정했어요.');
    } catch (err) {
      setError(errorMessage(err, '이름을 수정하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    setError('');
    setNotice('');
    // 비활성화만 막는다(활성화는 언제든 허용).
    if (admin.active && blockReason) {
      setError(blockReason);
      return;
    }
    setToggling(true);
    try {
      await callAdminFn({ mode: 'toggle-active', profileId: admin.id, active: !admin.active });
      onClose(admin.active ? '관리자 계정을 비활성화했어요.' : '관리자 계정을 활성화했어요.');
    } catch (err) {
      setError(errorMessage(err, '상태를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setToggling(false);
    }
  }

  async function handleResetPassword() {
    setError('');
    setNotice('');
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setResetting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(admin.email, {
      redirectTo: window.location.origin,
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
      icon={<UserCog size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={() => onClose()}
      dirty={nameChanged && !busy}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
            취소
          </Button>
          <Button onClick={handleSaveName} loading={saving} disabled={busy && !saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {blockReason && <Alert tone="warning">{blockReason}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <Field label="이름" required value={editName} onChange={setEditName} />
        <Field
          label="이메일"
          description="이메일은 변경할 수 없어요."
          value={admin.email}
          onChange={() => {}}
          disabled
        />

        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">상태</span>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                admin.active ? 'bg-success-muted text-success' : 'bg-muted text-foreground-muted'
              }`}
            >
              {admin.active ? '● 활성' : '○ 비활성'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleToggleActive}
              loading={toggling}
              disabled={busy || (admin.active && Boolean(blockReason))}
            >
              {admin.active ? '비활성화' : '활성화'}
            </Button>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <span className="mb-1.5 block text-sm font-medium text-foreground">비밀번호</span>
          <p className="mb-2 text-xs leading-5 text-foreground-muted">
            비밀번호는 본인만 지정할 수 있어요. 재설정 메일을 보내면 해당 관리자가 링크에서 새 비밀번호를 정합니다.
          </p>
          <Button variant="secondary" size="sm" onClick={handleResetPassword} loading={resetting} disabled={busy}>
            <KeyRound size={15} aria-hidden="true" /> 비밀번호 재설정 메일 보내기
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          {!confirmDelete ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy || Boolean(blockReason)}>
              <Trash2 size={15} aria-hidden="true" /> 관리자 계정 삭제
            </Button>
          ) : (
            <div className="rounded-element border border-destructive-border bg-destructive-muted p-4">
              <div className="flex items-start gap-2 text-sm text-destructive">
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

// ── 로그인 계정 재생성 ───────────────────────────────────────

const RECREATE_FORM_ID = 'admin-recreate-form';

function RecreateAuthModal({
  admin,
  onClose,
  onSuccess,
}: {
  admin: AdminProfile;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      await callAdminFn({
        mode: 'recreate-auth',
        profileId: admin.id,
        email: admin.email,
        password,
        name: admin.name,
      });
      onSuccess();
    } catch (err) {
      setLocalError(errorMessage(err, '로그인 계정을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.'));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="로그인 계정 재생성"
      icon={<UserCog size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={onClose}
      dirty={Boolean(password) && !submitting}
      closeDisabled={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button type="submit" form={RECREATE_FORM_ID} loading={submitting}>
            {submitting ? '생성 중...' : '로그인 계정 생성'}
          </Button>
        </>
      }
    >
      <form id={RECREATE_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
        <Alert tone="warning">이 계정에는 로그인 계정이 없어요. 새 비밀번호로 로그인 계정을 만듭니다.</Alert>
        <Field label="이름" value={admin.name} onChange={() => {}} disabled />
        <Field label="이메일" value={admin.email} onChange={() => {}} disabled />
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
