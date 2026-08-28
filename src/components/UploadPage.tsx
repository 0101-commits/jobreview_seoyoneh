import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  Settings2,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from './ui/Button';
import { ModalShell } from './ui/ModalShell';
import { Toast, useToast } from './ui/Toast';
import {
  JOB_SHEET_NAME,
  SKILL_SHEET_NAME,
  downloadIntegratedTemplate,
  parseAndValidateIntegratedWorkbook,
  type IntegratedValidationResult,
} from '@/lib/integratedUploadUtils';
import {
  fetchCurrentJobCount,
  fetchFixedCompanyId,
  saveIntegratedJobData,
  type IntegratedSaveResult,
  type UploadMode,
} from '@/lib/integratedJobApi';

type PageState = 'idle' | 'validating' | 'validated' | 'saving' | 'done';

const STEPS = [
  { label: '파일 선택', icon: FileSpreadsheet },
  { label: '데이터 검증', icon: ListChecks },
  { label: '저장 방식 선택', icon: Settings2 },
  { label: '최종 업로드', icon: Upload },
] as const;

/** 저장은 서버 RPC 한 번으로 끝나므로 건별 진행률 대신 두 단계로만 알립니다. */
const SAVE_PHASES = ['회사 정보 확인 중', '직무정보 전송 및 반영 중'] as const;

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<PageState>('idle');
  const [validation, setValidation] = useState<IntegratedValidationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<UploadMode>('append');
  const [savePhase, setSavePhase] = useState(0);
  const [saveResult, setSaveResult] = useState<IntegratedSaveResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentJobCount, setCurrentJobCount] = useState<number | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast, showToast, dismiss } = useToast();

  const resetFile = useCallback(() => {
    setFile(null);
    setValidation(null);
    setParseError(null);
    setState('idle');
    setSaveResult(null);
    setSaveError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleIntegratedFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setValidation(null);
    setParseError(null);
    setSaveResult(null);
    setSaveError(null);
    setState('validating');

    try {
      const checked = await parseAndValidateIntegratedWorkbook(selectedFile);
      setValidation(checked);
    } catch (error) {
      setParseError(
        error instanceof Error && error.message
          ? `파일을 읽지 못했어요. ${error.message}`
          : '파일을 읽지 못했어요. 손상되지 않은 xlsx 파일인지 확인한 뒤 다시 선택해 주세요.',
      );
    } finally {
      setState('validated');
    }
  }, []);

  const runUpload = useCallback(async () => {
    if (!validation?.valid || state === 'saving') return;

    setConfirmOpen(false);
    setState('saving');
    setSavePhase(0);
    setSaveError(null);
    setSaveResult(null);

    try {
      const companyId = await fetchFixedCompanyId();
      setSavePhase(1);
      const result = await saveIntegratedJobData({
        jobRows: validation.jobRows,
        skillRows: validation.skillRows,
        mode,
        companyId,
      });
      setSaveResult(result);
      setState('done');
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? `저장하지 못했어요. ${error.message} 잠시 후 다시 시도하거나, 반복되면 관리자에게 문의해 주세요.`
          : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
      setState('validated');
    }
  }, [mode, state, validation]);

  const handleUploadClick = useCallback(async () => {
    if (!validation?.valid || state === 'saving') return;
    if (mode === 'append') {
      void runUpload();
      return;
    }
    // 전체 교체는 되돌릴 수 없으므로 현재 등록 건수를 보여 주고 한 번 더 확인받습니다.
    setCurrentJobCount(undefined);
    setConfirmOpen(true);
    try {
      const companyId = await fetchFixedCompanyId();
      setCurrentJobCount(await fetchCurrentJobCount(companyId));
    } catch {
      setCurrentJobCount(null);
    }
  }, [mode, runUpload, state, validation]);

  const canUpload = Boolean(validation?.valid) && (state === 'validated' || state === 'done');

  const currentStep = useMemo(() => {
    if (state === 'saving' || state === 'done') return 4;
    if (!file) return 1;
    if (state === 'validating' || parseError || !validation) return 2;
    return validation.valid ? 3 : 2;
  }, [file, parseError, state, validation]);

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">직무정보 통합 업로드</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          하나의 Excel 파일로 직무·과업 정보와 Skill·수행요건을 한 번에 등록합니다.
        </p>
      </div>

      <div className="mb-6 rounded-container border border-border bg-card p-5 shadow-sm">
        <StepIndicator current={currentStep} complete={state === 'done'} />
      </div>

      <Toast toast={toast} onDismiss={dismiss} />

      {saveError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted p-4 text-sm text-destructive"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 whitespace-pre-line">{saveError}</p>
          <Button size="sm" variant="secondary" onClick={() => void runUpload()}>
            <RefreshCw size={14} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      )}

      {state === 'done' && saveResult && (
        <div className="mb-5 rounded-element border border-success-border bg-success-muted p-4 text-sm text-success">
          <p className="flex items-center gap-2 font-semibold">
            <Check size={16} aria-hidden="true" /> 직무정보 업로드가 완료되었습니다.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['직무', saveResult.jobCount],
              ['주요과업', saveResult.taskCount],
              ['세부활동', saveResult.activityCount],
              ['Skill', saveResult.skillCount],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs opacity-80">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold">{Number(value).toLocaleString()}건</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div className="rounded-container border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-foreground">통합 Excel 파일 업로드</h3>
                <p className="mt-1 text-xs text-foreground-subtle">
                  Sheet 1 {JOB_SHEET_NAME} · Sheet 2 {SKILL_SHEET_NAME}
                </p>
              </div>
              {file && (
                <Button size="sm" variant="secondary" onClick={resetFile} disabled={state === 'saving'}>
                  <RefreshCw size={14} aria-hidden="true" /> 파일 변경
                </Button>
              )}
            </div>

            <IntegratedFileDrop
              file={file}
              inputRef={inputRef}
              disabled={state === 'validating' || state === 'saving'}
              onFile={handleIntegratedFile}
              onClear={resetFile}
              onReject={(msg) => showToast({ type: 'error', msg })}
            />

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-element bg-primary-subtle px-4 py-3">
              <FileSpreadsheet size={16} className="shrink-0 text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-xs leading-5 text-foreground-muted">
                처음이라면 양식부터 받아 그대로 채워 주세요. 헤더 이름과 순서가 다르면 검증에서 막힙니다.
              </p>
              <Button size="sm" onClick={downloadIntegratedTemplate}>
                <Download size={14} aria-hidden="true" /> 통합 업로드 양식 다운로드
              </Button>
            </div>

            {state === 'validating' && (
              <div
                role="status"
                className="mt-5 flex items-center gap-2 rounded-element bg-muted px-4 py-3 text-sm text-foreground-muted"
              >
                <Loader2 size={16} className="animate-spin" aria-hidden="true" /> 두 Sheet의 데이터 검증 및 매칭 중…
              </div>
            )}
          </div>

          {parseError && (
            <div className="rounded-container border border-destructive-border bg-destructive-muted p-6 text-sm text-destructive">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                {parseError}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => file && void handleIntegratedFile(file)}
              >
                <RefreshCw size={14} aria-hidden="true" /> 같은 파일로 다시 검증
              </Button>
            </div>
          )}

          {validation && !parseError && state !== 'validating' && (
            <>
              <ValidationPanel validation={validation} onCopied={showToast} />
              <PreviewPanel validation={validation} />
            </>
          )}
        </section>

        <aside className="h-fit rounded-container border border-border bg-card p-5 shadow-sm">
          <h3 className="font-semibold text-foreground">업로드 방식</h3>
          <div className="mt-4 space-y-3">
            <ModeOption
              checked={mode === 'append'}
              title="기존 데이터에 추가"
              description="새로운 직무정보를 추가하고 기존 검토 이력을 유지합니다."
              onChange={() => setMode('append')}
              disabled={state === 'saving'}
            />
            <ModeOption
              checked={mode === 'replace'}
              title="기존 데이터 전체 교체"
              description="현재 등록된 직무정보를 이 파일 내용으로 바꿉니다. 실행 전 확인 창에서 현재 건수를 보여 드려요."
              onChange={() => setMode('replace')}
              disabled={state === 'saving'}
            />
          </div>

          <div className="mt-4 flex gap-2 rounded-element bg-muted px-3 py-3 text-xs leading-5 text-foreground-muted">
            <Info size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <span>두 Sheet가 하나의 작업으로 검증되고 저장됩니다.</span>
          </div>

          <Button
            size="lg"
            className="mt-5 w-full"
            onClick={() => void handleUploadClick()}
            disabled={!canUpload}
            loading={state === 'saving'}
          >
            {state !== 'saving' && <Upload size={16} aria-hidden="true" />}
            {state === 'saving' ? '전체 직무정보 저장 중…' : state === 'done' ? '다시 업로드' : '전체 직무정보 업로드'}
          </Button>

          {state === 'saving' && validation && (
            <SaveProgress
              phase={savePhase}
              jobRows={validation.jobRows.length}
              skillRows={validation.skillRows.length}
            />
          )}

          {!file && <p className="mt-3 text-center text-xs text-foreground-subtle">먼저 Excel 파일을 선택해 주세요.</p>}
          {file && validation && !validation.valid && state !== 'saving' && (
            <p className="mt-3 text-center text-xs text-destructive">오류를 수정한 후 파일을 다시 선택해 주세요.</p>
          )}
        </aside>
      </div>

      {confirmOpen && (
        <ReplaceConfirmModal
          currentJobCount={currentJobCount}
          fileJobCount={validation?.jobCount ?? 0}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void runUpload()}
        />
      )}
    </>
  );
}

// ── 진행 단계 ───────────────────────────────────────────────────────

function StepIndicator({ current, complete }: { current: number; complete: boolean }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-center" aria-label="업로드 진행 단계">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const isDone = complete || number < current;
        const isActive = !complete && number === current;
        const Icon = step.icon;
        return (
          <li key={step.label} className="flex flex-1 items-center gap-3" aria-current={isActive ? 'step' : undefined}>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                isDone
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isActive
                    ? 'border-primary bg-primary-subtle text-primary'
                    : 'border-border bg-muted text-foreground-subtle'
              }`}
            >
              {isDone ? <Check size={16} aria-hidden="true" /> : number}
            </span>
            <span className="min-w-0">
              <span
                className={`flex items-center gap-1.5 text-sm ${
                  isActive
                    ? 'font-semibold text-primary'
                    : isDone
                      ? 'font-medium text-foreground'
                      : 'text-foreground-subtle'
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {step.label}
                <span className="sr-only">{isDone ? ' (완료)' : isActive ? ' (진행 중)' : ' (대기)'}</span>
              </span>
            </span>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={`hidden h-px flex-1 sm:block ${isDone ? 'bg-primary' : 'bg-border'}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SaveProgress({ phase, jobRows, skillRows }: { phase: number; jobRows: number; skillRows: number }) {
  const label = SAVE_PHASES[Math.min(phase, SAVE_PHASES.length - 1)];
  return (
    <div className="mt-4 rounded-element bg-muted px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {phase + 1}/{SAVE_PHASES.length}단계 · {label}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={SAVE_PHASES.length}
        aria-valuenow={phase + 1}
        aria-valuetext={`${phase + 1}단계 ${label}`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((phase + 1) / SAVE_PHASES.length) * 100}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-4 text-foreground-subtle">
        직무·과업 {jobRows.toLocaleString()}행, Skill {skillRows.toLocaleString()}행을 한 번의 작업으로 저장합니다.
        서버가 한 번에 처리하므로 건별 진행률은 표시되지 않아요.
      </p>
    </div>
  );
}

// ── 전체 교체 확인 ──────────────────────────────────────────────────

function ReplaceConfirmModal({
  currentJobCount,
  fileJobCount,
  onCancel,
  onConfirm,
}: {
  currentJobCount: number | null | undefined;
  fileJobCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <ModalShell
      title="기존 데이터를 전체 교체할까요?"
      description="되돌릴 수 없는 작업입니다. 아래 내용을 확인해 주세요."
      icon={<AlertTriangle size={18} className="mt-0.5 text-destructive" aria-hidden="true" />}
      size="md"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            취소
          </Button>
          <Button variant="danger" disabled={!acknowledged} onClick={onConfirm}>
            전체 교체 업로드
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-element border border-border p-4">
          <dt className="text-xs text-foreground-muted">현재 등록된 직무</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            {currentJobCount === undefined ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-foreground-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> 확인 중…
              </span>
            ) : currentJobCount === null ? (
              <span className="text-sm text-foreground-muted">확인하지 못했어요</span>
            ) : (
              `${currentJobCount.toLocaleString()}건`
            )}
          </dd>
        </div>
        <div className="rounded-element border border-primary-border bg-primary-subtle p-4">
          <dt className="text-xs text-foreground-muted">업로드 파일의 직무</dt>
          <dd className="mt-1 text-lg font-semibold text-primary">{fileJobCount.toLocaleString()}건</dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2 rounded-element border border-destructive-border bg-destructive-muted p-4 text-sm leading-6 text-destructive">
        <li>현재 등록된 직무정보가 이 파일의 내용으로 대체됩니다.</li>
        <li>
          어떤 항목이 지워지고 무엇이 남는지는 서버의 교체 규칙을 따르며, 실행 후에는 화면에서 되돌릴 수 없습니다.
        </li>
        <li>불확실하다면 먼저 「기존 데이터에 추가」로 올리거나, 현재 데이터를 내려받아 보관해 주세요.</li>
      </ul>

      <label className="mt-4 flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1 h-4 w-4 accent-[rgb(var(--destructive))]"
        />
        <span>위 내용을 확인했고, 되돌릴 수 없는 전체 교체를 진행합니다.</span>
      </label>
    </ModalShell>
  );
}

// ── 파일 선택 / 드래그앤드롭 ────────────────────────────────────────

const ACCEPTED = /\.(xlsx|xls)$/i;

function IntegratedFileDrop({
  file,
  inputRef,
  disabled,
  onFile,
  onClear,
  onReject,
}: {
  file: File | null;
  inputRef: RefObject<HTMLInputElement>;
  disabled: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  onReject: (message: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const accept = (selected: File | undefined) => {
    if (!selected) return;
    if (!ACCEPTED.test(selected.name)) {
      onReject(`‘${selected.name}’은 업로드할 수 없어요. xlsx 또는 xls 파일을 선택해 주세요.`);
      return;
    }
    onFile(selected);
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => accept(event.target.files?.[0]);

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    if ((event.dataTransfer.files?.length ?? 0) > 1) {
      onReject('파일은 한 번에 하나만 올릴 수 있어요. 통합 양식 파일 하나만 놓아 주세요.');
      return;
    }
    accept(event.dataTransfer.files?.[0]);
  };

  return (
    <>
      <label
        className={`flex min-h-48 flex-col items-center justify-center rounded-element border border-dashed px-5 py-6 text-center transition ${
          disabled
            ? 'cursor-not-allowed border-border bg-muted opacity-60'
            : dragOver
              ? 'cursor-pointer border-primary bg-primary-subtle'
              : 'cursor-pointer border-border bg-muted hover:border-primary hover:bg-primary-subtle'
        }`}
        onDragOver={(event) => {
          if (!disabled) {
            event.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={dropFile}
      >
        <Upload
          size={24}
          className={`mb-3 ${dragOver ? 'text-primary' : 'text-foreground-subtle'}`}
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">
          {dragOver ? '여기에 놓으면 검증을 시작해요' : '파일을 끌어놓거나 클릭하여 선택'}
        </p>
        <p className="mt-2 text-xs text-foreground-muted">xlsx · xls 파일 1개 · Sheet 2개</p>
        <p className="mt-1 text-xs text-foreground-subtle">
          {JOB_SHEET_NAME} · {SKILL_SHEET_NAME}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={selectFile}
          className="sr-only"
          disabled={disabled}
        />
      </label>

      {file && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-element bg-muted px-4 py-3 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            <FileSpreadsheet size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            aria-label={`선택한 파일 ${file.name} 지우기`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-element text-foreground-subtle transition hover:bg-card hover:text-foreground-muted disabled:opacity-50 sm:h-9 sm:w-9"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}

// ── 검증 결과 ───────────────────────────────────────────────────────

function ValidationPanel({
  validation,
  onCopied,
}: {
  validation: IntegratedValidationResult;
  onCopied: (toast: { type: 'success' | 'error'; msg: string }) => void;
}) {
  return (
    <div className="rounded-container border border-border bg-card p-6 shadow-sm">
      <h3 className="font-semibold text-foreground">데이터 검증 결과</h3>

      <div className="mt-4 space-y-3">
        <SheetValidationCard
          sheetLabel="Sheet 1"
          title={JOB_SHEET_NAME}
          valid={validation.jobErrorCount === 0}
          stats={[
            ['직무', validation.jobCount],
            ['주요과업', validation.taskCount],
            ['세부활동', validation.activityCount],
            ['오류', validation.jobErrorCount],
            ['필수값 누락', validation.jobMissingCount],
            ['확인 필요', validation.jobWarningCount],
          ]}
        />
        <SheetValidationCard
          sheetLabel="Sheet 2"
          title={SKILL_SHEET_NAME}
          valid={validation.skillErrorCount === 0}
          stats={[
            ['Skill', validation.skillCount],
            ['수행요건 직무', validation.requirementCount],
            ['직무 매칭', validation.matchedJobCount],
            ['오류', validation.skillErrorCount],
            ['필수값 누락', validation.skillMissingCount],
            ['확인 필요', validation.skillWarningCount],
          ]}
        />
      </div>

      <p className="mt-3 text-xs leading-5 text-foreground-subtle">
        「필수값 누락」은 업로드를 막는 오류이고, 「확인 필요」는 선택 항목 공백·중복 제외처럼 업로드는 되는 안내입니다.
      </p>

      <div
        className={`mt-4 flex items-center gap-2 rounded-element px-4 py-3 text-sm ${
          validation.valid ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'
        }`}
      >
        {validation.valid ? <Check size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
        {validation.valid
          ? '두 Sheet의 데이터가 정상적으로 검증되었습니다.'
          : '업로드할 수 없는 항목이 있습니다. 오류 내용을 수정한 후 파일을 다시 선택해 주세요.'}
      </div>

      {validation.errors.length > 0 && (
        <MessageList
          title={`오류 ${validation.errors.length.toLocaleString()}건`}
          messages={validation.errors}
          type="error"
          onToast={onCopied}
        />
      )}
      {validation.warnings.length > 0 && (
        <MessageList
          title={`확인 필요사항 ${validation.warnings.length.toLocaleString()}건`}
          messages={validation.warnings}
          type="warning"
          onToast={onCopied}
        />
      )}
    </div>
  );
}

function SheetValidationCard({
  sheetLabel,
  title,
  valid,
  stats,
}: {
  sheetLabel: string;
  title: string;
  valid: boolean;
  stats: [string, number][];
}) {
  return (
    <div className="rounded-element border border-border p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              valid ? 'bg-success text-success-foreground' : 'bg-destructive-muted text-destructive'
            }`}
          >
            {valid ? <Check size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            <span className="sr-only">{valid ? '검증 통과' : '오류 있음'}</span>
          </span>
          <div>
            <p className="text-xs font-medium text-primary">{sheetLabel}</p>
            <p className="mt-0.5 font-semibold text-foreground">{title}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-2 sm:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label} className="text-right">
              <dt className="text-[11px] text-foreground-subtle">{label}</dt>
              <dd
                className={`mt-0.5 text-sm font-semibold ${
                  value > 0 && (label === '오류' || label === '필수값 누락')
                    ? 'text-destructive'
                    : value > 0 && label === '확인 필요'
                      ? 'text-warning'
                      : 'text-foreground-muted'
                }`}
              >
                {value.toLocaleString()}건
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const MESSAGE_PAGE = 50;

function MessageList({
  title,
  messages,
  type,
  onToast,
}: {
  title: string;
  messages: string[];
  type: 'error' | 'warning';
  onToast: (toast: { type: 'success' | 'error'; msg: string }) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE);
  const visible = messages.slice(0, visibleCount);
  const label = type === 'error' ? '오류' : '확인 필요사항';

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(messages.join('\n'));
      onToast({ type: 'success', msg: `${label} ${messages.length.toLocaleString()}건을 복사했어요.` });
    } catch {
      onToast({ type: 'error', msg: '복사하지 못했어요. 브라우저가 클립보드를 막고 있다면 엑셀로 내보내 주세요.' });
    }
  };

  const exportExcel = () => {
    const sheet = XLSX.utils.json_to_sheet(
      messages.map((message, index) => ({ 번호: index + 1, 구분: label, 내용: message })),
    );
    sheet['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 110 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '검증결과');
    XLSX.writeFile(wb, `직무정보_검증_${type === 'error' ? '오류' : '확인필요'}_${messages.length}건.xlsx`);
  };

  return (
    <div
      className={`mt-4 rounded-element border p-4 ${
        type === 'error' ? 'border-destructive-border bg-destructive-muted' : 'border-warning-border bg-warning-muted'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={`flex items-center gap-1.5 text-sm font-medium ${type === 'error' ? 'text-destructive' : 'text-warning'}`}
        >
          <AlertTriangle size={15} aria-hidden="true" />
          {title}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void copyAll()}>
            <Copy size={13} aria-hidden="true" /> 전체 복사
          </Button>
          <Button size="sm" variant="secondary" onClick={exportExcel}>
            <Download size={13} aria-hidden="true" /> 엑셀로 내보내기
          </Button>
        </div>
      </div>

      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-inner bg-card/60 p-3 text-xs leading-5 text-foreground-muted">
        {visible.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>

      {messages.length > visible.length && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground-muted">
            {visible.length.toLocaleString()} / {messages.length.toLocaleString()}건 표시 중
          </span>
          <Button size="sm" variant="ghost" onClick={() => setVisibleCount((count) => count + MESSAGE_PAGE * 4)}>
            {MESSAGE_PAGE * 4}건 더 보기
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setVisibleCount(messages.length)}>
            모두 보기
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 파일 내용 미리보기 ──────────────────────────────────────────────

const PREVIEW_ROWS = 20;

/** 「직무 및 과업 정보 12행: …」 형태의 메시지에서 오류가 난 엑셀 행 번호를 뽑습니다. */
function errorRowNumbers(messages: string[], sheet: string): Set<number> {
  const rows = new Set<number>();
  for (const message of messages) {
    if (!message.startsWith(sheet)) continue;
    const matched = / (\d+)행:/.exec(message);
    if (matched) rows.add(Number(matched[1]));
  }
  return rows;
}

function PreviewPanel({ validation }: { validation: IntegratedValidationResult }) {
  const [sheet, setSheet] = useState<'job' | 'skill'>('job');
  const [limit, setLimit] = useState(PREVIEW_ROWS);

  const jobErrorRows = useMemo(() => errorRowNumbers(validation.errors, JOB_SHEET_NAME), [validation.errors]);
  const skillErrorRows = useMemo(() => errorRowNumbers(validation.errors, SKILL_SHEET_NAME), [validation.errors]);

  const isJob = sheet === 'job';
  const total = isJob ? validation.jobRows.length : validation.skillRows.length;
  const errorRows = isJob ? jobErrorRows : skillErrorRows;
  const rowNumbers = isJob ? validation.jobRowNumbers : validation.skillRowNumbers;
  const headers = isJob
    ? ['직군', '직렬', '직무', '주요과업', '세부활동']
    : ['직군', '직렬', '직무', 'Skill 구분', 'Skill', '요구 학력'];

  const cells = useMemo(() => {
    if (isJob) {
      return validation.jobRows
        .slice(0, limit)
        .map((row) => [row.직군, row.직렬, row.직무, row.주요과업, row.세부활동]);
    }
    return validation.skillRows
      .slice(0, limit)
      .map((row) => [row.직군, row.직렬, row.직무, row['Skill 구분'], row.Skill, row['요구 학력'] || '—']);
  }, [isJob, limit, validation.jobRows, validation.skillRows]);

  if (validation.jobRows.length === 0 && validation.skillRows.length === 0) return null;

  return (
    <div className="rounded-container border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <Table2 size={16} className="text-primary" aria-hidden="true" /> 파일 내용 미리보기
        </h3>
        <div className="flex gap-2" role="group" aria-label="미리보기 Sheet 선택">
          {(
            [
              ['job', `${JOB_SHEET_NAME} (${validation.jobRows.length.toLocaleString()}행)`],
              ['skill', `${SKILL_SHEET_NAME} (${validation.skillRows.length.toLocaleString()}행)`],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              aria-pressed={sheet === key}
              variant={sheet === key ? 'primary' : 'secondary'}
              onClick={() => {
                setSheet(key);
                setLimit(PREVIEW_ROWS);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-foreground-muted">
        중복 제외 후 저장될 {total.toLocaleString()}행 중 상위 {Math.min(limit, total).toLocaleString()}행입니다.
        {errorRows.size > 0 && ` 오류가 있는 행은 붉게 표시했습니다.`}
      </p>

      <div className="mt-3 overflow-x-auto rounded-element border border-border">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-muted text-foreground-muted">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                엑셀 행
              </th>
              {headers.map((header) => (
                <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, index) => {
              const rowNumber = rowNumbers[index];
              const hasError = errorRows.has(rowNumber);
              return (
                <tr
                  key={`${rowNumber}-${index}`}
                  className={`border-t border-border ${hasError ? 'bg-destructive-muted' : ''}`}
                >
                  <th
                    scope="row"
                    className={`whitespace-nowrap px-3 py-2 text-left font-medium ${
                      hasError ? 'text-destructive' : 'text-foreground-subtle'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {hasError && <AlertTriangle size={12} aria-hidden="true" />}
                      {rowNumber ?? '—'}행{hasError && <span className="sr-only"> (오류 있음)</span>}
                    </span>
                  </th>
                  {row.map((value, cellIndex) => (
                    <td key={cellIndex} className="max-w-[220px] truncate px-3 py-2 text-foreground" title={value}>
                      {value}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > cells.length && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground-muted">
            {cells.length.toLocaleString()} / {total.toLocaleString()}행 표시 중
          </span>
          <Button size="sm" variant="ghost" onClick={() => setLimit((value) => value + 100)}>
            100행 더 보기
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 저장 방식 ───────────────────────────────────────────────────────

function ModeOption({
  checked,
  title,
  description,
  onChange,
  disabled,
}: {
  checked: boolean;
  title: string;
  description: ReactNode;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex gap-3 rounded-element border p-4 transition ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : checked
            ? 'cursor-pointer border-primary-border bg-primary-subtle'
            : 'cursor-pointer border-border hover:border-primary'
      }`}
    >
      <input
        type="radio"
        name="upload-mode"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]"
      />
      <span>
        <b className="block text-sm text-foreground">{title}</b>
        <small className="mt-1 block text-xs leading-5 text-foreground-muted">{description}</small>
      </span>
    </label>
  );
}
