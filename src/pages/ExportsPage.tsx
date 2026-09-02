// 산출물 내보내기 센터 — 관리자(ADMIN) /exports (§9 · §10 P4 · §11-2 Phase 4).
//
// 이 화면의 목적은 "다운로드 버튼 모음"이 아니다. §9가 못박은 대로
// "각 Export가 어떤 계약 산출물·착수보고 문언의 원천인지 화면에 함께 표기해, 12월 검수 시
// 이 화면이 그대로 증빙 목록이 되게" 하는 것이다. 그래서 카드마다 §9 표의 매핑 라벨을
// 글자 그대로 붙인다(줄이거나 풀어 쓰지 않는다). 라벨·이름·설명의 원본은 exportSchema.ts다.
//
// 역할 분담
//   exportSchema.ts  시트·열·매핑 라벨의 계약(무엇을 내보내는가)
//   exportApi.ts     조회·집계(다른 작업자 소유)
//   exportFile.ts    XLSX·CSV·JSON 파일 생성(어떻게 파일이 되는가)
//   이 파일          고르기·실행·진행·실패 알림·감사 로그(누가 언제 눌렀는가)
//
// exportApi.ts와의 접점은 EXPORT_COLLECTORS 하나뿐이다 — Export ID → 조회 함수 표.
//   EXPORT_COLLECTORS[id](companyId, { basis? }): Promise<ApiResult<CollectedExport>>
//   · 반환 sheets의 순서·시트명·열은 EXPORT_DEFINITIONS[id].sheets 와 같다
//     (어긋나면 exportFile.checkSheetsMatchDefinition이 파일을 만들지 않고 막는다).
//   · basis는 E2에만 넘긴다(§9 E2의 승인 응답 기준/전체 기준 토글).
//   · 조회 실패는 ok:false로 온다. 실패를 빈 시트(=0건)로 내려보내지 않는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, FileSpreadsheet, Info, RotateCw } from 'lucide-react';
import {
  EXPORT_DEFINITIONS,
  EXPORT_SCHEMA_VERSION,
  FTE_BASIS_LABELS,
  FTE_SCOPE_NOTICE,
  type ExportDefinition,
  type ExportId,
  type FteBasis,
} from '@/lib/exportSchema';
import { downloadExport, expectedFileCount, type ExportFormat } from '@/lib/exportFile';
import { EXPORT_COLLECTORS, EXPORT_ROW_WARNING } from '@/lib/exportApi';
import { PERSONAL_DATA_WARNING, SNAPSHOT_TABLES, downloadSnapshot } from '@/lib/snapshotApi';
import { logAudit } from '@/lib/auditApi';
import { fetchCompanies, type Company } from '@/lib/jobApi';
import { CompanyFilterDropdown } from '@/components/shared/CompanyFilterDropdown';
import { Button } from '@/components/ui/Button';
import { Toast, useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import type { User } from '@/types';

// ── 상수 ────────────────────────────────────────────────────────────

const FORMATS: ExportFormat[] = ['XLSX', 'CSV', 'JSON'];

/*
 * 대용량 안내는 exportApi의 EXPORT_ROW_WARNING(전 시트 행 수 합)을 그대로 쓴다. 임계값을 화면에서
 * 다시 정하면 조회 쪽 상한(EXPORT_MAX_REVIEWS)과 두 기준이 생긴다.
 * 조회를 마친 뒤에 묻는 이유: 건수만 미리 세는 조회를 따로 두면 같은 집계를 두 번 돌리게 되고,
 * 그 예상치가 실제 파일과 어긋나면 오히려 잘못된 안내가 된다. 여기서 무거운 쪽은 조회가 아니라
 * 브라우저에서 도는 파일 생성이므로, 실측 건수로 그 직전에 묻는 편이 정확하다.
 */

const BASIS_OPTIONS: FteBasis[] = ['APPROVED', 'ALL'];

/** 카드 하나의 실행 결과. 성공·실패 어느 쪽이든 마지막 한 번만 남긴다. */
type CardState =
  | { kind: 'IDLE' }
  | { kind: 'RUNNING'; format: ExportFormat }
  | { kind: 'DONE'; format: ExportFormat; rows: number; files: string[]; at: Date }
  | { kind: 'FAILED'; format: ExportFormat; message: string };

function timeText(at: Date): string {
  return at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ── 화면 ────────────────────────────────────────────────────────────

export function ExportsPage({
  user,
  companyFilter,
  setCompanyFilter,
}: {
  user: User;
  companyFilter: string;
  setCompanyFilter: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [states, setStates] = useState<Record<string, CardState>>({});
  /** E2 전용. 어느 기준으로 집계할지(§9 E2). 기본은 승인 응답 기준 — 검수 기준이 그쪽이다. */
  const [basis, setBasis] = useState<FteBasis>('APPROVED');
  /** 수동 스냅샷(§8 S7). Export 5종과 달리 계열사 필터를 받지 않는다 — 자세한 근거는 snapshotApi.ts 상단. */
  const [snapshot, setSnapshot] = useState<CardState>({ kind: 'IDLE' });
  const { toast, showToast, dismiss } = useToast();
  // 되돌릴 수 없는 조작 확인(v2 §6-4) — dialog를 아래에서 반드시 그린다.
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    fetchCompanies().then(setCompanies);
  }, []);

  // 계열사·기준이 바뀌면 앞선 결과 표시는 더 이상 지금 조건의 결과가 아니다.
  useEffect(() => {
    setStates({});
  }, [companyFilter, basis]);

  const companyId = companyFilter === 'all' ? null : companyFilter;
  const companyLabel = useMemo(
    () => (companyId ? (companies.find((c) => c.id === companyId)?.name ?? companyId) : '전체'),
    [companyId, companies],
  );

  const stateOf = (id: ExportId): CardState => states[id] ?? { kind: 'IDLE' };
  const setState = (id: ExportId, next: CardState) => setStates((prev) => ({ ...prev, [id]: next }));

  /*
   * 실행 중에 계열사·기준이 바뀌는 두 갈래를 막는다. 조회는 초 단위라 그 사이 드롭다운이 살아 있다.
   *  ① 중복 실행 — 버튼의 disabled 는 states 를 보는데, 조건이 바뀌면 위 effect 가 states 를 통째로
   *     비워 실행 중에도 버튼이 다시 열린다. 그래서 실행 여부는 ref 로 따로 든다(runSnapshot 의 가드와 같은 뜻).
   *  ② 조건이 바뀐 뒤 도착한 결과 — 실행 시점 조건을 잡아 두고, 끝난 시점의 조건과 다르면 이전 회사
   *     데이터로 만든 결과를 새 회사 헤더 아래 '생성 완료'로 붙이지 않는다(이 화면이 곧 증빙 목록이다).
   */
  const runningRef = useRef<Set<string>>(new Set());
  const scopeKey = `${companyFilter}|${basis}`;
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  const run = async (definition: ExportDefinition, format: ExportFormat) => {
    const id = definition.id;
    if (runningRef.current.has(id)) return;
    runningRef.current.add(id);
    const scope = scopeKey;
    try {
      const useBasis = definition.hasBasisToggle ? basis : null;
      setState(id, { kind: 'RUNNING', format });

      const result = await EXPORT_COLLECTORS[id](companyId, useBasis ? { basis: useBasis } : {});

      // 조회 중에 조건이 바뀌었다면 이 결과는 지금 화면의 조건이 아니다. 파일을 만들지 않고 그 사실을 알린다.
      if (scopeRef.current !== scope) {
        showToast({
          type: 'warning',
          msg: `${id} 생성을 취소했어요 — 조회 중에 계열사·집계 기준이 바뀌었습니다. 다시 눌러 주세요.`,
        });
        return;
      }

      // 조회 실패는 실패 그대로 알린다. 빈 파일을 내려보내면 받는 쪽은 "0건"으로 읽는다.
      if (!result.ok) {
        setState(id, { kind: 'FAILED', format, message: result.error });
        showToast({ type: 'error', msg: `${id} 데이터를 불러오지 못했어요.` });
        return;
      }

      const { sheets, totalRows: rows } = result.data;
      if (
        rows > EXPORT_ROW_WARNING &&
        !(await confirm({
          title: '파일을 만드는 데 시간이 걸려요',
          body: `${id} ${definition.name} — 총 ${rows.toLocaleString('ko-KR')}행입니다. 파일을 만드는 동안 화면이 잠시 멈출 수 있어요.`,
          confirmLabel: '계속',
        }))
      ) {
        setState(id, { kind: 'IDLE' });
        return;
      }

      const generatedAt = new Date();
      try {
        const files = await downloadExport(
          {
            definition,
            sheets,
            basis: useBasis,
            generatedAt,
            generatedBy: `${user.name} <${user.email}>`,
            companyId,
            companyLabel,
          },
          format,
        );
        /*
         * 파일 생성 중에도 조건은 바뀔 수 있다. 파일은 이미 만들어졌으므로 감사 기록은 그대로 남기되,
         * 카드에는 붙이지 않고 어느 조건으로 만든 파일인지 알린다(파일명에는 회사가 들어가지 않는다).
         */
        if (scopeRef.current === scope) {
          setState(id, { kind: 'DONE', format, rows, files, at: generatedAt });
          showToast({
            type: 'success',
            // 여러 파일은 브라우저가 두 번째부터 막을 수 있고 코드는 그 사실을 알 수 없다(exportFile.saveBlob).
            // 그래서 '완료'가 아니라 '요청'이라고 적는다.
            msg:
              files.length > 1
                ? `${id} ${format} 파일 ${files.length}개 내려받기를 요청했어요 — 브라우저가 여러 파일 다운로드를 물으면 허용해 주세요.`
                : `${id} ${format} 생성 완료 — 파일 ${files.length}개`,
          });
        } else {
          showToast({
            type: 'warning',
            msg: `${id} ${format} 파일은 조건이 바뀌기 전(대상 회사 ${companyLabel})의 데이터로 만들어졌어요.`,
          });
        }

        /*
         * Export 실행 기록(§8 S5 · §11-2 Phase 4 3항 "Export 실행도 audit_logs 기록").
         * 무엇을 남기는가 — 나중에 "이 파일 누가 언제 뽑았나"를 파일만 보고 되짚을 수 있어야 한다.
         *   action    'EXPORT_DOWNLOADED' (기존 로그의 UPPER_SNAKE 과거형 관례)
         *   entity    'export'  · entity_id  Export ID('E2') — audit_logs.entity_id는 text다
         *   meta      format(형식) · basis(E2의 집계 기준) · company_id(계열사 필터) ·
         *             schema_version(받는 쪽이 기대할 열의 판) · rows(총 행 수) · files_requested(파일명)
         * 파일명을 남기는 이유: 돌아다니는 파일에서 로그를 거꾸로 찾을 수 있는 유일한 열쇠다.
         * 'files' 가 아니라 'files_requested' 인 이유: 브라우저가 실제로 저장했는지는 알 수 없다
         * (CSV 는 파일 여러 개를 연속으로 요청하고 두 번째부터는 조용히 막힐 수 있다 — exportFile.saveBlob).
         * 12월 검수에서 읽힐 기록이므로 확인하지 못한 사실을 단정해 적지 않는다.
         * 실패한 실행은 남기지 않는다 — 만들어지지 않은 파일에 대한 기록은 로그를 흐린다.
         */
        await logAudit('EXPORT_DOWNLOADED', 'export', id, {
          format,
          basis: useBasis,
          company_id: companyId,
          schema_version: EXPORT_SCHEMA_VERSION,
          rows,
          files_requested: files,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState(id, { kind: 'FAILED', format, message });
        showToast({ type: 'error', msg: `${id} 파일을 만들지 못했어요.` });
      }
    } finally {
      runningRef.current.delete(id);
    }
  };

  const runSnapshot = async () => {
    if (snapshot.kind === 'RUNNING') return;
    if (
      !(await confirm({
        title: '개인정보가 포함된 파일이에요',
        body: PERSONAL_DATA_WARNING,
        confirmLabel: '내려받기',
        tone: 'negative',
      }))
    )
      return;
    setSnapshot({ kind: 'RUNNING', format: 'JSON' });
    const at = new Date();
    // 감사 기록(SNAPSHOT_EXPORTED)은 downloadSnapshot 안에서 남긴다 — 파일을 실제로 만든 쪽에서만 남긴다.
    const res = await downloadSnapshot(user.id);
    if (!res.ok) {
      setSnapshot({ kind: 'FAILED', format: 'JSON', message: res.error });
      showToast({ type: 'error', msg: '스냅샷을 만들지 못했어요.' });
      return;
    }
    // CardState를 그대로 재사용한다. rows는 스냅샷 표시에 쓰지 않는다(표별 행 수는 파일 안 row_counts에 있다).
    setSnapshot({ kind: 'DONE', format: 'JSON', rows: 0, files: [res.data], at });
    showToast({ type: 'success', msg: '스냅샷을 내려받았습니다.' });
  };

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1 text-sm text-foreground-subtle">
            스키마 버전 {EXPORT_SCHEMA_VERSION} · 대상 회사 {companyLabel}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">산출물 내보내기</h2>
        </div>
        <div className="flex items-center gap-3">
          <CompanyFilterDropdown companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        </div>
      </div>

      <div className="mb-5 border border-border bg-muted p-4 text-sm text-foreground-muted">
        <p className="flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            각 산출물이 어느 계약 산출물·착수보고 문언의 원천인지 카드에 함께 표기합니다. 이 화면이 그대로 검수
            증빙 목록입니다. XLSX는 실무용, CSV·JSON은 분석·AI 처리용이며 세 형식의 열 구성은 모두 같습니다.
            모든 파일의 첫 시트(CSV는 별도 파일)에 생성 일시·생성자·집계 기준·시트별 행 수가 함께 담깁니다.
          </span>
        </p>
      </div>

      <Toast toast={toast} onDismiss={dismiss} className="mb-5" />
      {dialog}

      <div className="grid gap-4 xl:grid-cols-2">
        {EXPORT_DEFINITIONS.map((definition) => {
          const state = stateOf(definition.id);
          const running = state.kind === 'RUNNING';
          return (
            <section
              key={definition.id}
              className="flex flex-col rounded-container border border-border bg-card p-4 shadow-1"
              aria-labelledby={`export-${definition.id}-title`}
            >
              <div className="mb-2 flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-element border border-primary-border bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary">
                  {definition.id}
                </span>
                <h3 id={`export-${definition.id}-title`} className="text-base font-semibold text-foreground">
                  {definition.name}
                </h3>
              </div>

              <p className="mb-3 text-sm leading-relaxed text-foreground-muted">{definition.description}</p>

              {/* §9 표의 '산출물 매핑' 열 문언 그대로. 이 칩이 검수 증빙의 연결고리다. */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {definition.deliverables.map((label) => (
                  <span
                    key={label}
                    className="rounded-element border border-border bg-muted px-2 py-0.5 text-xs text-foreground-subtle"
                  >
                    {label}
                  </span>
                ))}
              </div>

              <ul className="mb-3 space-y-1 text-xs text-foreground-subtle">
                {definition.sheets.map((sheet) => (
                  <li key={sheet.name} className="flex items-start gap-1.5">
                    <FileSpreadsheet size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {sheet.name} <span className="text-foreground-muted">· 열 {sheet.columns.length}개</span>
                    </span>
                  </li>
                ))}
              </ul>

              {/* E2만. 같은 데이터라도 어느 응답까지 세느냐로 수치가 달라진다(§9 E2). */}
              {definition.hasBasisToggle && (
                <div className="mb-3 border border-border bg-muted p-3">
                  <p className="mb-2 text-xs font-medium text-foreground-muted">집계 기준</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="집계 기준 선택">
                    {BASIS_OPTIONS.map((option) => {
                      const on = basis === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setBasis(option)}
                          className={`min-h-11 rounded-element border px-3 text-xs font-medium transition sm:min-h-control-sm ${
                            on
                              ? 'border-primary bg-primary-subtle text-primary'
                              : 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary'
                          }`}
                        >
                          {FTE_BASIS_LABELS[option]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-foreground-subtle">
                    선택한 기준은 파일의 「내보내기 정보」에 함께 기록됩니다.
                  </p>
                </div>
              )}

              {/* 계열사 필터가 그대로 걸리지 않는 시트가 있는 Export(E5 감사 로그). 파일에도 같은 문구가 실린다. */}
              {definition.scopeNote && (
                <p className="mb-3 flex items-start gap-1.5 text-xs text-foreground-subtle">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{definition.scopeNote}</span>
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                {FORMATS.map((format) => (
                  <Button
                    key={format}
                    variant={format === 'XLSX' ? 'primary' : 'secondary'}
                    size="sm"
                    loading={running && state.format === format}
                    disabled={running}
                    onClick={() => run(definition, format)}
                  >
                    {!(running && state.format === format) && <Download size={14} aria-hidden="true" />}
                    {format}
                  </Button>
                ))}
              </div>

              {/*
                CSV 는 시트마다 파일이 따로 내려간다. 브라우저는 같은 오리진의 두 번째 파일부터를
                '여러 파일 다운로드' 권한으로 묻고, 막히면 코드에서는 알 수 없다(exportFile.saveBlob).
                그래서 누르기 전에 몇 개가 내려가는지 미리 알린다.
              */}
              <p className="mt-2 text-xs text-foreground-subtle">
                CSV는 시트마다 파일 1개씩 모두 {expectedFileCount(definition, 'CSV')}개를 따로 내려받습니다. 브라우저가
                &lsquo;여러 파일 다운로드&rsquo;를 물으면 허용해 주세요.
              </p>

              {/* 진행·결과는 카드 안에서만 알린다. aria-live로 스크린리더에도 전달한다. */}
              <div aria-live="polite" className="mt-3 min-h-[1.25rem] text-xs">
                {state.kind === 'RUNNING' && (
                  <p className="text-foreground-muted">{state.format} 생성 중… 데이터를 모으고 있어요.</p>
                )}
                {state.kind === 'DONE' && (
                  <p className="flex items-start gap-1.5 text-success">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      {timeText(state.at)} · {state.format} 생성 완료 — 총 {state.rows.toLocaleString('ko-KR')}행 ·
                      파일 {state.files.length}개 {state.files.length > 1 && '내려받기 요청'}
                      <span className="block break-all text-foreground-subtle">{state.files.join(' · ')}</span>
                      {/* 두 번째 파일부터는 브라우저가 조용히 막을 수 있다. 저장됐다고 단정하지 않는다. */}
                      {state.files.length > 1 && (
                        <span className="block text-foreground-subtle">
                          파일 {state.files.length}개를 하나씩 내려받도록 요청했습니다. 브라우저가 두 번째부터를 막으면
                          일부만 저장되니 받은 폴더에서 {state.files.length}개가 다 있는지 확인해 주세요.
                        </span>
                      )}
                    </span>
                  </p>
                )}
                {state.kind === 'FAILED' && (
                  <div className="flex flex-col gap-2 border border-destructive-border bg-destructive-muted p-3 text-destructive">
                    <p className="flex items-start gap-1.5">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        {state.format} 생성에 실패했어요. 파일은 만들어지지 않았습니다. {state.message}
                      </span>
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-start"
                      onClick={() => run(definition, state.format)}
                    >
                      <RotateCw size={13} aria-hidden="true" /> 다시 시도
                    </Button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/*
        수동 스냅샷(§8 S7 · §11-2 Phase 4 4번). E1~E5와 목적이 달라 카드 격자 밖에 따로 둔다 —
        이건 계약 산출물이 아니라 복원용 백업이고, 계열사로 자르지 않는다(자르면 참조가 끊긴다).
      */}
      <section className="mt-6 rounded-container border border-border bg-card p-4 shadow-1" aria-labelledby="snapshot-title">
        <div className="mb-2 flex items-start gap-2">
          <DatabaseBackup size={18} className="mt-0.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <h3 id="snapshot-title" className="text-base font-semibold text-foreground">
            수동 스냅샷 (백업)
          </h3>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-foreground-muted">
          주요 테이블 {SNAPSHOT_TABLES.length}종을 JSON 한 파일로 내려받습니다. 계약 산출물이 아니라 복원용 백업이라
          계열사 필터가 걸리지 않고 전사 데이터가 담깁니다. 한 표라도 조회에 실패하면 파일을 만들지 않습니다.
        </p>
        <p className="mb-3 flex items-start gap-2 border border-warning-border bg-warning-muted p-3 text-xs leading-5 text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{PERSONAL_DATA_WARNING}</span>
        </p>
        <Button
          variant="secondary"
          size="sm"
          loading={snapshot.kind === 'RUNNING'}
          disabled={snapshot.kind === 'RUNNING'}
          onClick={() => void runSnapshot()}
        >
          {snapshot.kind !== 'RUNNING' && <Download size={14} aria-hidden="true" />} 스냅샷 내려받기
        </Button>
        <div aria-live="polite" className="mt-3 min-h-[1.25rem] text-xs">
          {snapshot.kind === 'RUNNING' && <p className="text-foreground-muted">표를 하나씩 읽고 있어요…</p>}
          {snapshot.kind === 'DONE' && (
            <p className="flex items-start gap-1.5 text-success">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {timeText(snapshot.at)} · 내려받기 완료
                <span className="block break-all text-foreground-subtle">{snapshot.files.join(' · ')}</span>
              </span>
            </p>
          )}
          {snapshot.kind === 'FAILED' && (
            <div className="flex flex-col gap-2 border border-destructive-border bg-destructive-muted p-3 text-destructive">
              <p className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>스냅샷을 만들지 못했어요. 파일은 만들어지지 않았습니다. {snapshot.message}</span>
              </p>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => void runSnapshot()}>
                <RotateCw size={13} aria-hidden="true" /> 다시 시도
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* §2 하단·§6-3 ⓒ 범위 종료선. 산출물을 뽑는 자리에도 같은 경계를 붙여 둔다. */}
      <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-foreground-subtle">
        {FTE_SCOPE_NOTICE}
      </p>
    </>
  );
}
