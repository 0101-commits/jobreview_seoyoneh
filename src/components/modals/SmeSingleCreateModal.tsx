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
  onSuccess: () => void;
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

  const dirty = Boolean(companyId || organization || title || employeeNumber || name || email || password);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (
      !companyId ||
      !organization.trim() ||
      !title.trim() ||
      !employeeNumber.trim() ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      setLocalError('회사, 조직, 직급, 사번, 이름, 이메일, 비밀번호를 모두 입력해 주세요.');
      return;
    }

    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setLocalError('비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      await callAdminFn({
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
      });
      onSuccess();
    } catch (err) {
      setLocalError(errorMessage(err, 'SME 계정 등록 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.'));
      setSubmitting(false);
    }
  }

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

        <Field
          label="비밀번호"
          required
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="8자 이상, 영문 및 숫자 포함"
          description="8자 이상, 영문과 숫자를 포함해 주세요."
          autoComplete="new-password"
        />

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
