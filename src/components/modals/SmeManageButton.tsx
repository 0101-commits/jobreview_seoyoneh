// SME 계정 수정/삭제 '관리' 버튼 + 모달 — 관리자(ADMIN) 'SME 계정 관리' 목록의 각 행에서 사용한다.
// 실패 사유는 모달 안에 남긴다(모달 뒤 토스트로 보내면 사실상 보이지 않는다).
import { useState } from 'react';
import { AlertTriangle, Trash2, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import type { ToastMessage } from '@/components/ui/Toast';
import type { SmeListItem } from '@/types';
import { callAdminFn, errorMessage } from './edgeApi';
import { AccountAdminPanel } from './AccountAdminPanel';

export function SmeManageButton({
  sme,
  companies,
  onChanged,
  onToast,
}: {
  sme: SmeListItem;
  companies: { id: string; name: string }[];
  onChanged: () => void;
  onToast: (t: ToastMessage) => void;
}) {
  const [show, setShow] = useState(false);
  const [editName, setEditName] = useState(sme.name);
  const [editCompany, setEditCompany] = useState(sme.company_id || '');
  const [editOrg, setEditOrg] = useState(sme.organization);
  const [editTitle, setEditTitle] = useState(sme.title);
  const [editEmpNum, setEditEmpNum] = useState(sme.employee_number);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  // 전권 패널이 요청을 도는 동안 닫기·저장을 잠근다(비밀번호 재발급 중 모달이 닫히면 값이 사라진다).
  const [panelBusy, setPanelBusy] = useState(false);

  const dirty =
    editName !== sme.name ||
    editCompany !== (sme.company_id || '') ||
    editOrg !== sme.organization ||
    editTitle !== sme.title ||
    editEmpNum !== sme.employee_number;

  function open() {
    setEditName(sme.name);
    setEditCompany(sme.company_id || '');
    setEditOrg(sme.organization);
    setEditTitle(sme.title);
    setEditEmpNum(sme.employee_number);
    setConfirmDelete(false);
    setError('');
    setShow(true);
  }

  async function handleSave() {
    setError('');
    if (!editCompany) {
      setError('SME 계정에는 회사가 반드시 지정되어야 해요. 회사를 선택해 주세요.');
      return;
    }
    if (!dirty) {
      // 바뀐 게 없으면 저장했다고 알리지 않는다.
      setShow(false);
      return;
    }
    setSaving(true);
    try {
      await callAdminFn({
        mode: 'update-sme',
        profileId: sme.id,
        name: editName,
        company_id: editCompany,
        organization: editOrg,
        title: editTitle,
        employee_number: editEmpNum,
      });
      setShow(false);
      onToast({ type: 'success', msg: 'SME 계정 정보를 수정했어요.' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err, '수정하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError('');
    setDeleting(true);
    try {
      await callAdminFn({ mode: 'delete', profileId: sme.id });
      setShow(false);
      onToast({ type: 'success', msg: `${sme.name} SME 계정을 삭제했어요.` });
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'SME 계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={open}>
        관리
      </Button>

      {show && (
        <ModalShell
          title="SME 계정 수정"
          description="소속 정보와 비밀번호·로그인 ID·역할·상태까지 이 창에서 모두 바꿉니다."
          icon={<UserCog size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
          // 전권 패널이 들어와 내용이 길어졌다. 관리자 계정 관리 모달과 같은 폭(480px)을 쓴다.
          size="lg"
          onClose={() => setShow(false)}
          // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
          hideClose
          dirty={dirty && !saving && !deleting}
          closeDisabled={saving || deleting || panelBusy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShow(false)} disabled={saving || deleting || panelBusy}>
                닫기
              </Button>
              <Button onClick={handleSave} loading={saving} disabled={deleting || panelBusy}>
                {saving ? '저장 중...' : '수정사항 저장'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="회사" required>
              <select value={editCompany} onChange={(e) => setEditCompany(e.target.value)} className="input">
                <option value="">회사를 선택해 주세요</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="이름" value={editName} onChange={setEditName} />
              <Field label="사번" value={editEmpNum} onChange={setEditEmpNum} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="조직" value={editOrg} onChange={setEditOrg} />
              <Field label="직급" value={editTitle} onChange={setEditTitle} />
            </div>

            {/* 로그인 ID(이메일)는 아래 전권 패널에서 바꾼다 — 여기에 읽기 전용으로 한 번 더 두면
                같은 값이 두 곳에 보이면서 한쪽만 편집 가능해 혼동을 만든다. */}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2.5 t-label text-destructive"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* 비밀번호 재설정 · 로그인 ID · 역할 · 활성 · 가이드 초기화 (기획서 §3 F1~F7).
                관리자 계정 관리 화면과 같은 컴포넌트를 쓴다. */}
            <AccountAdminPanel
              target={{
                id: sme.id,
                name: sme.name,
                email: sme.email,
                role: 'sme',
                active: sme.active,
                companyId: sme.company_id,
              }}
              isSelf={false}
              // SME 계정이라 "마지막 관리자" 방어가 걸릴 일이 없다. 관리자로 올리는 것은 언제나 허용된다.
              isLastLoginableAdmin={false}
              onRefresh={onChanged}
              onBusyChange={setPanelBusy}
            />

            <div className="border-t border-border pt-4">
              {!confirmDelete ? (
                <Button
                  variant="danger"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving || deleting || panelBusy}
                >
                  <Trash2 size={15} aria-hidden="true" /> SME 계정 삭제
                </Button>
              ) : (
                <div className="rounded-element border border-destructive-border bg-destructive-muted p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                    <div>
                      <p className="t-label font-medium text-destructive">{sme.name} 계정을 삭제할까요?</p>
                      <p className="mt-1 t-caption leading-5 text-destructive">
                        삭제하면 해당 SME는 더 이상 로그인할 수 없고, 계정 복구가 어려울 수 있어요.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      취소
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
                      {deleting ? '삭제 중...' : '삭제'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
