// SME 계정 Excel 일괄 업로드 모달 — 관리자(ADMIN) 'SME 계정 관리' 화면에서 사용한다.
// 부분 실패를 성공으로 보고하지 않는다: 처리 결과(성공/실패 수 + 실패 목록)를 모달 안에 남긴다.
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import {
  downloadSmeTemplate,
  validateSmeRows,
  parseWorkbook,
  sheetToRows,
  type SmeValidationResult,
} from '@/lib/uploadUtils';
import { callAdminFn, errorMessage, getAccessToken } from './edgeApi';

interface UploadResult {
  total: number;
  created: number;
  failed: number;
  aborted: boolean;
  errors: { email: string; message: string }[];
}

export function SmeBulkUploadModal({
  companies,
  onClose,
  onCompleted,
}: {
  companies: { id: string; name: string }[];
  onClose: () => void;
  /** 한 건이라도 등록됐으면 목록을 새로고침하도록 부모에 알린다. 모달은 결과를 보여 주려고 열린 채로 둔다. */
  onCompleted: (result: { created: number; failed: number; aborted: boolean }) => void;
}) {
  const [validation, setValidation] = useState<SmeValidationResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  async function handleFile(file: File) {
    setValidating(true);
    setValidation(null);
    setResult(null);
    setFileError('');
    setFileName(file.name);
    try {
      const wb = await parseWorkbook(file);
      const sheetName = wb.SheetNames.includes('SME 계정') ? 'SME 계정' : wb.SheetNames[0];
      const rows = sheetToRows<Record<string, unknown>>(wb, sheetName);

      // 기존 이메일 / (회사|사번) 중복 검사용 자료
      const { data: existingProfiles, error } = await supabase!
        .from('profiles')
        .select('email, company_id, employee_number')
        .eq('role', 'sme');
      if (error) throw new Error('기존 계정 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');

      const existingEmails = new Set(
        (existingProfiles || []).map((p: Record<string, unknown>) => (p.email as string).toLowerCase()),
      );
      const existingEmpNums = new Set<string>();
      for (const p of (existingProfiles || []) as Record<string, unknown>[]) {
        if (p.company_id && p.employee_number) {
          const compName = companies.find((c) => c.id === p.company_id)?.name || '';
          if (compName) existingEmpNums.add(`${compName}|${p.employee_number}`);
        }
      }
      const companyNames = new Set(companies.map((c) => c.name));
      setValidation(validateSmeRows(rows, existingEmails, existingEmpNums, companyNames));
    } catch (err) {
      setFileError(errorMessage(err, '파일을 읽을 수 없어요. xlsx 또는 xls 파일인지 확인한 뒤 다시 선택해 주세요.'));
    }
    setValidating(false);
  }

  async function handleCreate() {
    if (!validation || validation.valid === 0) return;
    const rows = validation.validRows;
    const compIdMap = new Map(companies.map((c) => [c.name, c.id]));

    abortRef.current = false;
    setResult(null);
    setSubmitting(true);
    setProgress({ done: 0, total: rows.length });

    let token: string;
    try {
      // 토큰은 행마다가 아니라 한 번만 가져온다.
      token = await getAccessToken();
    } catch (err) {
      setSubmitting(false);
      setResult({
        total: rows.length,
        created: 0,
        failed: rows.length,
        aborted: false,
        errors: [{ email: '', message: errorMessage(err, '인증 정보를 확인할 수 없어요.') }],
      });
      return;
    }

    let created = 0;
    const errors: UploadResult['errors'] = [];

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break;
      const row = rows[i];
      try {
        await callAdminFn(
          {
            mode: 'create-sme',
            sme: {
              name: row.이름,
              email: row.이메일,
              password: row.비밀번호,
              company_id: compIdMap.get(row.회사) || null,
              organization: row.조직,
              title: row.직급,
              employee_number: row.사번,
            },
          },
          token,
        );
        created++;
      } catch (err) {
        errors.push({ email: String(row.이메일), message: errorMessage(err, '등록하지 못했어요.') });
      }
      setProgress({ done: i + 1, total: rows.length });
    }

    const aborted = abortRef.current;
    setSubmitting(false);
    setResult({ total: rows.length, created, failed: errors.length, aborted, errors });
    onCompleted({ created, failed: errors.length, aborted });
  }

  const canUpload = Boolean(validation && validation.valid > 0) && !submitting && !result;

  return (
    <ModalShell
      title="SME 계정 전체 업로드"
      description="Excel 양식으로 SME 계정을 한 번에 등록합니다. 기존 계정 수정은 목록의 '관리' 버튼을 이용해 주세요."
      icon={<Upload size={18} className="mt-0.5 text-primary" aria-hidden="true" />}
      onClose={onClose}
      size="lg"
      dirty={Boolean(validation) && !result && !submitting}
      closeDisabled={submitting}
      footer={
        submitting ? (
          <Button variant="danger" onClick={() => (abortRef.current = true)}>
            업로드 중단
          </Button>
        ) : result ? (
          <Button onClick={onClose}>닫기</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button onClick={handleCreate} disabled={!canUpload}>
              검증 후 전체 업로드
            </Button>
          </>
        )
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={downloadSmeTemplate} disabled={submitting}>
          <Download size={15} aria-hidden="true" /> 업로드 양식 다운로드
        </Button>
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={submitting}>
          <FileSpreadsheet size={15} aria-hidden="true" /> Excel 파일 선택
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {fileName && <p className="mb-3 text-xs text-foreground-subtle">선택된 파일: {fileName}</p>}

      {fileError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2.5 text-sm text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{fileError}</span>
        </div>
      )}

      {validating && (
        <div className="py-8 text-center text-sm text-foreground-subtle">
          <Loader2 size={20} className="mx-auto mb-2 animate-spin" aria-hidden="true" /> 검증 중...
        </div>
      )}

      {validation && !validating && (
        <div className="mb-4">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-element border border-border bg-muted p-3 text-center">
              <p className="text-xs text-foreground-muted">총 대상</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{validation.total}명</p>
            </div>
            <div className="rounded-element border border-success-border bg-success-muted p-3 text-center">
              <p className="text-xs text-success">정상</p>
              <p className="mt-1 text-lg font-semibold text-success">{validation.valid}명</p>
            </div>
            <div className="rounded-element border border-destructive-border bg-destructive-muted p-3 text-center">
              <p className="text-xs text-destructive">오류</p>
              <p className="mt-1 text-lg font-semibold text-destructive">{validation.errors}명</p>
            </div>
          </div>
          {validation.errorList.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-element border border-destructive-border bg-destructive-muted p-3">
              <p className="mb-2 text-xs font-medium text-destructive">양식 오류 — 아래 행은 업로드하지 않습니다.</p>
              <ul className="space-y-1">
                {validation.errorList.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">
                    {e.row}행: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {submitting && (
        <div className="mb-2" aria-live="polite">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-foreground-muted">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              {progress.done}/{progress.total}명 처리 중
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
            aria-label="업로드 진행률"
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3" aria-live="polite">
          <div
            className={`flex items-start gap-2 rounded-element border px-3 py-2.5 text-sm ${
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
              {result.total}명 중 {result.created}명 등록, {result.failed}명 실패
              {result.aborted && ` (중단 — ${result.total - result.created - result.failed}명은 시도하지 않았어요)`}
              {result.failed > 0 && ' — 실패한 행은 원인을 고친 뒤 그 행만 다시 업로드해 주세요.'}
            </p>
          </div>

          {result.errors.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-element border border-destructive-border bg-destructive-muted p-3">
              <p className="mb-2 text-xs font-medium text-destructive">실패 목록 ({result.errors.length}건)</p>
              <ul className="space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">
                    {e.email ? `${e.email}: ` : ''}
                    {e.message}
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
