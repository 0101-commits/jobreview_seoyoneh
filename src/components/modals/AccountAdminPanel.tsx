/*
 * 관리자 전권 계정 조작 패널 — 'SME 계정 관리'와 '관리자 계정 관리'의 관리 모달이 함께 쓴다.
 * 기획서: docs/PLAN_ADMIN_FULL_CONTROL.md §3(F1~F7) · §6.
 *
 * ▣ 왜 공용 컴포넌트인가
 *   비밀번호 재설정·로그인 ID 변경·역할 변경·활성 토글·게이트 초기화는 두 화면에서 완전히 같은
 *   조작이다. 두 파일에 복붙하면 한쪽만 고쳐지는 사고가 난다(edgeApi.ts를 만든 이유와 같다).
 *
 * ▣ 성공도 실패도 이 패널 안에 남긴다
 *   부모가 모달이라, 모달 뒤 토스트로 보내면 사실상 보이지 않는다(기존 관례).
 *   임시 비밀번호는 특히 그렇다 — 한 번 사라지면 다시 볼 수 없으므로 모달을 닫지 않고 여기 남긴다.
 *
 * ▣ 평문 열람 (2026-09-04, docs/PLAN_2026-09-04_IMPROVEMENT.md §2)
 *   Supabase Auth 는 해시만 갖고 있으므로 '지금 걸려 있는 값'을 Auth 에서 읽어 올 수는 없다.
 *   대신 앱을 지나는 모든 설정값을 서버가 암호문으로 보관하고(account_password_vault),
 *   여기서 재인증을 거쳐 다시 보여 준다. 앱을 지나지 않은 변경이 있었던 계정은 값 대신 사유가 뜬다.
 *   열람 1회는 audit_logs 에 PASSWORD_VIEWED 한 줄로 남는다(값·로그인 ID 는 남기지 않는다).
 */
import { useState } from 'react';
import { AlertTriangle, BookOpen, Eye, EyeOff, KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { callAdminFn, errorMessage } from './edgeApi';
import { PASSWORD_POLICY_HINT, passwordPolicyError } from '@/lib/passwordPolicy';

export type AccountAdminTarget = {
  id: string;
  name: string;
  /** 현재 로그인 ID(= profiles.email). */
  email: string;
  role: 'admin' | 'sme';
  active: boolean;
  /**
   * 회사 미지정이면 서버가 SME 강등을 거절한다. 누르기 전에 사유를 알려 주려고 받는다.
   * undefined는 "부모가 이 값을 모른다"는 뜻이라 강등을 막지 않는다(서버가 판정한다).
   */
  companyId?: string | null;
};

type Section = 'password' | 'reveal' | 'loginId' | 'role' | 'active' | 'guide';

export function AccountAdminPanel({
  target,
  isSelf,
  isLastLoginableAdmin,
  onRefresh,
  onBusyChange,
}: {
  target: AccountAdminTarget;
  /** 현재 로그인한 계정 본인인가. 강등·비활성은 막고 비밀번호·로그인 ID는 허용한다. */
  isSelf: boolean;
  /** 이 계정을 비활성화·강등하면 로그인할 수 있는 관리자가 0명이 된다. */
  isLastLoginableAdmin: boolean;
  /** 목록을 다시 불러온다. 모달은 닫지 않는다(임시 비밀번호를 남겨 둬야 한다). */
  onRefresh: () => void;
  /** 요청이 도는 동안 부모의 닫기·저장을 잠그기 위한 신호. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [running, setRunning] = useState<Section | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 비밀번호
  const [newPassword, setNewPassword] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [issued, setIssued] = useState('');
  const [copied, setCopied] = useState(false);

  // 비밀번호 확인(열람)
  const [revealOpen, setRevealOpen] = useState(false);
  const [reauth, setReauth] = useState('');
  const [revealed, setRevealed] = useState('');
  const [revealNote, setRevealNote] = useState('');
  const [revealCopied, setRevealCopied] = useState(false);

  // 로그인 ID
  const [loginId, setLoginId] = useState(target.email);

  const busy = running !== null;

  /** 상태 표시를 한 곳에서 갈아 준다. 성공 문구와 오류 문구가 동시에 남지 않게 한다. */
  async function run(section: Section, body: Record<string, unknown>, done: (data: Record<string, unknown>) => string) {
    setError('');
    setNotice('');
    setRunning(section);
    onBusyChange?.(true);
    try {
      const data = await callAdminFn(body);
      setNotice(done(data));
      onRefresh();
    } catch (err) {
      setError(errorMessage(err, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setRunning(null);
      onBusyChange?.(false);
    }
  }

  // ── 비밀번호 ──────────────────────────────────────────────────────
  const explicitPassword = newPassword.length > 0;
  // 비워 두면 서버가 임시값을 만든다 — 그때는 화면에서 정책을 따지지 않는다.
  const passwordLocalError = explicitPassword ? (passwordPolicyError(newPassword) ?? '') : '';

  function submitPassword() {
    if (passwordLocalError) return;
    setIssued('');
    setCopied(false);
    void run(
      'password',
      {
        mode: 'set-password',
        profileId: target.id,
        // 빈 값을 보내면 서버가 임시 비밀번호를 만든다.
        password: explicitPassword ? newPassword : undefined,
        forceChange,
      },
      (data) => {
        const temp = typeof data.tempPassword === 'string' ? data.tempPassword : '';
        if (temp) setIssued(temp);
        setNewPassword('');
        const tail = data.forceChangeApplied === false
          ? ' 다만 첫 로그인 변경 강제 설정은 저장되지 않았어요 — 다시 시도해 주세요.'
          : forceChange
            ? ' 이 계정은 다음 로그인에서 비밀번호를 반드시 바꿉니다.'
            : ' 첫 로그인 변경 강제는 걸지 않았어요.';
        return (temp ? '임시 비밀번호를 새로 발급했어요.' : '비밀번호를 지정한 값으로 바꿨어요.') + tail;
      },
    );
  }

  // ── 비밀번호 확인(열람) ────────────────────────────────────────────
  /*
   * 값은 눌러서 열 때만, 그것도 15초만 보여 준다. 관리자 화면은 회의실 스크린에 그대로 떠 있는
   * 일이 잦고, 한 번 열면 계속 남아 있는 값은 그 화면을 찍은 사진 한 장으로 새 나간다.
   */
  function submitReveal() {
    setRevealed('');
    setRevealNote('');
    setRevealCopied(false);
    void run(
      'reveal',
      { mode: 'reveal-password', profileId: target.id, reauthPassword: reauth },
      (data) => {
        setReauth('');
        if (data.found === true && typeof data.password === 'string') {
          setRevealed(data.password);
          window.setTimeout(() => setRevealed(''), 15000);
          const setAt = typeof data.setAt === 'string' ? new Date(data.setAt).toLocaleString('ko-KR') : '';
          return setAt ? `${setAt}에 정해진 비밀번호예요. 15초 뒤 다시 가려집니다.` : '비밀번호를 확인했어요. 15초 뒤 다시 가려집니다.';
        }
        setRevealNote(typeof data.reason === 'string' ? data.reason : '보관된 비밀번호가 없어요.');
        return '보관된 비밀번호를 찾지 못했어요.';
      },
    );
  }

  // ── 로그인 ID ─────────────────────────────────────────────────────
  const loginIdChanged = loginId.trim().toLowerCase() !== target.email.toLowerCase();

  // ── 역할 ─────────────────────────────────────────────────────────
  const nextRole = target.role === 'admin' ? 'sme' : 'admin';
  const demoteBlockReason =
    target.role !== 'admin'
      ? ''
      : isSelf
        ? '현재 로그인한 계정이에요. 스스로 SME로 내릴 수 없어요.'
        : isLastLoginableAdmin
          ? '로그인할 수 있는 마지막 관리자예요. 다른 관리자를 먼저 활성화해 주세요.'
          : target.companyId === null
            ? '이 계정에 회사가 지정되어 있지 않아 SME로 내릴 수 없어요. 위에서 회사를 먼저 지정해 주세요.'
            : '';
  const activeBlockReason = !target.active
    ? ''
    : isSelf
      ? '현재 로그인한 계정이에요. 스스로 비활성화할 수 없어요.'
      : target.role === 'admin' && isLastLoginableAdmin
        ? '로그인할 수 있는 마지막 관리자예요. 다른 관리자를 먼저 활성화해 주세요.'
        : '';

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3.5 py-2.5 t-label text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-element border border-success-border bg-success-muted px-3.5 py-2.5 t-label text-success"
        >
          <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* ── 비밀번호 ── */}
      <section className="border-t border-border pt-4">
        <h4 className="mb-1.5 t-label font-semibold text-foreground">비밀번호</h4>
        <p className="mb-3 t-caption leading-5 text-foreground-muted">
          앱을 통해 정해진 비밀번호는 아래 「비밀번호 확인」으로 다시 볼 수 있어요. 새로 발급하거나 값을 직접 지정할
          수도 있습니다. 비워 두고 「임시 비밀번호 발급」을 누르면 서버가 만들어 이 자리에 보여 줘요.
        </p>

        <Field
          label="새 비밀번호 (선택)"
          description={`직접 지정할 때만 입력해 주세요. ${PASSWORD_POLICY_HINT}`}
          error={passwordLocalError}
          type="text"
          value={newPassword}
          onChange={setNewPassword}
          placeholder="비워 두면 서버가 임시 비밀번호를 만들어요"
          autoComplete="off"
        />

        <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            checked={forceChange}
            onChange={(e) => setForceChange(e.target.checked)}
            disabled={busy}
          />
          <span className="t-label-reading text-foreground">
            다음 로그인에서 본인이 비밀번호를 다시 바꾸게 한다
            <span
              className={`ml-2 rounded px-2 py-0.5 t-caption-2 font-medium ${
                forceChange ? 'bg-success-muted text-success' : 'bg-warning-muted text-warning'
              }`}
            >
              {forceChange ? '켜짐' : '꺼짐'}
            </span>
            <span className="mt-1 block t-caption text-foreground-subtle">
              끄면 관리자가 정한 비밀번호를 본인이 계속 쓰게 됩니다.
            </span>
          </span>
        </label>

        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={submitPassword}
            loading={running === 'password'}
            disabled={busy || Boolean(passwordLocalError)}
          >
            <KeyRound size={15} aria-hidden="true" />
            {explicitPassword ? '이 비밀번호로 바꾸기' : '임시 비밀번호 발급'}
          </Button>
        </div>

        {issued && (
          <div className="mt-3 space-y-2">
            <div className="rounded-element border border-warning-border bg-warning-muted px-3.5 py-3 t-label text-warning">
              아래 임시 비밀번호를 본인에게 개별적으로 전달해 주세요. 이 창을 닫으면 다시 볼 수 없어요.
            </div>
            <div className="flex items-center justify-between gap-3 rounded-element border border-border bg-card px-3.5 py-3">
              <span className="break-all font-mono t-body font-semibold text-foreground">{issued}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? '복사했어요' : '복사'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── 비밀번호 확인(열람) ── */}
      <section className="border-t border-border pt-4">
        <h4 className="mb-1.5 t-label font-semibold text-foreground">비밀번호 확인</h4>
        <p className="mb-3 t-caption leading-5 text-foreground-muted">
          앱을 통해 마지막으로 정해진 비밀번호를 다시 봅니다. 본인 확인을 위해 관리자 본인의 비밀번호를 한 번 더
          입력해요. 확인한 사실은 기록에 남습니다.
        </p>

        {!revealOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setRevealOpen(true)} disabled={busy}>
            <Eye size={15} aria-hidden="true" /> 비밀번호 확인
          </Button>
        ) : (
          <div className="space-y-3">
            <Field
              label="관리자 본인 비밀번호"
              description="대상 계정의 비밀번호가 아니라, 지금 로그인한 관리자 본인의 비밀번호예요."
              type="password"
              value={reauth}
              onChange={setReauth}
              placeholder="본인 비밀번호"
              autoComplete="current-password"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={submitReveal}
                loading={running === 'reveal'}
                disabled={busy || !reauth}
              >
                <Eye size={15} aria-hidden="true" /> 확인
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRevealOpen(false);
                  setReauth('');
                  setRevealed('');
                  setRevealNote('');
                }}
                disabled={busy}
              >
                <EyeOff size={15} aria-hidden="true" /> 닫기
              </Button>
            </div>
          </div>
        )}

        {revealNote && (
          <div className="mt-3 rounded-element border border-warning-border bg-warning-muted px-3.5 py-3 t-label text-warning">
            {revealNote}
          </div>
        )}

        {revealed && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-element border border-border bg-card px-3.5 py-3">
            <span className="break-all font-mono t-body font-semibold text-foreground">{revealed}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(revealed);
                  setRevealCopied(true);
                } catch {
                  setRevealCopied(false);
                }
              }}
            >
              {revealCopied ? '복사했어요' : '복사'}
            </Button>
          </div>
        )}
      </section>

      {/* ── 로그인 ID ── */}
      <section className="border-t border-border pt-4">
        <h4 className="mb-1.5 t-label font-semibold text-foreground">로그인 ID</h4>
        <p className="mb-3 t-caption leading-5 text-foreground-muted">
          이 값으로 로그인합니다. 메일 주소가 없으면 영문·숫자 ID만 넣어 주세요 — 서버가 도메인을 붙입니다.
          바꾸면 예전 ID로는 로그인할 수 없어요.
        </p>
        {/* type을 email로 두면 'hcg-admin' 같은 ID에서 브라우저 기본 검증이 제출을 막는다. */}
        <Field
          label="로그인 ID 또는 이메일"
          type="text"
          value={loginId}
          onChange={setLoginId}
          placeholder="name@company.com 또는 sme01"
          autoComplete="off"
        />
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            loading={running === 'loginId'}
            disabled={busy || !loginIdChanged || loginId.trim().length === 0}
            onClick={() =>
              void run(
                'loginId',
                { mode: 'set-login-id', profileId: target.id, email: loginId.trim() },
                (data) =>
                  `로그인 ID를 ${typeof data.email === 'string' ? data.email : loginId.trim()} 로 바꿨어요. 본인에게 새 ID를 전달해 주세요.`,
              )
            }
          >
            <UserCog size={15} aria-hidden="true" /> 로그인 ID 변경
          </Button>
        </div>
      </section>

      {/* ── 역할 ── */}
      <section className="border-t border-border pt-4">
        <h4 className="mb-1.5 t-label font-semibold text-foreground">역할</h4>
        <div className="mb-3 flex flex-wrap items-center gap-2 t-caption text-foreground-muted">
          <span className="rounded-full bg-primary-subtle px-2.5 py-1 font-medium text-primary">
            {target.role === 'admin' ? '관리자' : 'SME'}
          </span>
          <span>
            {target.role === 'admin'
              ? '관리자 메뉴 전체를 볼 수 있어요.'
              : '배정된 직무만 검토할 수 있어요.'}
          </span>
        </div>
        {demoteBlockReason && (
          <p className="mb-2 rounded-element border border-warning-border bg-warning-muted px-3 py-2 t-caption leading-5 text-warning">
            {demoteBlockReason}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={running === 'role'}
          disabled={busy || Boolean(demoteBlockReason)}
          onClick={() =>
            void run('role', { mode: 'set-role', profileId: target.id, role: nextRole }, (data) => {
              const base = nextRole === 'admin' ? '관리자로 올렸어요.' : 'SME로 내렸어요.';
              // 배정 생성은 SME로 내릴 때만 돈다. 실패해도 역할은 이미 바뀌었으므로 함께 알린다.
              if (data.assignmentsSynced === false)
                return `${base} 다만 검토 배정을 만들지 못했어요 — 「SME 배정 관리」에서 확인해 주세요.`;
              if (data.assignmentsSynced === true) return `${base} 이 회사의 활성 직무가 배정되었어요.`;
              return base;
            })
          }
        >
          {nextRole === 'admin' ? '관리자로 올리기' : 'SME로 내리기'}
        </Button>
      </section>

      {/* ── 상태 ── */}
      <section className="border-t border-border pt-4">
        <h4 className="mb-1.5 t-label font-semibold text-foreground">상태</h4>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 t-caption font-medium ${
              target.active ? 'bg-success-muted text-success' : 'bg-muted text-foreground-muted'
            }`}
          >
            {target.active ? '● 활성' : '○ 비활성'}
          </span>
          <span className="t-caption text-foreground-muted">비활성 계정은 로그인할 수 없어요.</span>
        </div>
        {activeBlockReason && (
          <p className="mb-2 rounded-element border border-warning-border bg-warning-muted px-3 py-2 t-caption leading-5 text-warning">
            {activeBlockReason}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={running === 'active'}
          disabled={busy || Boolean(activeBlockReason)}
          onClick={() =>
            void run('active', { mode: 'toggle-active', profileId: target.id, active: !target.active }, () =>
              target.active ? '계정을 비활성화했어요.' : '계정을 활성화했어요.',
            )
          }
        >
          {target.active ? '비활성화' : '활성화'}
        </Button>
      </section>

      {/* ── 시작 가이드(SME 전용) ── */}
      {target.role === 'sme' && (
        <section className="border-t border-border pt-4">
          <h4 className="mb-1.5 t-label font-semibold text-foreground">시작 가이드</h4>
          <p className="mb-3 t-caption leading-5 text-foreground-muted">
            이수 기록을 지우면 이 SME는 다음 로그인에서 시작 가이드를 다시 보고 통과해야 합니다.
          </p>
          <Button
            variant="secondary"
            size="sm"
            loading={running === 'guide'}
            disabled={busy}
            onClick={() =>
              void run(
                'guide',
                { mode: 'set-flags', profileId: target.id, reset_guide: true },
                () => '시작 가이드 이수 기록을 지웠어요. 다음 로그인에서 가이드를 다시 봅니다.',
              )
            }
          >
            <BookOpen size={15} aria-hidden="true" /> 가이드 이수 초기화
          </Button>
        </section>
      )}
    </div>
  );
}
