// 운영 설정(/settings) — 관리자 전용 화면. §6-3 ⓒ "설정 — 마감일(D-day 계산 원점), 예상 소요 N분,
// 가이드 문구(마크다운), 문의 담당 표기, 리마인더 템플릿"과 §11-2 Phase 4 2번을 이행한다.
//
// 조회·저장은 전부 src/lib/settingsApi.ts를 거친다(화면에서 쿼리를 짜지 않는다 — Phase 3 관례).
// survey_settings는 회사당 한 행이라 이 화면의 모든 입력은 "지금 고른 회사 하나"에만 적용된다.
// 어느 회사를 편집 중인지 잘못 읽으면 다른 계열사의 마감일을 바꾸게 되므로, 대상 회사를 화면
// 맨 위에 크게 고정 표기한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CalendarClock, RotateCw, ShieldAlert } from 'lucide-react';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Toast, useToast } from '@/components/ui/Toast';
import { AutoTextarea } from '@/pages/sme-review/controls';
import { fetchCompaniesResult, type Company } from '@/lib/jobApi';
import {
  EXPECTED_MINUTES_MAX,
  REMINDER_TEMPLATE_MISSING_NOTE,
  fetchOperationSettings,
  reminderTemplateSupported,
  saveOperationSettings,
  type OperationSettings,
  type OperationSettingsInput,
} from '@/lib/settingsApi';
import { DEFAULT_TEMPLATES, TEMPLATE_TOKENS } from '@/lib/mailApi';
import type { User } from '@/types';

/**
 * 아직 저장된 행이 없는 회사의 초기값.
 *
 * fte_required를 false로 두는 것은 임의 선택이 아니라 **현재 서버 동작과 같은 값**이다.
 * submit_review는 설정 행이 없으면 COALESCE(…, false)로 읽어 FTE 검사를 건너뛴다
 * (20260901030000_phase1_submit_gate.sql ③). 여기서 true를 기본으로 그려 두면 저장하지 않은
 * 화면이 "검사 켜짐"으로 보이는데 실제 제출은 검사 없이 통과한다 — 화면이 거짓말을 하게 된다.
 */
const BLANK: OperationSettingsInput = {
  due_date: null,
  expected_minutes: null,
  guide_md: '',
  inquiry_contact: '',
  fte_required: false,
  reminder_subject: '',
  reminder_body_md: '',
};

function toInput(s: OperationSettings): OperationSettingsInput {
  return {
    due_date: s.due_date,
    expected_minutes: s.expected_minutes,
    guide_md: s.guide_md,
    inquiry_contact: s.inquiry_contact,
    fte_required: s.fte_required,
    reminder_subject: s.reminder_subject,
    reminder_body_md: s.reminder_body_md,
  };
}

/**
 * 마감일 미리보기 문구. DashboardPage의 dDayText와 같은 표기(D-n · D-day · D+n)를 쓴다.
 * 그 함수는 export되어 있지 않고 그 파일은 이 Phase의 소유가 아니라 여기서 같은 규칙만 되풀이한다
 * (표기가 갈리면 같은 마감일이 두 화면에서 다르게 읽힌다).
 */
function dDayPreview(date: string | null): string {
  if (!date) return '마감일 미설정 — 대시보드 D-day 지표가 비어 있게 됩니다.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((target - today) / 86400000);
  const label = days > 0 ? `D-${days}` : days === 0 ? 'D-day' : `D+${-days}`;
  return days < 0
    ? `오늘 기준 ${label} — 이미 지난 날짜입니다. 대시보드에 그대로 표시됩니다.`
    : `오늘 기준 ${label}로 표시됩니다.`;
}

function formatAt(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
}

// ── 관리자 방어 ─────────────────────────────────────────────────────
//
// 라우팅은 App.tsx가 막지만(관리자 메뉴에만 링크가 있다) 컴포넌트도 스스로 막는다.
// 주소를 직접 친 SME에게 설정 값을 그려 놓고 저장만 서버가 거절하면, 마감일·가이드 문구 같은
// 운영 정보가 그대로 노출된다. 값을 아예 불러오지 않도록 폼 자체를 렌더링하지 않는다.
function AdminOnlyNotice() {
  return (
    <div role="alert" className="rounded-container border border-border bg-card p-10 text-center">
      <ShieldAlert size={22} className="mx-auto mb-2 text-foreground-subtle" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">운영 설정은 관리자만 열 수 있습니다</p>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">
        접근 권한이 필요하면 조사 담당자에게 문의해 주세요.
      </p>
    </div>
  );
}

export function SettingsPage({
  user,
  companyFilter,
  setCompanyFilter,
}: {
  user: User;
  /** 관리자 화면 공통 계열사 필터. 넘기면 이 화면의 선택이 다른 화면과 함께 움직인다(§10 P3 DoD ④). */
  companyFilter?: string;
  setCompanyFilter?: (v: string) => void;
}) {
  if (user.role !== 'admin') return <AdminOnlyNotice />;
  return <SettingsForm user={user} companyFilter={companyFilter} setCompanyFilter={setCompanyFilter} />;
}

function SettingsForm({
  user,
  companyFilter,
  setCompanyFilter,
}: {
  user: User;
  companyFilter?: string;
  setCompanyFilter?: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyError, setCompanyError] = useState('');
  // 편집 대상 회사. 공통 필터가 특정 회사면 그 값, '전체 회사'면 본인 소속으로 시작한다 —
  // survey_settings는 회사당 한 행이라 '전체'라는 대상이 존재하지 않는다.
  const [companyId, setCompanyId] = useState<string>(
    companyFilter && companyFilter !== 'all' ? companyFilter : (user.company_id ?? ''),
  );

  const [saved, setSaved] = useState<OperationSettings | null>(null);
  const [form, setForm] = useState<OperationSettingsInput>(BLANK);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * 리마인더 템플릿 컬럼이 이 DB에 있는가. settingsApi가 첫 조회에서 판정한 값을 그대로 읽는다
   * (조회 전에는 null이라 false로 본다 — 없는 것으로 보는 쪽이 안전하다).
   */
  const [reminderReady, setReminderReady] = useState(false);
  const { toast, showToast, dismiss } = useToast();

  useEffect(() => {
    void fetchCompaniesResult().then((res) => {
      if (res.ok) {
        setCompanies(res.data);
        setCompanyError('');
        // 본인 소속도 공통 필터도 없을 때만 첫 회사로 시작한다.
        setCompanyId((cur) => cur || res.data[0]?.id || '');
      } else {
        // 목록을 비우기만 하면 "계열사가 없다"로 읽힌다. 조회에 실패했다고 적는다(jobApi.ts 상단 원칙).
        setCompanies([]);
        setCompanyError('계열사 목록을 불러오지 못했습니다. 회사를 고를 수 없으니 새로고침 후 다시 시도해 주세요.');
      }
    });
  }, []);

  // 다른 화면에서 계열사 필터를 바꾼 채 들어온 경우를 따라간다('전체 회사'는 대상이 없으므로 무시).
  useEffect(() => {
    if (companyFilter && companyFilter !== 'all') setCompanyId(companyFilter);
  }, [companyFilter]);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSaveError('');
    void (async () => {
      const res = await fetchOperationSettings(companyId);
      if (cancelled) return;
      if (res.ok) {
        setSaved(res.data);
        setForm(res.data ? toInput(res.data) : BLANK);
        setLoadError('');
      } else {
        // 실패를 빈 폼으로 위장하지 않는다 — 그 상태에서 저장하면 기존 값이 통째로 지워진다.
        setSaved(null);
        setForm(BLANK);
        setLoadError(res.error);
      }
      setReminderReady(reminderTemplateSupported() === true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  const patch = useCallback((p: Partial<OperationSettingsInput>) => {
    setForm((f) => ({ ...f, ...p }));
    setSaveError('');
  }, []);

  const baseline = useMemo(() => (saved ? toInput(saved) : BLANK), [saved]);
  const dirty = useMemo(
    () => (Object.keys(baseline) as (keyof OperationSettingsInput)[]).some((k) => baseline[k] !== form[k]),
    [baseline, form],
  );

  const companyName =
    companies.find((c) => c.id === companyId)?.name ||
    (companyId === user.company_id ? (user.company_name ?? '') : '') ||
    '';
  // 게이트를 켜져 있던 상태에서 끄는 저장인지. 화면 경고와 저장 전 확인에 함께 쓴다.
  const turningGateOff = !!saved?.fte_required && !form.fte_required;

  function onPickCompany(id: string) {
    if (id === companyId) return;
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 회사를 바꾸면 입력한 내용이 사라집니다. 계속할까요?')) {
      return;
    }
    setCompanyId(id);
    // 공통 필터도 함께 옮겨 다른 관리자 화면이 같은 회사를 보게 한다.
    // 빈 값('전체 회사')은 'all'로 되돌려 보낸다 — 다른 화면은 'all'만 전체 보기로 알아듣고,
    // 빈 문자열이 그대로 넘어가면 company_id = '' 로 조회해 빈 목록이나 오류가 된다.
    setCompanyFilter?.(id || 'all');
  }

  async function handleSave() {
    if (saving || !companyId) return;
    if (
      turningGateOff &&
      !window.confirm(
        '투입 비중(FTE) 합계 검사를 끕니다.\n' +
          '저장하면 이 회사의 SME는 합계가 100%가 아니어도, 배분을 한 줄도 하지 않아도 제출할 수 있습니다.\n' +
          '계속할까요?',
      )
    ) {
      return;
    }
    setSaving(true);
    setSaveError('');
    const res = await saveOperationSettings(companyId, form, saved);
    setSaving(false);
    if (!res.ok) {
      // 저장 실패를 삼키지 않는다. 사유를 그대로 보이고 입력값은 그대로 둔다 — 같은 버튼으로 다시 시도한다.
      setSaveError(res.error);
      return;
    }
    setSaved(res.data);
    setForm(toInput(res.data));
    showToast({
      type: 'success',
      msg: `${companyName || '선택한 회사'} 운영 설정을 저장했습니다.${
        res.data.fte_required ? '' : ' (투입 비중 합계 검사는 꺼진 상태입니다)'
      }`,
    });
  }

  const minutesText = form.expected_minutes === null ? '' : String(form.expected_minutes);

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            §6-3 ⓒ 설정 · 마감일 · 예상 소요 · 가이드 문구 · 문의 담당
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">운영 설정</h2>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <CompanyFilterDropdown
            companies={companies}
            value={companyId || 'all'}
            onChange={(v) => onPickCompany(v === 'all' ? '' : v)}
          />
          {companyError && <p className="text-xs text-warning">{companyError}</p>}
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {/* 대상 회사 고정 표기 — 설정은 회사당 한 벌이라 "어느 회사를 고치는 중인가"가 가장 중요한 정보다. */}
      <div className="mb-5 rounded-container border border-primary/40 bg-primary-subtle p-5">
        <p className="text-xs font-medium text-primary">지금 편집 중인 회사</p>
        <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-foreground">
          <Building2 size={20} className="shrink-0 text-primary" aria-hidden="true" />
          {companyId ? companyName || '이름을 불러오지 못한 회사' : '회사를 선택해 주세요'}
        </p>
        <p className="mt-2 text-xs leading-5 text-foreground-muted">
          아래 값은 이 회사에만 적용됩니다. 다른 계열사는 위 드롭다운에서 회사를 바꿔 따로 저장해 주세요.
          {saved ? ` · 마지막 저장 ${formatAt(saved.updated_at)}` : ''}
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {loading ? '설정을 불러오는 중…' : loadError ? loadError : `${companyName} 운영 설정을 표시하고 있습니다.`}
      </p>

      {!companyId ? (
        <div className="rounded-container border border-border bg-card p-10 text-center">
          <Building2 size={22} className="mx-auto mb-2 text-foreground-subtle" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">회사를 먼저 선택해 주세요</p>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            운영 설정은 회사마다 한 벌입니다. &lsquo;전체 회사&rsquo; 상태로는 편집할 수 없습니다.
          </p>
        </div>
      ) : loading ? (
        <div className="py-12 text-center text-foreground-subtle">불러오는 중…</div>
      ) : loadError ? (
        <div role="alert" className="rounded-container border border-destructive-border bg-destructive-muted p-6 text-center">
          <AlertTriangle size={20} className="mx-auto mb-2 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium text-destructive">{loadError}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            설정이 없는 것이 아니라 불러오지 못한 상태입니다. 이대로 저장하면 기존 값을 덮어쓰게 되므로 먼저 다시
            시도해 주세요.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {!saved && (
            <p className="rounded-element border border-border bg-muted px-4 py-3 text-xs leading-5 text-foreground-muted">
              이 회사는 아직 저장된 설정이 없습니다. 아래 값을 저장하면 새로 만들어집니다. 그때까지 마감일·예상
              소요는 미설정으로, 투입 비중 합계 검사는 꺼진 상태로 동작합니다.
            </p>
          )}

          {/* ── 마감일 ── */}
          <section className="rounded-container border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <CalendarClock size={16} className="text-primary" aria-hidden="true" /> 마감일
            </h3>
            <Field
              label="조사 마감일"
              description="대시보드·SME 화면의 D-day가 이 날짜에서 계산됩니다(§6-3 ⓐ). 비워 두면 D-day 지표가 표시되지 않습니다."
              type="date"
              value={form.due_date ?? ''}
              onChange={(v) => patch({ due_date: v || null })}
              inputClassName="max-w-xs"
            />
            <p className="mt-2 text-xs leading-5 text-foreground-muted">{dDayPreview(form.due_date)}</p>
          </section>

          {/* ── 예상 소요 ── */}
          <section className="rounded-container border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">예상 소요</h3>
            <Field
              label="직무당 예상 소요(분)"
              description={`가이드 카드 ④의 "예상 소요는 직무당 약 N분" 문장에 그대로 들어갑니다(§6-1). 비워 두면 그 문장이 통째로 빠집니다 — 앱이 숫자를 지어내지 않습니다. 1~${EXPECTED_MINUTES_MAX} 사이의 정수로 입력해 주세요.`}
              type="number"
              value={minutesText}
              onChange={(v) => {
                const n = v.trim() === '' ? null : Number(v);
                patch({ expected_minutes: n !== null && Number.isFinite(n) ? n : null });
              }}
              inputClassName="max-w-[10rem]"
            />
            {/* §12 오픈이슈 1번 — 이 값은 파일럿 실측으로 확정된다. 지금 입력값은 잠정치다. */}
            <p className="mt-2 text-xs leading-5 text-foreground-muted">
              이 값은 파일럿 실측 중앙값으로 확정할 잠정치입니다(§12 오픈이슈 1번, 착수보고 11면 &ldquo;착수 후
              확정&rdquo;). 실측 중앙값은 SME 화면에 노출하지 않고 관리자만 봅니다 — 지금은 Export E5
              &lsquo;소요 실측 요약&rsquo;(직무당 중앙값)에서 확인할 수 있습니다. 대시보드 지표로 올리는 일은
              §10 P5에서 정합니다.
            </p>
          </section>

          {/* ── 가이드 추가 안내 ── */}
          <section className="rounded-container border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-1 text-sm font-semibold text-foreground">가이드 추가 안내</h3>
            {/*
             * 덮어쓰기가 아니라 덧붙이기를 택했다. §6-1의 카드 ①·③·④는 착수보고 문언 그대로이고
             * 원칙 P1이 "이 절의 문구를 UI 카피로 그대로 사용"하라고 못박고 있다. 관리자가 그 문장을
             * 통째로 대체할 수 있으면 플랫폼이 착수보고의 이행 증빙이라는 전제(§1 결론 ③)가 무너진다.
             * 그래서 이 입력은 고정 문언 아래에 붙는 별도 안내로만 쓴다.
             */}
            <p className="mb-3 text-xs leading-5 text-foreground-muted">
              시작 가이드(§6-1)의 고정 문언 <strong className="font-semibold text-foreground">아래에 덧붙는</strong>{' '}
              추가 안내입니다. 착수보고 문언은 제품 문구이므로 이 입력으로 대체되지 않습니다.
            </p>
            <label className="block">
              <span className="label">추가 안내 문구(마크다운 원문 그대로 저장)</span>
              <AutoTextarea
                id="settings-guide-md"
                value={form.guide_md}
                onChange={(v) => patch({ guide_md: v })}
                minRows={4}
                maxRows={16}
                placeholder="예) 이번 조사는 10월 10일까지입니다. 문항이 헷갈리면 문의하기로 남겨 주세요."
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-foreground-muted">
              시작 가이드 마지막 카드 아래에 &lsquo;추가 안내&rsquo;로 그대로 표시됩니다. 마크다운 렌더러는 쓰지
              않으므로 기호(**굵게**, - 목록 등)는 친 그대로 보입니다 — 아래 미리보기가 SME에게 보이는 모습과
              같습니다(줄바꿈만 반영).
            </p>
            {form.guide_md.trim() && (
              <div className="mt-3 rounded-element border border-border bg-muted p-4">
                <p className="mb-1.5 text-xs font-medium text-foreground-muted">미리보기(줄바꿈만 반영)</p>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">{form.guide_md}</p>
              </div>
            )}
          </section>

          {/* ── 문의 담당 ── */}
          <section className="rounded-container border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">문의 담당 표기</h3>
            <label className="block">
              <span className="label">문의 화면에 노출할 담당자·연락 방법</span>
              <AutoTextarea
                id="settings-inquiry-contact"
                value={form.inquiry_contact}
                onChange={(v) => patch({ inquiry_contact: v })}
                minRows={2}
                maxRows={6}
                placeholder="예) 인사기획팀 김OO 책임 · 내선 1234 · hr@example.com (평일 09:00~18:00)"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-foreground-muted">
              SME가 문의하기 화면에서 보게 되는 안내입니다. 비워 두면 담당자 표기 없이 문의만 접수됩니다.
            </p>
          </section>

          {/* ── 제출 게이트 스위치 ── */}
          <section className="rounded-container border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">제출 게이트 · 투입 비중 합계 검사</h3>
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
                checked={form.fte_required}
                onChange={(e) => patch({ fte_required: e.target.checked })}
              />
              <span className="text-sm leading-6 text-foreground">
                제출 시 투입 비중(FTE) 합계 100%를 검사한다
                {/* 색만으로 알리지 않는다 — 켜짐/꺼짐을 글자로도 적는다. */}
                <span
                  className={`ml-2 rounded px-2 py-0.5 text-[11px] font-medium ${
                    form.fte_required ? 'bg-success-muted text-success' : 'bg-warning-muted text-warning'
                  }`}
                >
                  {form.fte_required ? '켜짐' : '꺼짐'}
                </span>
              </span>
            </label>
            <div
              className={`mt-3 rounded-element border px-4 py-3 text-xs leading-5 ${
                form.fte_required
                  ? 'border-border bg-muted text-foreground-muted'
                  : 'border-warning-border bg-warning-muted text-warning'
              }`}
            >
              {form.fte_required ? (
                <>
                  켜짐 — 서버(submit_review)가 제출 시 배분 행 존재와 합계 100%를 검사합니다(§7-2 제출 게이트 ③).
                  합계가 100%가 아니면 STEP 3으로 되돌려 보냅니다.
                </>
              ) : (
                <>
                  <AlertTriangle size={13} className="mr-1 inline align-[-2px]" aria-hidden="true" />
                  <strong className="font-semibold">끄면 투입 비중 합계 100% 검사 없이 제출됩니다.</strong> 배분을 한
                  줄도 하지 않은 검토도 제출·승인까지 갈 수 있어, §9 E2(직무·조직별 투입 비중 분포)의 원천 데이터가
                  비어 있는 채로 산출됩니다. 화면 쪽 안내는 남지만 서버 검사는 사라집니다.
                </>
              )}
            </div>
            {turningGateOff && (
              <p role="alert" className="mt-2 text-xs font-medium leading-5 text-destructive">
                저장하면 이 회사의 검사가 켜짐 → 꺼짐으로 바뀝니다. 변경 사실은 감사 로그에 기록됩니다.
              </p>
            )}
          </section>

          {/* ── 리마인더 템플릿(§6-3 ⓒ) ── */}
          {/*
            컬럼이 아직 없는 DB(APPLY_2026-09-01_phase4.sql 미적용)에서는 입력을 열지 않는다.
            열어 두면 관리자가 친 글이 저장되지 않고 조용히 사라진다 — settingsApi가 확인되지 않은
            컬럼을 payload에 싣지 않기 때문이다. 그 사실을 감추지 않고 사유를 그대로 적는다.
          */}
          <section
            className={`rounded-container border bg-card p-5 ${
              reminderReady ? 'border-border' : 'border-dashed border-border'
            }`}
          >
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              리마인더 템플릿
              {!reminderReady && (
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  저장 위치 준비 중
                </span>
              )}
            </h3>
            <p className="mb-3 text-xs leading-5 text-foreground-muted">
              {reminderReady ? (
                <>
                  진행 현황(/progress)의 리마인더 발송에서 기본으로 채워집니다. 비워 두면 발송 화면의 기본 문구가
                  쓰입니다. 치환 토큰:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{TEMPLATE_TOKENS.join(' ')}</code>
                </>
              ) : (
                REMINDER_TEMPLATE_MISSING_NOTE
              )}
            </p>
            <label className="block">
              <span className="label">메일 제목</span>
              <input
                className="input max-w-xl"
                value={form.reminder_subject}
                disabled={!reminderReady}
                readOnly={!reminderReady}
                placeholder={DEFAULT_TEMPLATES.REMINDER.subject}
                onChange={(e) => patch({ reminder_subject: e.target.value })}
                aria-label="리마인더 메일 제목"
              />
            </label>
            <label className="mt-3 block">
              <span className="label">메일 본문</span>
              <textarea
                className="textarea"
                rows={8}
                value={form.reminder_body_md}
                disabled={!reminderReady}
                readOnly={!reminderReady}
                placeholder={DEFAULT_TEMPLATES.REMINDER.body}
                onChange={(e) => patch({ reminder_body_md: e.target.value })}
                aria-label="리마인더 메일 본문"
              />
            </label>
          </section>

          {/* ── 저장 ── */}
          {saveError && (
            <div
              role="alert"
              className="rounded-element border border-destructive-border bg-destructive-muted px-4 py-3 text-xs leading-5 text-destructive"
            >
              {saveError}
              <span className="mt-1 block text-foreground-muted">
                입력하신 값은 그대로 남아 있습니다. 원인을 확인한 뒤 다시 저장해 주세요.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Button onClick={() => void handleSave()} disabled={!dirty} loading={saving}>
              {saveError ? '다시 저장' : '설정 저장'}
            </Button>
            {dirty && (
              <Button variant="secondary" onClick={() => setForm(baseline)} disabled={saving}>
                변경 취소
              </Button>
            )}
            <span className="text-xs text-foreground-subtle">
              {dirty ? '저장하지 않은 변경이 있습니다.' : saved ? '저장된 값과 같습니다.' : '아직 저장된 설정이 없습니다.'}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export default SettingsPage;
