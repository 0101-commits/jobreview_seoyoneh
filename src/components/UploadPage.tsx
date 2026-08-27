import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type RefObject,
} from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import {
  JOB_SHEET_NAME,
  SKILL_SHEET_NAME,
  downloadIntegratedTemplate,
  parseAndValidateIntegratedWorkbook,
  type IntegratedValidationResult,
} from '@/lib/integratedUploadUtils';
import {
  fetchFixedCompanyId,
  saveIntegratedJobData,
  type UploadMode,
} from '@/lib/integratedJobApi';

type PageState = 'idle' | 'validating' | 'validated' | 'saving' | 'done';

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<PageState>('idle');
  const [validation, setValidation] = useState<IntegratedValidationResult | null>(null);
  const [mode, setMode] = useState<UploadMode>('append');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultIsError, setResultIsError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetFile = useCallback(() => {
    setFile(null);
    setValidation(null);
    setState('idle');
    setResultMessage(null);
    setResultIsError(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleIntegratedFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setValidation(null);
    setResultMessage(null);
    setResultIsError(false);
    setState('validating');

    try {
      const checked = await parseAndValidateIntegratedWorkbook(selectedFile);
      setValidation(checked);
      setState('validated');
    } catch (error) {
      setValidation({
        valid: false,
        errors: [`파일: ${error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다.'}`],
        warnings: [],
        jobRows: [],
        skillRows: [],
        jobCount: 0,
        taskCount: 0,
        activityCount: 0,
        skillCount: 0,
        requirementCount: 0,
        matchedJobCount: 0,
        jobErrorCount: 0,
        skillErrorCount: 0,
        jobMissingCount: 0,
        skillMissingCount: 0,
        duplicateJobRowCount: 0,
        duplicateSkillRowCount: 0,
      });
      setState('validated');
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!validation?.valid || state === 'saving') return;

    setState('saving');
    setResultMessage(null);
    setResultIsError(false);

    try {
      const companyId = await fetchFixedCompanyId();
      const result = await saveIntegratedJobData({
        jobRows: validation.jobRows,
        skillRows: validation.skillRows,
        mode,
        companyId,
      });

      setResultMessage(
        `직무정보 업로드가 완료되었습니다.\n직무 ${result.jobCount}개, 주요과업 ${result.taskCount}개, ` +
        `세부활동 ${result.activityCount}개, Skill ${result.skillCount}개가 반영되었습니다.`,
      );
      setState('done');
    } catch (error) {
      setResultIsError(true);
      setResultMessage(`오류: ${error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.'}`);
      setState('validated');
    }
  }, [mode, state, validation]);

  const canUpload = Boolean(validation?.valid) && state === 'validated';

  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-sm text-slate-400">
          1. 파일 선택 → 2. 데이터 검증 → 3. 저장 방식 선택 → 4. 최종 업로드
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">직무정보 통합 업로드</h2>
        <p className="mt-2 text-sm text-slate-500">
          하나의 Excel 파일로 직무·과업 정보와 Skill·수행요건을 한 번에 등록합니다.
        </p>
      </div>

      {resultMessage && (
        <div className={`mb-5 whitespace-pre-line rounded-md border p-4 text-sm ${
          resultIsError
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {resultMessage}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div className="border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900">통합 Excel 파일 업로드</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Sheet 1 직무 및 과업 정보 · Sheet 2 Skill 및 수행요건
                </p>
              </div>
              {file && (
                <button
                  type="button"
                  onClick={resetFile}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-[#247d7c] hover:text-[#247d7c]"
                >
                  <RefreshCw size={14} /> 파일 변경
                </button>
              )}
            </div>

            <IntegratedFileDrop
              file={file}
              inputRef={inputRef}
              disabled={state === 'validating' || state === 'saving'}
              onFile={handleIntegratedFile}
              onClear={resetFile}
            />

            <button
              type="button"
              onClick={downloadIntegratedTemplate}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:border-[#247d7c] hover:text-[#247d7c]"
            >
              <Download size={14} /> 통합 업로드 양식 다운로드
            </button>

            {state === 'validating' && (
              <div className="mt-5 flex items-center gap-2 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> 두 Sheet의 데이터 검증 및 매칭 중…
              </div>
            )}
          </div>

          {validation && state !== 'validating' && (
            <ValidationPanel validation={validation} />
          )}
        </section>

        <aside className="h-fit border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-900">업로드 방식</h3>
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
              description="새 버전으로 직무정보를 교체하며 기존 제출 피드백은 유지됩니다."
              onChange={() => setMode('replace')}
              disabled={state === 'saving'}
            />
          </div>

          <div className="mt-4 flex gap-2 rounded-md bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
            <Info size={15} className="mt-0.5 shrink-0 text-[#247d7c]" />
            <span>두 Sheet가 하나의 작업으로 검증되고 저장됩니다.</span>
          </div>

          <button
            type="button"
            onClick={handleUpload}
            disabled={!canUpload}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-[#247d7c] py-3 text-sm font-semibold text-white transition hover:bg-[#1d6867] disabled:cursor-not-allowed disabled:bg-slate-200"
          >
            {state === 'saving' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {state === 'saving'
              ? '전체 직무정보 저장 중...'
              : state === 'done'
                ? '전체 직무정보 업로드 완료'
                : '전체 직무정보 업로드'}
          </button>

          {!file && <p className="mt-3 text-center text-xs text-slate-400">먼저 Excel 파일을 선택해 주세요.</p>}
          {file && validation && !validation.valid && (
            <p className="mt-3 text-center text-xs text-rose-500">오류를 수정한 후 파일을 다시 선택해 주세요.</p>
          )}
        </aside>
      </div>
    </>
  );
}

function IntegratedFileDrop({
  file,
  inputRef,
  disabled,
  onFile,
  onClear,
}: {
  file: File | null;
  inputRef: RefObject<HTMLInputElement>;
  disabled: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) onFile(selected);
  };

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const selected = event.dataTransfer.files?.[0];
    if (selected) onFile(selected);
  };

  return (
    <>
      <label
        className={`flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed px-5 text-center transition ${
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
            : dragOver
              ? 'cursor-pointer border-[#247d7c] bg-[#f3fbfa]'
              : 'cursor-pointer border-slate-300 bg-slate-50 hover:border-[#247d7c] hover:bg-[#f3fbfa]'
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
        <Upload size={24} className="mb-3 text-slate-400" />
        <p className="text-sm font-medium text-slate-700">파일을 끌어놓거나 클릭하여 선택</p>
        <p className="mt-2 text-xs text-slate-400">
          {JOB_SHEET_NAME} · {SKILL_SHEET_NAME}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={selectFile}
          className="hidden"
          disabled={disabled}
        />
      </label>

      {file && (
        <div className="mt-3 flex items-center justify-between rounded-md bg-slate-50 px-4 py-3 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-slate-700">
            <FileSpreadsheet size={16} className="shrink-0 text-[#247d7c]" />
            <span className="truncate">{file.name}</span>
          </span>
          <button type="button" onClick={onClear} disabled={disabled} aria-label="선택 파일 삭제">
            <X size={16} className="text-slate-400 hover:text-slate-600" />
          </button>
        </div>
      )}
    </>
  );
}

function ValidationPanel({ validation }: { validation: IntegratedValidationResult }) {
  return (
    <div className="border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-slate-900">데이터 검증 결과</h3>

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
            ['누락', validation.jobMissingCount],
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
            ['누락', validation.skillMissingCount],
          ]}
        />
      </div>

      <div className={`mt-4 flex items-center gap-2 rounded-md px-4 py-3 text-sm ${
        validation.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
      }`}>
        {validation.valid ? <Check size={16} /> : <AlertTriangle size={16} />}
        {validation.valid
          ? '두 Sheet의 데이터가 정상적으로 검증되었습니다.'
          : '업로드할 수 없는 항목이 있습니다. 오류 내용을 수정한 후 파일을 다시 선택해 주세요.'}
      </div>

      {validation.errors.length > 0 && (
        <MessageList title="오류 내용" messages={validation.errors} type="error" />
      )}
      {validation.warnings.length > 0 && (
        <MessageList title={`확인 필요사항 ${validation.warnings.length}건`} messages={validation.warnings} type="warning" />
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
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-full ${
            valid ? 'bg-emerald-600 text-white' : 'bg-rose-100 text-rose-600'
          }`}>
            {valid ? <Check size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div>
            <p className="text-xs font-medium text-[#247d7c]">{sheetLabel}</p>
            <p className="mt-0.5 font-semibold text-slate-800">{title}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="text-right">
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`mt-0.5 text-sm font-semibold ${label === '오류' && value > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                {value.toLocaleString()}건
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageList({
  title,
  messages,
  type,
}: {
  title: string;
  messages: string[];
  type: 'error' | 'warning';
}) {
  const visible = messages.slice(0, 50);
  return (
    <div className={`mt-4 rounded-md border p-4 ${
      type === 'error' ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60'
    }`}>
      <p className={`text-sm font-medium ${type === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>{title}</p>
      <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto text-xs leading-5 text-slate-600">
        {visible.map((message, index) => (
          <li key={`${message}-${index}`}>
            {message}
          </li>
        ))}
      </ul>
      {messages.length > visible.length && (
        <p className="mt-2 text-xs text-slate-400">외 {messages.length - visible.length}건</p>
      )}
    </div>
  );
}

function ModeOption({
  checked,
  title,
  description,
  onChange,
  disabled,
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <label className={`flex gap-3 rounded-md border p-4 transition ${
      disabled
        ? 'cursor-not-allowed opacity-60'
        : checked
          ? 'cursor-pointer border-[#a5d5d2] bg-[#f3fbfa]'
          : 'cursor-pointer border-slate-200 hover:border-slate-300'
    }`}>
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 accent-[#247d7c]"
      />
      <span>
        <b className="block text-sm text-slate-800">{title}</b>
        <small className="mt-1 block text-xs leading-5 text-slate-500">{description}</small>
      </span>
    </label>
  );
}