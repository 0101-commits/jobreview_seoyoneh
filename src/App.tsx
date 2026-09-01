// 앱 셸 — 세션 부팅·구독 / 로그인·로그아웃 / 역할(ADMIN·SME) 분기 / 사이드바·헤더 / 라우팅만 담당한다.
// 각 화면의 실제 내용은 src/pages/ 아래에 있다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Upload,
  Users,
  UserCog,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { UploadPage } from '@/components/UploadPage';
import { AdminUsersPage } from '@/components/AdminUsersPage';
import { Login, type LoginResult } from '@/pages/LoginPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { Dashboard } from '@/pages/DashboardPage';
import { ReviewTable } from '@/pages/ReviewStatusPage';
import { JobsPage } from '@/pages/JobsPage';
import { UsersPage } from '@/pages/SmeUsersPage';
import { ReviewWorkspace } from '@/pages/SmeReviewPage';
import { HistoryPage } from '@/pages/ReviewHistoryPage';
import { MyAssignmentsPage } from '@/pages/MyAssignmentsPage';
import type { Role, User } from '@/types';

// ── 라우트 정의 ─────────────────────────────────────────────────────
// 사이드바 메뉴 = 이 목록. 목록에 없는 화면(직무 상세·직무 검토)은 title에서만 이름을 찾는다.
type NavItem = { to: string; label: string; sub: string; Icon: typeof LayoutDashboard };

const adminNav: NavItem[] = [
  { to: '/dashboard', label: '대시보드', sub: '전체 검토 현황을 확인하세요', Icon: LayoutDashboard },
  { to: '/reviews', label: '검토 현황', sub: 'SME별 검토 진행 상태', Icon: BarChart3 },
  { to: '/jobs', label: '직무정보 관리', sub: '등록된 직무정보를 관리하세요', Icon: FileSpreadsheet },
  { to: '/upload', label: '직무정보 업로드', sub: 'Excel 파일로 일괄 등록', Icon: Upload },
  { to: '/users', label: 'SME 계정 관리', sub: 'SME 계정을 등록·관리하세요', Icon: Users },
  { to: '/admin-users', label: '관리자 계정 관리', sub: '관리자 계정을 등록·관리하세요', Icon: UserCog },
];

const smeNav: NavItem[] = [
  { to: '/assignments', label: '내 검토 목록', sub: '배정된 직무를 검토해 주세요', Icon: ClipboardList },
  { to: '/history', label: '검토 이력', sub: '내 검토 이력을 확인하세요', Icon: Clock3 },
];

const adminHome = '/dashboard';
const smeHome = '/assignments';

// 헤더 제목. 앞이 더 구체적인 경로여야 한다.
const titles: [string, string][] = [
  ['/dashboard', '관리자 대시보드'],
  ['/reviews', 'SME 검토 현황'],
  ['/jobs', '직무정보 관리'],
  ['/upload', '직무정보 업로드'],
  ['/users', 'SME 계정 관리'],
  ['/admin-users', '관리자 계정 관리'],
  ['/assignments', '내 검토 목록'],
  ['/review', '직무정보 검토'],
  ['/history', '검토 이력'],
];

function titleOf(pathname: string) {
  const hit = titles.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : 'Job Review Architecture';
}

// DashboardPage가 아직 쓰는 옛 키(go('upload')) → 경로.
const legacyKeyToPath: Record<string, string> = {
  dashboard: '/dashboard',
  reviews: '/reviews',
  jobs: '/jobs',
  upload: '/upload',
  users: '/users',
  'admin-users': '/admin-users',
  review: '/assignments',
  history: '/history',
};

// ── 이탈 가드 ───────────────────────────────────────────────────────
// SME 검토 화면이 onDirtyChange(true)를 부르면 사이드바 이동·새로고침 전에 확인을 거친다.
const DirtyContext = React.createContext<{ setDirty: (d: boolean) => void; confirmLeave: () => boolean }>({
  setDirty: () => {},
  confirmLeave: () => true,
});

// ── 세션 ────────────────────────────────────────────────────────────

/** 로그인된 auth 사용자 → 화면이 쓰는 User. 권한이 없으면 사유를 담아 throw 한다. */
async function loadUser(authUserId: string): Promise<User> {
  if (!supabase) throw new Error('데이터베이스에 연결되어 있지 않습니다. 관리자에게 문의해 주세요.');
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle();
  if (error) throw new Error('사용자 권한 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  if (!profile) throw new Error('사용자 권한 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.');
  if (!profile.active) throw new Error('비활성화된 계정입니다. 관리자에게 문의해 주세요.');

  // 마이그레이션이 아직 적용되지 않은 DB에는 must_change_password 컬럼이 없다. 그때는 게이트가 조용히 꺼진 상태가 되는데,
  // 화면에도 로그에도 흔적이 없으면 운영자가 이 창을 알아챌 방법이 없다. 그래서 사실만 콘솔에 남긴다.
  if (!('must_change_password' in profile))
    console.warn(
      '[App] Phase 0 마이그레이션 미적용 — 비밀번호 강제 변경 게이트가 꺼져 있다. supabase/APPLY_2026-09-01_phase0.sql을 먼저 적용해 주세요.',
    );

  let companyName = '';
  if (profile.company_id) {
    const { data: comp } = await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle();
    companyName = comp?.name || '';
  }
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    organization: profile.organization,
    title: profile.title,
    role: (profile.role === 'admin' ? 'admin' : 'sme') as Role,
    company_id: profile.company_id || null,
    company_name: companyName,
    // 마이그레이션이 아직 적용되지 않은 DB에는 이 컬럼이 없다. select('*')로 읽으므로 그때는 값이 undefined로 온다.
    // 없는 컬럼 때문에 앱 전체가 로그인 불가가 되는 편보다 "변경 불필요"로 보고 통과시키는 편이 안전하다
    // — 컬럼이 생기면 default true가 그대로 들어와 강제 변경이 곧바로 작동한다.
    must_change_password: profile.must_change_password === true,
  };
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all'); // 관리자 회사 필터

  // 부팅과 로그인이 같은 경로를 쓰도록, 프로필 조회는 여기 한 곳에서만 한다.
  useEffect(() => {
    if (!supabase) {
      setBooting(false);
      return;
    }
    const auth = supabase.auth;
    let cancelled = false;
    let currentId: string | null = null;

    async function apply(authUserId: string | undefined) {
      if (!authUserId) {
        currentId = null;
        if (!cancelled) setUser(null);
        return;
      }
      if (authUserId === currentId) return; // 토큰 갱신 등: 이미 같은 사용자를 들고 있다.
      currentId = authUserId;
      try {
        const u = await loadUser(authUserId);
        if (!cancelled) setUser(u);
      } catch (e) {
        currentId = null;
        if (!cancelled) {
          setUser(null);
          setLoginError(e instanceof Error ? e.message : '로그인 정보를 확인할 수 없습니다.');
        }
        await auth.signOut();
      }
    }

    auth
      .getSession()
      .then(({ data }) => apply(data.session?.user?.id))
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    // 토큰 만료·다른 탭 로그아웃을 반영한다. 콜백 안에서 곧바로 supabase를 부르면 잠길 수 있어 한 틱 미룬다.
    const { data: sub } = auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return; // getSession이 이미 처리했다.
      setTimeout(() => {
        void apply(session?.user?.id);
      }, 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 반환값은 로그인 화면의 잠금 카운터가 쓴다 — 자격 증명이 거부된 경우('invalid')만 연속 실패로 센다.
  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    setLoginError('');
    if (!supabase) {
      setLoginError('데이터베이스에 연결되어 있지 않습니다. 관리자에게 문의해 주세요.');
      return 'error';
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    // 성공하면 onAuthStateChange가 프로필을 읽어 user를 세팅한다(권한 오류 문구도 그쪽에서 나온다).
    if (error) {
      setLoginError('이메일 또는 비밀번호를 확인해 주세요.');
      return 'invalid';
    }
    return 'ok';
  }, []);

  const logout = useCallback(async () => {
    setLoginError('');
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }, []);

  if (booting)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-foreground-subtle">
        불러오는 중…
      </div>
    );
  if (!user) return <Login onLogin={login} error={loginError} />;

  // 강제 게이트 — 라우터를 아예 띄우지 않는다. 라우트 가드를 두면 직접 URL 입력으로 한 번은 화면이 그려지므로,
  // 진입 자체를 막는 이 방식이 §10 P0 DoD ②("변경 없이는 어떤 화면에도 진입 불가")를 그대로 만족한다.
  if (user.must_change_password)
    return (
      <ChangePasswordPage
        user={user}
        onChanged={() => setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev))}
        onLogout={logout}
      />
    );

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Shell user={user} onLogout={logout} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
    </BrowserRouter>
  );
}

// ── 셸 ──────────────────────────────────────────────────────────────

function Shell({
  user,
  onLogout,
  companyFilter,
  setCompanyFilter,
}: {
  user: User;
  onLogout: () => void;
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { pathname } = useLocation();
  const isAdmin = user.role === 'admin';
  const nav = isAdmin ? adminNav : smeNav;
  const home = isAdmin ? adminHome : smeHome;
  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  const confirmLeave = useCallback(
    () =>
      !dirty ||
      window.confirm('저장하지 않은 검토 내용이 있어요. 이 화면을 떠나면 작성 중인 내용이 사라집니다. 이동할까요?'),
    [dirty],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const guard = React.useMemo(() => ({ setDirty, confirmLeave }), [confirmLeave]);

  return (
    <DirtyContext.Provider value={guard}>
      <div className="min-h-screen bg-background text-foreground">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-[#182635] text-white lg:block">
          <SidebarBody items={nav} onNavigate={closeDrawer} onLogout={onLogout} />
        </aside>

        <MobileDrawer open={mobileOpen} onClose={closeDrawer}>
          <SidebarBody items={nav} onNavigate={closeDrawer} onLogout={onLogout} />
        </MobileDrawer>

        <div className="lg:pl-64">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-border bg-card/95 px-5 backdrop-blur lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="메뉴 열기"
                aria-expanded={mobileOpen}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-element text-foreground-muted hover:bg-muted lg:hidden"
              >
                <Menu size={20} aria-hidden="true" />
              </button>
              <div>
                <p className="text-xs text-foreground-subtle">{isAdmin ? '관리자 포털' : 'SME 검토 포털'}</p>
                <h1 className="text-lg font-semibold text-foreground">{titleOf(pathname)}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-foreground">{user.name}</p>
                <p className="text-xs text-foreground-subtle">
                  {user.organization} · {user.title}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-subtle text-sm font-semibold text-primary">
                {user.name.slice(0, 1)}
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1500px] p-5 lg:p-8">
            <Routes>
              {isAdmin ? (
                <>
                  <Route
                    path="/dashboard"
                    element={<DashboardRoute companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/reviews"
                    element={<ReviewTable companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route path="/jobs" element={<JobsRoute userId={user.id} />} />
                  <Route path="/jobs/:jobId" element={<JobsRoute userId={user.id} />} />
                  <Route path="/upload" element={<UploadPage />} />
                  <Route
                    path="/users"
                    element={<UsersPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route path="/admin-users" element={<AdminUsersPage currentUser={user} />} />
                </>
              ) : (
                <>
                  <Route path="/assignments" element={<MyAssignmentsPage user={user} />} />
                  <Route path="/review" element={<ReviewRoute user={user} />} />
                  <Route path="/review/:jobId" element={<ReviewRoute user={user} />} />
                  <Route path="/history" element={<HistoryPage user={user} />} />
                </>
              )}
              {/* 역할에 맞지 않는 경로는 각 역할의 홈으로 */}
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </DirtyContext.Provider>
  );
}

function SidebarBody({
  items,
  onNavigate,
  onLogout,
}: {
  items: NavItem[];
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { confirmLeave } = React.useContext(DirtyContext);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2e9b9a]">
          <ClipboardCheck size={19} aria-hidden="true" />
        </div>
        <div>
          <p className="text-[15px] font-semibold tracking-tight">Job Review Architecture</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Workforce platform</p>
        </div>
      </div>
      {/* 짧은 뷰포트·확대에서도 메뉴가 잘리지 않도록 nav만 스크롤한다. */}
      <nav aria-label="주요 메뉴" className="flex-1 space-y-1 overflow-y-auto px-3 py-6">
        {items.map(({ to, label, sub, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={(e) => {
              if (!confirmLeave()) {
                e.preventDefault();
                return;
              }
              onNavigate();
            }}
            className={({ isActive }) =>
              `flex min-h-11 w-full items-center gap-3 rounded-element px-3 py-3 text-left text-sm transition ${
                isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm">{label}</span>
                  <span
                    className={`mt-0.5 block text-[11px] leading-tight ${isActive ? 'text-slate-300' : 'text-slate-500'}`}
                  >
                    {sub}
                  </span>
                </div>
                {isActive && <ChevronRight size={15} className="ml-auto shrink-0 text-[#73d0c5]" aria-hidden="true" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="shrink-0 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-11 w-full items-center gap-3 rounded-element px-3 py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <LogOut size={16} aria-hidden="true" /> 로그아웃
        </button>
      </div>
    </div>
  );
}

/** 모바일 메뉴. <dialog>가 배경 오버레이·ESC·포커스 트랩을 브라우저 기본기로 처리한다. */
function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="메뉴"
      onCancel={(e) => {
        e.preventDefault(); // 상태를 통해 닫아 open과 어긋나지 않게 한다.
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // ::backdrop 클릭은 dialog로 전달된다.
      }}
      className="m-0 h-[100dvh] max-h-none w-64 max-w-[85vw] bg-[#182635] p-0 text-white backdrop:bg-slate-900/50 lg:hidden"
    >
      {children}
    </dialog>
  );
}

// ── 라우트 어댑터 (URL ↔ 화면 prop) ─────────────────────────────────

function DashboardRoute({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <Dashboard
      go={(key: string) => navigate(legacyKeyToPath[key] ?? adminHome)}
      companyFilter={companyFilter}
      setCompanyFilter={setCompanyFilter}
    />
  );
}

function JobsRoute({ userId }: { userId: string }) {
  const { jobId } = useParams();
  const navigate = useNavigate();
  return (
    <JobsPage
      userId={userId}
      selectedJobId={jobId ?? null}
      onSelectJob={(next) => navigate(next ? `/jobs/${next}` : '/jobs')}
    />
  );
}

function ReviewRoute({ user }: { user: User }) {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { setDirty, confirmLeave } = React.useContext(DirtyContext);

  // 검토 화면을 벗어나면 가드를 반드시 푼다(제출 후 남아 있으면 다른 화면에서도 확인창이 뜬다).
  useEffect(() => () => setDirty(false), [setDirty]);

  return (
    <ReviewWorkspace
      user={user}
      jobId={jobId}
      onDirtyChange={setDirty}
      onBack={() => {
        if (confirmLeave()) navigate(smeHome);
      }}
      onSelectJob={(next) => navigate(`/review/${next}`, { replace: true })}
    />
  );
}

export default App;
