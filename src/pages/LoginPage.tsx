// 로그인 화면 — 로그인 전 모든 사용자(ADMIN/SME 공통)가 보는 화면이다.
// 비밀번호 재설정 요청(F1)도 이 화면에서 시작한다. 로그인 전이라 운영 설정(inquiry_contact)은 읽을 수 없다.
import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { resetRedirectUrl, supabase } from '@/lib/supabase';
// 화면 문구는 copy.ts 한곳에 둔다(문언 단일 원천 — copy.ts 파일 상단 규칙).
import { LOGIN_PRIVACY_NOTICE } from './sme-review/copy';

// 로그인 보호(§8 S3) — 연속 실패 5회면 60초 동안 입력·제출을 막는다.
const MAX_FAIL = 5;
const LOCK_SECONDS = 60;

/**
 * 로그인 시도 결과. 잠금 카운터(§8 S3 "연속 실패")는 'invalid'만 센다.
 * 'error'(환경 미설정 등 자격 증명과 무관한 사유)는 몇 번을 눌러도 세지 않고, 'ok'는 카운터를 0으로 되돌린다.
 */
export type LoginResult = 'ok' | 'invalid' | 'error';

export function Login({
  onLogin,
  error,
}: {
  onLogin: (email: string, password: string) => Promise<LoginResult>;
  error: string;
}) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 이 잠금은 서버 방어선이 아니라 완충 장치다. 상태가 이 컴포넌트 안에만 있으므로
  // 새로고침하면 그대로 초기화된다. 실제 방어선은 Supabase Auth의 rate limit이며,
  // 그 설정 점검은 README의 운영 체크 항목으로 남긴다.
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState(0); // 잠금 해제 시각(epoch ms), 0이면 잠금 없음
  const [remainSeconds, setRemainSeconds] = useState(0);
  const locked = lockUntil !== 0;

  // 잠금 중에만 1초마다 남은 시간을 다시 계산하고, 해제되면 실패 횟수를 0으로 되돌린다.
  useEffect(() => {
    if (!lockUntil) return;
    const tick = () => {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockUntil(0);
        setRemainSeconds(0);
        setFailCount(0);
        return;
      }
      setRemainSeconds(left);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lockUntil]);

  return (
    <div className="flex min-h-screen bg-inverse">
      <div className="hidden w-[48%] flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3 text-inverse-label">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand">
            <ClipboardCheck size={21} />
          </div>
          <span className="font-semibold">Job Review Architecture</span>
        </div>
        <div className="max-w-xl pb-20">
          <p className="mb-4 t-label font-medium tracking-widest text-inverse-accent">JOB ARCHITECTURE REVIEW</p>
          <h1 className="text-4xl font-semibold leading-tight text-inverse-label">
            현업의 전문성을 기반으로
            <br />
            직무체계를 검증합니다.
          </h1>
          <p className="mt-6 max-w-lg t-body text-inverse-label-muted">
            직무전문가(SME)의 실제 업무 경험을 바탕으로 직무 정의, 주요 Task, 필요 Skill의 적정성을 검토하고 보완하여,
            서연의 직무체계를 보다 명확하고 일관된 기준으로 정립합니다.
          </p>
        </div>
        <p className="t-caption text-inverse-label-muted">© 2026 Seoyon Job Architecture Review</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
              <ClipboardCheck size={21} />
            </div>
            <h1 className="t-title text-foreground">Job Review Architecture</h1>
          </div>
          <div className="rounded-container border border-border bg-card p-6 shadow-1 sm:p-8">
            {mode === 'login' ? (
              <>
                <h2 className="t-title text-foreground">로그인</h2>
                <p className="mt-2 t-label text-foreground-muted">등록된 계정으로 로그인해 주세요.</p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (locked) return;
                    // 인증 결과를 받은 뒤에 센다. 제출 자체를 세면 '연속 실패'가 아니라 '제출 횟수'가 되어,
                    // 자격 증명과 무관한 사유(환경 미설정 등)나 성공한 로그인까지 잠금으로 끌고 간다.
                    const result = await onLogin(email, password);
                    if (result !== 'invalid') {
                      setFailCount(0);
                      return;
                    }
                    const next = failCount + 1;
                    setFailCount(next);
                    if (next >= MAX_FAIL) {
                      setLockUntil(Date.now() + LOCK_SECONDS * 1000);
                      setRemainSeconds(LOCK_SECONDS);
                    }
                  }}
                  className="mt-8 space-y-5"
                >
                  <Field
                    label="이메일"
                    value={email}
                    onChange={setEmail}
                    type="email"
                    placeholder="name@company.com"
                    disabled={locked}
                  />
                  <Field
                    label="비밀번호"
                    value={password}
                    onChange={setPassword}
                    type="password"
                    placeholder="비밀번호를 입력하세요"
                    disabled={locked}
                  />
                  {locked && (
                    <p role="status" aria-live="polite" className="t-label text-destructive">
                      로그인 시도가 {MAX_FAIL}회 연속 실패했습니다. {LOCK_SECONDS}초 후에 다시 시도해 주세요. (남은
                      시간 {remainSeconds}초)
                    </p>
                  )}
                  {/* 잠금 문구가 실제 실패 사유를 덮지 않도록 둘 다 남긴다(§8 S8 오류 문구의 구체성). */}
                  {error && <p className="t-label text-destructive">{error}</p>}
                  <button
                    disabled={locked}
                    className="w-full rounded-element bg-primary py-3 t-label font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    로그인
                  </button>
                </form>
                <div className="mt-5 text-center">
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="min-h-11 t-label-2 text-primary underline-offset-2 hover:underline"
                  >
                    비밀번호를 잊으셨나요?
                  </button>
                </div>
              </>
            ) : (
              <ForgotPasswordForm initialEmail={email} onBack={() => setMode('login')} />
            )}
          </div>
          {/* §8 S6 — 수집·이용 안내 1문장. 로그인 전에 보이도록 카드 바로 아래에 둔다. */}
          <p className="mt-5 text-center t-caption leading-5 text-foreground-muted">{LOGIN_PRIVACY_NOTICE}</p>
          {/*
            로그인 전 화면은 회사를 모르므로 운영 설정의 문의 담당(inquiry_contact)을 읽을 수 없다.
            개인 이메일을 번들에 싣지 않기 위해(S4) 담당자 주소는 로그인 후 화면에서만 보여 준다.
          */}
          <p className="mt-3 text-center t-caption text-foreground-muted">
            계정 생성 및 권한 변경은 관리자에게 문의해 주세요.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 비밀번호 재설정 요청(F1 ②). 계정이 있는지 여부는 알려 주지 않는다 —
 * 존재 여부를 문구로 흘리면 이메일 열거에 쓰인다. 성공·미등록 모두 같은 안내를 낸다.
 */
function ForgotPasswordForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const target = email.trim().toLowerCase();
    if (!target) {
      setError('이메일을 입력해 주세요.');
      return;
    }
    if (!supabase) {
      setError('데이터베이스에 연결되어 있지 않아요. 관리자에게 문의해 주세요.');
      return;
    }
    setSending(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: resetRedirectUrl(),
    });
    setSending(false);
    if (sendError) {
      // rate limit(시간당 발송 제한)에 걸린 경우가 대부분이라 "잠시 후"를 함께 적는다.
      setError('재설정 메일을 보내지 못했어요. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.');
      return;
    }
    setSent(true);
  }

  if (sent)
    return (
      <div>
        <h2 className="t-title text-foreground">메일을 보냈어요</h2>
        <p className="mt-3 t-label leading-6 text-foreground-muted">
          {email.trim().toLowerCase()} 으로 재설정 링크를 보냈어요. 메일의 링크를 열면 새 비밀번호를 정할 수 있어요.
          <br />
          메일이 보이지 않으면 스팸함을 확인해 주세요.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-element border border-border bg-card t-label font-medium text-foreground transition hover:bg-fill-strong"
        >
          <ArrowLeft size={16} aria-hidden="true" /> 로그인으로 돌아가기
        </button>
      </div>
    );

  return (
    <div>
      <h2 className="t-title text-foreground">비밀번호 재설정</h2>
      <p className="mt-2 t-label text-foreground-muted">계정 이메일로 재설정 링크를 보내 드려요.</p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <Field
          label="이메일"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="name@company.com"
          disabled={sending}
        />
        {error && <p className="t-label text-destructive">{error}</p>}
        <button
          disabled={sending}
          className="w-full rounded-element bg-primary py-3 t-label font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? '보내는 중…' : '재설정 링크 보내기'}
        </button>
      </form>
      <div className="mt-5 text-center">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 t-label-2 text-foreground-muted underline-offset-2 hover:underline"
        >
          로그인으로 돌아가기
        </button>
      </div>
    </div>
  );
}

// 이 화면 전용 입력 필드. src/components/ui/Field.tsx 와 이름이 같지만 별개다(교체는 다음 단계).
function Field({
  label,
  value,
  onChange,
  type,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <input
        className="input disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}
