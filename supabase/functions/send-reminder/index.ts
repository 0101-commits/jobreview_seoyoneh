// 초대·리마인더 메일 발송 Edge Function (§6-3 ⓐ 리마인더 · §11-2 Phase 4 3번 · §10 P4 DoD ③).
//
// 구조·CORS·호출자 인증 검사는 supabase/functions/admin-create-user/index.ts 를 그대로 따른다.
// service_role 클라이언트로 호출자 JWT를 풀고, profiles.role = 'admin' 이며 active 인지
// 서버에서 다시 확인한다. 클라이언트가 보내온 역할·이메일은 하나도 믿지 않는다.
//
// ── 발신 도메인(SPF·DKIM)이 아직 확정되지 않았다 — §12 오픈이슈 4 ──
// 초대·리마인더 실발송에는 SPF·DKIM 인증을 마친 발신 도메인(HCG 또는 고객 도메인)이 필요하다.
// 미확정 기간에는 이 함수가 시뮬레이션 모드로만 동작한다(RESEND_API_KEY 미설정 = 기록만).
// 실발송으로 전환하기 전에 반드시 확인할 항목:
//   1) 발신 도메인 확정 — HCG 도메인인가 고객(서연이화) 도메인인가. 승인 주체는 HCG IT(§12).
//   2) Resend 대시보드에 그 도메인 등록 + 상태가 Verified 인가.
//   3) DNS 에 SPF(TXT) · DKIM(CNAME 3건) · DMARC(TXT, 최소 p=none) 레코드가 반영됐는가.
//   4) Supabase 시크릿 RESEND_API_KEY · RESEND_FROM 등록 — 저장소·코드에는 절대 남기지 않는다.
//      RESEND_FROM 은 2)에서 인증한 도메인의 주소여야 한다(예: "표시이름 <noreply@도메인>").
//   5) 회신 주소(RESEND_REPLY_TO, 선택) — 문의 담당자 메일. 없으면 회신이 발신함으로 흩어진다.
//   6) 관리자 1명에게 시험 발송 → 수신함 도착 · 스팸함 여부 · 헤더의 SPF/DKIM=pass 확인.
//   7) 그 뒤에야 다수 발송. 수신자 명단은 화면에서 다시 확인한다(오발송은 되돌릴 수 없다).
// 위 6)까지 끝나기 전에는 키를 등록하지 않는 편이 안전하다 — 키가 없으면 이 함수는
// 아무것도 보내지 않고 mail_logs 에 simulated = true 로만 남긴다. 그것이 P4 DoD ③이다.
//
// ── 비밀값 취급 ──
// RESEND_API_KEY 는 Deno.env.get 으로만 읽는다. 값을 응답·콘솔·mail_logs.meta 어디에도 싣지 않는다.
// 아래 코드는 키의 존재 여부(boolean)만 밖으로 내보낸다.
//
// ── 본문을 서버에서 만들지 않는 이유 ──
// 화면(MailSendPanel)이 템플릿 치환까지 끝낸 제목·본문을 수신자별로 보내 온다. 서버는 그대로 발송한다.
// 서버가 다시 치환하면 치환기가 두 벌(브라우저 TS · Deno)이 되어 미리보기와 실제 발송 문구가
// 갈라진다. "미리보기에 보인 문장 = 실제 나간 문장"을 보증하려면 치환기가 하나여야 한다.
// 대신 수신자 이메일 주소만은 클라이언트 값을 쓰지 않고 profiles 에서 다시 읽는다 — 오발송 방지.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** 한 번의 호출로 받을 수 있는 수신자 수 상한. Edge Function 실행 시간을 넘기지 않도록 자른다. */
const MAX_RECIPIENTS = 100;

/**
 * 실발송 사이의 간격(ms). Resend 기본 rate limit 이 초당 2건이라 그보다 느리게 보낸다.
 * ponytail: 순차 발송이라 100명이면 최대 60초가 걸린다. 더 많아지면 Resend 의 batch 엔드포인트
 * (/emails/batch, 1회 100건)로 바꾼다 — 다만 batch 는 전송 실패가 전원 실패로 뭉뚱그려져
 * "수신자별 결과"를 잃는다. 지금 규모(SME 수십 명)에서는 순차가 맞다.
 */
const SEND_INTERVAL_MS = 600;

const KINDS = ["INVITE", "REMINDER"] as const;
type MailKind = (typeof KINDS)[number];

interface RecipientInput {
  id: string;
  subject: string;
  body: string;
  /** 이 메일이 어느 직무 건인지. mail_logs.meta 에만 남는 참고값이다. */
  jobName?: string;
}

interface SendOutcome {
  id: string;
  /** 발송에 실제로 쓴 주소. 시뮬레이션에서도 "어디로 갔을 것인가"를 알 수 있게 돌려준다. */
  email: string;
  name: string;
  ok: boolean;
  simulated: boolean;
  /** 실패 사유(한국어). 성공이면 없다. */
  error?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 발송 실패 사유를 사람이 읽을 한국어 한 줄로. 키 값이 섞여 나가지 않도록 원문은 200자에서 자른다. */
function sendErrorMessage(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "";
  const trimmed = text.trim().slice(0, 200);
  return trimmed ? `메일 발송에 실패했습니다. ${trimmed}` : "메일 발송에 실패했습니다.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    // mail_logs 는 authenticated 의 INSERT 정책이 아예 없다(정책 없음 = 거부, Phase 1 마이그레이션).
    // 기록은 이 service_role 클라이언트로만 남길 수 있다 — admin-create-user 와 같은 방식이다.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 호출자 인증 (admin-create-user 와 동일한 3단계) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: callerUser, error: callerErr } = await adminClient.auth.getUser(token);
    if (callerErr || !callerUser?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, active")
      .eq("id", callerUser.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    // ── 입력 검증 ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "요청 본문을 읽지 못했습니다." }, 400);
    }

    const kind = (body as { kind?: string }).kind as MailKind;
    if (!KINDS.includes(kind)) {
      return json({ error: "메일 종류가 올바르지 않습니다. (INVITE 또는 REMINDER)" }, 400);
    }

    const rawRecipients = (body as { recipients?: unknown }).recipients;
    if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
      return json({ error: "수신자를 한 명 이상 선택해 주세요." }, 400);
    }
    if (rawRecipients.length > MAX_RECIPIENTS) {
      return json(
        { error: `한 번에 보낼 수 있는 수신자는 ${MAX_RECIPIENTS}명까지입니다. 나눠서 발송해 주세요.` },
        400,
      );
    }

    const recipients: RecipientInput[] = [];
    for (const r of rawRecipients as RecipientInput[]) {
      const id = typeof r?.id === "string" ? r.id.trim() : "";
      const subject = typeof r?.subject === "string" ? r.subject.trim() : "";
      const mailBody = typeof r?.body === "string" ? r.body.trim() : "";
      if (!id || !subject || !mailBody) {
        return json({ error: "수신자·제목·본문이 비어 있는 항목이 있습니다. 내용을 확인해 주세요." }, 400);
      }
      recipients.push({ id, subject, body: mailBody, jobName: typeof r.jobName === "string" ? r.jobName : undefined });
    }

    // 같은 사람이 두 직무로 두 번 선택될 수 있다. 그건 그대로 둔다(직무별 안내가 다르다).
    const uniqueIds = [...new Set(recipients.map((r) => r.id))];

    // ── 수신 주소는 profiles 에서 다시 읽는다 ──
    const { data: profileRows, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, email, name, active")
      .in("id", uniqueIds);

    if (profileErr) {
      console.error("send-reminder: profiles 조회 실패:", profileErr.message);
      return json({ error: "수신자 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
    }

    const profileById = new Map<string, { email: string; name: string; active: boolean }>();
    for (const p of (profileRows || []) as { id: string; email: string; name: string; active: boolean }[]) {
      profileById.set(p.id, { email: p.email || "", name: p.name || "", active: p.active !== false });
    }

    // ── 발송 모드 판정 ──
    // 키가 없으면 시뮬레이션이다. 오류가 아니다(§10 P4 DoD ③).
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const resendFrom = Deno.env.get("RESEND_FROM") || "";
    const replyTo = Deno.env.get("RESEND_REPLY_TO") || "";
    const simulated = resendKey.length === 0;

    // 키는 있는데 발신 주소가 없으면 보낼 수 없다. 이때 조용히 시뮬레이션으로 내려가면
    // "보낸 줄 알았는데 안 갔다"가 된다 — 설정 누락은 설정 누락이라고 말한다.
    if (!simulated && !resendFrom) {
      return json(
        {
          error:
            "발신 주소(RESEND_FROM)가 설정되어 있지 않아 발송할 수 없습니다. " +
            "인증된 발신 도메인의 주소를 Supabase 시크릿 RESEND_FROM 에 등록해 주세요.",
        },
        500,
      );
    }

    // ── 수신자별 발송 ──
    // 한 명이 실패해도 나머지는 계속 보낸다. 결과는 수신자별로 돌려준다.
    const results: SendOutcome[] = [];
    let sentAttempts = 0;

    for (const r of recipients) {
      const profile = profileById.get(r.id);

      if (!profile) {
        results.push({ id: r.id, email: "", name: "", ok: false, simulated, error: "계정을 찾을 수 없습니다." });
        continue;
      }
      if (!profile.active) {
        results.push({
          id: r.id,
          email: profile.email,
          name: profile.name,
          ok: false,
          simulated,
          error: "비활성 계정이라 발송하지 않았습니다.",
        });
        continue;
      }
      if (!profile.email) {
        results.push({
          id: r.id,
          email: "",
          name: profile.name,
          ok: false,
          simulated,
          error: "등록된 이메일 주소가 없습니다.",
        });
        continue;
      }
      /*
       * 메일 주소 없이 만든 계정은 로그인용으로 지은 .local 주소를 갖고 있다
       * (admin-create-user 의 LOGIN_ID_DOMAIN). 인터넷으로 라우팅되지 않는 주소라 보내면
       * 반드시 실패한다. 시도해서 실패로 남기는 대신 사유를 정확히 적고 건너뛴다 —
       * 관리자가 "왜 이 사람만 안 갔나"를 로그에서 바로 알 수 있어야 한다.
       */
      if (profile.email.toLowerCase().endsWith(".local")) {
        results.push({
          id: r.id,
          email: profile.email,
          name: profile.name,
          ok: false,
          simulated,
          error: "메일 주소가 없는 계정입니다(로그인 ID 전용). 직접 안내해 주세요.",
        });
        continue;
      }

      if (simulated) {
        // 아무것도 보내지 않는다. 기록만 남긴다.
        results.push({ id: r.id, email: profile.email, name: profile.name, ok: true, simulated: true });
        continue;
      }

      // Resend rate limit 을 넘지 않도록 두 번째 발송부터 간격을 둔다.
      if (sentAttempts > 0) await sleep(SEND_INTERVAL_MS);
      sentAttempts += 1;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [profile.email],
            subject: r.subject,
            text: r.body,
            ...(replyTo ? { reply_to: replyTo } : {}),
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
        if (!res.ok) {
          results.push({
            id: r.id,
            email: profile.email,
            name: profile.name,
            ok: false,
            simulated: false,
            error: sendErrorMessage(payload.message || payload.name || `HTTP ${res.status}`),
          });
          continue;
        }
        results.push({ id: r.id, email: profile.email, name: profile.name, ok: true, simulated: false });
      } catch (e) {
        results.push({
          id: r.id,
          email: profile.email,
          name: profile.name,
          ok: false,
          simulated: false,
          error: sendErrorMessage(e),
        });
      }
    }

    // ── mail_logs 기록 (수신자별 1행) ──
    // 성공만이 아니라 실패한 시도도 남긴다. "보내려 했으나 실패했다"도 운영 기록이다.
    // meta 에는 종류·제목·직무·성패만 담는다. 본문 전문은 넣지 않는다(로그가 개인 응답을 품지 않게).
    const nowIso = new Date().toISOString();
    const logRows = results.map((r, i) => ({
      kind,
      recipient: r.id,
      simulated: r.simulated,
      sent_at: nowIso,
      meta: {
        kind,
        subject: recipients[i].subject,
        job_name: recipients[i].jobName ?? null,
        to: r.email || null,
        ok: r.ok,
        error: r.error ?? null,
        actor_id: callerUser.user.id,
      },
    }));

    // 계정을 찾지 못한 수신자는 recipient FK 를 만족하지 못하므로 기록에서 뺀다.
    const insertable = logRows.filter((row) => profileById.has(row.recipient));

    let logError: string | null = null;
    if (insertable.length > 0) {
      const { error: logErr } = await adminClient.from("mail_logs").insert(insertable);
      if (logErr) {
        console.error("send-reminder: mail_logs 기록 실패:", logErr.message);
        // 발송 자체는 이미 끝났다. 기록 실패를 발송 실패로 뒤집지 않는다 — 대신 숨기지도 않는다.
        logError = "발송 이력을 남기지 못했습니다. 발송 결과는 아래 목록으로 확인해 주세요.";
      }
    }

    return json({
      success: true,
      /** true 면 아무것도 보내지 않았다(RESEND_API_KEY 미설정). 화면이 이 값으로 시뮬레이션 배지를 띄운다. */
      simulated,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      logged: logError ? 0 : insertable.length,
      logError,
      results,
    });
  } catch (err) {
    console.error("send-reminder exception:", err);
    return json({ error: "메일 발송 처리 중 오류가 발생했습니다." }, 500);
  }
});
