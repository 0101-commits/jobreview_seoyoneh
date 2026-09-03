// 앱 셸 — 세션 부팅·구독 / 로그인·로그아웃 / 역할(ADMIN·SME) 분기 / 사이드바·헤더 / 라우팅만 담당한다.
// 각 화면의 실제 내용은 src/pages/ 아래에 있다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  FileSpreadsheet,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquareText,
  PieChart,
  Settings,
  Upload,
  Users,
  UserCog,
  UserPlus,
} from 'lucide-react';
import { isResetPasswordPath, supabase } from '@/lib/supabase';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UploadPage } from '@/components/UploadPage';
import { AdminUsersPage } from '@/components/AdminUsersPage';
import { Login, type LoginResult } from '@/pages/LoginPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { Dashboard } from '@/pages/DashboardPage';
import { ReviewTable } from '@/pages/ReviewStatusPage';
import { JobsPage } from '@/pages/JobsPage';
import { UsersPage } from '@/pages/SmeUsersPage';
import { AssignmentAdminPage } from '@/pages/AssignmentAdminPage';
import { ReviewWorkspace } from '@/pages/SmeReviewPage';
import { HistoryPage } from '@/pages/ReviewHistoryPage';
import { MyAssignmentsPage } from '@/pages/MyAssignmentsPage';
import { GuidePage } from '@/pages/GuidePage';
import { MyInquiriesPage } from '@/pages/MyInquiriesPage';
import { ProgressMatrixPage } from '@/pages/ProgressMatrixPage';
import { WorkbenchPage } from '@/pages/WorkbenchPage';
import { JobComparePage } from '@/pages/workbench/compare';
import { InquiryInboxPage } from '@/pages/InquiryInboxPage';
import { FteAnalyticsPage } from '@/pages/FteAnalyticsPage';
import { ExportsPage } from '@/pages/ExportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { GUIDE_REOPEN_LINK } from '@/pages/sme-review/copy';
import type { StepNo } from '@/pages/sme-review/wizardTypes';
import type { Role, User } from '@/types';

// ── 라우트 정의 ─────────────────────────────────────────────────────
// 사이드바 메뉴 = 이 목록. 목록에 없는 화면(직무 상세·직무 검토)은 title에서만 이름을 찾는다.
type NavItem = { to: string; label: string; sub: string; Icon: typeof LayoutDashboard };
/**
 * 사이드바 묶음(v2 §6-5). 13개 평면 메뉴를 준비 → 운영 → 검토 → 산출 → 설정 다섯 그룹으로 나눈다.
 * 순서가 관리자 흐름(§5-2)과 같다 — 첫 사용에서 무엇부터 해야 하는지가 순서로 읽혀야 한다.
 */
type NavGroup = { title: string; items: NavItem[] };

const adminNav: NavGroup[] = [
  {
    title: '준비',
    items: [
      { to: '/upload', label: '직무정보 업로드', sub: 'Excel 파일로 일괄 등록', Icon: Upload },
      { to: '/jobs', label: '직무정보 관리', sub: '등록된 직무정보를 관리하세요', Icon: FileSpreadsheet },
      { to: '/users', label: 'SME 계정 관리', sub: 'SME 계정을 등록·관리하세요', Icon: Users },
      { to: '/admin-users', label: '관리자 계정 관리', sub: '관리자 계정을 등록·관리하세요', Icon: UserCog },
      // SME 화면의 '/assignments'(내 검토 목록)와 다른 화면이다. 라벨에 'SME'를 붙여 구분한다.
      { to: '/assignments-admin', label: 'SME 배정 관리', sub: '직무별 SME 1~2명(R6) 점검·조정', Icon: UserPlus },
    ],
  },
  {
    title: '운영',
    items: [
      { to: '/dashboard', label: '대시보드', sub: '전체 검토 현황을 확인하세요', Icon: LayoutDashboard },
      // §5-2 라우트 표의 문언을 그대로 쓴다(진행 현황 · 검토 워크벤치 · 문의 인박스).
      { to: '/progress', label: '진행 현황', sub: '조직×직무 매트릭스 · 리마인더', Icon: LayoutGrid },
      { to: '/inbox', label: '문의 인박스', sub: '문의 답변·상태 관리', Icon: Inbox },
    ],
  },
  {
    title: '검토',
    items: [
      { to: '/workbench', label: '검토 워크벤치', sub: '제출 큐 · SME 비교 · 승인/반려', Icon: ClipboardCheck },
      { to: '/reviews', label: '검토 현황', sub: 'SME별 검토 진행 상태', Icon: BarChart3 },
    ],
  },
  {
    title: '산출',
    items: [
      { to: '/analytics/fte', label: 'FTE 분포', sub: '직무·조직별 투입 비중 집계', Icon: PieChart },
      { to: '/exports', label: '산출물 내보내기', sub: '계약 산출물 E1~E5 · 스냅샷', Icon: Download },
    ],
  },
  {
    title: '설정',
    items: [{ to: '/settings', label: '운영 설정', sub: '마감일 · 안내문 · 예상 소요 · 문의 담당', Icon: Settings }],
  },
];

const smeNav: NavGroup[] = [
  {
    title: '검토',
    items: [
      { to: '/assignments', label: '내 검토 목록', sub: '배정된 직무를 검토해 주세요', Icon: ClipboardList },
      { to: '/history', label: '검토 이력', sub: '내 검토 이력을 확인하세요', Icon: Clock3 },
    ],
  },
  {
    title: '도움',
    items: [
      { to: '/inquiries', label: '내 문의', sub: '문의하고 답변을 확인하세요', Icon: MessageSquareText },
      // 가이드는 최초 1회 필수 통과 뒤에도 여기서 상시 다시 볼 수 있다(§6-1).
      { to: '/guide', label: GUIDE_REOPEN_LINK, sub: '조사 취지와 5단계 안내', Icon: BookOpen },
    ],
  },
];

const adminHome = '/dashboard';
const smeHome = '/assignments';

// 헤더 제목. 앞이 더 구체적인 경로여야 한다.
const titles: [string, string][] = [
  ['/dashboard', '관리자 대시보드'],
  ['/reviews', 'SME 검토 현황'],
  ['/progress', '진행 현황'],
  // '/workbench'가 '/workbench/:jobId'(비교 뷰)까지 함께 잡는다 — titleOf가 startsWith로도 본다.
  ['/workbench', '검토 워크벤치'],
  ['/analytics/fte', 'FTE 분포'],
  ['/inbox', '문의 인박스'],
  ['/jobs', '직무정보 관리'],
  ['/upload', '직무정보 업로드'],
  ['/users', 'SME 계정 관리'],
  ['/assignments-admin', 'SME 배정 관리'],
  ['/admin-users', '관리자 계정 관리'],
  ['/exports', '산출물 내보내기'],
  ['/settings', '운영 설정'],
  ['/assignments', '내 검토 목록'],
  ['/review', '직무정보 검토'],
  ['/history', '검토 이력'],
  ['/guide', '시작 가이드'],
  ['/inquiries', '내 문의'],
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
//
// v2 §6-4: 예전에는 window.confirm으로 물었다. 브라우저 기본 창은 문구·버튼 위계를 정할 수 없고
// 모바일에서는 맥락이 끊긴다. 대신 앱 안의 ConfirmDialog로 묻는데, 그 확인은 비동기라
// "true/false를 즉시 돌려주는" 옛 계약(confirmLeave)을 쓸 수 없다.
// 그래서 계약을 뒤집었다 — 떠나는 동작을 콜백으로 넘기고, 확인이 끝나면 셸이 그 콜백을 실행한다.
const DirtyContext = React.createContext<{ setDirty: (d: boolean) => void; requestLeave: (run: () => void) => void }>({
  setDirty: () => {},
  requestLeave: (run) => run(),
});

/*
 * 유휴 자동 로그아웃(§8 S3 · 결정 D8 = 30분).
 *
 * 왜 필요한가: 현장 SME가 공용 PC를 쓰는 것을 전제한다. persistSession이 기본으로 켜져 있어
 * 브라우저를 닫아도 세션이 남고, 다음 사람이 그 화면을 그대로 이어 볼 수 있었다.
 *
 * 왜 이 방식인가: 서버 강제가 아니라 화면의 완충 장치다(진짜 방어선은 Auth의 JWT 만료·refresh
 * 재사용 감지 설정이며 그 점검표는 OPERATIONS에 있다). 그래서 조작 흔적(키·포인터·스크롤)이
 * 30분 없으면 로그아웃하고, 1분 전에 한 번 알린다 — 작성 중인 내용이 있으면 미리 저장할 수 있게.
 */
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const IDLE_WARN_MS = 60 * 1000;

function useIdleLogout(active: boolean, onIdle: () => void) {
  const [warnLeft, setWarnLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setWarnLeft(null);
      return;
    }
    let last = Date.now();
    const bump = () => {
      last = Date.now();
      setWarnLeft((prev) => (prev === null ? prev : null));
    };
    // passive: 스크롤 성능을 건드리지 않는다. capture: 입력이 어느 요소에서 나도 받는다.
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'visibilitychange'] as const;
    for (const type of events) window.addEventListener(type, bump, { passive: true, capture: true });

    const timer = setInterval(() => {
      const idle = Date.now() - last;
      if (idle >= IDLE_LIMIT_MS) {
        onIdle();
        return;
      }
      const left = IDLE_LIMIT_MS - idle;
      setWarnLeft(left <= IDLE_WARN_MS ? Math.ceil(left / 1000) : null);
    }, 5000);

    return () => {
      clearInterval(timer);
      for (const type of events) window.removeEventListener(type, bump, { capture: true });
    };
  }, [active, onIdle]);

  return warnLeft;
}

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
    // 컬럼이 없는 DB(Phase 1 마이그레이션 미적용)에서는 undefined가 되어 가이드 게이트가 꺼진다.
    // 통과 시각을 기록할 곳이 없는데 가이드를 강제하면 SME가 앱에 영영 들어오지 못한다.
    guide_completed_at: 'guide_completed_at' in profile ? profile.guide_completed_at || null : undefined,
  };
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all'); // 관리자 회사 필터
  // 비밀번호 재설정 흐름(F1). 주소가 진실이고, PASSWORD_RECOVERY 이벤트는 보조 신호다
  // — supabase-js가 해시(#type=recovery)를 먼저 지워도 경로는 남기 때문이다.
  const [recovery, setRecovery] = useState(isResetPasswordPath);

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
      // 재설정 메일 링크로 들어온 세션. 주소가 /reset-password가 아니어도(메일 클라이언트가 주소를
      // 바꾸는 경우) 이 이벤트로 재설정 화면을 띄운다.
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
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

  // 유휴 30분 로그아웃(§8 S3 · D8). 로그인 상태에서만 돈다.
  const idleLeft = useIdleLogout(Boolean(user), logout);

  // 재설정을 마치거나 포기했을 때 — 주소에서 /reset-password를 지워 새로고침해도 다시 열리지 않게 한다.
  const exitRecovery = useCallback(() => {
    window.history.replaceState(null, '', import.meta.env.BASE_URL);
    setRecovery(false);
  }, []);

  if (booting)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background t-label text-foreground-subtle">
        불러오는 중…
      </div>
    );

  // 재설정 게이트(F1) — 로그인 게이트보다 앞이다. 링크가 만료돼 세션이 없으면
  // ChangePasswordPage가 "링크가 만료되었어요"를 보여 주고 로그인 화면으로 되돌린다.
  if (recovery)
    return (
      <ChangePasswordPage
        mode="recovery"
        user={user}
        onChanged={() => {
          setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
          exitRecovery();
        }}
        onLogout={async () => {
          await logout();
          exitRecovery();
        }}
      />
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

  // 시작 가이드 게이트(§6-1) — SME는 최초 1회 반드시 통과한다. 순서는 비밀번호 변경이 먼저다(위 게이트).
  // Routes를 아예 걸지 않으므로 직접 URL을 쳐도 어떤 화면에도 닿지 못한다(비밀번호 게이트와 같은 방식).
  // 다만 BrowserRouter 안쪽에 둔다 — 가이드 화면도 링크·이동을 쓸 수 있어야 하기 때문이다.
  const needsGuide = user.role === 'sme' && user.guide_completed_at === null;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/* 유휴 경고 — 남은 시간을 초 단위로 알린다. 아무 키·클릭이면 사라진다. */}
      {idleLeft !== null && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-toast flex justify-center px-4 pt-3"
        >
          <p className="rounded-element border border-warning-border bg-warning-muted px-4 py-2 t-label text-warning shadow-2">
            {idleLeft}초 후 자동 로그아웃돼요. 계속하시려면 화면을 클릭해 주세요.
          </p>
        </div>
      )}
      {needsGuide ? (
        <GuidePage
          user={user}
          onDone={() => setUser((prev) => (prev ? { ...prev, guide_completed_at: new Date().toISOString() } : prev))}
        />
      ) : (
        <Shell user={user} onLogout={logout} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
      )}
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
  const navGroups = isAdmin ? adminNav : smeNav;
  const home = isAdmin ? adminHome : smeHome;
  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  /** 확인을 기다리는 이탈 동작. null이면 확인창이 닫힌 상태다. */
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);

  const requestLeave = useCallback(
    (run: () => void) => {
      if (!dirty) {
        run();
        return;
      }
      setPendingLeave({ run });
    },
    [dirty],
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const guard = React.useMemo(() => ({ setDirty, requestLeave }), [requestLeave]);

  return (
    <DirtyContext.Provider value={guard}>
      <div className="min-h-screen bg-background text-foreground">
        <aside className="fixed inset-y-0 left-0 z-drawer hidden w-64 border-r border-border bg-inverse text-inverse-label lg:block">
          <SidebarBody groups={navGroups} onNavigate={closeDrawer} onLogout={onLogout} />
        </aside>

        <MobileDrawer open={mobileOpen} onClose={closeDrawer}>
          <SidebarBody groups={navGroups} onNavigate={closeDrawer} onLogout={onLogout} />
        </MobileDrawer>

        {/* 이탈 확인 — 사이드바 이동·뒤로가기 버튼이 모두 이 한 창을 쓴다. */}
        {pendingLeave && (
          <ConfirmDialog
            title="작성 중인 내용이 사라져요"
            body="저장하지 않은 검토 내용이 있어요. 이 화면을 떠나면 작성 중인 내용이 사라집니다."
            confirmLabel="이동하기"
            cancelLabel="여기 머무르기"
            tone="negative"
            onConfirm={() => {
              const run = pendingLeave.run;
              setPendingLeave(null);
              run();
            }}
            onCancel={() => setPendingLeave(null)}
          />
        )}

        <div className="lg:pl-64">
          <header className="sticky top-0 z-sticky flex h-20 items-center justify-between border-b border-border bg-card/95 px-5 backdrop-blur lg:px-8">
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
                <p className="t-caption text-foreground-subtle">{isAdmin ? '관리자 포털' : 'SME 검토 포털'}</p>
                <h1 className="t-headline text-foreground">{titleOf(pathname)}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="t-label font-medium text-foreground">{user.name}</p>
                <p className="t-caption text-foreground-subtle">
                  {user.organization} · {user.title}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-subtle t-label font-semibold text-primary">
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
                    element={
                      <ReviewsRoute companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                  <Route
                    path="/progress"
                    element={<ProgressMatrixPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/workbench"
                    element={<WorkbenchRoute companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route path="/workbench/:jobId" element={<CompareRoute />} />
                  <Route
                    path="/inbox"
                    element={<InquiryInboxPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/jobs"
                    element={
                      <JobsRoute userId={user.id} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                  <Route
                    path="/jobs/:jobId"
                    element={
                      <JobsRoute userId={user.id} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                  <Route
                    path="/upload"
                    element={<UploadPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/users"
                    element={<UsersPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/assignments-admin"
                    element={
                      <AssignmentAdminPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                  <Route path="/admin-users" element={<AdminUsersPage currentUser={user} />} />
                  <Route
                    path="/analytics/fte"
                    element={<FteAnalyticsPage companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />}
                  />
                  <Route
                    path="/exports"
                    element={
                      <ExportsPage user={user} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <SettingsPage user={user} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />
                    }
                  />
                </>
              ) : (
                <>
                  <Route path="/assignments" element={<MyAssignmentsPage user={user} />} />
                  {/* 직무 없이 들어온 /review는 배정 목록으로 돌려보낸다 — 검토할 직무는 배정이 정한다(§5-1). */}
                  <Route path="/review" element={<Navigate to={smeHome} replace />} />
                  <Route path="/review/:jobId" element={<ReviewRoute user={user} />} />
                  <Route path="/guide" element={<GuideRoute user={user} />} />
                  <Route path="/inquiries" element={<MyInquiriesPage user={user} />} />
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
  groups,
  onNavigate,
  onLogout,
}: {
  groups: NavGroup[];
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { requestLeave } = React.useContext(DirtyContext);
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-20 shrink-0 items-center gap-3 border-b border-inverse-label/10 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand">
          <ClipboardCheck size={19} aria-hidden="true" />
        </div>
        <div>
          <p className="t-body-2 font-semibold tracking-tight">Job Review Architecture</p>
          <p className="t-caption uppercase tracking-[0.18em] text-inverse-label-muted">Workforce platform</p>
        </div>
      </div>
      {/* 짧은 뷰포트·확대에서도 메뉴가 잘리지 않도록 nav만 스크롤한다. */}
      <nav aria-label="주요 메뉴" className="flex-1 space-y-5 overflow-y-auto px-3 py-6">
        {groups.map((group) => (
          <div key={group.title}>
            {/* 그룹 제목은 조작이 아니라 이름표다 — 누를 수 없고, 낭독기에는 목록의 이름으로 읽힌다. */}
            <p className="px-3 pb-1.5 t-caption font-semibold uppercase tracking-wider text-inverse-label-muted">
              {group.title}
            </p>
            <div role="group" aria-label={group.title} className="space-y-1">
              {group.items.map(({ to, label, sub, Icon }) => (
              <NavLink
                key={to}
            to={to}
            onClick={(e) => {
              // 확인이 비동기라 기본 이동을 먼저 막고, 확인이 끝난 뒤 직접 이동한다.
              e.preventDefault();
              requestLeave(() => {
                navigate(to);
                onNavigate();
              });
            }}
            className={({ isActive }) =>
              `flex min-h-11 w-full items-center gap-3 rounded-element px-3 py-3 text-left t-label transition ${
                isActive
                  ? 'bg-inverse-label/10 text-inverse-label'
                  : 'text-inverse-label-muted hover:bg-inverse-label/5 hover:text-inverse-label'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="block t-label">{label}</span>
                  {/*
                    반전 표면(--inverse-bg #182635)의 보조설명. 대비는 이 토큰 쌍으로 고정된다:
                    --inverse-label-muted(#94a3b8)가 #182635 위 5.99:1로 §8 S8의 4.5:1을 넘는다.
                    활성은 --inverse-label(흰색)을 90%로 써 더 밝다 — 활성/비활성 관계는 그대로다.
                    (v2 §6-2: hex 14곳을 이 토큰들로 걷어냈다.)
                  */}
                  <span
                    className={`mt-0.5 block t-caption leading-tight ${
                      isActive ? 'text-inverse-label/90' : 'text-inverse-label-muted'
                    }`}
                  >
                    {sub}
                  </span>
                </div>
                {isActive && (
                  <ChevronRight size={15} className="ml-auto shrink-0 text-inverse-accent" aria-hidden="true" />
                )}
              </>
            )}
          </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-inverse-label/10 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-11 w-full items-center gap-3 rounded-element px-3 py-2 t-label text-inverse-label-muted hover:bg-inverse-label/5 hover:text-inverse-label"
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
      className="m-0 h-[100dvh] max-h-none w-64 max-w-[85vw] bg-inverse p-0 text-inverse-label scrim-backdrop lg:hidden"
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

/**
 * 검토 현황(/reviews). 행을 열면 직무 상세의 SME 피드백 패널로 보낸다(v2 §6-5) —
 * 예전에는 이 화면이 자기 상세 모달을 따로 갖고 있어 "직무 항목 의견만 보이는" 반쪽 화면이 됐다.
 */
function ReviewsRoute({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <ReviewTable
      companyFilter={companyFilter}
      setCompanyFilter={setCompanyFilter}
      onOpenReview={(jobId, smeId) => navigate(`/jobs/${jobId}?sme=${smeId}`)}
    />
  );
}

/** 제출 큐(/workbench) → 비교 뷰(/workbench/:jobId). 다른 관리자 화면과 같이 URL을 App이 정한다. */
function WorkbenchRoute({
  companyFilter,
  setCompanyFilter,
}: {
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <WorkbenchPage
      companyFilter={companyFilter}
      setCompanyFilter={setCompanyFilter}
      onOpenJob={(jobId) => navigate(`/workbench/${jobId}`)}
    />
  );
}

/** 비교 뷰(§6-3 ⓑ 그림 6-B). 직무 id가 없는 주소는 제출 큐로 돌려보낸다. */
function CompareRoute() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  if (!jobId) return <Navigate to="/workbench" replace />;
  return <JobComparePage jobId={jobId} onBack={() => navigate('/workbench')} />;
}

function JobsRoute({
  userId,
  companyFilter,
  setCompanyFilter,
}: {
  userId: string;
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const { jobId } = useParams();
  const navigate = useNavigate();
  // 검토 현황에서 「보기」로 넘어오면 ?sme=<id>가 붙는다 — 그 SME 카드로 스크롤한다(v2 §6-5).
  const [params] = useSearchParams();
  return (
    <JobsPage
      userId={userId}
      selectedJobId={jobId ?? null}
      onSelectJob={(next) => navigate(next ? `/jobs/${next}` : '/jobs')}
      companyFilter={companyFilter}
      setCompanyFilter={setCompanyFilter}
      focusSmeId={params.get('sme')}
    />
  );
}

// 마법사 단계는 URL(?step=1..5)이 진실이다. 새로고침·직접 링크·뒤로가기가 모두 같은 단계를 연다(§10 P2 DoD 3).
const toStepNo = (raw: string | null): StepNo | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as StepNo) : null;
};

/** 직무별 마지막 단계. 배정 목록에서 다시 들어올 때는 URL에 단계가 없어 이 값으로 이어 간다. */
const lastStepKey = (jobId: string) => `jobreview:last-step:${jobId}`;

const readLastStep = (jobId: string): StepNo | null => {
  try {
    return toStepNo(window.localStorage.getItem(lastStepKey(jobId)));
  } catch {
    return null; // 저장소가 막힌 브라우저(사생활 보호 모드 등). 단계 기억만 못 할 뿐 검토는 그대로 된다.
  }
};

function ReviewRoute({ user }: { user: User }) {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { setDirty, requestLeave } = React.useContext(DirtyContext);

  // 검토 화면을 벗어나면 가드를 반드시 푼다(제출 후 남아 있으면 다른 화면에서도 확인창이 뜬다).
  useEffect(() => () => setDirty(false), [setDirty]);

  const urlStep = toStepNo(params.get('step'));
  const step = urlStep ?? (jobId ? readLastStep(jobId) : null) ?? 1;

  // URL에 단계가 없으면 이어서 볼 단계를 URL에 적어 둔다. 이 한 번만 replace다 —
  // 뒤로가기가 "단계 없는 같은 주소"로 되돌아오는 고리를 만들지 않기 위해서다.
  useEffect(() => {
    if (urlStep === null) setParams({ step: String(step) }, { replace: true });
  }, [urlStep, step, setParams]);

  if (!jobId) return <Navigate to={smeHome} replace />;

  return (
    <ReviewWorkspace
      user={user}
      jobId={jobId}
      step={step}
      onStepChange={(next) => {
        try {
          window.localStorage.setItem(lastStepKey(jobId), String(next));
        } catch {
          // 저장소가 막혀 있어도 단계 이동 자체는 막지 않는다.
        }
        // push다(replace 아님) — 브라우저 뒤로가기로 이전 단계에 돌아갈 수 있어야 한다(§10 P2 DoD 3).
        setParams({ step: String(next) });
      }}
      onDirtyChange={setDirty}
      onBack={() => requestLeave(() => navigate(smeHome))}
      // 문의 답변 배너(§6-3 ⓒ) → '내 문의'. onBack과 같은 이탈 가드를 태운다 —
      // 검토 화면을 떠나는 이동이라 작성 중인 입력이 있으면 먼저 확인을 거쳐야 한다.
      onOpenInquiries={() => requestLeave(() => navigate('/inquiries'))}
    />
  );
}

/** 가이드 재열람(/guide). 다 보면 배정 목록으로 돌아간다 — 이때는 통과 기록이 이미 있다. */
function GuideRoute({ user }: { user: User }) {
  const navigate = useNavigate();
  return <GuidePage user={user} onDone={() => navigate(smeHome)} />;
}

export default App;
