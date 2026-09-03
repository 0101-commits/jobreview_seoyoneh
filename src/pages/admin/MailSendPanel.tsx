// 메일 발송 패널 — 진행 현황(/progress)의 '리마인더 발송' 영역(§6-3 ⓐ · §11-2 Phase 4 3번).
//
// 화면에 붙이는 일은 통합 담당이 한다. 이 파일은 컴포넌트 하나만 내보낸다.
// 수신자는 부모(진행 매트릭스)가 고른 미시작·미제출 대상을 그대로 받는다 — 선택 로직은 여기 없다.
//
// ── 시뮬레이션 여부는 발송 전에 알 수 없다 ──
// RESEND_API_KEY 는 Supabase 시크릿이라 브라우저에서 볼 수 없다(보여서도 안 된다).
// 그래서 발송 전에는 "키가 없으면 기록만 남습니다"라고만 적고, 실제 판정은 발송 결과의
// simulated 값으로 표시한다. 발송 전에 단정하는 문구를 쓰면 그 문구가 언젠가 거짓말이 된다.
//
// ── 미리보기 = 실제 나가는 문장 ──
// 치환은 mailApi.renderTemplate 하나만 쓴다. 미리보기도 발송 본문도 같은 함수를 통과한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Info, Mail, RotateCw, Send, XCircle } from 'lucide-react';
import {
  DEFAULT_TEMPLATES,
  MAIL_KIND_LABELS,
  MAX_RECIPIENTS_PER_SEND,
  TEMPLATE_TOKENS,
  daysUntil,
  fetchMailLogs,
  renderTemplate,
  sendMails,
  type MailKind,
  type MailLogEntry,
  type MailRecipient,
  type MailSendResult,
  type MailTemplate,
  type MailTemplateVars,
} from '@/lib/mailApi';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Toast, useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
import { FallbackView } from '@/components/ui/FallbackView';
import { Skeleton } from '@/components/ui/Skeleton';

const KINDS: MailKind[] = ['REMINDER', 'INVITE'];

/** 수신자 목록을 접어 두는 기준. 이보다 많으면 앞쪽만 보이고 나머지는 "외 N명"으로 줄인다. */
const RECIPIENT_PREVIEW = 8;

export interface MailSendPanelProps {
  /** 부모가 고른 발송 대상. 같은 사람이 두 직무로 두 번 들어올 수 있다(직무별 안내가 다르다). */
  recipients: MailRecipient[];
  /** 운영 설정(survey_settings)의 값. 템플릿 치환에 쓴다. */
  dueDate?: string | null;
  expectedMinutes?: number | null;
  inquiryContact?: string | null;
  /**
   * 저장된 템플릿(운영 설정). 제목·본문 중 한쪽만 저장돼 있으면 부모가 그 칸만 채우고
   * 나머지는 기본 문구로 메워 넘긴다 — 여기서는 종류(kind) 단위로만 받는다.
   * 조회가 화면보다 늦게 끝나 값이 나중에 도착해도 반영된다(아래 동기화 effect).
   */
  templates?: Partial<Record<MailKind, MailTemplate>>;
  /** 발송이 끝난 뒤. 부모가 매트릭스를 다시 불러오거나 선택을 비우는 데 쓴다. */
  onSent?: (result: MailSendResult) => void;
}

export function MailSendPanel({
  recipients,
  dueDate = null,
  expectedMinutes = null,
  inquiryContact = null,
  templates,
  onSent,
}: MailSendPanelProps) {
  const { toast, showToast, dismiss } = useToast();
  // 되돌릴 수 없는 조작 확인(v2 §6-4) — dialog를 아래에서 반드시 그린다.
  const { confirm, dialog } = useConfirm();

  const [kind, setKind] = useState<MailKind>('REMINDER');
  const [subject, setSubject] = useState(templates?.REMINDER?.subject ?? DEFAULT_TEMPLATES.REMINDER.subject);
  const [body, setBody] = useState(templates?.REMINDER?.body ?? DEFAULT_TEMPLATES.REMINDER.body);
  /** 관리자가 문구를 직접 고쳤는가. 고쳤다면 종류를 바꿔도 덮어쓰지 않는다(쓰던 글이 사라지면 안 된다). */
  const [edited, setEdited] = useState(false);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<MailSendResult | null>(null);
  /** 결과와 짝이 맞는 수신자 배열. 실패자만 다시 보낼 때 이 배열에서 골라낸다. */
  const [sentBatch, setSentBatch] = useState<MailRecipient[]>([]);
  /** 그 배치를 어느 종류로 보냈는가. 같은 종류·같은 대상을 또 보내려는 경우만 되묻기 위해서다. */
  const [sentKind, setSentKind] = useState<MailKind | null>(null);

  const [logs, setLogs] = useState<MailLogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);

  const vars: MailTemplateVars = useMemo(
    () => ({ dueDate, expectedMinutes, inquiryContact }),
    [dueDate, expectedMinutes, inquiryContact],
  );

  const remainDays = daysUntil(dueDate);

  // ── 발송 이력 ──
  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    const r = await fetchMailLogs(20);
    setLogsLoading(false);
    if (r.ok) {
      setLogs(r.data);
      setLogsError(null);
    } else {
      // 조회 실패를 "이력 없음"으로 위장하지 않는다.
      setLogsError(r.error);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // ── 문구 동기화 ──
  /*
   * 종류 전환과 '저장된 템플릿이 늦게 도착한 경우'를 한곳에서 처리한다.
   * 초기값으로만 읽으면 운영 설정 조회가 화면보다 늦게 끝났을 때 저장된 문구가 영영 반영되지 않는다.
   * 관리자가 이미 고쳐 쓴 문구(edited)는 어느 경우에도 덮지 않는다 — 쓰던 글이 사라지면 안 된다.
   */
  useEffect(() => {
    if (edited) return;
    const t = templates?.[kind] ?? DEFAULT_TEMPLATES[kind];
    setSubject(t.subject);
    setBody(t.body);
  }, [templates, kind, edited]);

  /** 고쳐 쓴 표시만 내리면 위 effect 가 저장된(없으면 기본) 문구를 다시 넣는다. */
  const resetTemplate = () => setEdited(false);

  // ── 미리보기 ──
  // 첫 수신자 기준이다. 수신자마다 이름·직무가 다르므로 "이 사람에게는 이렇게 나간다"를 보여 준다.
  const previewFor = recipients[0];
  const preview = previewFor
    ? { subject: renderTemplate(subject, previewFor, vars), body: renderTemplate(body, previewFor, vars) }
    : null;

  // ── 발송 ──
  /**
   * 방금 보낸 것과 같은 종류·같은 대상인가. 발송 뒤에도 버튼은 그대로 눌리므로
   * (초대 → 리마인더처럼 종류를 바꿔 다시 보내는 흐름이 정상이라 잠그지 않는다)
   * 같은 배치를 한 번 더 누르는 경우만 가려낸다. 메일은 되돌릴 수 없다.
   */
  const isRepeatOfSent = (targets: MailRecipient[]) =>
    result !== null &&
    sentKind === kind &&
    targets.length === sentBatch.length &&
    targets.every((t, i) => t.id === sentBatch[i]?.id && t.jobName === sentBatch[i]?.jobName);

  const send = async (targets: MailRecipient[]) => {
    if (targets.length === 0) return;
    if (
      isRepeatOfSent(targets) &&
      !(await confirm({
        title: '같은 대상에게 한 번 더 보낼까요?',
        body: `방금 이 ${targets.length}명에게 ${MAIL_KIND_LABELS[kind]} 메일을 보냈습니다. 보낸 메일은 되돌릴 수 없습니다.`,
        confirmLabel: '한 번 더 보내기',
        tone: 'negative',
      }))
    ) {
      return;
    }
    setSending(true);
    setSendError(null);
    const r = await sendMails(kind, targets, { subject, body }, vars);
    setSending(false);

    if (!r.ok) {
      setSendError(r.error);
      showToast({ type: 'error', msg: r.error });
      return;
    }

    setResult(r.data);
    setSentBatch(targets);
    setSentKind(kind);
    void loadLogs();
    onSent?.(r.data);

    if (r.data.simulated) {
      showToast({ type: 'warning', msg: `시뮬레이션으로 ${r.data.results.length}건을 기록했습니다. 실제 메일은 발송되지 않았습니다.` });
    } else if (r.data.failed > 0) {
      showToast({ type: 'warning', msg: `${r.data.sent}건 발송, ${r.data.failed}건 실패했습니다. 실패한 수신자는 아래에서 다시 보낼 수 있습니다.` });
    } else {
      showToast({ type: 'success', msg: `${r.data.sent}건을 발송했습니다.` });
    }
  };

  /** 실패한 수신자만. 결과 배열은 보낸 순서 그대로라 인덱스로 짝을 맞춘다. */
  const failedRecipients = useMemo(() => {
    if (!result) return [];
    return result.results.map((r, i) => (r.ok ? null : sentBatch[i])).filter((r): r is MailRecipient => Boolean(r));
  }, [result, sentBatch]);

  const tooMany = recipients.length > MAX_RECIPIENTS_PER_SEND;
  const canSend = recipients.length > 0 && !tooMany && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <section className="rounded-card border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Mail size={16} aria-hidden="true" /> 리마인더 · 초대 메일 발송
        </h2>
        <p className="text-sm text-foreground-muted">
          선택한 수신자 <b className="font-semibold text-foreground">{recipients.length}명</b>
          {dueDate && (
            <span className="ml-2 text-xs text-foreground-subtle">
              마감 {dueDate}
              {remainDays !== null && ` · 남은 ${remainDays}일`}
            </span>
          )}
        </p>
      </header>

      <div className="space-y-4 p-4">
        {/* 발송 전 안내 — 시뮬레이션 여부는 아직 알 수 없다는 사실을 그대로 적는다. */}
        <p className="flex items-start gap-2 rounded-element border border-border bg-muted px-3 py-2 text-xs text-foreground-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            메일 키가 설정되어 있지 않으면 실제 메일은 발송되지 않고 발송 이력만 남습니다. 키 설정 여부는 브라우저에서 확인할 수
            없어, 시뮬레이션 여부는 발송 후 결과에 표시됩니다. 발신 도메인(SPF·DKIM) 확정 전까지는 시뮬레이션으로 운영합니다.
          </span>
        </p>

        {/* 종류 */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground-muted" id="mail-kind-label">
            메일 종류
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="mail-kind-label">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={[
                  'inline-flex min-h-11 items-center rounded-element border px-4 text-sm transition sm:min-h-control-sm',
                  kind === k
                    ? 'border-primary bg-primary-subtle font-semibold text-primary'
                    : 'border-border bg-card text-foreground-muted hover:border-primary hover:text-primary',
                ].join(' ')}
              >
                {MAIL_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {/* 문구 */}
        <Field label="제목" value={subject} onChange={(v) => { setSubject(v); setEdited(true); }} />

        <Field
          label="본문"
          description={`치환 항목: ${TEMPLATE_TOKENS.join(' ')} — 값이 없으면 '미정'으로 표시됩니다.`}
        >
          <textarea
            rows={10}
            value={body}
            onChange={(e) => { setBody(e.target.value); setEdited(true); }}
            className="w-full rounded-element border border-border bg-card px-3 py-2 font-mono text-xs leading-relaxed text-foreground focus:border-primary focus:outline-none"
          />
        </Field>

        {edited && (
          <Button variant="ghost" size="sm" onClick={resetTemplate}>
            <RotateCw size={13} aria-hidden="true" /> 기본 문구로 되돌리기
          </Button>
        )}

        {/* 미리보기 */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground-muted">
            미리보기{previewFor && ` — ${previewFor.name}님에게 나가는 문구`}
          </p>
          {preview ? (
            <div className="rounded-element border border-border bg-muted p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">{preview.subject}</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground-muted">
                {preview.body}
              </pre>
            </div>
          ) : (
            <p className="rounded-element border border-border bg-muted px-3 py-2 text-xs text-foreground-subtle">
              수신자를 선택하면 실제로 나갈 문구를 여기서 확인할 수 있습니다.
            </p>
          )}
        </div>

        {/* 수신자 */}
        {recipients.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground-muted">수신자</p>
            <ul className="flex flex-wrap gap-1.5">
              {recipients.slice(0, RECIPIENT_PREVIEW).map((r, i) => (
                <li
                  key={`${r.id}-${r.jobName ?? ''}-${i}`}
                  className="rounded-element border border-border bg-muted px-2 py-1 text-xs text-foreground-muted"
                >
                  {r.name}
                  {r.jobName && <span className="text-foreground-subtle"> · {r.jobName}</span>}
                </li>
              ))}
              {recipients.length > RECIPIENT_PREVIEW && (
                <li className="px-2 py-1 text-xs text-foreground-subtle">
                  외 {recipients.length - RECIPIENT_PREVIEW}명
                </li>
              )}
            </ul>
          </div>
        )}

        {tooMany && (
          <p className="flex items-start gap-2 rounded-element border border-warning-border bg-warning-muted px-3 py-2 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            한 번에 보낼 수 있는 수신자는 {MAX_RECIPIENTS_PER_SEND}명까지입니다. 대상을 나눠 선택해 주세요.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void send(recipients)} disabled={!canSend} loading={sending}>
            <Send size={14} aria-hidden="true" /> {MAIL_KIND_LABELS[kind]} 메일 발송 ({recipients.length}명)
          </Button>
          {recipients.length === 0 && (
            <span className="text-xs text-foreground-subtle">진행 매트릭스에서 대상을 먼저 선택해 주세요.</span>
          )}
        </div>

        {sendError && (
          <p className="flex items-start gap-2 rounded-element border border-destructive-border bg-destructive-muted px-3 py-2 text-sm text-destructive">
            <XCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {sendError}
          </p>
        )}

        {/* 발송 결과 */}
        {result && (
          <div className="rounded-element border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-sm font-semibold text-foreground">발송 결과</p>
              <p className="text-xs text-foreground-muted">
                성공 {result.sent}건 · 실패 {result.failed}건 · 이력 {result.logged}건 기록
              </p>
            </div>

            {result.simulated && (
              <p className="flex items-start gap-2 border-b border-border bg-warning-muted px-3 py-2 text-xs text-warning">
                <FlaskConical size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                시뮬레이션 모드입니다 — 실제 메일은 발송되지 않습니다. 발송 이력(mail_logs)에는 시뮬레이션으로 기록됐습니다.
              </p>
            )}

            {result.logError && (
              <p className="flex items-start gap-2 border-b border-border bg-warning-muted px-3 py-2 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                {result.logError}
              </p>
            )}

            <ul className="divide-y divide-border">
              {result.results.map((r, i) => (
                <li key={`${r.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span className="text-foreground">
                    {r.name || sentBatch[i]?.name || '이름 없음'}
                    {sentBatch[i]?.jobName && <span className="text-foreground-subtle"> · {sentBatch[i].jobName}</span>}
                    {r.email && <span className="ml-1 text-foreground-subtle">({r.email})</span>}
                  </span>
                  {r.ok ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 size={13} aria-hidden="true" /> {r.simulated ? '기록됨(시뮬레이션)' : '발송됨'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <XCircle size={13} aria-hidden="true" /> {r.error || '실패'}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {failedRecipients.length > 0 && (
              <div className="border-t border-border px-3 py-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={sending}
                  onClick={() => void send(failedRecipients)}
                >
                  <RotateCw size={13} aria-hidden="true" /> 실패한 {failedRecipients.length}명에게 다시 보내기
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 발송 이력 */}
        <div className="rounded-element border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-foreground">최근 발송 이력</p>
            <Button variant="ghost" size="sm" onClick={() => void loadLogs()} loading={logsLoading}>
              <RotateCw size={13} aria-hidden="true" /> 새로고침
            </Button>
          </div>

          {logsError ? (
            <FallbackView kind="error" compact description={logsError} />
          ) : logsLoading ? (
            <div className="p-3">
              <Skeleton.Table rows={3} cols={4} />
            </div>
          ) : (
            // v2 §6-5: 공용 DataTable — 좁은 화면에서는 줄 목록으로 쌓인다.
            <DataTable
              caption="최근 메일 발송 이력. 발송 시각, 종류, 수신자, 제목, 결과 순입니다."
              minWidth="720px"
              className="border-0"
              rows={logs}
              rowKey={(log) => log.id}
              empty={<FallbackView compact description="아직 발송한 메일이 없어요." />}
              columns={[
                {
                  key: 'sentAt',
                  header: '발송 시각',
                  className: 'whitespace-nowrap',
                  cell: (log) => (log.sentAt ? new Date(log.sentAt).toLocaleString('ko-KR') : ''),
                },
                {
                  key: 'kind',
                  header: '종류',
                  className: 'whitespace-nowrap',
                  cell: (log) => MAIL_KIND_LABELS[log.kind],
                },
                {
                  key: 'recipient',
                  header: '수신자',
                  mobile: 'title',
                  className: 'whitespace-nowrap',
                  cell: (log) => (
                    <span className="text-foreground">
                      {log.recipientName}
                      {log.jobName && <span className="text-foreground-subtle"> · {log.jobName}</span>}
                    </span>
                  ),
                },
                { key: 'subject', header: '제목', cell: (log) => log.subject },
                {
                  key: 'result',
                  header: '결과',
                  mobile: 'trailing',
                  className: 'whitespace-nowrap',
                  cell: (log) =>
                    log.succeeded === false ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <XCircle size={12} aria-hidden="true" /> 실패
                      </span>
                    ) : log.simulated ? (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <FlaskConical size={12} aria-hidden="true" /> 시뮬레이션
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 size={12} aria-hidden="true" /> 발송
                      </span>
                    ),
                },
              ]}
            />
          )}
        </div>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
      {dialog}
    </section>
  );
}
