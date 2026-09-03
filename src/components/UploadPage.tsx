import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileSpreadsheet, Info, Loader2, RefreshCw, Upload } from 'lucide-react';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from './ui/Button';
import { Toast, useToast } from './ui/Toast';
import {
  JOB_SHEET_NAME,
  ORG_SHEET_NAME,
  SKILL_SHEET_NAME,
  SME_SHEET_NAME,
  downloadIntegratedTemplate,
  parseAndValidateIntegratedWorkbook,
  type IntegratedValidationResult,
} from '@/lib/integratedUploadUtils';
import {
  fetchCurrentJobCount,
  fetchExistingJobNames,
  linkSmeRoster,
  saveIntegratedJobData,
  saveOrgUnits,
  type IntegratedSaveResult,
  type SmeRosterLinkResult,
  type UploadMode,
} from '@/lib/integratedJobApi';
import {
  IntegratedFileDrop,
  ModeOption,
  PreviewPanel,
  ReplaceConfirmModal,
  RosterSummary,
  SaveProgress,
  StepIndicator,
  ValidationPanel,
} from '@/components/upload/parts';
import { ORG_SAVE_PHASE, SAVE_PHASES, SME_SAVE_PHASE, SME_SHEET_NOTICE } from '@/components/upload/constants';

type PageState = 'idle' | 'validating' | 'validated' | 'saving' | 'done';

export function UploadPage({
  companyFilter,
  setCompanyFilter,
}: {
  /** 공통 회사 필터(App 보유). 업로드는 대상이 하나여야 하므로 'all'이면 저장 버튼을 막는다(v2 F4). */
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<PageState>('idle');
  const [validation, setValidation] = useState<IntegratedValidationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<UploadMode>('append');
  const [savePhase, setSavePhase] = useState(0);
  const [saveResult, setSaveResult] = useState<IntegratedSaveResult | null>(null);
  const [orgSavedCount, setOrgSavedCount] = useState(0);
  const [rosterResult, setRosterResult] = useState<SmeRosterLinkResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentJobCount, setCurrentJobCount] = useState<number | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast, showToast, dismiss } = useToast();

  // 회사명 하드코딩('서연이화')을 걷어낸 자리(v2 F4). 대상 회사는 관리자가 고른다.
  const companyId = companyFilter === 'all' ? null : companyFilter;
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '';

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  const resetFile = useCallback(() => {
    setFile(null);
    setValidation(null);
    setParseError(null);
    setState('idle');
    setSaveResult(null);
    setOrgSavedCount(0);
    setRosterResult(null);
    setSaveError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleIntegratedFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setValidation(null);
    setParseError(null);
    setSaveResult(null);
    setOrgSavedCount(0);
    setRosterResult(null);
    setSaveError(null);
    setState('validating');

    try {
      // 두 번째 인자는 SME 명부 Sheet가 있을 때만 호출됩니다. 기존 2시트 파일은 조회를 타지 않습니다.
      const checked = await parseAndValidateIntegratedWorkbook(selectedFile, async () =>
        companyId ? fetchExistingJobNames(companyId) : [],
      );
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
  }, [companyId]);

  const runUpload = useCallback(async () => {
    if (!validation?.valid || state === 'saving') return;

    setConfirmOpen(false);
    setState('saving');
    setSavePhase(0);
    setSaveError(null);
    setSaveResult(null);
    setOrgSavedCount(0);
    setRosterResult(null);

    if (!companyId) {
      setSaveError('업로드할 회사를 먼저 선택해 주세요. 「전체 회사」로는 저장할 수 없어요.');
      setState('validated');
      return;
    }

    try {
      setSavePhase(1);
      const result = await saveIntegratedJobData({
        jobRows: validation.jobRows,
        skillRows: validation.skillRows,
        mode,
        companyId,
      });
      setSaveResult(result);
      // 조직 마스터 → SME 명부 순서로 이어서 반영합니다. 순서를 바꾸면 안 됩니다 —
      // 명부의 조직코드는 방금 저장한 org_units에서만 풀 수 있습니다.
      //
      // 둘 다 위 RPC(단일 트랜잭션) 밖의 별도 저장입니다. 여기서 실패해도 직무·과업·Skill은
      // 이미 커밋된 뒤라, 전체 실패로 되돌리면 관리자는 아무것도 안 들어간 줄 알고 같은 파일을
      // 처음부터 다시 올립니다. 그래서 실패해도 완료 요약은 그대로 띄우고 실패한 단계만 따로 알립니다.
      // 두 단계 모두 멱등이라 「다시 시도」로 같은 파일을 다시 올려도 행이 늘지 않습니다.
      if (validation.orgRows.length > 0) {
        setSavePhase(2);
        try {
          setOrgSavedCount(await saveOrgUnits({ companyId, rows: validation.orgRows }));
        } catch (error) {
          setSaveError(
            `조직 마스터를 저장하지 못했어요. ${error instanceof Error ? error.message : ''} ` +
              '직무·과업·Skill은 저장되었습니다. 조직 마스터만 다시 시도해 주세요.',
          );
        }
      }
      // SME 명부: 이미 등록된 계정의 소속 조직(§9 E2 조직축·R8)과 배정직무(R6)만 반영합니다.
      // 계정은 만들지 않습니다 — 계정이 없는 사람은 결과 요약에 명단으로 남깁니다.
      if (validation.smeRows.length > 0) {
        setSavePhase(validation.orgRows.length > 0 ? 3 : 2);
        try {
          setRosterResult(await linkSmeRoster({ companyId, rows: validation.smeRows }));
        } catch (error) {
          // 조직 마스터도 실패했다면 두 문장을 함께 보여 줍니다(알림 영역이 whitespace-pre-line입니다).
          setSaveError(
            (prev) =>
              `${prev ? `${prev}\n` : ''}SME 명부를 반영하지 못했어요. ` +
              `${error instanceof Error ? error.message : ''} ` +
              '직무·과업·Skill은 저장되었습니다. 명부만 다시 시도해 주세요.',
          );
        }
      }
      setState('done');
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? `저장하지 못했어요. ${error.message} 잠시 후 다시 시도하거나, 반복되면 관리자에게 문의해 주세요.`
          : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
      setState('validated');
    }
  }, [companyId, mode, state, validation]);

  const handleUploadClick = useCallback(async () => {
    if (!validation?.valid || state === 'saving') return;
    if (mode === 'append') {
      void runUpload();
      return;
    }
    // 전체 교체는 되돌릴 수 없으므로 현재 등록 건수를 보여 주고 한 번 더 확인받습니다.
    setCurrentJobCount(undefined);
    setConfirmOpen(true);
    if (!companyId) {
      setCurrentJobCount(null);
      return;
    }
    setCurrentJobCount(await fetchCurrentJobCount(companyId));
  }, [companyId, mode, runUpload, state, validation]);

  const canUpload =
    Boolean(validation?.valid) && Boolean(companyId) && (state === 'validated' || state === 'done');

  const savePhases = useMemo(
    () => [
      ...SAVE_PHASES,
      ...(validation && validation.orgRows.length > 0 ? [ORG_SAVE_PHASE] : []),
      ...(validation && validation.smeRows.length > 0 ? [SME_SAVE_PHASE] : []),
    ],
    [validation],
  );

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

      <div className="mb-6 rounded-container border border-border bg-card p-5 shadow-1">
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
              ...(orgSavedCount > 0 ? [['조직', orgSavedCount]] : []),
              ...(rosterResult ? [['소속 조직 연결', rosterResult.linkedCount]] : []),
              ...(rosterResult ? [['배정직무 추가', rosterResult.assignmentCreatedCount]] : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs opacity-80">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold">{Number(value).toLocaleString()}건</dd>
              </div>
            ))}
          </dl>
          {rosterResult && <RosterSummary result={rosterResult} />}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div className="rounded-container border border-border bg-card p-6 shadow-1">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-foreground">통합 Excel 파일 업로드</h3>
                <p className="mt-1 text-xs text-foreground-subtle">
                  Sheet 1 {JOB_SHEET_NAME} · Sheet 2 {SKILL_SHEET_NAME}
                </p>
                <p className="mt-1 text-xs text-foreground-subtle">
                  Sheet 3 {ORG_SHEET_NAME} · Sheet 4 {SME_SHEET_NAME} (선택 — 없어도 업로드됩니다)
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

        <aside className="h-fit rounded-container border border-border bg-card p-5 shadow-1">
          {/* 대상 회사 — 저장 대상이 무엇인지가 업로드 방식보다 먼저 정해져야 한다(v2 F4). */}
          <h3 className="font-semibold text-foreground">대상 회사</h3>
          <div className="mt-3">
            <CompanyFilterDropdown
              companies={companies}
              value={companyFilter}
              onChange={setCompanyFilter}
              label="대상 회사"
              className="w-full"
            />
            {companyId ? (
              <p className="mt-2 text-xs text-foreground-muted">
                이 파일의 직무·과업·Skill이 <span className="font-medium text-foreground">{companyName}</span> 에
                저장됩니다.
              </p>
            ) : (
              <p className="mt-2 text-xs text-warning">업로드할 회사를 선택해 주세요. 「전체 회사」로는 저장할 수 없어요.</p>
            )}
          </div>

          <h3 className="mt-6 font-semibold text-foreground">업로드 방식</h3>
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
            <span>
              두 Sheet가 하나의 작업으로 검증되고 저장됩니다. {ORG_SHEET_NAME} Sheet가 있으면 이어서 반영하고,{' '}
              {SME_SHEET_NOTICE}. 기존 배정은 지우지 않고 명부에 있는 직무만 더합니다.
            </span>
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
              phases={savePhases}
              jobRows={validation.jobRows.length}
              skillRows={validation.skillRows.length}
              orgRows={validation.orgRows.length}
              smeRows={validation.smeRows.length}
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

// ── SME 명부 반영 결과 ──────────────────────────────────────────────
