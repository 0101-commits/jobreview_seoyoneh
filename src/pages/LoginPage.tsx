// 로그인 화면 — 로그인 전 모든 사용자(ADMIN/SME 공통)가 보는 화면이다.
import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

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
    <div className="flex min-h-screen bg-[#182635]">
      <div className="hidden w-[48%] flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2e9b9a]">
            <ClipboardCheck size={21} />
          </div>
          <span className="font-semibold">Job Review Architecture</span>
        </div>
        <div className="max-w-xl pb-20">
          <p className="mb-4 text-sm font-medium tracking-widest text-[#73d0c5]">JOB ARCHITECTURE REVIEW</p>
          <h1 className="text-4xl font-semibold leading-tight text-white">
            현업의 전문성을 기반으로
            <br />
            직무체계를 검증합니다.
          </h1>
          <p className="mt-6 max-w-lg leading-7 text-slate-400">
            직무전문가(SME)의 실제 업무 경험을 바탕으로 직무 정의, 주요 Task, 필요 Skill의 적정성을 검토하고 보완하여,
            서연의 직무체계를 보다 명확하고 일관된 기준으로 정립합니다.
          </p>
        </div>
        <p className="text-xs text-slate-500">© 2026 Seoyon Job Architecture Review</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#2e9b9a] text-white">
              <ClipboardCheck size={21} />
            </div>
            <h1 className="text-2xl font-semibold text-slate-900">Job Review Architecture</h1>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">로그인</h2>
            <p className="mt-2 text-sm text-slate-500">등록된 계정으로 로그인해 주세요.</p>
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
                <p role="status" aria-live="polite" className="text-sm text-rose-600">
                  로그인 시도가 {MAX_FAIL}회 연속 실패했습니다. {LOCK_SECONDS}초 후에 다시 시도해 주세요. (남은 시간{' '}
                  {remainSeconds}초)
                </p>
              )}
              {/* 잠금 문구가 실제 실패 사유를 덮지 않도록 둘 다 남긴다(§8 S8 오류 문구의 구체성). */}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                disabled={locked}
                className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                로그인
              </button>
            </form>
          </div>
          <p className="mt-5 text-center text-xs text-slate-400">
            계정 생성 및 권한 변경은 관리자에게 문의해 주세요.
            <br />
            (hechoi@e-hcg.com)
          </p>
        </div>
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
