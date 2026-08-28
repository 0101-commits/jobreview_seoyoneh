// 로그인 화면 — 로그인 전 모든 사용자(ADMIN/SME 공통)가 보는 화면이다.
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

export function Login({ onLogin, error }: { onLogin: (email: string, password: string) => void; error: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
              onSubmit={(e) => {
                e.preventDefault();
                onLogin(email, password);
              }}
              className="mt-8 space-y-5"
            >
              <Field label="이메일" value={email} onChange={setEmail} type="email" placeholder="name@company.com" />
              <Field
                label="비밀번호"
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="비밀번호를 입력하세요"
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button className="w-full rounded-md bg-primary py-3 text-sm font-semibold text-white transition hover:bg-primary-hover">
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
      />
    </label>
  );
}
