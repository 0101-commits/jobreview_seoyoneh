import { useEffect, useState, useCallback } from 'react';
import { UserCog, Plus, X, Eye, EyeOff, Loader2, ShieldCheck, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
  hasAuth?: boolean;
}

interface Props {
  currentUser: User;
}

export function AdminUsersPage({ currentUser }: Props) {
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [showManage, setShowManage] = useState<AdminProfile | null>(null);
  const [showRecreate, setShowRecreate] = useState<AdminProfile | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    if (!supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, email, active, created_at')
      .eq('role', 'admin')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('fetch admins failed:', error);
      setLoading(false);
      return;
    }
    const profiles = (data || []) as AdminProfile[];
    setAdmins(profiles);
    setLoading(false);

    // Check auth status via edge function
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ mode: 'check-auth' }),
      });
      const checkData = await res.json();
      if (checkData.success && Array.isArray(checkData.profiles)) {
        const authMap = new Map<string, boolean>();
        for (const p of checkData.profiles) {
          authMap.set(p.id, p.hasAuth);
        }
        setAdmins((prev) => prev.map((a) => ({ ...a, hasAuth: authMap.get(a.id) ?? false })));
      }
    } catch (err) {
 console.error('check-auth failed:', err); }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function formatDate(d: string) {
    try {
      const dt = new Date(d);
      return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
    } catch { return d; }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">관리자 계정 관리</h2>
          <p className="mt-1 text-sm text-slate-500">시스템 관리자 계정을 등록하고 관리합니다.</p>
        </div>
        <button
          onClick={() => setShowRegister(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867]"
        >
          <Plus size={16} /> 관리자 계정 등록
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500">이름</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500">이메일</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500">상태</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500">등록일</th>
              <th className="px-6 py-3.5 text-center text-xs font-semibold text-slate-500">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">불러오는 중…</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">등록된 관리자 계정이 없습니다.</td></tr>
            ) : admins.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 transition hover:bg-slate-50/50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{a.name}</span>
                    {a.id === currentUser.id && (
                      <span className="rounded bg-[#edf8f7] px-2 py-0.5 text-[11px] font-medium text-[#247d7c]">현재 로그인</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">{a.email}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium w-fit ${a.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {a.active ? '활성' : '비활성'}
                    </span>
                    {a.hasAuth === false && (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 w-fit">로그인 계정 미생성</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-500">{formatDate(a.created_at)}</td>
                <td className="px-6 py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    {a.hasAuth === false && (
                      <button
                        onClick={() => setShowRecreate(a)}
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
                      >
                        로그인 계정 재생성
                      </button>
                    )}
                    <button
                      onClick={() => setShowManage(a)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-[#247d7c] hover:text-[#247d7c]"
                    >
                      관리
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Register Modal */}
      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSuccess={() => {
            setShowRegister(false);
            setToast({ type: 'success', msg: '관리자 계정이 등록되었습니다.' });
            fetchAdmins();
          }}
          onError={(msg) => {
            setShowRegister(false);
            setToast({ type: 'error', msg });
          }}
        />
      )}

      {/* Recreate Auth Modal */}
      {showRecreate && (
        <RecreateAuthModal
          admin={showRecreate}
          onClose={() => setShowRecreate(null)}
          onSuccess={() => {
            setShowRecreate(null);
            setToast({ type: 'success', msg: '로그인 계정이 생성되었습니다.' });
            fetchAdmins();
          }}
          onError={(msg) => {
            setShowRecreate(null);
            setToast({ type: 'error', msg });
          }}
        />
      )}

      {/* Manage Modal */}
      {showManage && (
        <ManageModal
          admin={showManage}
          isSelf={showManage.id === currentUser.id}
          activeAdminCount={admins.filter(a => a.active).length}
          onClose={() => setShowManage(null)}
          onChanged={() => {
            setShowManage(null);
            fetchAdmins();
            setToast({ type: 'success', msg: '관리자 계정 정보가 업데이트되었습니다.' });
          }}
          onDeleted={() => {
            setShowManage(null);
            fetchAdmins();
            setToast({ type: 'success', msg: '관리자 계정이 삭제되었습니다.' });
          }}
          onError={(msg) => setToast({ type: 'error', msg })}
        />
      )}
    </div>
  );
}

// ── Register Modal ──────────────────────────────────────────

function RegisterModal({ onClose, onSuccess, onError }: {
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

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
      const { data: session } = await supabase!.auth.getSession();
      const token = session.session?.access_token;
      if (!token) { onError('관리자 계정 등록 중 오류가 발생했습니다.'); return; }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || '관리자 계정 등록 중 오류가 발생했습니다.';
        setLocalError(msg);
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      console.error('register admin failed:', err);
      setLocalError('관리자 계정 등록 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="관리자 계정 등록" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="이름">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름을 입력해 주세요"
            className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#247d7c]"
            autoFocus
          />
        </Field>
        <Field label="이메일">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#247d7c]"
          />
        </Field>
        <Field label="비밀번호">
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력해 주세요"
              className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-800 outline-none focus:border-[#247d7c]"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">8자 이상, 영문 및 숫자 포함</p>
        </Field>

        {localError && (
          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
            <AlertTriangle size={14} /> {localError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867] disabled:opacity-50"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? '등록 중...' : '관리자 계정 등록'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Manage Modal ─────────────────────────────────────────────

function ManageModal({ admin, isSelf, activeAdminCount, onClose, onChanged, onDeleted, onError }: {
  admin: AdminProfile;
  isSelf: boolean;
  activeAdminCount: number;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [editName, setEditName] = useState(admin.name);
  const [active, setActive] = useState(admin.active);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isLastActiveAdmin = activeAdminCount <= 1 && admin.active;

  async function callEdgeFunction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const { data: session } = await supabase!.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return { ok: false, error: '인증 정보를 확인할 수 없습니다.' };
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) return { ok: false, error: data.error || '오류가 발생했습니다.' };
    return { ok: true };
  }

  async function handleSaveName() {
    if (!editName.trim() || editName === admin.name) { onChanged(); return; }
    setSaving(true);
    try {
      const result = await callEdgeFunction({ mode: 'update', profileId: admin.id, name: editName.trim() });
      if (!result.ok) { onError(result.error || '이름 수정 중 오류가 발생했습니다.'); setSaving(false); return; }
      onChanged();
    } catch (err) {
      console.error('update admin name failed:', err);
      onError('이름 수정 중 오류가 발생했습니다.');
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    setToggling(true);
    try {
      const result = await callEdgeFunction({ mode: 'toggle-active', profileId: admin.id, active: !active });
      if (!result.ok) { onError(result.error || '상태 변경 중 오류가 발생했습니다.'); setToggling(false); return; }
      setActive(!active);
      onChanged();
    } catch (err) {
      console.error('toggle active failed:', err);
      onError('상태 변경 중 오류가 발생했습니다.');
      setToggling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await callEdgeFunction({ mode: 'delete', profileId: admin.id });
      if (!result.ok) { onError(result.error || '계정 삭제 중 오류가 발생했습니다.'); setDeleting(false); return; }
      onDeleted();
    } catch (err) {
      console.error('delete admin failed:', err);
      onError('계정 삭제 중 오류가 발생했습니다.');
      setDeleting(false);
    }
  }

  return (
    <ModalShell title="관리자 계정 관리" onClose={onClose}>
      <div className="space-y-5">
        {isSelf && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
            <ShieldCheck size={14} /> 현재 로그인한 계정입니다. 삭제하거나 비활성화할 수 없습니다.
          </div>
        )}

        <Field label="이름">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-[#247d7c]"
          />
        </Field>

        <Field label="이메일">
          <input
            value={admin.email}
            disabled
            className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">상태</span>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {active ? '활성' : '비활성'}
            </span>
            <button
              onClick={handleToggleActive}
              disabled={isSelf || isLastActiveAdmin || toggling}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {toggling ? '변경 중...' : active ? '비활성화' : '활성화'}
            </button>
          </div>
          {isSelf && <p className="mt-1.5 text-xs text-slate-400">현재 로그인한 계정은 비활성화할 수 없습니다.</p>}
          {isLastActiveAdmin && !isSelf && <p className="mt-1.5 text-xs text-slate-400">최소 1개의 활성 관리자 계정이 필요합니다.</p>}
        </div>

        {/* Delete section */}
        <div className="border-t border-slate-200 pt-4">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isSelf || deleting}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={15} /> 관리자 계정 삭제
            </button>
          ) : (
            <div className="rounded-md border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-2 text-sm text-red-700">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>관리자 계정을 삭제하시겠습니까? 삭제 후에는 해당 계정으로 로그인할 수 없습니다.</p>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting && <Loader2 size={15} className="animate-spin" />}
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={handleSaveName}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867] disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Recreate Auth Modal ──────────────────────────────────────

function RecreateAuthModal({ admin, onClose, onSuccess, onError }: {
  admin: AdminProfile;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: session } = await supabase!.auth.getSession();
      const token = session.session?.access_token;
      if (!token) { onError('로그인 계정 생성 중 오류가 발생했습니다.'); return; }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ mode: 'recreate-auth', profileId: admin.id, email: admin.email, password, name: admin.name }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setLocalError(data.error || '로그인 계정 생성 중 오류가 발생했습니다.');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      console.error('recreate auth failed:', err);
      setLocalError('로그인 계정 생성 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="로그인 계정 재생성" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={14} /> 이 계정은 로그인 계정이 없습니다. 새 비밀번호로 로그인 계정을 생성합니다.
        </div>
        <Field label="이름">
          <input value={admin.name} disabled className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500" />
        </Field>
        <Field label="이메일">
          <input value={admin.email} disabled className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500" />
        </Field>
        <Field label="비밀번호">
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력해 주세요"
              className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-800 outline-none focus:border-[#247d7c]"
            />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">8자 이상, 영문 및 숫자 포함</p>
        </Field>
        {localError && (
          <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-600">
            <AlertTriangle size={14} /> {localError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">취소</button>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1f6867] disabled:opacity-50">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? '생성 중...' : '로그인 계정 생성'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Shared UI ────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCog size={18} className="text-[#247d7c]" />
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
