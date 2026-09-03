// 워크숍 플래그 패널 — 검토 워크벤치(§6-3 ⓑ)의 '워크숍 대상 지정' 영역.
//
// 자동 규칙 4종의 판정을 사유별로 펼쳐 보여 주고, 그 위에 관리자의 수동 지정·해제를 얹는다.
// 저장은 adminApi.upsertWorkshopFlag 하나로만 한다(job_workshop_flags, 직무당 한 줄).
//
// ── 수동 결정과 자동 규칙의 관계(화면에도 같은 말이 적혀 있다) ──
// 수동으로 지정하거나 해제한 직무(source = 'MANUAL')는 자동 규칙에 다시 걸려도 상태가 바뀌지 않는다.
// 자동 판정은 '참고 신호'로만 남고, 되돌리려면 관리자가 [자동 판정 반영]을 눌러야 한다.
// 사람이 현장 확인 끝에 내린 결정이 규칙 재실행마다 되돌아가면 워크벤치에서 아무것도 확정할 수 없다.
// 이 패널은 화면을 열었다는 이유로 아무것도 저장하지 않는다 — 저장은 언제나 버튼을 누른 결과다.
//
// 사유(reasons)는 언제나 누적한다 — mergeReasons: true(§10 P3 DoD ③). adminApi의 기본값은
// 교체(false)지만 여기서는 항상 누적을 넘긴다. 기존 사유를 지우면 "왜 이 직무가 워크숍 대상이
// 됐는가"라는 Export(§9 E4)의 근거 자체가 사라지기 때문이다.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Info, Minus, RotateCw } from 'lucide-react';
import {
  fetchWorkshopFlags,
  upsertWorkshopFlag,
  type WorkshopFlag,
  type WorkshopFlagSource,
} from '@/lib/adminApi';
import { evaluateWorkshopRules, type WorkshopRuleInput } from '@/lib/workshopRules';
import { SIGNAL_LABELS } from '@/lib/workshopThresholds';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Toast, useToast } from '@/components/ui/Toast';
import { AutoTextarea } from '@/pages/sme-review/controls';

/** 수동 사유임을 사유 배열 안에서도 알아볼 수 있게 붙인다(자동 사유와 한 배열에 섞여 Export된다). */
const MANUAL_PREFIX = '수동: ';

export interface WorkshopFlagPanelProps {
  jobId: string;
  jobName?: string;
  /**
   * 자동 규칙 판정의 원천. 둘 중 하나만 주면 된다.
   *   · comparison — fetchJobComparison 결과. 규칙별 측정값("부적합 42%")까지 보여 준다.
   *   · autoReasons — 사유 목록만(= comparison.workshopReasons). 측정값 줄은 생략된다.
   * 둘 다 없으면 자동 판정 없이 수동 지정만 하는 패널이 된다.
   */
  comparison?: WorkshopRuleInput;
  autoReasons?: string[];
  /**
   * 이미 조회한 플래그가 있으면 넘긴다(null = 저장된 결정 없음).
   * 생략하면(undefined) 패널이 직접 불러온다.
   */
  flag?: WorkshopFlag | null;
  /**
   * 저장 성공 후. 부모가 제출 큐·워크숍 대상 목록을 다시 불러오게 한다.
   * 두 이름을 모두 받는다 — 이 패널을 붙이는 화면마다 부르는 이름이 갈렸다. 있는 쪽만 호출한다.
   */
  onChanged?: () => void;
  onSaved?: () => void;
}

type SaveTag = 'MANUAL_ON' | 'MANUAL_OFF' | 'AUTO';
type SaveArgs = { flagged: boolean; source: WorkshopFlagSource; reasons: string[] };

export function WorkshopFlagPanel({
  jobId,
  jobName,
  comparison,
  autoReasons,
  flag,
  onChanged,
  onSaved,
}: WorkshopFlagPanelProps) {
  const evaluation = evaluateWorkshopRules(comparison ?? { workshopReasons: autoReasons ?? [] });
  const { toast, showToast, dismiss } = useToast();

  // ── 저장된 결정 ──
  // 부모가 flag를 주면 그대로 쓰고, 주지 않으면 직접 불러온다.
  // ponytail: 한 직무만 필요한데 회사 전체 플래그를 받아 골라낸다(adminApi에 단건 조회가 없다).
  // 플래그 행은 직무 수만큼이라 지금 규모에서는 문제되지 않는다. 느려지면 adminApi에
  // fetchWorkshopFlag(jobId)를 만들어 여기만 바꾸면 된다.
  const selfLoad = flag === undefined;
  const [loaded, setLoaded] = useState<WorkshopFlag | null>(null);
  const [loading, setLoading] = useState(selfLoad);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selfLoad) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    void fetchWorkshopFlags().then((result) => {
      if (!alive) return;
      setLoading(false);
      // 조회 실패를 "지정 없음"으로 위장하지 않는다 — 상태를 모르는 채로 결정하게 두면 안 된다.
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoaded(result.data.find((f) => f.jobId === jobId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [selfLoad, jobId, reloadKey]);

  // 저장 직후의 낙관적 표시. 부모가 새 flag를 넘겨 주면 그쪽이 진실이므로 비운다.
  const [local, setLocal] = useState<WorkshopFlag | null>(null);
  useEffect(() => setLocal(null), [jobId, flag]);
  const current = local ?? (selfLoad ? loaded : flag) ?? null;

  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveTag | null>(null);
  // 실패는 삼키지 않는다 — 사유를 그대로 보여 주고 같은 동작을 다시 시도할 수 있게 들고 있는다.
  const [failure, setFailure] = useState<{ message: string; args: SaveArgs; tag: SaveTag } | null>(null);

  const isManual = current?.source === 'MANUAL';
  const flagged = current?.flagged ?? false;
  const savedReasons = current?.reasons ?? [];
  // 사람의 결정과 자동 판정이 엇갈린 상태 — 이 경우에만 안내 배너를 띄운다.
  const manualOverridesAuto = isManual && flagged !== evaluation.flagged;
  // 저장된 상태를 모르는 동안에는 결정 버튼을 잠근다(모르는 상태 위에 결정을 얹지 않는다).
  const stateUnknown = loading || !!loadError;

  const save = useCallback(
    async (args: SaveArgs, tag: SaveTag) => {
      setSaving(tag);
      setFailure(null);
      const result = await upsertWorkshopFlag(jobId, { ...args, mergeReasons: true });
      setSaving(null);

      if (!result.ok) {
        setFailure({ message: result.error, args, tag });
        showToast({ type: 'error', msg: '워크숍 대상 지정을 저장하지 못했습니다.' });
        return;
      }

      // 서버와 같은 규칙으로 합집합을 만든다(중복 제거). decided_by는 서버가 채우므로 건드리지 않는다.
      const merged = [...new Set([...(current?.reasons ?? []), ...args.reasons.map((r) => r.trim()).filter(Boolean)])];
      setLocal({
        jobId,
        jobName: jobName ?? current?.jobName ?? '',
        flagged: args.flagged,
        source: args.source,
        reasons: merged,
        decidedBy: current?.decidedBy ?? null,
        updatedAt: new Date().toISOString(),
      });
      setReasonText('');
      setReasonError(null);
      showToast({
        type: 'success',
        msg: args.flagged ? '워크숍 대상으로 지정했습니다.' : '워크숍 대상에서 해제했습니다.',
      });
      onChanged?.();
      onSaved?.();
    },
    [jobId, jobName, current, showToast, onChanged, onSaved],
  );

  function saveManual(nextFlagged: boolean) {
    const text = reasonText.trim();
    // 자동 판정과 다른 결정일 때만 사유를 필수로 받는다. 규칙과 같은 결론이면 자동 사유가 이미 근거가 된다.
    if (nextFlagged !== evaluation.flagged && !text) {
      setReasonError('자동 판정과 다른 결정입니다 — 사유를 입력해 주세요.');
      return;
    }
    setReasonError(null);
    const reasons = [...(nextFlagged ? evaluation.reasons : []), ...(text ? [`${MANUAL_PREFIX}${text}`] : [])];
    void save({ flagged: nextFlagged, source: 'MANUAL', reasons }, nextFlagged ? 'MANUAL_ON' : 'MANUAL_OFF');
  }

  function saveAuto() {
    void save({ flagged: evaluation.flagged, source: 'AUTO', reasons: evaluation.reasons }, 'AUTO');
  }

  const hitRules = evaluation.rules.filter((r) => r.hit);

  return (
    <section aria-labelledby={`workshop-flag-${jobId}`} className="rounded-element border border-border bg-card p-5">
      <Toast toast={toast} onDismiss={dismiss} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`workshop-flag-${jobId}`} className="t-label font-semibold text-foreground">
          워크숍 대상 지정
        </h3>
        {/* 색만으로 알리지 않는다 — 아이콘·텍스트를 함께 둔다. */}
        <span
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 t-caption-2 font-medium ${
            flagged && !stateUnknown ? 'bg-warning-muted text-warning' : 'bg-muted text-foreground-muted'
          }`}
        >
          {flagged && !stateUnknown ? (
            <AlertTriangle size={12} aria-hidden="true" />
          ) : (
            <Minus size={12} aria-hidden="true" />
          )}
          {loading
            ? '불러오는 중'
            : loadError
              ? '상태 확인 불가'
              : current
                ? `${flagged ? '워크숍 후보' : '대상 아님'} · ${isManual ? '수동 결정' : '자동 판정'}`
                : '미지정'}
        </span>
      </div>

      {/* ── 자동 판정 ────────────────────────────────────────────── */}
      <p className="mt-4 t-caption font-medium text-foreground-muted">
        {evaluation.evaluable === false
          ? '제출된 검토가 없어 자동 판정을 할 수 없습니다.'
          : hitRules.length > 0
            ? `이 직무가 워크숍 후보인 이유: ${hitRules.length}건`
            : '자동 규칙에 걸리는 신호가 없습니다.'}
      </p>

      <ul className="mt-2 space-y-1.5">
        {evaluation.rules.map((rule) => (
          <li
            key={rule.key}
            className={`flex items-start gap-2 rounded-element border px-3 py-2 t-caption ${
              rule.hit ? 'border-warning-border bg-warning-muted text-warning' : 'border-border text-foreground-muted'
            }`}
          >
            {rule.hit ? (
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <Check size={14} className="mt-0.5 shrink-0 opacity-50" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                규칙 {rule.no}. {rule.title}
              </span>
              {/* 사유 문구는 저장되는 값 그대로 보여 준다 — Export(§9 E4)에 실릴 문구와 화면이 같아야 한다. */}
              {rule.hit && <span className="ml-1.5 font-semibold">— {rule.reason}</span>}
              {/* 판정 기준을 늘 함께 적는다 — 관리자가 "왜 걸렸는지"를 화면에서 바로 읽게(§12 조정 대상 값). */}
              <span className="mt-0.5 block text-foreground-subtle">
                {rule.measured ? `${rule.measured} · ` : ''}기준 {rule.criterion}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 t-caption-2 text-foreground-subtle">
        ※ 비교 뷰의 '{SIGNAL_LABELS.fteGap}' 하이라이트는 행 단위 이견 신호이며, 위 자동 플래그 규칙과는 별개입니다.
      </p>

      {manualOverridesAuto && (
        <p className="mt-3 flex items-start gap-2 rounded-element border border-primary-border bg-primary-subtle px-3 py-2 t-caption text-primary">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            수동 결정({flagged ? '지정' : '해제'})이 유지됩니다. 자동 규칙 판정은 참고 신호로만 표시하며 상태를 바꾸지
            않습니다. 자동 판정대로 되돌리려면 [자동 판정 반영]을 눌러 주세요.
          </span>
        </p>
      )}

      {/* ── 저장된 사유(누적) ────────────────────────────────────── */}
      {savedReasons.length > 0 && (
        <div className="mt-4">
          <p className="t-caption font-medium text-foreground-muted">저장된 사유 (누적)</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {savedReasons.map((reason) => (
              <li
                key={reason}
                className="rounded border border-border bg-muted px-2 py-1 t-caption-2 text-foreground-muted"
              >
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 저장된 결정을 못 불러온 경우 — "지정 없음"과 구분해서 알리고 다시 불러올 수 있게 한다. */}
      {loadError && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2 t-caption text-destructive"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">저장된 워크숍 대상 지정을 불러오지 못했습니다 — {loadError}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw size={13} aria-hidden="true" />
            다시 불러오기
          </Button>
        </div>
      )}

      {/* ── 수동 지정·해제 ───────────────────────────────────────── */}
      <div className="mt-4">
        <Field
          label="수동 사유"
          description="수동 지정·해제와 함께 저장됩니다. 기존 사유는 지우지 않고 덧붙입니다."
          error={reasonError ?? undefined}
        >
          <AutoTextarea
            value={reasonText}
            onChange={(v) => setReasonText(v)}
            placeholder="예: 현장 확인 결과 과업 구성 재정의가 필요함"
            minRows={2}
            disabled={stateUnknown}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {flagged ? (
          <Button
            variant="danger"
            loading={saving === 'MANUAL_OFF'}
            disabled={!!saving || stateUnknown}
            onClick={() => saveManual(false)}
          >
            워크숍 대상 해제
          </Button>
        ) : (
          <Button loading={saving === 'MANUAL_ON'} disabled={!!saving || stateUnknown} onClick={() => saveManual(true)}>
            워크숍 대상 지정
          </Button>
        )}
        <Button variant="secondary" loading={saving === 'AUTO'} disabled={!!saving || stateUnknown} onClick={saveAuto}>
          자동 판정 반영
        </Button>
      </div>
      <p className="mt-2 t-caption-2 text-foreground-subtle">
        [자동 판정 반영]은 위 자동 규칙 결과({evaluation.flagged ? '워크숍 후보' : '대상 아님'})를 그대로 저장하고 이후
        자동 규칙을 다시 따르게 합니다. 수동 사유 입력란은 반영되지 않습니다.
      </p>

      {failure && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2 t-caption text-destructive"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">저장하지 못했습니다 — {failure.message}</span>
          <Button
            variant="secondary"
            size="sm"
            loading={saving === failure.tag}
            disabled={!!saving}
            onClick={() => void save(failure.args, failure.tag)}
          >
            <RotateCw size={13} aria-hidden="true" />
            다시 시도
          </Button>
        </div>
      )}
    </section>
  );
}

export default WorkshopFlagPanel;
