// 비밀번호 변경 화면 — 두 흐름이 같은 화면을 쓴다.
//  · mode 'first-login': profiles.must_change_password가 true인 동안 이 화면만 보인다(§8 S2 · §10 P0 DoD ②).
//  · mode 'recovery': 재설정 메일 링크(/reset-password)로 들어온 경우(v2 F1).
// 어느 쪽도 현재 비밀번호는 묻지 않는다. Supabase Auth 세션이 이미 본인임을 증명했고,
// 초기 비밀번호를 다시 입력하게 하면 관리자가 발급한 값을 한 번 더 타이핑시키는 것뿐이다.
import { useRef, useState } from 'react';
import { ClipboardCheck, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/auditApi';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Toast, useToast } from '@/components/ui/Toast';
import type { User } from '@/types';

/** 최소 길이 정책(§8 S2 "길이 10+ 권장"). */
const MIN_LENGTH = 10;

export function ChangePasswordPage({
  user,
  onChanged,
  onLogout,
  mode = 'first-login',
}: {
  /** 재설정 링크가 만료돼 세션이 없는 경우 null. 그때는 안내만 보여 준다. */
  user: User | null;
  onChanged: () => void;
  onLogout: () => void;
  mode?: 'first-login' | 'recovery';
}) {
  const recovery = mode === 'recovery';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismiss } = useToast();
  // Auth 변경에 성공한 비밀번호 값을 기억한다. 뒤이은 profiles 갱신만 실패했을 때 같은 값으로 다시 제출하면
  // Auth가 "이전과 같은 비밀번호"라며 거부해 갱신 재시도에 영영 닿지 못하기 때문이다.
  // 값이 같으면 Auth 호출을 건너뛰고 갱신부터 이어서 하고, 다른 값을 넣었으면 그 값으로 정상 변경한다.
  const changedPassword = useRef('');

  // 오류는 "무엇이 왜 안 되는지"까지 적는다(§8 S8 오류 문구의 구체성).
  // 아직 아무것도 입력하지 않은 칸에 미리 빨간 글씨를 띄우지는 않되, 제출을 눌렀다면 빈 칸도 짚어 준다.
  const shown = (value: string) => value.length > 0 || submitted;
  const passwordError = !shown(password)
    ? ''
    : password.length === 0
      ? '새 비밀번호를 입력해 주세요.'
      : password.length < MIN_LENGTH
        ? `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다. 지금 ${password.length}자입니다.`
        : '';
  const confirmError = !shown(confirm)
    ? ''
    : confirm.length === 0
      ? '새 비밀번호를 한 번 더 입력해 주세요.'
      : confirm !== password
        ? '두 번 입력한 비밀번호가 서로 다릅니다. 다시 확인해 주세요.'
        : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (password.length < MIN_LENGTH || confirm !== password) return;
    if (!supabase) {
      showToast({ type: 'error', msg: '데이터베이스에 연결되어 있지 않습니다. 관리자에게 문의해 주세요.' });
      return;
    }

    setSaving(true);
    try {
      if (changedPassword.current !== password) {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) {
          showToast({ type: 'error', msg: `비밀번호를 변경하지 못했습니다. ${authError.message}` });
          return;
        }
        changedPassword.current = password;
      }

      // 본인 행만 갱신한다. 클라이언트가 id를 정하지만 서버 RLS가 같은 조건을 다시 확인한다.
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', user!.id);
      if (profileError) {
        // 여기까지 왔으면 비밀번호는 이미 바뀌었다. 실패를 뭉뚱그리면 사용자가 옛 비밀번호로 다시 로그인하려 든다.
        showToast({
          type: 'error',
          msg: `새 비밀번호는 저장됐지만 변경 완료 표시를 기록하지 못했습니다. 잠시 후 다시 시도해 주세요. ${profileError.message}`,
        });
        return;
      }

      await logAudit(recovery ? 'PASSWORD_RESET' : 'PASSWORD_CHANGED', 'profiles', user!.id, {
        reason: recovery ? 'RESET_LINK' : 'FIRST_LOGIN',
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  // 재설정 링크의 유효기간이 지났거나 링크 없이 이 주소를 연 경우 — 세션이 없어 비밀번호를 바꿀 수 없다.
  if (recovery && !user)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-[440px]">
          <Brand />
          <div className="rounded-container border border-border bg-card p-7 shadow-1 sm:p-9">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">링크가 만료되었어요</h1>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">
              비밀번호 재설정 링크는 일정 시간이 지나면 쓸 수 없어요. 로그인 화면에서 다시 요청해 주세요.
            </p>
            <Button size="lg" className="mt-6 w-full" onClick={onLogout}>
              로그인 화면으로
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[440px]">
        <Brand />

        <div className="rounded-container border border-border bg-card p-7 shadow-1 sm:p-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {recovery ? '새 비밀번호 설정' : '비밀번호 변경'}
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {recovery
              ? '재설정 링크로 들어오셨습니다. 새 비밀번호를 정해 주세요.'
              : '처음 로그인하셨습니다. 계속하기 전에 비밀번호를 변경해 주세요.'}
          </p>
          <p className="mt-4 rounded-element border border-warning-border bg-warning-muted px-4 py-3 text-sm text-warning">
            {recovery
              ? '새 비밀번호를 정하면 이전 비밀번호는 더 이상 사용할 수 없습니다.'
              : '관리자가 발급한 초기 비밀번호는 더 이상 사용할 수 없습니다.'}
          </p>

          <Toast toast={toast} onDismiss={dismiss} className="mt-5" />

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Field
              label="새 비밀번호"
              description={`${MIN_LENGTH}자 이상으로 정해 주세요.`}
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete="new-password"
              placeholder="새 비밀번호를 입력하세요"
              error={passwordError}
              disabled={saving}
              required
            />
            <Field
              label="새 비밀번호 확인"
              value={confirm}
              onChange={setConfirm}
              type="password"
              autoComplete="new-password"
              placeholder="새 비밀번호를 다시 입력하세요"
              error={confirmError}
              disabled={saving}
              required
            />
            <Button type="submit" size="lg" loading={saving} className="w-full">
              {recovery ? '새 비밀번호로 시작하기' : '비밀번호 변경하고 시작하기'}
            </Button>
          </form>
        </div>

        {/* 계정을 잘못 받은 사람이 이 화면에 갇히지 않도록 로그아웃 경로를 남겨 둔다. */}
        <div className="mt-5 text-center">
          <Button variant="ghost" size="md" onClick={onLogout} disabled={saving}>
            <LogOut size={16} aria-hidden="true" /> 다른 계정으로 로그인
          </Button>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-8 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
        <ClipboardCheck size={21} aria-hidden="true" />
      </div>
      <span className="font-semibold text-foreground">Job Review Architecture</span>
    </div>
  );
}

export default ChangePasswordPage;
