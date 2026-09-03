// SME 계정 전체 삭제 확인 모달 — 관리자(ADMIN) 'SME 계정 관리' 화면의 ⋯ 메뉴에서 연다.
// 부분 실패를 성공으로 보고하지 않는다: 결과와 실패 목록을 모달 안에 남긴다.
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ModalShell } from '@/components/ui/ModalShell';
import type { SmeListItem } from '@/types';
import { callAdminFn, errorMessage, getAccessToken } from './edgeApi';

/** 확인 문구. 화면에 이 값을 그대로 보여 주고, 비교할 때는 공백만 무시한다. */
const CONFIRM_PHRASE = '전체삭제';
const normalize = (v: string) => v.replace(/\s/g, '');

interface DeleteResult {
  total: number;
  deleted: number;
  failed: number;
  aborted: boolean;
  errors: string[];
}

export function SmeBulkDeleteModal({
  smeList,
  companyFilter,
  companies,
  onClose,
  onCompleted,
}: {
  smeList: SmeListItem[];
  companyFilter: string;
  companies: { id: string; name: string }[];
  onClose: () => void;
  onCompleted: (result: { deleted: number; failed: number; aborted: boolean }) => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: smeList.length });
  const [result, setResult] = useState<DeleteResult | null>(null);
  const abortRef = useRef(false);

  const scopeName =
    companyFilter === 'all' ? '전체 회사' : companies.find((c) => c.id === companyFilter)?.name || '선택 회사';
  const confirmed = normalize(confirmText) === CONFIRM_PHRASE;

  async function handleDeleteAll() {
    if (!confirmed || smeList.length === 0) return;

    abortRef.current = false;
    setDeleting(true);
    setResult(null);
    setProgress({ done: 0, total: smeList.length });

    let token: string;
    try {
      // 토큰은 루프 밖에서 한 번만 가져온다.
      token = await getAccessToken();
    } catch (err) {
      setDeleting(false);
      setResult({
        total: smeList.length,
        deleted: 0,
        failed: smeList.length,
        aborted: false,
        errors: [errorMessage(err, '인증 정보를 확인할 수 없어요.')],
      });
      return;
    }

    let deleted = 0;
    const errors: string[] = [];

    for (let i = 0; i < smeList.length; i++) {
      if (abortRef.current) break;
      const sme = smeList[i];
      try {
        await callAdminFn({ mode: 'delete', profileId: sme.id }, token);
        deleted++;
      } catch (err) {
        errors.push(`${sme.name} (${sme.email}): ${errorMessage(err, '삭제하지 못했어요.')}`);
      }
      setProgress({ done: i + 1, total: smeList.length });
    }

    const aborted = abortRef.current;
    setDeleting(false);
    setResult({ total: smeList.length, deleted, failed: errors.length, aborted, errors });
    onCompleted({ deleted, failed: errors.length, aborted });
  }

  return (
    <ModalShell
      title="SME 전체 삭제"
      description="현재 선택 범위의 SME 계정을 모두 삭제합니다."
      icon={<AlertTriangle size={18} className="mt-0.5 text-destructive" aria-hidden="true" />}
      onClose={onClose}
      dirty={Boolean(confirmText) && !result && !deleting}
      closeDisabled={deleting}
      footer={
        deleting ? (
          <Button variant="secondary" onClick={() => (abortRef.current = true)}>
            삭제 중단
          </Button>
        ) : result ? (
          <Button onClick={onClose}>닫기</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button variant="danger" onClick={handleDeleteAll} disabled={!confirmed || smeList.length === 0}>
              <AlertTriangle size={15} aria-hidden="true" /> {smeList.length}명 삭제 실행
            </Button>
          </>
        )
      }
    >
      <div className="rounded-element border border-destructive-border bg-destructive-muted p-4">
        <div className="grid grid-cols-2 gap-4 t-label">
          <div>
            <p className="t-caption text-destructive">삭제 범위</p>
            <p className="mt-1 font-semibold text-destructive">{scopeName}</p>
          </div>
          <div>
            <p className="t-caption text-destructive">삭제 대상</p>
            <p className="mt-1 font-semibold text-destructive">{smeList.length}명</p>
          </div>
        </div>
        <p className="mt-4 t-caption leading-5 text-destructive">
          삭제된 SME는 더 이상 로그인할 수 없어요. 검토 관련 연결 데이터에도 영향을 줄 수 있으니, 실제 삭제가 필요할
          때만 사용해 주세요.
        </p>
      </div>

      {!deleting && !result && (
        <div className="mt-5">
          <Field
            label="확인 문구 입력"
            required
            value={confirmText}
            onChange={setConfirmText}
            placeholder={CONFIRM_PHRASE}
            autoComplete="off"
            description={`확인을 위해 «${CONFIRM_PHRASE}»를 그대로 입력해 주세요.`}
          />
        </div>
      )}

      {deleting && (
        <div className="mt-6" aria-live="polite">
          <div className="mb-2 flex items-center justify-between t-label">
            <span className="flex items-center gap-2 text-foreground-muted">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              {progress.done}/{progress.total}명 삭제 중
            </span>
            <span className="font-medium text-foreground">
              {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="삭제 진행률"
          >
            <div
              className="h-full rounded-full bg-destructive transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-3" aria-live="polite">
          <div
            className={`flex items-start gap-2 rounded-element border px-3 py-2.5 t-label ${
              result.failed === 0 && !result.aborted
                ? 'border-success-border bg-success-muted text-success'
                : 'border-warning-border bg-warning-muted text-warning'
            }`}
          >
            {result.failed === 0 && !result.aborted ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <p>
              {result.total}명 중 {result.deleted}명 삭제, {result.failed}명 실패
              {result.aborted && ` (중단 — ${result.total - result.deleted - result.failed}명은 남아 있어요)`}
            </p>
          </div>

          {result.errors.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-element border border-destructive-border bg-destructive-muted p-3">
              <p className="mb-2 t-caption font-medium text-destructive">실패 목록 ({result.errors.length}건)</p>
              <ul className="space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="t-caption text-destructive">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
