/*
 * 직무정보 통합 업로드 화면의 표시 조각 — 검증 결과·미리보기·파일 드롭·진행 표시 (v2 D5 파일 분해).
 *
 * UploadPage.tsx는 1,217줄이었다. 업로드 상태 기계(검증→저장→명부 반영)와 이 표시 조각들이
 * 한 파일에 있어서, 미리보기 표 한 줄을 고칠 때도 저장 흐름 전체를 지나야 했다(기획안 §7 D5).
 * 상태를 들지 않는 조각(또는 자기 지역 상태만 쓰는 조각)만 이 파일로 옮겼다.
 */

import { useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode, type RefObject } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Check, Copy, Download, FileSpreadsheet, Info, Loader2, Table2, Upload, X } from 'lucide-react';
import {
  JOB_SHEET_NAME,
  ORG_SHEET_NAME,
  SKILL_SHEET_NAME,
  SME_SHEET_NAME,
  downloadNormalizedSmeRoster,
  type IntegratedValidationResult,
} from '@/lib/integratedUploadUtils';
import type { SmeRosterLinkResult } from '@/lib/integratedJobApi';
import { ProgressTracker } from '@/components/ui/ProgressTracker';
import { ProgressIndicator } from '@/components/ui/ProgressIndicator';
import { Button } from '@/components/ui/Button';
import { ModalShell } from '@/components/ui/ModalShell';
import { SME_SHEET_NOTICE, STEPS, listPreview } from '@/components/upload/constants';


/**
 * 무엇이 반영됐고 무엇이 남았는지를 한 화면에서 정확히 알립니다.
 * 계정이 없어 연결하지 못한 사람, 조직 마스터에 없는 조직코드, 등록된 직무에서 찾지 못한 직무명은
 * 조용히 사라지면 관리자가 영영 모릅니다 — 그래서 건수와 함께 실제 값을 나열합니다.
 */
export function RosterSummary({ result }: { result: SmeRosterLinkResult }) {
  return (
    <div className="mt-3 space-y-1 border-t border-success-border pt-3 t-caption leading-5">
      <p>
        이미 등록된 계정 {result.linkedCount.toLocaleString()}명의 소속 조직을 연결하고, 배정직무{' '}
        {result.assignmentCreatedCount.toLocaleString()}건을 추가했습니다.
        {result.assignmentCreatedCount === 0 && ' (이미 배정된 직무는 그대로 두었습니다.)'}
      </p>
      {result.unmatchedEmails.length > 0 && (
        <p>
          계정이 없는 {result.unmatchedEmails.length.toLocaleString()}명은 SME 계정 관리에서 먼저 만들어 주세요.{' '}
          {listPreview(result.unmatchedEmails)}
        </p>
      )}
      {result.missingOrgCodes.length > 0 && (
        <p>
          조직코드 {listPreview(result.missingOrgCodes)}는 조직 마스터에 없어 소속 조직을 연결하지 못했습니다.
        </p>
      )}
      {result.unknownJobNames.length > 0 && (
        <p>
          직무명 {listPreview(result.unknownJobNames)}는 등록된 직무에서 찾지 못해 배정하지 않았습니다.
        </p>
      )}
    </div>
  );
}

// ── 진행 단계 ───────────────────────────────────────────────────────

export function StepIndicator({ current, complete }: { current: number; complete: boolean }) {
  // v2 §6-4: 단계 표시는 공용 ProgressTracker 하나를 쓴다(마법사와 같은 부품).
  // 여기서는 표시 전용이라 onSelect를 주지 않는다 — 업로드 단계는 눌러서 건너뛸 수 없다.
  return (
    <ProgressTracker
      label="업로드 진행 단계"
      current={complete ? STEPS.length + 1 : current}
      items={STEPS.map((step, index) => ({
        step: index + 1,
        label: step.label,
        complete: complete || index + 1 < current,
      }))}
    />
  );
}

export function SaveProgress({
  phase,
  phases,
  jobRows,
  skillRows,
  orgRows,
  smeRows,
}: {
  phase: number;
  phases: string[];
  jobRows: number;
  skillRows: number;
  orgRows: number;
  smeRows: number;
}) {
  const label = phases[Math.min(phase, phases.length - 1)];
  return (
    <div className="mt-4 rounded-element bg-muted px-4 py-3">
      <p className="flex items-center gap-2 t-caption font-medium text-foreground-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {phase + 1}/{phases.length}단계 · {label}
      </p>
      {/* 단계 진행 — 이름은 위 문장이 말하므로 막대는 잔여량만 전달한다(v3 T3·T4). */}
      <ProgressIndicator
        className="mt-2"
        label="업로드 검증 진행"
        valueText={`${phase + 1}단계 ${label}`}
        min={1}
        max={phases.length}
        value={phase + 1}
      />
      <p className="mt-2 t-caption-2 leading-4 text-foreground-subtle">
        직무·과업 {jobRows.toLocaleString()}행, Skill {skillRows.toLocaleString()}행
        {orgRows > 0 ? `, 조직 ${orgRows.toLocaleString()}행` : ''}
        {smeRows > 0 ? `, SME 명부 ${smeRows.toLocaleString()}행` : ''}을 한 번의 작업으로 저장합니다. 서버가 한 번에
        처리하므로 건별 진행률은 표시되지 않아요.
      </p>
    </div>
  );
}

// ── 전체 교체 확인 ──────────────────────────────────────────────────

export function ReplaceConfirmModal({
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
      size="lg"
      onClose={onCancel}
      // footer에 취소·닫기가 있어 우상단 [X]를 감춘다(v3 T3 · montage 닫기 중복 금지).
      hideClose
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
          <dt className="t-caption text-foreground-muted">현재 등록된 직무</dt>
          <dd className="mt-1 t-headline text-foreground">
            {currentJobCount === undefined ? (
              <span className="inline-flex items-center gap-1.5 t-label text-foreground-muted">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> 확인 중…
              </span>
            ) : currentJobCount === null ? (
              <span className="t-label text-foreground-muted">확인하지 못했어요</span>
            ) : (
              `${currentJobCount.toLocaleString()}건`
            )}
          </dd>
        </div>
        <div className="rounded-element border border-primary-border bg-primary-subtle p-4">
          <dt className="t-caption text-foreground-muted">업로드 파일의 직무</dt>
          <dd className="mt-1 t-headline text-primary">{fileJobCount.toLocaleString()}건</dd>
        </div>
      </dl>

      <ul className="mt-4 space-y-2 rounded-element border border-destructive-border bg-destructive-muted p-4 t-label-reading text-destructive">
        <li>현재 등록된 직무정보가 이 파일의 내용으로 대체됩니다.</li>
        <li>
          어떤 항목이 지워지고 무엇이 남는지는 서버의 교체 규칙을 따르며, 실행 후에는 화면에서 되돌릴 수 없습니다.
        </li>
        <li>불확실하다면 먼저 「기존 데이터에 추가」로 올리거나, 현재 데이터를 내려받아 보관해 주세요.</li>
      </ul>

      <label className="mt-4 flex items-start gap-2 t-label text-foreground">
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

export function IntegratedFileDrop({
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
        <p className="t-label font-medium text-foreground">
          {dragOver ? '여기에 놓으면 검증을 시작해요' : '파일을 끌어놓거나 클릭하여 선택'}
        </p>
        <p className="mt-2 t-caption text-foreground-muted">xlsx · xls 파일 1개 · 필수 Sheet 2개</p>
        <p className="mt-1 t-caption text-foreground-subtle">
          {JOB_SHEET_NAME} · {SKILL_SHEET_NAME}
        </p>
        <p className="mt-1 t-caption text-foreground-subtle">
          선택 {ORG_SHEET_NAME} · {SME_SHEET_NAME}
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
        <div className="mt-3 flex items-center justify-between gap-2 rounded-element bg-muted px-4 py-3 t-label">
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            <FileSpreadsheet size={16} className="shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{file.name}</span>
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            aria-label={`선택한 파일 ${file.name} 지우기`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-element text-foreground-subtle transition hover:bg-card hover:text-foreground-muted disabled:opacity-50 sm:h-10 sm:w-10"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}

// ── 검증 결과 ───────────────────────────────────────────────────────

export function ValidationPanel({
  validation,
  onCopied,
}: {
  validation: IntegratedValidationResult;
  onCopied: (toast: { type: 'success' | 'error'; msg: string }) => void;
}) {
  return (
    <div className="rounded-container border border-border bg-card p-6 shadow-1">
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
        {validation.hasOrgSheet && (
          <SheetValidationCard
            sheetLabel="Sheet 3"
            title={ORG_SHEET_NAME}
            valid={validation.orgErrorCount === 0}
            stats={[
              ['조직', validation.orgCount],
              ['상위조직 연결', validation.orgRows.filter((row) => row.상위조직코드).length],
              ['오류', validation.orgErrorCount],
              ['필수값 누락', validation.orgMissingCount],
              ['확인 필요', validation.orgWarningCount],
            ]}
          />
        )}
        {validation.hasSmeSheet && (
          <SheetValidationCard
            sheetLabel="Sheet 4"
            title={SME_SHEET_NAME}
            valid={validation.smeErrorCount === 0}
            stats={[
              ['SME', validation.smeCount],
              ['배정직무', validation.assignmentCount],
              ['오류', validation.smeErrorCount],
              ['필수값 누락', validation.smeMissingCount],
              ['확인 필요', validation.smeWarningCount],
            ]}
          />
        )}
      </div>

      {validation.hasSmeSheet && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-element bg-muted px-4 py-3">
          <Info size={15} className="shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1 t-caption leading-5 text-foreground-muted">{SME_SHEET_NOTICE}.</p>
          {validation.smeRows.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => downloadNormalizedSmeRoster(validation.smeRows)}>
              <Download size={13} aria-hidden="true" /> 명부 정규화 결과 내려받기
            </Button>
          )}
        </div>
      )}

      <p className="mt-3 t-caption leading-5 text-foreground-subtle">
        「필수값 누락」은 업로드를 막는 오류이고, 「확인 필요」는 선택 항목 공백·중복 제외처럼 업로드는 되는 안내입니다.
      </p>

      <div
        className={`mt-4 flex items-center gap-2 rounded-element px-4 py-3 t-label ${
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
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              valid ? 'bg-success text-success-foreground' : 'bg-destructive-muted text-destructive'
            }`}
          >
            {valid ? <Check size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            <span className="sr-only">{valid ? '검증 통과' : '오류 있음'}</span>
          </span>
          <div>
            <p className="t-caption font-medium text-primary">{sheetLabel}</p>
            <p className="mt-0.5 font-semibold text-foreground">{title}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-2 sm:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label} className="text-right">
              <dt className="t-caption-2 text-foreground-subtle">{label}</dt>
              <dd
                className={`mt-0.5 t-label font-semibold ${
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
          className={`flex items-center gap-1.5 t-label font-medium ${type === 'error' ? 'text-destructive' : 'text-warning'}`}
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

      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-inner bg-card/60 p-3 t-caption leading-5 text-foreground-muted">
        {visible.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>

      {messages.length > visible.length && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="t-caption text-foreground-muted">
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

type PreviewKey = 'job' | 'skill' | 'org' | 'sme';

export function PreviewPanel({ validation }: { validation: IntegratedValidationResult }) {
  const [sheet, setSheet] = useState<PreviewKey>('job');
  const [limit, setLimit] = useState(PREVIEW_ROWS);

  // 선택 시트는 파일에 있을 때만 탭으로 나옵니다. 없으면 기존과 같은 2개 탭입니다.
  const tabs = useMemo(() => {
    const list: { key: PreviewKey; sheetName: string; rows: number }[] = [
      { key: 'job', sheetName: JOB_SHEET_NAME, rows: validation.jobRows.length },
      { key: 'skill', sheetName: SKILL_SHEET_NAME, rows: validation.skillRows.length },
    ];
    if (validation.hasOrgSheet) {
      list.push({ key: 'org', sheetName: ORG_SHEET_NAME, rows: validation.orgRows.length });
    }
    if (validation.hasSmeSheet) {
      list.push({ key: 'sme', sheetName: SME_SHEET_NAME, rows: validation.smeRows.length });
    }
    return list;
  }, [validation]);

  // 다른 파일을 다시 고르면 선택 시트가 사라질 수 있으므로 항상 존재하는 탭으로 되돌립니다.
  const active = tabs.find((tab) => tab.key === sheet) ?? tabs[0];

  const errorRows = useMemo(
    () => errorRowNumbers(validation.errors, active.sheetName),
    [active.sheetName, validation.errors],
  );

  const view = useMemo(() => {
    switch (active.key) {
      case 'skill':
        return {
          headers: ['직군', '직렬', '직무', 'Skill 구분', 'Skill', '요구 학력'],
          rowNumbers: validation.skillRowNumbers,
          cells: validation.skillRows
            .slice(0, limit)
            .map((row) => [row.직군, row.직렬, row.직무, row['Skill 구분'], row.Skill, row['요구 학력'] || '—']),
        };
      case 'org':
        return {
          headers: ['조직코드', '조직명', '상위조직코드'],
          rowNumbers: validation.orgRowNumbers,
          cells: validation.orgRows.slice(0, limit).map((row) => [row.조직코드, row.조직명, row.상위조직코드 || '—']),
        };
      case 'sme':
        return {
          headers: ['성명', '이메일', '조직코드', '직급', '배정직무'],
          rowNumbers: validation.smeRowNumbers,
          cells: validation.smeRows
            .slice(0, limit)
            .map((row) => [row.성명, row.이메일, row.조직코드, row.직급 || '—', row.배정직무목록.join(', ') || '—']),
        };
      default:
        return {
          headers: ['직군', '직렬', '직무', '주요과업', '세부활동'],
          rowNumbers: validation.jobRowNumbers,
          cells: validation.jobRows.slice(0, limit).map((row) => [row.직군, row.직렬, row.직무, row.주요과업, row.세부활동]),
        };
    }
  }, [active.key, limit, validation]);

  const { headers, rowNumbers, cells } = view;
  const total = active.rows;

  if (validation.jobRows.length === 0 && validation.skillRows.length === 0) return null;

  return (
    <div className="rounded-container border border-border bg-card p-6 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <Table2 size={16} className="text-primary" aria-hidden="true" /> 파일 내용 미리보기
        </h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="미리보기 Sheet 선택">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              size="sm"
              aria-pressed={active.key === tab.key}
              variant={active.key === tab.key ? 'primary' : 'secondary'}
              onClick={() => {
                setSheet(tab.key);
                setLimit(PREVIEW_ROWS);
              }}
            >
              {tab.sheetName} ({tab.rows.toLocaleString()}행)
            </Button>
          ))}
        </div>
      </div>

      <p className="mt-2 t-caption text-foreground-muted">
        {active.key === 'sme' ? '소속 조직·배정직무를 반영할' : '중복 제외 후 저장될'} {total.toLocaleString()}행 중 상위{' '}
        {Math.min(limit, total).toLocaleString()}행입니다.
        {errorRows.size > 0 && ` 오류가 있는 행은 붉게 표시했습니다.`}
      </p>

      <div className="mt-3 overflow-x-auto rounded-element border border-border">
        <table className="w-full min-w-[720px] text-left t-caption">
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
          <span className="t-caption text-foreground-muted">
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

export function ModeOption({
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
        <b className="block t-label text-foreground">{title}</b>
        <small className="mt-1 block t-caption leading-5 text-foreground-muted">{description}</small>
      </span>
    </label>
  );
}
