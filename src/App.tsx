import { useEffect, useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeft, BarChart3, Check, ChevronDown, ChevronRight, ClipboardCheck,
  Download, FileSpreadsheet, Filter, LayoutDashboard, Loader2, LogOut, Menu, Plus,
  Search, Settings, ShieldCheck, Upload, Users, UserCog, X, Clock3, AlertTriangle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { UploadPage } from '@/components/UploadPage';
import { AdminUsersPage } from '@/components/AdminUsersPage';
import { fetchAllJobs, fetchJobDetail, fetchCompanies, exportAllJobsToExcel, fetchReviewStatus, mapReviewStatus, type JobListItem, type JobDetail, type Company, type ReviewStatusRow } from '@/lib/jobApi';
import { downloadSmeTemplate, validateSmeRows, parseWorkbook, sheetToRows, type SmeUploadRow, type SmeValidationResult } from '@/lib/uploadUtils';
import { JobDetailPage } from '@/components/JobDetailPage';
import { fetchFixedCompanyId } from '@/lib/integratedJobApi';

type Role = 'admin' | 'sme';
type Status = '미시작' | '작성 중' | '제출 완료' | '재검토 요청' | '재제출 완료';
type Suitability = '적합' | '일부 수정 필요' | '부적합' | '';

type Task = { id: string; name: string; description: string };
type Skill = { id: string; name: string; description: string };
type Job = { id: string; group: string; series: string; name: string; definition: string; tasks: Task[]; skills: Skill[] };

type Feedback = { suitability: Suitability; comment: string; suggestion: string; remove?: boolean };
type User = { id: string; name: string; email: string; organization: string; title: string; role: Role; company_id?: string | null; company_name?: string };

const statusStyle: Record<Status, string> = { '미시작': 'bg-slate-100 text-slate-600', '작성 중': 'bg-amber-50 text-amber-700', '제출 완료': 'bg-emerald-50 text-emerald-700', '재검토 요청': 'bg-rose-50 text-rose-700', '재제출 완료': 'bg-blue-50 text-blue-700' };

const adminPages = ['dashboard','reviews','jobs','upload','users','admin-users'] as const;
const smePages = ['review','history'] as const;
const adminHome = 'dashboard';
const smeHome = 'review';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all'); // admin company filter

  useEffect(() => {
    if (!supabase) { setBooting(false); return; }
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user) { setBooting(false); return; }
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (cancelled) return;
      if (!profile || !profile.active) { await supabase.auth.signOut(); setBooting(false); return; }
      const role = (profile.role === 'admin' ? 'admin' : 'sme') as Role;
      // Fetch company name if company_id exists
      let companyName = '';
      if (profile.company_id) {
        const { data: comp } = await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle();
        companyName = comp?.name || '';
      }
      setUser({ id: profile.id, name: profile.name, email: profile.email, organization: profile.organization, title: profile.title, role, company_id: profile.company_id || null, company_name: companyName });
      setPage(role === 'admin' ? adminHome : smeHome);
      setBooting(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function login(email: string, password: string) {
    setLoginError('');
    if (!supabase) { setLoginError('이메일 또는 비밀번호를 확인해 주세요.'); return; }
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.user) {
      console.error('Login failed:', error);
      setLoginError('이메일 또는 비밀번호를 확인해 주세요.');
      return;
    }
    const { data: profile, error: profileErr } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
    if (profileErr) console.error('Profile fetch failed:', profileErr);
    if (!profile) {
      setLoginError('사용자 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
      await supabase.auth.signOut();
      return;
    }
    if (!profile.active) {
      setLoginError('비활성화된 계정입니다. 관리자에게 문의해 주세요.');
      await supabase.auth.signOut();
      return;
    }
    const role = (profile.role === 'admin' ? 'admin' : 'sme') as Role;
      // Fetch company name if company_id exists
      let companyName = '';
      if (profile.company_id) {
        const { data: comp } = await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle();
        companyName = comp?.name || '';
      }
      setUser({ id: profile.id, name: profile.name, email: profile.email, organization: profile.organization, title: profile.title, role, company_id: profile.company_id || null, company_name: companyName });
      setPage(role === 'admin' ? adminHome : smeHome);
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setPage(adminHome);
  }

  if (booting) return <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] text-sm text-slate-400">불러오는 중…</div>;
  if (!user) return <Login onLogin={login} error={loginError} />;

  const allowed = user.role === 'admin' ? adminPages : smePages;
  if (!(allowed as readonly string[]).includes(page)) setPage(user.role === 'admin' ? adminHome : smeHome);
  const safePage = (allowed as readonly string[]).includes(page) ? page : (user.role === 'admin' ? adminHome : smeHome);
  const go = (next: string) => { if ((allowed as readonly string[]).includes(next)) { setPage(next); setMobileOpen(false); } };
  return <div className="min-h-screen bg-[#f5f6f8] text-slate-800">
    <aside className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-slate-200 bg-[#182635] text-white transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2e9b9a]"><ClipboardCheck size={19} /></div><div><p className="text-[15px] font-semibold tracking-tight">Job Review Architecture</p><p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Workforce platform</p></div></div>
      <nav className="space-y-1 px-3 py-6">{(user.role === 'admin' ? [['dashboard','대시보드','전체 검토 현황을 확인하세요',LayoutDashboard],['reviews','검토 현황','SME별 검토 진행 상태',BarChart3],['jobs','직무정보 관리','등록된 직무정보를 관리하세요',FileSpreadsheet],['upload','직무정보 업로드','Excel 파일로 일괄 등록',Upload],['users','SME 계정 관리','SME 계정을 등록·관리하세요',Users],['admin-users','관리자 계정 관리','관리자 계정을 등록·관리하세요',UserCog]] : [['review','직무 검토','직무정보를 검토해 주세요',ClipboardCheck],['history','검토 이력','내 검토 이력을 확인하세요',Clock3]]).map(([key,label,sub,Icon]) => <button key={key as string} onClick={() => go(key as string)} className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm transition ${safePage === key ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Icon size={17} className="shrink-0" /><div className="min-w-0 flex-1"><span className="block text-sm">{label as string}</span><span className={`mt-0.5 block text-[11px] leading-tight ${safePage === key ? 'text-slate-300' : 'text-slate-500'}`}>{sub as string}</span></div>{safePage === key && <ChevronRight size={15} className="ml-auto shrink-0 text-[#73d0c5]" />}</button>)}</nav>
      <div className="absolute bottom-5 left-3 right-3 border-t border-white/10 pt-4"><button onClick={logout} className="flex w-full items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:text-white"><LogOut size={16} /> 로그아웃</button></div>
    </aside>
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur lg:px-8"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(!mobileOpen)} className="rounded-md p-2 hover:bg-slate-100 lg:hidden"><Menu size={20} /></button><div><p className="text-xs text-slate-400">{user.role === 'admin' ? '관리자 포털' : 'SME 검토 포털'}</p><h1 className="text-lg font-semibold text-slate-900">{pageTitle(page)}</h1></div></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-sm font-medium text-slate-800">{user.name}</p><p className="text-xs text-slate-400">{user.organization} · {user.title}</p></div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dceeed] text-sm font-semibold text-[#247d7c]">{user.name.slice(0,1)}</div></div></header><main className="mx-auto max-w-[1500px] p-5 lg:p-8">{user.role === 'admin' ? <AdminPage page={safePage} go={go} userId={user.id} currentUser={user} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} /> : <SmePage page={safePage} go={go} user={user} />}</main></div>
  </div>;
}

function pageTitle(page: string) { return ({ dashboard: '관리자 대시보드', reviews: 'SME 검토 현황', jobs: '직무정보 관리', upload: '직무정보 업로드', users: 'SME 계정 관리', 'admin-users': '관리자 계정 관리', review: '직무정보 검토', history: '검토 이력' } as Record<string,string>)[page] || 'Job Review Architecture'; }

function Login({ onLogin, error }: { onLogin: (email: string, password: string) => void; error: string }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return <div className="flex min-h-screen bg-[#182635]"><div className="hidden w-[48%] flex-col justify-between p-12 lg:flex"><div className="flex items-center gap-3 text-white"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2e9b9a]"><ClipboardCheck size={21} /></div><span className="font-semibold">Job Review Architecture</span></div><div className="max-w-xl pb-20"><p className="mb-4 text-sm font-medium tracking-widest text-[#73d0c5]">JOB ARCHITECTURE REVIEW</p><h1 className="text-4xl font-semibold leading-tight text-white">현업의 전문성을 기반으로<br />직무체계를 검증합니다.</h1><p className="mt-6 max-w-lg leading-7 text-slate-400">직무전문가(SME)의 실제 업무 경험을 바탕으로 직무 정의, 주요 Task, 필요 Skill의 적정성을 검토하고 보완하여, 서연의 직무체계를 보다 명확하고 일관된 기준으로 정립합니다.</p></div><p className="text-xs text-slate-500">© 2026 Seoyon Job Architecture Review</p></div><div className="flex flex-1 items-center justify-center bg-[#f7f8fa] px-5 py-10"><div className="w-full max-w-[400px]"><div className="mb-8 lg:hidden"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#2e9b9a] text-white"><ClipboardCheck size={21} /></div><h1 className="text-2xl font-semibold text-slate-900">Job Review Architecture</h1></div><div className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9"><h2 className="text-2xl font-semibold tracking-tight text-slate-900">로그인</h2><p className="mt-2 text-sm text-slate-500">등록된 계정으로 로그인해 주세요.</p><form onSubmit={e => { e.preventDefault(); onLogin(email, password); }} className="mt-8 space-y-5"><Field label="이메일" value={email} onChange={setEmail} type="email" placeholder="name@company.com" /><Field label="비밀번호" value={password} onChange={setPassword} type="password" placeholder="비밀번호를 입력하세요" />{error && <p className="text-sm text-rose-600">{error}</p>}<button className="w-full rounded-md bg-[#247d7c] py-3 text-sm font-semibold text-white transition hover:bg-[#1d6867]">로그인</button></form></div><p className="mt-5 text-center text-xs text-slate-400">계정 생성 및 권한 변경은 관리자에게 문의해 주세요.<br />(hechoi@e-hcg.com)</p></div></div></div>;
}

function AdminPage({ page, go, userId, currentUser, companyFilter, setCompanyFilter }: { page: string; go: (page: string) => void; userId: string; currentUser: User; companyFilter: string; setCompanyFilter: (v: string) => void }) {
  if (page === 'upload') return <UploadPage />;
  if (page === 'jobs') return <JobsPage userId={userId} />;
  if (page === 'users') return <UsersPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />;
  if (page === 'admin-users') return <AdminUsersPage currentUser={currentUser} />;
  if (page === 'reviews') return <ReviewTable companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />;
  if (page === 'dashboard') return <Dashboard go={go} />;
  return null;
}

// ── Company Filter Dropdown ─────────────────────────────────────────
function CompanyFilterDropdown({ companies, value, onChange }: { companies: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-[#247d7c]"
    >
      <option value="all">전체 회사</option>
      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ── SME List Item Type ───────────────────────────────────────────────
interface SmeListItem {
  id: string;
  name: string;
  email: string;
  organization: string;
  title: string;
  active: boolean;
  created_at: string;
  company_id: string | null;
  company_name: string;
  employee_number: string;
}

// ── SME Excel Upload Modal ───────────────────────────────────────────
function SmeBulkUploadModal({ companies, onClose, onSuccess, onError }: {
  companies: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [validation, setValidation] = useState<SmeValidationResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setValidating(true);
    setValidation(null);
    setFileName(file.name);
    try {
      const wb = await parseWorkbook(file);
      const sheetName = wb.SheetNames.includes('SME 계정') ? 'SME 계정' : wb.SheetNames[0];
      const rows = sheetToRows<Record<string, unknown>>(wb, sheetName);

      // Fetch existing emails and emp numbers
      const { data: existingProfiles } = await supabase!.from('profiles').select('email, company_id, employee_number').eq('role', 'sme');
      const existingEmails = new Set((existingProfiles || []).map((p: Record<string, unknown>) => (p.email as string).toLowerCase()));
      const existingEmpNums = new Set<string>();
      const compIdMap = new Map<string, string>();
      for (const c of companies) compIdMap.set(c.name, c.id);
      for (const p of (existingProfiles || []) as Record<string, unknown>[]) {
        if (p.company_id && p.employee_number) {
          const compName = companies.find(c => c.id === p.company_id)?.name || '';
          if (compName) existingEmpNums.add(`${compName}|${p.employee_number}`);
        }
      }
      const companyNames = new Set(companies.map(c => c.name));
      const result = validateSmeRows(rows, existingEmails, existingEmpNums, companyNames);
      setValidation(result);
    } catch {
      onError('파일을 읽을 수 없습니다. xlsx 또는 xls 파일인지 확인해 주세요.');
    }
    setValidating(false);
  }

  async function handleCreate() {
    if (!validation || validation.valid === 0) return;
    setSubmitting(true);
    const compIdMap = new Map(companies.map(c => [c.name, c.id]));
    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of validation.validRows) {
      const companyId = compIdMap.get(row.회사) || null;
      try {
        const { data: session } = await supabase!.auth.getSession();
        const token = session.session?.access_token;
        if (!token) { errors.push(`${row.이메일}: 인증 실패`); failed++; continue; }
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ mode: 'create-sme', sme: { name: row.이름, email: row.이메일, password: row.비밀번호, company_id: companyId, organization: row.조직, title: row.직급, employee_number: row.사번 } }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { errors.push(`${row.이메일}: ${data.error || '오류'}`); failed++; }
        else { created++; }
      } catch { errors.push(`${row.이메일}: 오류`); failed++; }
    }

    setSubmitting(false);
    if (created > 0) {
      onSuccess();
    } else {
      onError(`등록에 실패했습니다.\n${errors.join('\n')}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-semibold text-slate-900">SME 계정 전체 업로드</h3>
        <p className="mb-5 text-sm text-slate-500">Excel 양식을 이용해 SME 계정을 일괄 등록합니다. 기존 계정 수정은 목록의 '관리' 버튼을 이용해 주세요.</p>

        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={downloadSmeTemplate} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-[#247d7c] hover:text-[#247d7c]"><Download size={15} /> 업로드 양식 다운로드</button>
          <button onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-[#247d7c] hover:text-[#247d7c]"><FileSpreadsheet size={15} /> Excel 파일 선택</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>

        {fileName && <p className="mb-3 text-xs text-slate-400">선택된 파일: {fileName}</p>}

        {validating && <div className="py-8 text-center text-sm text-slate-400"><Loader2 size={20} className="mx-auto mb-2 animate-spin" /> 검증 중...</div>}

        {validation && !validating && (
          <div className="mb-4">
            <div className="mb-3 grid grid-cols-3 gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-center"><p className="text-xs text-slate-400">총 대상</p><p className="mt-1 text-lg font-semibold text-slate-800">{validation.total}명</p></div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-center"><p className="text-xs text-emerald-500">정상</p><p className="mt-1 text-lg font-semibold text-emerald-700">{validation.valid}명</p></div>
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-center"><p className="text-xs text-rose-500">오류</p><p className="mt-1 text-lg font-semibold text-rose-700">{validation.errors}명</p></div>
            </div>
            {validation.errorList.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-rose-100 bg-rose-50/50 p-3">
                <p className="mb-2 text-xs font-medium text-rose-600">오류 목록</p>
                <ul className="space-y-1">
                  {validation.errorList.map((e, i) => <li key={i} className="text-xs text-rose-700">{e.row}행: {e.message}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">취소</button>
          <button type="button" onClick={handleCreate} disabled={!validation || validation.valid === 0 || submitting} className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{submitting && <Loader2 size={15} className="animate-spin" />}{submitting ? '등록 중...' : '검증 후 전체 업로드'}</button>
        </div>
      </div>
    </div>
  );
}



// ── SME Bulk Delete Modal ────────────────────────────────────────────
function SmeBulkDeleteModal({
  smeList,
  companyFilter,
  companies,
  onClose,
  onSuccess,
  onError,
}: {
  smeList: SmeListItem[];
  companyFilter: string;
  companies: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: (deleted: number, failed: number) => void;
  onError: (msg: string) => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: smeList.length });

  const scopeName =
    companyFilter === 'all'
      ? '전체 회사'
      : companies.find(c => c.id === companyFilter)?.name || '선택 회사';

  async function handleDeleteAll() {
    if (confirmText !== '전체삭제') return;

    setDeleting(true);
    setProgress({ done: 0, total: smeList.length });

    try {
      const { data: session } = await supabase!.auth.getSession();
      const token = session.session?.access_token;

      if (!token) {
        onError('인증 정보를 확인할 수 없습니다.');
        setDeleting(false);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      let deleted = 0;
      let failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < smeList.length; i++) {
        const sme = smeList[i];

        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              mode: 'delete',
              profileId: sme.id,
            }),
          });

          const data = await res.json();

          if (!res.ok || data.error) {
            failed++;
            errors.push(`${sme.name} (${sme.email}): ${data.error || '삭제 실패'}`);
          } else {
            deleted++;
          }
        } catch {
          failed++;
          errors.push(`${sme.name} (${sme.email}): 삭제 중 오류`);
        }

        setProgress({ done: i + 1, total: smeList.length });
      }

      setDeleting(false);

      if (failed > 0) {
        onError(
          `SME 전체 삭제 결과: 성공 ${deleted}명 / 실패 ${failed}명` +
          (errors.length ? `\n${errors.slice(0, 10).join('\n')}` : '')
        );
      }

      onSuccess(deleted, failed);
    } catch {
      setDeleting(false);
      onError('SME 전체 삭제 중 오류가 발생했습니다.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={deleting ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">SME 전체 삭제</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              현재 선택 범위의 SME 계정을 모두 삭제합니다.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-rose-500">삭제 범위</p>
              <p className="mt-1 font-semibold text-rose-800">{scopeName}</p>
            </div>
            <div>
              <p className="text-xs text-rose-500">삭제 대상</p>
              <p className="mt-1 font-semibold text-rose-800">{smeList.length}명</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-rose-700">
            삭제된 SME는 더 이상 로그인할 수 없습니다. 검토 관련 연결 데이터에도 영향을 줄 수 있으므로,
            실제 삭제가 필요한 경우에만 사용해 주세요.
          </p>
        </div>

        {!deleting ? (
          <>
            <div className="mt-5">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                확인을 위해 <b className="text-rose-600">전체삭제</b>를 입력해 주세요.
              </label>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                className="input"
                placeholder="전체삭제"
                autoComplete="off"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={confirmText !== '전체삭제' || smeList.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={15} />
                {smeList.length}명 전체 삭제
              </button>
            </div>
          </>
        ) : (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                삭제 중...
              </span>
              <span className="font-medium text-slate-700">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-rose-500 transition-all"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SME Single Create Modal ──────────────────────────────────────────
function SmeSingleCreateModal({ companies, onClose, onSuccess, onError }: {
  companies: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [organization, setOrganization] = useState('');
  const [title, setTitle] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');

  async function handleCreate() {
    setLocalError('');

    if (!companyId || !organization.trim() || !title.trim() || !employeeNumber.trim() || !name.trim() || !email.trim() || !password) {
      setLocalError('회사, 조직, 직급, 사번, 이름, 이메일, 비밀번호를 모두 입력해 주세요.');
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

      if (!token) {
        setLocalError('인증 정보를 확인할 수 없습니다.');
        setSubmitting(false);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          mode: 'create-sme',
          sme: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
            company_id: companyId,
            organization: organization.trim(),
            title: title.trim(),
            employee_number: employeeNumber.trim(),
          },
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setLocalError(data.error || 'SME 계정 등록 중 오류가 발생했습니다.');
        setSubmitting(false);
        return;
      }

      onSuccess();
    } catch {
      setLocalError('SME 계정 등록 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">SME 개별 추가</h3>
            <p className="mt-1 text-sm text-slate-500">SME 계정을 1명씩 직접 등록합니다.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">회사 <span className="text-rose-500">*</span></label>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#247d7c]"
            >
              <option value="">회사를 선택해 주세요</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">조직 <span className="text-rose-500">*</span></label>
              <input value={organization} onChange={e => setOrganization(e.target.value)} className="input" placeholder="예: 인사팀" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">직급 <span className="text-rose-500">*</span></label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="input" placeholder="예: 과장" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">사번 <span className="text-rose-500">*</span></label>
              <input value={employeeNumber} onChange={e => setEmployeeNumber(e.target.value)} className="input" placeholder="사번" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">이름 <span className="text-rose-500">*</span></label>
              <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="이름" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">이메일 <span className="text-rose-500">*</span></label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" placeholder="name@company.com" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">비밀번호 <span className="text-rose-500">*</span></label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" placeholder="8자 이상, 영문 및 숫자 포함" />
            <p className="mt-1 text-xs text-slate-400">8자 이상, 영문 및 숫자 포함</p>
          </div>

          {localError && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{localError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              취소
            </button>
            <button type="button" onClick={handleCreate} disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting ? '등록 중...' : 'SME 계정 추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SME Manage Button ────────────────────────────────────────────────
function SmeManageButton({ sme, companies, onChanged, onToast }: {
  sme: SmeListItem;
  companies: { id: string; name: string }[];
  onChanged: () => void;
  onToast: (t: { type: 'success' | 'error'; msg: string }) => void;
}) {
  const [show, setShow] = useState(false);
  const [editName, setEditName] = useState(sme.name);
  const [editCompany, setEditCompany] = useState(sme.company_id || '');
  const [editOrg, setEditOrg] = useState(sme.organization);
  const [editTitle, setEditTitle] = useState(sme.title);
  const [editEmpNum, setEditEmpNum] = useState(sme.employee_number);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!editCompany) {
      onToast({ type: 'error', msg: 'SME 계정에는 회사가 반드시 지정되어야 합니다.' });
      return;
    }
    setSaving(true);
    try {
      const { data: session } = await supabase!.auth.getSession();
      const token = session.session?.access_token;
      if (!token) { onToast({ type: 'error', msg: '인증 정보를 확인할 수 없습니다.' }); setSaving(false); return; }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ mode: 'update-sme', profileId: sme.id, name: editName, company_id: editCompany, organization: editOrg, title: editTitle, employee_number: editEmpNum }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { onToast({ type: 'error', msg: data.error || '수정 중 오류가 발생했습니다.' }); setSaving(false); return; }
      setShow(false);
      onToast({ type: 'success', msg: 'SME 계정 정보가 수정되었습니다.' });
      onChanged();
    } catch { onToast({ type: 'error', msg: '수정 중 오류가 발생했습니다.' }); setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);

    try {
      const { data: session } = await supabase!.auth.getSession();
      const token = session.session?.access_token;

      if (!token) {
        onToast({ type: 'error', msg: '인증 정보를 확인할 수 없습니다.' });
        setDeleting(false);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          mode: 'delete',
          profileId: sme.id,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        onToast({ type: 'error', msg: data.error || 'SME 계정 삭제 중 오류가 발생했습니다.' });
        setDeleting(false);
        return;
      }

      setShow(false);
      onToast({ type: 'success', msg: `${sme.name} SME 계정이 삭제되었습니다.` });
      onChanged();
    } catch {
      onToast({ type: 'error', msg: 'SME 계정 삭제 중 오류가 발생했습니다.' });
      setDeleting(false);
    }
  }

  return (
    <>
      <button onClick={() => setShow(true)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#247d7c] hover:text-[#247d7c]">관리</button>
      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShow(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold text-slate-900">SME 계정 수정</h3><p className="mb-5 text-sm text-slate-500">기존 SME 계정 정보를 수정합니다.</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">회사 <span className="text-rose-500">*</span></label>
                <select value={editCompany} onChange={e => setEditCompany(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#247d7c]">
                  <option value="">회사를 선택해 주세요</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-medium text-slate-700">이름</label><input value={editName} onChange={e => setEditName(e.target.value)} className="input" /></div>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">사번</label><input value={editEmpNum} onChange={e => setEditEmpNum(e.target.value)} className="input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-sm font-medium text-slate-700">조직</label><input value={editOrg} onChange={e => setEditOrg(e.target.value)} className="input" /></div>
                <div><label className="mb-1 block text-sm font-medium text-slate-700">직급</label><input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="input" /></div>
              </div>
              <div><label className="mb-1 block text-sm font-medium text-slate-700">이메일</label><input value={sme.email} disabled className="input cursor-not-allowed bg-slate-50 text-slate-500" /></div>
              <div className="border-t border-slate-200 pt-4">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={saving || deleting}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <X size={15} /> SME 계정 삭제
                  </button>
                ) : (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600" />
                      <div>
                        <p className="text-sm font-medium text-rose-700">{sme.name} 계정을 삭제하시겠습니까?</p>
                        <p className="mt-1 text-xs leading-5 text-rose-600">
                          삭제하면 해당 SME는 더 이상 로그인할 수 없으며 계정 복구가 어려울 수 있습니다.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
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
                  type="button"
                  onClick={() => setShow(false)}
                  disabled={saving || deleting}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || deleting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#247d7c] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving && <Loader2 size={15} className="animate-spin" />}
                  {saving ? '저장 중...' : '수정사항 저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Dashboard({ go }: { go: (page: string) => void }) {
  const [reviewRows, setReviewRows] = useState<ReviewStatusRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchReviewStatus();
      if (!cancelled) { setReviewRows(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const total = reviewRows.length;
  const smeNames = [...new Set(reviewRows.map(r => r.sme_name))];
  const cnt = (s: string) => reviewRows.filter(r => r.review_status === s).length;
  const notStarted = cnt('NOT_STARTED');
  const inProgress = cnt('IN_PROGRESS');
  const submitted = cnt('SUBMITTED') + cnt('RESUBMITTED');
  const resubmit = cnt('REVIEW_REQUESTED');
  const completionRate = total ? Math.round((submitted / total) * 1000) / 10 : 0;
  const pct = (n: number) => total ? Math.round((n / total) * 1000) / 10 : 0;

  const smeRows = smeNames.map(name => {
    const items = reviewRows.filter(r => r.sme_name === name);
    return {
      name,
      organization: items[0]?.organization || '',
      title: items[0]?.title || '',
      total: items.length,
      submitted: items.filter(r => r.review_status === 'SUBMITTED' || r.review_status === 'RESUBMITTED').length,
      inProgress: items.filter(r => r.review_status === 'IN_PROGRESS').length,
      notStarted: items.filter(r => r.review_status === 'NOT_STARTED').length,
      resubmit: items.filter(r => r.review_status === 'REVIEW_REQUESTED').length,
    };
  });

  const cards: [string, string | number, string, string][] = [
    ['전체 SME 수', smeNames.length, '등록 계정 기준', 'text-slate-900'],
    ['미실시', notStarted, `전체의 ${pct(notStarted)}%`, 'text-slate-500'],
    ['작성 중', inProgress, `전체의 ${pct(inProgress)}%`, 'text-amber-600'],
    ['제출 완료', submitted, `전체의 ${pct(submitted)}%`, 'text-emerald-600'],
    ['검토 완료율', `${completionRate}%`, `${submitted} / ${total}건`, 'text-[#247d7c]'],
  ];

  const dist: [string, number, string][] = [
    ['제출 완료', submitted, '#2e9b9a'],
    ['작성 중', inProgress, '#eabf63'],
    ['재검토 요청', resubmit, '#e58b8b'],
    ['미실시', notStarted, '#cbd5e1'],
  ];
  let acc = 0;
  const stops = dist.map(([label, n, color]) => {
    const start = acc;
    acc += (n / total) * 360;
    return { label, n, color, start, end: acc };
  });
  const conic = stops.map(s => `${s.color} ${s.start}deg ${s.end}deg`).join(', ');

  return <>
    <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="mb-1 text-sm text-slate-400">2026년 8월 12일 기준</p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">검토 현황을 확인하세요.</h2>
      </div>
      <button onClick={() => go('upload')} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d6867]"><Upload size={16} /> 직무정보 업로드</button>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map(([label, value, sub, color]) => (
        <div className="border border-slate-200 bg-white p-4 shadow-sm" key={label}>
          <p className="text-xs text-slate-500">{label}</p>
          <p className={`mt-3 text-2xl font-semibold ${color}`}>{loading ? '–' : value}</p>
          <p className="mt-1 text-[11px] text-slate-400">{sub}</p>
        </div>
      ))}
    </div>

    <div className="mt-7 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <section className="border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">SME별 검토 현황</h3>
            <p className="mt-1 text-xs text-slate-400">SME별 제출 완료 · 작성 중 · 미실시 건수</p>
          </div>
          <button onClick={() => go('reviews')} className="text-xs font-medium text-[#247d7c]">전체보기</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">SME</th>
                <th className="px-4 py-3 font-medium">소속 / 직급</th>
                <th className="px-4 py-3 text-center font-medium">담당</th>
                <th className="px-4 py-3 text-center font-medium">제출 완료</th>
                <th className="px-4 py-3 text-center font-medium">작성 중</th>
                <th className="px-4 py-3 text-center font-medium">미실시</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">불러오는 중…</td></tr>
              ) : smeRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">검토 대상이 없습니다.</td></tr>
              ) : smeRows.map(r => (
                <tr className="border-b border-slate-100 last:border-0" key={r.name}>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600"><span className="text-xs text-slate-400">{r.organization} · {r.title}</span></td>
                  <td className="px-4 py-3 text-center text-slate-500">{r.total}</td>
                  <td className="px-4 py-3 text-center"><span className="font-semibold text-emerald-600">{r.submitted}</span></td>
                  <td className="px-4 py-3 text-center"><span className="font-semibold text-amber-600">{r.inProgress}</span></td>
                  <td className="px-4 py-3 text-center"><span className="font-semibold text-slate-500">{r.notStarted}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">검토 상태 분포</h3>
        <p className="mt-1 text-xs text-slate-400">전체 {total}건 기준 · 검토 완료율 {completionRate}%</p>
        <div className="mt-7 flex flex-col items-center gap-7 sm:flex-row">
          <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${conic})` }}>
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-center">
              <span className="text-xl font-semibold text-slate-800">{completionRate}<small className="text-xs">%</small></span>
            </div>
          </div>
          <div className="w-full space-y-3 text-xs">
            {dist.map(([label, n, color]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  <span className="text-slate-500">{label}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <b className="text-slate-800">{n}건</b>
                  <span className="text-slate-400">({pct(n)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  </>;
}

function ReviewTable({ companyFilter, setCompanyFilter }: { companyFilter: string; setCompanyFilter: (v: string) => void }) {
  const [query,setQuery]=useState('');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [reviewRows, setReviewRows] = useState<ReviewStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchCompanies().then((cs) => setCompanies(cs)); }, []);
  useEffect(() => {
    setLoading(true);
    const cid = companyFilter === 'all' ? null : companyFilter;
    fetchReviewStatus(cid).then((rows) => { setReviewRows(rows); setLoading(false); });
  }, [companyFilter]);

  const filtered = reviewRows.filter(r => `${r.sme_name}${r.organization}${r.job_name}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-1 text-sm text-slate-400">총 {filtered.length}건</p><h2 className="text-2xl font-semibold tracking-tight text-slate-900">SME별 검토 현황</h2></div><div className="flex items-center gap-3"><CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} /></div></div><div className="border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input value={query} onChange={e=>setQuery(e.target.value)} className="input pl-9" placeholder="SME 이름, 조직, 직무 검색" /></div></div><div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><th className="px-5 py-3 font-medium">SME</th><th className="px-5 py-3 font-medium">조직 / 직급</th><th className="px-5 py-3 font-medium">담당 직무</th><th className="px-5 py-3 font-medium">검토상태</th><th className="px-5 py-3 font-medium">제출일</th><th className="px-5 py-3 font-medium">평가 결과</th></tr></thead><tbody>
    {loading ? (
      <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400">불러오는 중…</td></tr>
    ) : filtered.length === 0 ? (
      <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400">검토 대상이 없습니다.</td></tr>
    ) : filtered.map(r => <tr className="border-b border-slate-100 last:border-0" key={r.review_id || r.job_id}><td className="px-5 py-4"><p className="font-medium text-slate-800">{r.sme_name}</p><p className="mt-1 text-xs text-slate-400">{r.sme_email}</p></td><td className="px-5 py-4 text-slate-600">{r.organization}<br /><span className="text-xs text-slate-400">{r.title}</span></td><td className="px-5 py-4"><p className="font-medium text-slate-700">{r.job_name}</p><p className="mt-1 text-xs text-slate-400">{r.group_name} · {r.series_name}</p></td><td className="px-5 py-4"><StatusBadge status={mapReviewStatus(r.review_status)} /></td><td className="px-5 py-4 text-slate-500">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('ko-KR') : '-'}</td><td className="px-5 py-4"><div className="flex gap-2 text-xs"><span className="text-emerald-600">적합 {r.suitable_count}</span><span className="text-amber-600">수정 {r.needs_edit_count}</span><span className="text-rose-600">부적합 {r.unsuitable_count}</span></div></td></tr>)}
    </tbody></table></div></div></> }

function JobsPage({ userId }: { userId: string }) {
  const [query, setQuery] = useState('');
  const [jobList, setJobList] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [fixedCompanyId, setFixedCompanyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const companyId = await fetchFixedCompanyId();
        const jobs = await fetchAllJobs(companyId);
        if (cancelled) return;
        setFixedCompanyId(companyId);
        setJobList(jobs);
      } catch (error) {
        if (cancelled) return;
        setFixedCompanyId(null);
        setJobList([]);
        setLoadError(error instanceof Error ? error.message : '직무정보를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = jobList.filter((j) => `${j.group_name}${j.series_name}${j.name}`.toLowerCase().includes(query.toLowerCase()));

  if (selectedJobId) return <JobDetailPage jobId={selectedJobId} onBack={() => setSelectedJobId(null)} userId={userId} companyId={fixedCompanyId} />;

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-slate-400">총 {filtered.length}개 직무</p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">직무정보 관리</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fixedCompanyId && exportAllJobsToExcel(fixedCompanyId)}
            disabled={!fixedCompanyId || loading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-[#247d7c] hover:text-[#247d7c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={16} /> 전체 직무정보 다운로드
          </button>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="직무명 검색" className="w-48 bg-transparent text-sm outline-none placeholder:text-slate-400" />
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">직무 목록을 불러오는 중…</div>
      ) : loadError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white p-12 text-center">
          <FileSpreadsheet size={32} className="mx-auto mb-4 text-slate-300" />
          <p className="text-sm text-slate-500">등록된 직무가 없습니다.</p>
          <p className="mt-1 text-xs text-slate-400">관리자 메뉴에서 '직무정보 업로드'를 통해 Excel 파일로 직무를 등록할 수 있습니다.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJobId(j.id)}
              className="flex flex-col border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-[#247d7c] hover:shadow-md focus:border-[#247d7c] focus:outline-none focus:ring-1 focus:ring-[#247d7c]"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-baseline gap-2.5">
                    <span className="w-8 shrink-0 text-[12px] font-medium text-slate-400">직군</span>
                    <span className="text-[13px] text-slate-600">{j.group_name}</span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="w-8 shrink-0 text-[12px] font-medium text-slate-400">직렬</span>
                    <span className="line-clamp-1 text-[13px] text-slate-600">{j.series_name}</span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="w-8 shrink-0 text-[12px] font-medium text-slate-400">직무</span>
                    <h3 className="line-clamp-2 text-[19px] font-bold leading-tight text-slate-900">{j.name}</h3>
                  </div>
                </div>
                <span className="shrink-0 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">활성</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}





function UsersPage({ companyFilter, setCompanyFilter }: { companyFilter: string; setCompanyFilter: (v: string) => void }) {
  const [query, setQuery] = useState('');
  const [smeList, setSmeList] = useState<SmeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [showSingleCreate, setShowSingleCreate] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    fetchCompanies().then((cs) => setCompanies(cs));
  }, []);

  const fetchSmes = useCallback(async () => {
    setLoading(true);
    if (!supabase) { setLoading(false); return; }
    let q = supabase.from('profiles').select('id, name, email, organization, title, active, created_at, company_id, employee_number').eq('role', 'sme').order('created_at', { ascending: true });
    if (companyFilter !== 'all') q = q.eq('company_id', companyFilter);
    const { data, error } = await q;
    if (error) console.error('fetch SMEs failed:', error);
    // Fetch company names
    const { data: comps } = await supabase.from('companies').select('id, name');
    const compMap = new Map((comps || []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const rows = (data || []).map((p: Record<string, unknown>) => ({
      id: p.id as string, name: p.name as string, email: p.email as string, organization: (p.organization as string) || '', title: (p.title as string) || '', active: p.active as boolean, created_at: (p.created_at as string) || '', company_id: (p.company_id as string) || null, company_name: (p.company_id as string) ? (compMap.get(p.company_id as string) || '') : '', employee_number: (p.employee_number as string) || '',
    }));
    setSmeList(rows);
    setLoading(false);
  }, [companyFilter]);

  useEffect(() => { fetchSmes(); }, [fetchSmes]);

  return <>
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="mb-1 text-sm text-slate-400">총 {smeList.length}명</p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">SME 계정 관리</h2>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        <button
          onClick={() => setShowSingleCreate(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[#247d7c] bg-white px-4 py-2.5 text-sm font-semibold text-[#247d7c] hover:bg-[#f3fbfa]"
        >
          <Plus size={16} /> SME 개별 추가
        </button>
        <button
          onClick={() => setShowBulkUpload(true)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d6867]"
        >
          <Upload size={16} /> Excel 전체 업로드
        </button>
        <button
          onClick={() => setShowBulkDelete(true)}
          disabled={smeList.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={16} /> SME 전체 삭제
        </button>
      </div>
    </div>
    {toast && <div className={`mb-4 rounded-md border p-3 text-sm ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{toast.msg}</div>}
    <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
      개별 추가는 1명씩 등록할 때, 수정은 각 행의 '관리' 버튼을 이용할 때, Excel 전체 업로드는 여러 SME 계정을 한 번에 등록할 때 사용합니다.
    </div>
    <div className="border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input value={query} onChange={e => setQuery(e.target.value)} className="input pl-9" placeholder="이름, 이메일, 소속조직 검색" /></div></div>
      {loading ? <div className="py-20 text-center text-sm text-slate-400">불러오는 중…</div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">이름</th><th className="px-5 py-3 font-medium">회사</th><th className="px-5 py-3 font-medium">소속조직 / 직급</th><th className="px-5 py-3 font-medium">사번</th><th className="px-5 py-3 font-medium">상태</th><th className="px-5 py-3 font-medium">관리</th></tr></thead><tbody>
          {smeList.filter(s => `${s.name}${s.email}${s.organization}${s.company_name}`.toLowerCase().includes(query.toLowerCase())).map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="px-5 py-4 font-medium text-slate-800">{s.name}<p className="mt-1 text-xs font-normal text-slate-400">{s.email}</p></td><td className="px-5 py-4 text-slate-600">{s.company_name || <span className="text-amber-600">회사 미지정</span>}</td><td className="px-5 py-4 text-slate-600">{s.organization}<p className="mt-1 text-xs text-slate-400">{s.title}</p></td><td className="px-5 py-4 text-slate-600">{s.employee_number || '-'}</td><td className="px-5 py-4"><span className={`rounded px-2 py-1 text-xs ${s.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.active ? '활성' : '비활성'}</span></td><td className="px-5 py-4"><SmeManageButton sme={s} companies={companies} onChanged={fetchSmes} onToast={setToast} /></td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
    {showSingleCreate && (
      <SmeSingleCreateModal
        companies={companies}
        onClose={() => setShowSingleCreate(false)}
        onSuccess={() => {
          setShowSingleCreate(false);
          setToast({ type: 'success', msg: 'SME 계정이 추가되었습니다.' });
          fetchSmes();
        }}
        onError={(msg) => setToast({ type: 'error', msg })}
      />
    )}
    {showBulkUpload && (
      <SmeBulkUploadModal
        companies={companies}
        onClose={() => setShowBulkUpload(false)}
        onSuccess={() => {
          setShowBulkUpload(false);
          setToast({ type: 'success', msg: 'SME 계정 전체 업로드가 완료되었습니다.' });
          fetchSmes();
        }}
        onError={(msg) => setToast({ type: 'error', msg })}
      />
    )}
    {showBulkDelete && (
      <SmeBulkDeleteModal
        smeList={smeList}
        companyFilter={companyFilter}
        companies={companies}
        onClose={() => setShowBulkDelete(false)}
        onSuccess={(deleted, failed) => {
          setShowBulkDelete(false);
          setToast({
            type: failed === 0 ? 'success' : 'error',
            msg: failed === 0
              ? `SME ${deleted}명 전체 삭제가 완료되었습니다.`
              : `SME 전체 삭제 결과: 성공 ${deleted}명 / 실패 ${failed}명`,
          });
          fetchSmes();
        }}
        onError={(msg) => setToast({ type: 'error', msg })}
      />
    )}
  </>;
}

function SmePage({ page, go, user }: { page: string; go: (p: string) => void; user: User }) {
  if (page === 'history') return <HistoryPage user={user} />;
  return <ReviewWorkspace user={user} onBack={() => go('history')} />;
}
function ReviewWorkspace({ user, onBack }: { user: User; onBack: () => void }) {
  const [jobList, setJobList] = useState<JobListItem[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selGroup, setSelGroup] = useState('');
  const [selSeries, setSelSeries] = useState('');
  const [selJob, setSelJob] = useState('');
  const [section, setSection] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'unsaved' | 'saving' | 'saved'>('unsaved');
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});

  useEffect(() => {
    fetchAllJobs(user.company_id || null).then((jobs) => {
      setJobList(jobs);
      setLoadingJobs(false);
      if (jobs.length > 0) {
        const first = jobs[0];
        setSelGroup(first.group_name);
        setSelSeries(first.series_name);
        setSelJob(first.name);
        setSelectedJobId(first.id);
      }
    });
  }, [user.company_id]);

  useEffect(() => {
    if (!selectedJobId) return;
    setLoadingDetail(true);
    fetchJobDetail(selectedJobId).then((detail) => {
      setJobDetail(detail);
      setLoadingDetail(false);
      setFeedback({});
      setSection(0);
    });
  }, [selectedJobId]);

  const groups = [...new Set(jobList.map((j) => j.group_name))];
  const series = [...new Set(jobList.filter((j) => j.group_name === selGroup).map((j) => j.series_name))];
  const jobsInSeries = jobList.filter((j) => j.group_name === selGroup && j.series_name === selSeries);

  const update = (key: string, value: Partial<Feedback>) => {
    setFeedback((prev) => {
      const existing = prev[key] || { suitability: '', comment: '', suggestion: '' };
      return { ...prev, [key]: { ...existing, ...value } };
    });
    setSaveStatus((prev) => (prev === 'saved' ? 'unsaved' : prev));
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try { await new Promise((r) => setTimeout(r, 600)); setSaveStatus('saved'); } catch { setSaveStatus('unsaved'); }
  };

  const currentStatus = submitted ? '제출 완료' : '작성 중';
  const sections = ['직무명 검토', '직무정의 검토', '주요과업 및 세부활동 검토', '필요 Skill 검토', '수행요건 검토'];
  const totalSections = sections.length;

  const softSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Soft Skill') || [];
  const hardSkills = jobDetail?.skills.filter((s) => s.skill_type === 'Hard Skill') || [];

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-400 hover:text-[#247d7c]"><ArrowLeft size={16} /> 검토 이력</button>
          </div>
          <p className="mb-1 mt-2 text-sm text-slate-400">SME 검토 · {currentStatus}{user.company_name && <span className="ml-2 text-[#247d7c]">· {user.company_name}</span>}</p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">직무정보 검토</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">진행률</span>
          <div className="h-2 w-28 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-[#2e9b9a] transition-all" style={{ width: `${((section + 1) / totalSections) * 100}%` }} /></div>
          <span className="text-xs font-medium text-[#247d7c]">{section + 1}/{totalSections}</span>
        </div>
      </div>

      {loadingJobs ? (
        <div className="flex items-center justify-center py-20 text-sm text-slate-400">직무 목록을 불러오는 중…</div>
      ) : jobList.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-700">등록된 직무가 없습니다. 관리자가 직무정보를 업로드한 후 검토할 수 있습니다.</div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <Select label="직군" value={selGroup} options={groups} onChange={(v) => { setSelGroup(v); setSelSeries(''); setSelJob(''); }} />
            <Select label="직렬" value={selSeries} options={series} onChange={(v) => { setSelSeries(v); setSelJob(''); }} />
            <Select label="직무" value={selJob} options={jobsInSeries.map((j) => j.name)} onChange={(v) => {
              setSelJob(v);
              const found = jobsInSeries.find((j) => j.name === v);
              if (found) setSelectedJobId(found.id);
            }} />
          </div>

          {loadingDetail ? (
            <div className="flex items-center justify-center py-20 text-sm text-slate-400">직무 상세 정보를 불러오는 중…</div>
          ) : jobDetail ? (
            <div className="grid gap-5 xl:grid-cols-[220px_1fr]">
              <aside className="h-fit border border-slate-200 bg-white p-3 shadow-sm">
                <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">검토 섹션</p>
                {sections.map((label, i) => (
                  <button key={label} onClick={() => setSection(i)} className={`flex w-full items-center gap-2 rounded-md px-3 py-3 text-left text-sm ${section === i ? 'bg-[#edf8f7] font-semibold text-[#247d7c]' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${section > i ? 'bg-[#2e9b9a] text-white' : 'bg-slate-100 text-slate-500'}`}>{section > i ? <Check size={12} /> : i + 1}</span>{label}
                  </button>
                ))}
                <div className="mt-4 border-t border-slate-100 px-3 pt-4">
                  <p className="text-xs text-slate-400">자동 저장</p>
                  <p className={`mt-1 text-xs ${saveStatus === 'saved' ? 'text-emerald-600' : 'text-slate-500'}`}>{saveStatus === 'saved' ? '저장완료' : saveStatus === 'saving' ? '저장 중...' : '아직 저장되지 않음'}</p>
                </div>
              </aside>

              <section className="border border-slate-200 bg-white p-5 shadow-sm lg:p-7">
                {section === 0 && <FeedbackSection title="A. 직무명 검토" current={jobDetail.name} feedback={feedback.name || { suitability: '', comment: '', suggestion: '' }} update={(v) => update('name', v)} suggestionLabel="대체 직무명 제안" />}
                {section === 1 && <FeedbackSection title="B. 직무정의 검토" current={jobDetail.definition} feedback={feedback.definition || { suitability: '', comment: '', suggestion: '' }} update={(v) => update('definition', v)} suggestionLabel="수정 직무정의 제안" large />}
                {section === 2 && <TaskActivityFeedback tasks={jobDetail.tasks} feedback={feedback} update={update} />}
                {section === 3 && <SkillFeedback softSkills={softSkills} hardSkills={hardSkills} feedback={feedback} update={update} />}
                {section === 4 && <RequirementFeedback requirements={jobDetail.requirements} feedback={feedback} update={update} />}

                <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row">
                  <button disabled={section === 0} onClick={() => setSection(section - 1)} className="rounded-md border border-slate-200 px-4 py-2.5 text-sm text-slate-600 disabled:opacity-40">이전 섹션</button>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-[#247d7c]">임시저장</button>
                    {section < totalSections - 1 ? (
                      <button onClick={() => setSection(section + 1)} className="rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-semibold text-white">다음 섹션</button>
                    ) : (
                      <button onClick={() => { if (window.confirm('최종 제출 후에는 관리자가 재검토를 요청하기 전까지 수정할 수 없습니다. 제출하시겠습니까?')) setSubmitted(true); }} className="rounded-md bg-[#247d7c] px-4 py-2.5 text-sm font-semibold text-white">최종 제출</button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function TaskActivityFeedback({ tasks, feedback, update }: { tasks: JobDetail['tasks']; feedback: Record<string, Feedback>; update: (key: string, v: Partial<Feedback>) => void }) {
  return (
    <div>
      <SectionHeading title="C. 주요과업 및 세부활동 검토" />
      {tasks.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">등록된 주요과업이 없습니다.</p>
      ) : (
        <div className="space-y-5">
          {tasks.map((task, ti) => (
            <div key={task.id} className="rounded-md border border-slate-200 p-4 lg:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-[#247d7c]">주요과업 {ti + 1}</span>
                  <h4 className="mt-1 font-semibold text-slate-800">{task.name}</h4>
                </div>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{ti + 1}/{tasks.length}</span>
              </div>
              {task.task_activities.length > 0 && (
                <ul className="mt-3 space-y-1.5 pl-1">
                  {task.task_activities.map((act) => (
                    <li key={act.id} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {act.activity_name}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[240px_1fr_1fr]">
                <div>
                  <span className="label">적합성 평가</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['적합', '일부 수정 필요', '부적합'] as Suitability[]).map((v) => (
                      <button key={v} onClick={() => update(`task-${task.id}`, { suitability: v })} className={`rounded border px-2.5 py-1.5 text-xs ${feedback[`task-${task.id}`]?.suitability === v ? 'border-[#247d7c] bg-[#edf8f7] text-[#247d7c]' : 'border-slate-200 text-slate-500'}`}>{v}</button>
                    ))}
                  </div>
                </div>
                <label>
                  <span className="label">개선 필요사항</span>
                  <textarea value={feedback[`task-${task.id}`]?.comment || ''} onChange={(e) => update(`task-${task.id}`, { comment: e.target.value })} className="textarea" rows={3} placeholder="의견을 입력해 주세요." />
                </label>
                <label>
                  <span className="label">수정 제안</span>
                  <textarea value={feedback[`task-${task.id}`]?.suggestion || ''} onChange={(e) => update(`task-${task.id}`, { suggestion: e.target.value })} className="textarea" rows={3} placeholder="수정안을 입력해 주세요." />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:border-[#247d7c] hover:text-[#247d7c]"><Plus size={15} /> 신규 주요과업 제안 추가</button>
    </div>
  );
}

function SkillFeedback({ softSkills, hardSkills, feedback, update }: { softSkills: { id: string; name: string }[]; hardSkills: { id: string; name: string }[]; feedback: Record<string, Feedback>; update: (key: string, v: Partial<Feedback>) => void }) {
  const renderSkillList = (title: string, skills: { id: string; name: string }[], type: string) => (
    <div className="mb-6">
      <h4 className="mb-3 font-semibold text-slate-800">{title}</h4>
      {skills.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-4 py-3 text-center text-xs text-slate-400">등록된 {title}이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {skills.map((skill, i) => (
            <div key={skill.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-[#247d7c]">{type} {i + 1}</span>
                  <h5 className="mt-1 font-medium text-slate-800">{skill.name}</h5>
                </div>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{i + 1}/{skills.length}</span>
              </div>
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[240px_1fr_1fr]">
                <div>
                  <span className="label">적합성 평가</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['적합', '일부 수정 필요', '부적합'] as Suitability[]).map((v) => (
                      <button key={v} onClick={() => update(`skill-${skill.id}`, { suitability: v })} className={`rounded border px-2.5 py-1.5 text-xs ${feedback[`skill-${skill.id}`]?.suitability === v ? 'border-[#247d7c] bg-[#edf8f7] text-[#247d7c]' : 'border-slate-200 text-slate-500'}`}>{v}</button>
                    ))}
                  </div>
                </div>
                <label>
                  <span className="label">개선 필요사항</span>
                  <textarea value={feedback[`skill-${skill.id}`]?.comment || ''} onChange={(e) => update(`skill-${skill.id}`, { comment: e.target.value })} className="textarea" rows={2} placeholder="의견을 입력해 주세요." />
                </label>
                <label>
                  <span className="label">수정 제안</span>
                  <textarea value={feedback[`skill-${skill.id}`]?.suggestion || ''} onChange={(e) => update(`skill-${skill.id}`, { suggestion: e.target.value })} className="textarea" rows={2} placeholder="수정안을 입력해 주세요." />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <SectionHeading title="D. 필요 Skill 검토" />
      {renderSkillList('역량 (Soft Skill)', softSkills, 'Soft Skill')}
      {renderSkillList('지식/기술 (Hard Skill)', hardSkills, 'Hard Skill')}
      <button className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:border-[#247d7c] hover:text-[#247d7c]"><Plus size={15} /> 신규 Skill 제안 추가</button>
    </div>
  );
}

function RequirementFeedback({ requirements, feedback, update }: { requirements: JobDetail['requirements']; feedback: Record<string, Feedback>; update: (key: string, v: Partial<Feedback>) => void }) {
  const fields: [string, string][] = [
    ['education', '요구 학력'],
    ['major', '관련 전공'],
    ['certifications', '관련 자격증/면허'],
  ];
  return (
    <div>
      <SectionHeading title="E. 수행요건 검토" />
      {fields.map(([key, label]) => {
        const value = requirements ? (requirements as unknown as Record<string, string>)[key] || '' : '';
        return (
          <div key={key} className="mb-6 rounded-md border border-slate-200 p-4 lg:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold text-[#247d7c]">{label}</span>
                <p className="mt-1 text-sm leading-7 text-slate-700">{value || <em className="text-slate-400">미입력</em>}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[240px_1fr_1fr]">
              <div>
                <span className="label">적합성 평가</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['적합', '일부 수정 필요', '부적합'] as Suitability[]).map((v) => (
                    <button key={v} onClick={() => update(`req-${key}`, { suitability: v })} className={`rounded border px-2.5 py-1.5 text-xs ${feedback[`req-${key}`]?.suitability === v ? 'border-[#247d7c] bg-[#edf8f7] text-[#247d7c]' : 'border-slate-200 text-slate-500'}`}>{v}</button>
                  ))}
                </div>
              </div>
              <label>
                <span className="label">개선 필요사항</span>
                <textarea value={feedback[`req-${key}`]?.comment || ''} onChange={(e) => update(`req-${key}`, { comment: e.target.value })} className="textarea" rows={3} placeholder="의견을 입력해 주세요." />
              </label>
              <label>
                <span className="label">수정 제안</span>
                <textarea value={feedback[`req-${key}`]?.suggestion || ''} onChange={(e) => update(`req-${key}`, { suggestion: e.target.value })} className="textarea" rows={3} placeholder="수정안을 입력해 주세요." />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeedbackSection({ title,current,feedback,update,suggestionLabel,large=false }: {title:string;current:string;feedback:Feedback;update:(value:Partial<Feedback>)=>void;suggestionLabel:string;large?:boolean}) { return <div><SectionHeading title={title}/><div className="mb-6 rounded-md border border-slate-200 bg-slate-50 p-4"><p className="mb-2 text-xs font-medium text-slate-400">현재 등록 내용</p><p className={`text-sm leading-7 text-slate-700 ${large?'min-h-20':''}`}>{current}</p></div><label className="label">적합성 평가</label><div className="mb-5 flex flex-wrap gap-2">{(['적합','일부 수정 필요','부적합'] as Suitability[]).map(v=><button key={v} onClick={()=>update({suitability:v})} className={`rounded-md border px-4 py-2 text-sm ${feedback.suitability===v ? v==='적합'?'border-emerald-500 bg-emerald-50 text-emerald-700':v==='부적합'?'border-rose-400 bg-rose-50 text-rose-700':'border-amber-400 bg-amber-50 text-amber-700':'border-slate-200 text-slate-600 hover:border-slate-400'}`}>{v}</button>)}</div><div className="grid gap-5 lg:grid-cols-2"><label><span className="label">개선 필요사항 {feedback.suitability&&feedback.suitability!=='적합'&&<em className="text-rose-500">*</em>}</span><textarea value={feedback.comment} onChange={e=>update({comment:e.target.value})} className="textarea" placeholder="검토 의견을 입력해 주세요." rows={5}/></label><label><span className="label">{suggestionLabel}</span><textarea value={feedback.suggestion} onChange={e=>update({suggestion:e.target.value})} className="textarea" placeholder="수정이 필요한 경우 제안 내용을 입력해 주세요." rows={5}/></label></div></div> }

function ListFeedback({title,items,feedback,update,type}:{title:string;items:(Task|Skill)[];feedback:Record<string,Feedback>;update:(key:string,v:Partial<Feedback>)=>void;type:string}){return <div><SectionHeading title={title}/><div className="space-y-4">{items.map((item,i)=>{const f=feedback[`${type}-${item.id}`]||{suitability:'',comment:'',suggestion:'',remove:false};return <div key={item.id} className="rounded-md border border-slate-200 p-4 lg:p-5"><div className="flex items-start justify-between gap-4"><div><span className="text-[11px] font-semibold text-[#247d7c]">{item.id}</span><h4 className="mt-1 font-semibold text-slate-800">{item.name}</h4><p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p></div><span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{i+1}/{items.length}</span></div><div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-[240px_1fr_1fr]"><div><span className="label">적합성 평가</span><div className="flex flex-wrap gap-1.5">{(['적합','일부 수정 필요','부적합'] as Suitability[]).map(v=><button key={v} onClick={()=>update(`${type}-${item.id}`,{suitability:v})} className={`rounded border px-2.5 py-1.5 text-xs ${f.suitability===v?'border-[#247d7c] bg-[#edf8f7] text-[#247d7c]':'border-slate-200 text-slate-500'}`}>{v}</button>)}</div><label className="mt-3 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={f.remove} onChange={e=>update(`${type}-${item.id}`,{remove:e.target.checked})} className="accent-[#247d7c]"/> 삭제 필요</label></div><label><span className="label">개선 필요사항</span><textarea value={f.comment} onChange={e=>update(`${type}-${item.id}`,{comment:e.target.value})} className="textarea" rows={3} placeholder="의견을 입력해 주세요."/></label><label><span className="label">수정 제안</span><textarea value={f.suggestion} onChange={e=>update(`${type}-${item.id}`,{suggestion:e.target.value})} className="textarea" rows={3} placeholder="수정안을 입력해 주세요."/></label></div></div>})}</div><button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:border-[#247d7c] hover:text-[#247d7c]"><Plus size={15}/> 신규 {type==='task'?'Task':'Skill'} 제안 추가</button></div>}

function HistoryPage({ user }: { user: User }) {
  const [reviewRows, setReviewRows] = useState<ReviewStatusRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchReviewStatus();
      if (!cancelled) { setReviewRows(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-sm text-slate-400">내가 작성한 검토 기록{user.company_name && ` · ${user.company_name}`}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">검토 이력</h2>
      </div>
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-slate-400">불러오는 중…</div>
        ) : reviewRows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">검토 이력이 없습니다.</div>
        ) : reviewRows.map(r => (
          <div className="flex flex-col justify-between gap-3 border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center" key={r.review_id || r.job_id}>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-800">{r.job_name}</h3>
                <StatusBadge status={mapReviewStatus(r.review_status)} />
              </div>
              <p className="mt-2 text-sm text-slate-500">{r.group_name} · {r.series_name}</p>
              <p className="mt-1 text-xs text-slate-400">최종 제출일 {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('ko-KR') : '-'}</p>
            </div>
            <button className="rounded-md border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600">검토내용 보기</button>
          </div>
        ))}
      </div>
    </>
  );
}

function SectionHeading({title}:{title:string}){return <div className="mb-6 flex items-center justify-between"><h3 className="text-lg font-semibold text-slate-900">{title}</h3><span className="text-xs text-slate-400">필수 항목을 모두 작성해 주세요.</span></div>}
function StatusBadge({status}:{status:Status}){return <span className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium ${statusStyle[status]}`}>{status}</span>}
function Field({label,value,onChange,type,placeholder}:{label:string;value:string;onChange:(value:string)=>void;type?:string;placeholder?:string}){return <label><span className="label">{label}</span><input className="input" value={value} onChange={e=>onChange(e.target.value)} type={type} placeholder={placeholder}/></label>}
function Select({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(value:string)=>void}){return <label><span className="label">{label}</span><select className="input" value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o}>{o}</option>)}</select></label>}

export default App;