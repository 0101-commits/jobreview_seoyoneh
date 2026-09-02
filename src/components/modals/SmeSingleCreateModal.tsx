// SME 계정 개별 추가 모달 — 관리자(ADMIN) 'SME 계정 관리' 화면에서 사용한다.
import { useState } from 'react';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import { callAdminFn, errorMessage } from './edgeApi';

const FORM_ID = 'sme-single-create-form';

export function SmeSingleCreateModal({
  companies,
  onClose,
  onSuccess,
}: {
  companies: { id: string; name: string }[];
  onClose: () => void;
  /** keepOpen이면 목록만 새로고침하고 모달은 열어 둔다(임시 비밀번호 1회 표시 — v2 S2). */
  onSuccess: (opts?: { keepOpen: boolean }) => void;
}) {
  const [companyId, setCompanyId] = useState('');
  const [organization, setOrganization] = useState('');
  const [title, setTitle] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  // 서버가 만든 임시 비밀번호(v2 S2 / 결정 D1 ⓑ). 이 상태에만 있고 모달을 닫으면 사라진다.
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const dirty = Boolean(companyId || organization || title || employeeNumber || name || email) && !issued;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (
      !companyId ||
      !organization.trim() ||
      !title.trim() ||
      !employeeNumber.trim() ||
      !name.trim() ||
      !email.trim()
    ) {
      setLocalError('회사, 조직, 직급, 사번, 이름, 이메일을 모두 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await callAdminFn<{ tempPassword?: string }>({
        mode: 'create-sme',
        sme: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          company_id: companyId,
          organization: organization.trim(),
          title: title.trim(),
          employee_number: employeeNumber.trim(),
        },
      });
      // 목록 새로고침은 지금 하되 모달은 닫지 않는다 — 임시 비밀번호를 한 번은 보여 줘야 한다.
      setSubmitting(false);
      setIssued({ email: email.trim().toLowerCase(), tempPassword: res.tempPassword ?? '' });
      onSuccess({ keepOpen: true });
    } catch (err) {
      setLocalError(errorMessage(err, 'SME 계정 등록 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'));
      setSubmitting(false);
    }
  }

  if (issued)
    return (
      <ModalShell
        title="SME 계정을 만들었어요"
        description="임시 비밀번호는 이 창을 닫으면 다시 볼 수 없어요."
        icon={<UserPlus size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
        onClose={onClose}
        footer={<Button onClick={onClose}>닫기</Button>}
      >
        <div className="space-y-3">
          <div className="rounded-element border border-warning-border bg-warning-muted px-3.5 py-3 text-sm text-warning">
            아래 임시 비밀번호를 {issued.email} 님에게 개별적으로 전달해 주세요. 첫 로그인에서 반드시 바꾸게 됩니다.
          </div>
          <div className="flex items-center justify-between gap-3 rounded-element border border-border bg-card px-3.5 py-3">
            <span className="font-mono text-base font-semibold text-foreground">{issued.tempPassword}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issued.tempPassword);
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
      </ModalShell>
    );

  return (
    <ModalShell
      title="SME 개별 추가"
      description="SME 계정을 1명씩 직접 등록합니다."
      icon={<UserPlus size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={onClose}
      dirty={dirty && !submitting}
      closeDisabled={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting}>
            {submitting ? '등록 중...' : 'SME 계정 추가'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleCreate} className="space-y-4">
        <Field label="회사" required>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input">
            <option value="">회사를 선택해 주세요</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="조직" required value={organization} onChange={setOrganization} placeholder="예: 인사팀" />
          <Field label="직급" required value={title} onChange={setTitle} placeholder="예: 과장" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="사번" required value={employeeNumber} onChange={setEmployeeNumber} placeholder="사번" />
          <Field label="이름" required value={name} onChange={setName} placeholder="이름" />
        </div>

        <Field
          label="이메일"
          required
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="name@company.com"
          autoComplete="off"
        />

        <p className="rounded-element border border-border bg-muted px-3 py-2.5 text-xs leading-5 text-foreground-muted">
          비밀번호는 서버가 임시로 만들어 등록 직후 이 창에 한 번 보여 드려요. SME는 첫 로그인에서 반드시 새
          비밀번호로 바꿉니다.
        </p>

        {localError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2.5 text-sm text-destructive"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{localError}</span>
          </div>
        )}
      </form>
    </ModalShell>
  );
}
