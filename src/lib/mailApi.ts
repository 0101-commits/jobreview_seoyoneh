import { supabase } from './supabase';
import { getAccessToken } from '@/components/modals/edgeApi';
import { logAudit } from './auditApi';
import type { ApiResult } from './jobApi';

/*
 * 초대·리마인더 메일 API — Edge Function(send-reminder) 호출 래퍼 + mail_logs 조회.
 * 근거: §6-3 ⓐ 리마인더 · §11-2 Phase 4 3번 · §10 P4 DoD ③ · §12 오픈이슈 4.
 *
 * ── 규약 ──
 * 관리자 화면(MailSendPanel)이 쓰는 계층이라 adminApi.ts 와 같은 ApiResult<T>(ok/error)로 돌려준다.
 * 실패를 던지지 않는다 — 한 화면에서 발송 결과와 발송 이력을 동시에 띄우는데, 한쪽 실패가
 * 다른 쪽까지 흰 화면으로 만들면 안 된다.
 *
 * ── 템플릿 치환은 여기서만 한다 ──
 * renderTemplate 이 유일한 치환기다. 화면의 미리보기도, 실제 발송 본문도 이 함수를 통과한다.
 * Edge Function 은 치환하지 않고 받은 문구를 그대로 보낸다. 치환기가 두 벌이 되면
 * "미리보기에 보인 문장"과 "실제 나간 문장"이 갈라지는데, 메일은 되돌릴 수 없다.
 *
 * ── 시뮬레이션 여부는 발송 전에 알 수 없다 ──
 * RESEND_API_KEY 는 Supabase 시크릿이라 브라우저에서 보이지 않는다(보여서도 안 된다).
 * 그래서 발송 결과의 simulated 값으로만 확정된다. 화면은 그 사실을 그대로 표시해야 한다.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-reminder`;

const NO_DB = '데이터베이스에 연결되어 있지 않습니다. 환경설정(.env)을 확인해 주세요.';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(what: string, message: string): ApiResult<T> {
  console.error(`[mailApi] ${what} 실패: ${message}`);
  return { ok: false, error: `${what} 실패했습니다. ${message}` };
}

// ── 값 타입 ─────────────────────────────────────────────────────────

/** mail_logs.kind 의 CHECK 와 같은 두 값. */
export type MailKind = 'INVITE' | 'REMINDER';

export const MAIL_KIND_LABELS: Record<MailKind, string> = {
  INVITE: '초대',
  REMINDER: '리마인더',
};

/** Edge Function 이 한 번에 받는 수신자 상한. 서버 상수(MAX_RECIPIENTS)와 같은 값이어야 한다. */
export const MAX_RECIPIENTS_PER_SEND = 100;

/**
 * 발송 대상 한 명. 진행 매트릭스(§6-3 ⓐ)의 선택 결과에서 만든다.
 * 한 사람이 두 직무를 맡으면 두 줄이 된다 — 직무별로 안내 문구가 다르기 때문이다.
 * email 은 넣지 않는다. 주소는 서버가 profiles 에서 다시 읽는다(오발송 방지).
 */
export interface MailRecipient {
  /** profiles.id */
  id: string;
  name: string;
  jobName?: string;
  orgName?: string;
}

/** 템플릿에 채워 넣을 값. 화면이 운영 설정(survey_settings)에서 가져와 넘긴다. */
export interface MailTemplateVars {
  /** survey_settings.due_date (YYYY-MM-DD). 없으면 '미정'으로 치환된다. */
  dueDate?: string | null;
  /** survey_settings.expected_minutes. 없으면 '미정'. */
  expectedMinutes?: number | null;
  /** survey_settings.inquiry_contact. */
  inquiryContact?: string | null;
  /** 검토 화면 주소. 생략하면 현재 접속 주소를 쓴다. */
  link?: string | null;
}

export interface MailTemplate {
  subject: string;
  body: string;
}

/** 발송 결과 한 줄. Edge Function 의 SendOutcome 과 같은 모양이다. */
export interface MailSendOutcome {
  id: string;
  email: string;
  name: string;
  ok: boolean;
  simulated: boolean;
  error?: string;
}

export interface MailSendResult {
  /** true면 아무것도 보내지 않았다(메일 키 미설정). 발송 후에야 확정되는 값이다. */
  simulated: boolean;
  sent: number;
  failed: number;
  /** mail_logs 에 남긴 행 수. */
  logged: number;
  /** 발송은 됐으나 이력 기록이 실패한 경우의 안내. 없으면 null. */
  logError: string | null;
  results: MailSendOutcome[];
}

/** mail_logs 한 줄(관리자 조회용). */
export interface MailLogEntry {
  id: string;
  kind: MailKind;
  recipientId: string;
  recipientName: string;
  simulated: boolean;
  sentAt: string;
  subject: string;
  jobName: string;
  /** meta.ok — 그때 발송이 성공했는가. 옛 기록에 값이 없으면 null. */
  succeeded: boolean | null;
  error: string;
}

// ── 템플릿 ──────────────────────────────────────────────────────────

/**
 * 치환 토큰. 관리자가 본문을 고칠 때 그대로 쓰는 표기다(화면에도 이 목록을 보여 준다).
 * 값이 없는 항목은 '미정'으로 치환한다 — 빈칸으로 두면 "마감일 까지"처럼 말이 끊긴 메일이 나간다.
 * (산출물 Export 의 "빈 칸은 빈칸" 규칙은 집계표 얘기다. 사람이 읽는 문장은 다르다.)
 */
export const TEMPLATE_TOKENS = ['{{이름}}', '{{직무}}', '{{마감일}}', '{{남은일수}}', '{{예상소요}}', '{{문의담당}}', '{{링크}}'] as const;

const UNSET = '미정';

/** 기본 템플릿. 운영 설정에 리마인더 템플릿이 저장되기 전까지 이 문구를 쓴다(§6-3 ⓒ 설정). */
export const DEFAULT_TEMPLATES: Record<MailKind, MailTemplate> = {
  INVITE: {
    subject: '[서연이화 업무조사] {{직무}} 직무 검토를 요청드립니다',
    body: [
      '{{이름}}님, 안녕하세요.',
      '',
      '서연이화 업무조사·SME 검증에 {{직무}} 직무 검토자로 배정되셨습니다.',
      '아래 주소에서 로그인하신 뒤 시작 가이드를 확인하고 검토를 진행해 주세요.',
      '',
      '· 검토 화면: {{링크}}',
      '· 마감일: {{마감일}} (남은 기간 {{남은일수}}일)',
      '· 예상 소요: 약 {{예상소요}}분',
      '',
      '진행 중 궁금한 점은 화면 우측 하단의 문의 버튼을 이용해 주세요.',
      '문의 담당: {{문의담당}}',
    ].join('\n'),
  },
  REMINDER: {
    subject: '[서연이화 업무조사] {{직무}} 직무 검토 마감 안내 (D-{{남은일수}})',
    body: [
      '{{이름}}님, 안녕하세요.',
      '',
      '배정되신 {{직무}} 직무 검토가 아직 완료되지 않았습니다.',
      '마감일은 {{마감일}}이며 남은 기간은 {{남은일수}}일입니다.',
      '',
      '· 검토 화면: {{링크}}',
      '· 예상 소요: 약 {{예상소요}}분',
      '',
      '작성하시던 내용은 자동 저장되어 있으니 이어서 진행하시면 됩니다.',
      '문의 담당: {{문의담당}}',
    ].join('\n'),
  },
};

/**
 * 마감일까지 남은 일수. 오늘이 마감일이면 0, 지났으면 음수다.
 * 날짜만 비교한다(시각은 보지 않는다) — "오늘까지"라는 운영 감각과 맞추기 위해서다.
 */
export function daysUntil(dueDate: string | null | undefined, today = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - base.getTime()) / 86_400_000);
}

/**
 * 유일한 템플릿 치환기. 미리보기와 실제 발송이 같은 문장이 되도록 양쪽 모두 이 함수를 쓴다.
 * 모르는 토큰은 그대로 남긴다 — 조용히 지우면 관리자가 오타를 알아채지 못한 채 메일이 나간다.
 */
export function renderTemplate(text: string, recipient: MailRecipient, vars: MailTemplateVars): string {
  const remain = daysUntil(vars.dueDate);
  const map: Record<string, string> = {
    '{{이름}}': recipient.name || UNSET,
    '{{직무}}': recipient.jobName || UNSET,
    '{{마감일}}': vars.dueDate || UNSET,
    '{{남은일수}}': remain === null ? UNSET : String(remain),
    '{{예상소요}}': vars.expectedMinutes ? String(vars.expectedMinutes) : UNSET,
    '{{문의담당}}': vars.inquiryContact || UNSET,
    '{{링크}}': vars.link || (typeof window !== 'undefined' ? window.location.origin : UNSET),
  };
  return text.replace(/\{\{[^}]+\}\}/g, (token) => map[token] ?? token);
}

// ── 발송 ────────────────────────────────────────────────────────────

/**
 * 리마인더·초대 메일 발송. 수신자별로 치환을 끝낸 문구를 Edge Function 에 넘긴다.
 *
 * 메일 키(RESEND_API_KEY)가 없으면 서버가 아무것도 보내지 않고 mail_logs 에 simulated = true 로만
 * 남긴다(§10 P4 DoD ③). 그 판정은 서버만 할 수 있으므로 결과의 simulated 로 돌아온다.
 *
 * 부분 실패는 실패가 아니다 — results 로 수신자별 성패가 온다. 화면은 실패한 사람만 다시 보낼 수 있다.
 */
export async function sendMails(
  kind: MailKind,
  recipients: MailRecipient[],
  template: MailTemplate,
  vars: MailTemplateVars,
): Promise<ApiResult<MailSendResult>> {
  if (recipients.length === 0) return fail('메일 발송', '수신자를 한 명 이상 선택해 주세요.');
  if (recipients.length > MAX_RECIPIENTS_PER_SEND)
    return fail('메일 발송', `한 번에 보낼 수 있는 수신자는 ${MAX_RECIPIENTS_PER_SEND}명까지입니다. 나눠서 발송해 주세요.`);

  const payload = {
    kind,
    recipients: recipients.map((r) => ({
      id: r.id,
      jobName: r.jobName ?? null,
      subject: renderTemplate(template.subject, r, vars),
      body: renderTemplate(template.body, r, vars),
    })),
  };

  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    return fail('메일 발송', e instanceof Error ? e.message : '로그인 상태를 확인해 주세요.');
  }

  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return fail('메일 발송', '서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) {
    const raw = typeof data.error === 'string' ? data.error : '';
    // Edge Function 이 한국어로 내려준 사유는 그대로 쓴다(edgeApi.toKoreanMessage 와 같은 판정).
    if (/[가-힣]/.test(raw)) return fail('메일 발송', raw);
    if (res.status === 401 || res.status === 403)
      return fail('메일 발송', '권한이 없거나 로그인이 만료됐습니다. 다시 로그인한 뒤 시도해 주세요.');
    if (res.status === 404)
      return fail('메일 발송', 'send-reminder 기능을 찾을 수 없습니다. Edge Function 배포 상태를 확인해 주세요.');
    return fail('메일 발송', `잠시 후 다시 시도해 주세요. (오류 코드 ${res.status})`);
  }

  const result: MailSendResult = {
    simulated: data.simulated === true,
    sent: typeof data.sent === 'number' ? data.sent : 0,
    failed: typeof data.failed === 'number' ? data.failed : 0,
    logged: typeof data.logged === 'number' ? data.logged : 0,
    logError: typeof data.logError === 'string' ? data.logError : null,
    results: Array.isArray(data.results) ? (data.results as MailSendOutcome[]) : [],
  };

  /*
   * 발송 기록(§8 S5 "…·업로드·Export·메일 발송을 audit_logs 에 기록").
   * mail_logs 에는 수신자별 원본이 남지만 그건 원시 표이고, E5 '관리자 행위 로그' 시트는
   * audit_logs 만 읽는다 — 여기서 남기지 않으면 검수 자리에서 "40명에게 리마인더를 보냈다"가
   * 감사 로그에 한 줄도 없다.
   *
   * 서버(send-reminder)가 아니라 여기서 남기는 이유: log_audit 은 actor_id 를 auth.uid() 로 강제하고
   * 비로그인 호출을 42501 로 거절한다. Edge Function 은 service_role 로 붙으므로 auth.uid() 가 없다.
   *
   * meta 에는 개인정보를 넣지 않는다(§8 S6) — 수신자 이름·주소·제목·본문은 담지 않고 인원 수만 센다.
   * simulated 는 행위 이름으로 가른다: E5 의 '행위' 열만 보고도 실제 발송과 시뮬레이션이 구분돼야 한다.
   */
  await logAudit(result.simulated ? 'MAIL_SIMULATED' : 'MAIL_SENT', 'mail_logs', null, {
    kind,
    recipients: recipients.length,
    sent: result.sent,
    failed: result.failed,
  });

  return ok(result);
}

// ── 발송 이력 조회 ──────────────────────────────────────────────────

/**
 * mail_logs 최근 목록(§6-3 ⓐ "발송 이력은 mail_logs 에 기록"). select 는 RLS 로 ADMIN 만 된다.
 * 쿼리 1회 — profiles 를 embed 해 수신자 이름까지 함께 가져온다.
 */
export async function fetchMailLogs(limit = 20): Promise<ApiResult<MailLogEntry[]>> {
  if (!supabase) return fail('발송 이력 조회', NO_DB);

  const { data, error } = await supabase
    .from('mail_logs')
    .select('id, kind, recipient, simulated, sent_at, meta, profiles!inner(name)')
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) return fail('발송 이력 조회', error.message);

  return ok(
    (data || []).map((row: Record<string, unknown>) => {
      const meta = (row.meta as Record<string, unknown>) || {};
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id as string,
        kind: (row.kind as MailKind) ?? 'REMINDER',
        recipientId: row.recipient as string,
        recipientName: ((profile as { name?: string })?.name as string) || '',
        simulated: row.simulated !== false,
        sentAt: (row.sent_at as string) || '',
        subject: typeof meta.subject === 'string' ? meta.subject : '',
        jobName: typeof meta.job_name === 'string' ? meta.job_name : '',
        succeeded: typeof meta.ok === 'boolean' ? meta.ok : null,
        error: typeof meta.error === 'string' ? meta.error : '',
      };
    }),
  );
}
