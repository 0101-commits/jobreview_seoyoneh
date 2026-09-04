import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveLoginEmail } from "./loginEmail.ts";

/*
 * auth.admin.listUsers()는 인자를 주지 않으면 첫 50건만 돌려준다(supabase-js 기본 perPage).
 * 그 응답으로 "이 이메일이 이미 있는가"를 판정하면 계정 51번째부터 답이 틀린다(v2 F2).
 * 그래서 이메일로 찾아야 할 때만 이 헬퍼로 전체를 순회하고, id로 찾을 때는 getUserById를 쓴다.
 */
async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email?: string } | null> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (users.length < perPage) return null; // 마지막 페이지
  }
  return null;
}

/*
 * 활성 관리자 수. "로그인할 수 있는 마지막 관리자를 잠그지 않는다"는 방어가
 * toggle-active · delete · set-role 세 곳에서 같은 값을 본다. 세 곳에 같은 쿼리를 두면
 * 한 곳만 조건이 바뀌어도 방어가 갈리므로 여기 한 번만 적는다.
 */
async function countActiveAdmins(adminClient: ReturnType<typeof createClient>): Promise<number> {
  const { count } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true);
  return count ?? 0;
}

/*
 * 임시 비밀번호 생성(v2 S2 / 결정 D1 ⓑ).
 * 관리자가 엑셀 평문 비밀번호를 유통하던 발급 방식을 서버 생성으로 바꾼다.
 * 생성값은 응답으로 한 번만 돌려주고 어디에도 저장하지 않는다(profiles.must_change_password가
 * true라 SME는 첫 로그인에서 곧바로 바꾼다).
 * 혼동하기 쉬운 글자(0/O, 1/l/I)는 뺀다 — 관리자가 사람에게 읽어 줘야 하는 값이다.
 */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];
  // 앞 3자로 정책(영문 대·소문자 + 숫자)을 보장하고 나머지는 전체 집합에서 뽑는다.
  const head = [pick(upper, 0), pick(lower, 1), pick(digits, 2)];
  const tail = Array.from({ length: bytes.length - 3 }, (_, k) => pick(all, k + 3));
  return [...head, ...tail].join("");
}

/*
 * 비밀번호 정책 한 곳(기획서 §3 F11) — 이 파일이 최종 판정자다.
 * 예전에는 이 파일이 8자, 화면(ChangePasswordPage)이 10자를 요구해서 관리자가 만들어 준
 * 비밀번호를 본인이 바꾸려는 순간 거절당했다. 지금은 화면 쪽 사본이 `src/lib/passwordPolicy.ts`
 * 한 곳에 있다. **숫자를 바꿀 때는 그 파일과 함께 바꾼다** — Deno 런타임이라 import 할 수 없다.
 *
 * 2026-09-04: 10 → 8. 파일럿 운영 계정에 9자 비밀번호를 쓰기로 한 결정에 맞춘다.
 */
const PASSWORD_MIN_LENGTH = 8;

/** 정책 위반 사유를 한국어로 돌려준다. 통과하면 null. */
function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "비밀번호를 입력해 주세요.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다. 지금 ${password.length}자입니다.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "비밀번호에는 영문과 숫자를 함께 넣어 주세요.";
  }
  return null;
}

/*
 * 로그인 ID 도메인. .local 을 쓰는 이유 — 실제로 메일이 닿을 수 있는 도메인을 지어 쓰면
 * 리마인더 발송(send-reminder)이 남의 우편함으로 나간다. .local 은 인터넷으로 라우팅되지 않으므로
 * 그 사고가 구조적으로 막힌다. 운영 전환 때 바꿔야 하면 PILOT_LOGIN_DOMAIN 환경변수로 덮는다.
 */
const LOGIN_ID_DOMAIN = (Deno.env.get("PILOT_LOGIN_DOMAIN") || "seoyoneh.local").trim().toLowerCase();

/* ────────────────────────────────────────────────────────────────────────────
 * 비밀번호 보관고 — 관리자 평문 열람(기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md §2)
 *
 * 키는 여기(Edge Function 시크릿)에만 있다. DB 에는 암호문만 들어가므로 덤프·백업이 통째로
 * 새도 값은 읽히지 않는다. RESEND_API_KEY 를 다루는 방식과 같은 규약이다.
 *
 * 키가 없으면 보관도 열람도 하지 않는다. 계정 발급 자체는 막지 않는다 — 비밀번호를 못 만들어
 * 주는 것이 못 보여 주는 것보다 나쁘다. 대신 열람 요청에는 사유를 분명히 돌려준다.
 * ──────────────────────────────────────────────────────────────────────────── */
const VAULT_KEY_B64 = (Deno.env.get("PASSWORD_VAULT_KEY") || "").trim();

async function vaultKey(): Promise<CryptoKey | null> {
  if (!VAULT_KEY_B64) return null;
  try {
    const raw = Uint8Array.from(atob(VAULT_KEY_B64), (c) => c.charCodeAt(0));
    if (raw.length !== 32) {
      console.error("PASSWORD_VAULT_KEY must decode to 32 bytes, got", raw.length);
      return null;
    }
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch (err) {
    console.error("PASSWORD_VAULT_KEY is not valid base64:", err);
    return null;
  }
}

/** 저장 형식: base64(iv 12바이트 ‖ 암호문+태그). 버전은 key_version 컬럼이 따로 들고 있다. */
async function encryptSecret(plain: string): Promise<string | null> {
  const key = await vaultKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plain);
  const buf = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc));
  const joined = new Uint8Array(iv.length + buf.length);
  joined.set(iv, 0);
  joined.set(buf, iv.length);
  return btoa(String.fromCharCode(...joined));
}

async function decryptSecret(payload: string): Promise<string | null> {
  const key = await vaultKey();
  if (!key) return null;
  try {
    const joined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const iv = joined.slice(0, 12);
    const body = joined.slice(12);
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
    return new TextDecoder().decode(out);
  } catch (err) {
    // 키를 바꿨거나 값이 손상된 경우다. 조용히 빈 값을 주면 "비밀번호가 없다"로 오해된다.
    console.error("vault decrypt failed:", err);
    return null;
  }
}

/**
 * 보관고에 값을 남긴다. **실패해도 호출자의 작업을 되돌리지 않는다** — 비밀번호는 이미 바뀌었고,
 * 보관 실패로 400 을 돌려주면 관리자는 "실패했다"고 읽고 같은 조작을 다시 한다.
 * 대신 저장 여부를 boolean 으로 돌려주어 응답이 사실대로 말하게 한다.
 */
async function saveVaultEntry(
  adminClient: ReturnType<typeof createClient>,
  profileId: string,
  plaintext: string,
  source: "admin-create" | "sme-create" | "set-password" | "self-change",
  setBy: string | null,
): Promise<boolean> {
  const ciphertext = await encryptSecret(plaintext);
  if (!ciphertext) return false;
  const { error } = await adminClient
    .from("account_password_vault")
    .upsert({
      profile_id: profileId,
      ciphertext,
      key_version: 1,
      source,
      stale: false,
      set_by: setBy,
      set_at: new Date().toISOString(),
    }, { onConflict: "profile_id" });
  if (error) {
    // 표가 아직 없는 DB(APPLY 미적용)도 여기로 온다. 계정 발급은 그대로 성공시킨다.
    console.error("vault save failed:", error.message);
    return false;
  }
  return true;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get the caller's JWT to verify they are an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: callerUser, error: callerErr } = await adminClient.auth.getUser(token);
    if (callerErr || !callerUser?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /*
     * 본문을 관리자 검증보다 먼저 읽는다. 아래 set-own-password 하나만 관리자가 아니어도
     * 쓸 수 있어야 하기 때문이다(본인이 자기 비밀번호를 바꾸는 경로).
     */
    const body = await req.json();
    const { name, email, password, mode } = body;

    /*
     * ── 본인 비밀번호 변경 (기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md §2) ────
     *
     * 예전에는 화면이 supabase.auth.updateUser 로 GoTrue 에 직접 쏘았다. 그 경로만 서버를
     * 지나지 않아서, 관리자가 발급한 값은 첫 로그인 직후 폐기되고 보관고의 값은 그 순간부터
     * 거짓이 됐다. 신규 계정은 must_change_password 가 걸려 있어 이 일이 예외 없이 일어난다.
     * 그래서 이 경로를 서버로 끌어온다.
     *
     * 관리자 권한을 요구하지 않는다. 대상은 언제나 호출자 자신이고(body 의 값을 쓰지 않는다),
     * JWT 검증은 이미 위에서 끝났다.
     */
    if (mode === "set-own-password") {
      const ownPassword = body.password;
      const policyError = passwordPolicyError(ownPassword);
      if (policyError) {
        return new Response(
          JSON.stringify({ error: policyError }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: ownErr } = await adminClient.auth.admin.updateUserById(callerUser.user.id, {
        password: ownPassword as string,
      });
      if (ownErr) {
        console.error("set-own-password failed:", ownErr);
        return new Response(
          JSON.stringify({ error: `비밀번호를 변경하지 못했습니다. ${ownErr.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 변경 완료 표시. 실패해도 비밀번호는 이미 바뀌었으므로 성공을 뒤집지 않고 응답으로 알린다.
      const { error: ownFlagErr } = await adminClient
        .from("profiles")
        .update({ must_change_password: false, updated_at: new Date().toISOString() })
        .eq("id", callerUser.user.id);
      if (ownFlagErr) console.error("set-own-password flag update failed:", ownFlagErr);

      const ownVaulted = await saveVaultEntry(
        adminClient,
        callerUser.user.id,
        ownPassword as string,
        "self-change",
        callerUser.user.id,
      );

      return new Response(
        JSON.stringify({ success: true, flagApplied: !ownFlagErr, vaulted: ownVaulted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify caller is an admin
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, active")
      .eq("id", callerUser.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SME batch creation from Excel upload ───────────────────
    if (mode === "create-sme") {
      const { sme: smeData } = body;
      // smeData: { name, email, company_id, organization, title, employee_number }
      // password는 받지 않는다(v2 S2) — 서버가 만들어 응답으로 한 번만 돌려준다.
      if (!smeData || !smeData.name) {
        return new Response(
          JSON.stringify({ error: "이름을 입력해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // 이메일은 선택 입력이다. 비우면 사번으로 로그인 ID 를 만든다.
      const normalizedSmeEmail = resolveLoginEmail(smeData.email, smeData.employee_number, LOGIN_ID_DOMAIN);
      if (!normalizedSmeEmail) {
        return new Response(
          JSON.stringify({
            error: "이메일을 비우려면 영문·숫자 사번을 입력해 주세요. 그 사번으로 로그인 ID를 만듭니다.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const smeTempPassword = generateTempPassword();

      // Check for duplicate email in profiles
      const { data: existingSme } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", normalizedSmeEmail)
        .maybeSingle();
      if (existingSme) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 로그인 ID입니다. (${normalizedSmeEmail})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Check for duplicate (company_id, employee_number) if both are provided
      if (smeData.company_id && smeData.employee_number) {
        const { data: existingEmp } = await adminClient
          .from("profiles")
          .select("id")
          .eq("company_id", smeData.company_id)
          .eq("employee_number", smeData.employee_number)
          .neq("employee_number", "")
          .maybeSingle();
        if (existingEmp) {
          return new Response(
            JSON.stringify({ error: `이미 등록된 사번입니다. (${smeData.employee_number})` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // Check auth.users for duplicate email (전 페이지 순회 — F2)
      const existingSmeAuth = await findAuthUserByEmail(adminClient, normalizedSmeEmail);
      if (existingSmeAuth) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 로그인 ID입니다. (${normalizedSmeEmail})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Create auth user
      const { data: smeAuthData, error: smeAuthErr } = await adminClient.auth.admin.createUser({
        email: normalizedSmeEmail,
        password: smeTempPassword,
        email_confirm: true,
        user_metadata: { name: smeData.name.trim() },
      });

      if (smeAuthErr || !smeAuthData?.user) {
        const msg = smeAuthErr?.message || "SME 계정 등록 중 오류가 발생했습니다.";
        if (msg.includes("already") || msg.includes("exists")) {
          return new Response(
            JSON.stringify({ error: `이미 등록된 로그인 ID입니다. (${normalizedSmeEmail})` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: `SME 계정 등록 중 오류가 발생했습니다. (${normalizedSmeEmail})` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const smeUserId = smeAuthData.user.id;

      const { error: smeProfileErr } = await adminClient.from("profiles").insert({
        id: smeUserId,
        email: normalizedSmeEmail,
        name: smeData.name.trim(),
        organization: smeData.organization || "",
        title: smeData.title || "",
        role: "sme",
        active: true,
        company_id: smeData.company_id || null,
        employee_number: smeData.employee_number || "",
      });

      if (smeProfileErr) {
        console.error("SME profile insert failed:", smeProfileErr);
        await adminClient.auth.admin.deleteUser(smeUserId);
        return new Response(
          JSON.stringify({ error: `SME 계정 등록 중 오류가 발생했습니다. (${normalizedSmeEmail})` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Auto-create review assignments for all jobs in the SME's company
      //
      // 주의(§2 R6): 이 호출은 회사의 활성 직무 '전부'를 이 SME에게 배정한다.
      // R6("직무별 최소 인원의 SME 1~2명")과 충돌하고, §6-3 ⓐ의 「직무별 SME 배정 수」 점검이
      // 언제나 전원 배정으로 나온다. 그래도 여기서 끄지 않는다 — 지금은 계정을 만든 직후
      // 배정을 만드는 유일한 경로라, 끄면 새 SME의 배정이 0이 되어 관리자 흐름이 끊긴다.
      // 직무를 골라 배정하려면 통합 업로드의 SME 명부(시트 ④) → link_sme_roster를 쓴다
      // (마이그레이션 20260902010000). 그쪽은 기존 배정을 지우지 않고 명부에 있는 쌍만 더한다.
      if (smeData.company_id) {
        const { error: syncErr } = await adminClient.rpc("sync_sme_assignments", {
          p_sme_id: smeUserId,
          p_company_id: smeData.company_id,
        });
        if (syncErr) {
          console.error("sync_sme_assignments failed:", syncErr);
        }
      }

      // 보관고에 남긴다(§2 W1). profiles 행이 이미 있어야 FK 를 만족하므로 여기가 가장 이른 자리다.
      const smeVaulted = await saveVaultEntry(adminClient, smeUserId, smeTempPassword, "sme-create", callerUser.user.id);

      // tempPassword는 이 응답에도 있다. 화면은 관리자에게 1회 표시하고, 이후에는 보관고에서 다시 읽는다.
      return new Response(
        JSON.stringify({ success: true, userId: smeUserId, email: normalizedSmeEmail, tempPassword: smeTempPassword, vaulted: smeVaulted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Update profile fields (name·company·organization·title·employee_number) ──
    //
    // 이름이 update-sme 지만 role 을 보지 않으므로 관리자 계정에도 그대로 쓴다(기획서 §3 F8).
    // 모드 이름을 바꾸지 않는 이유: 이미 배포된 Edge Function 과 화면 5곳이 이 문자열을 쓰고 있어
    // 이름만 바꾸면 배포 순서에 따라 계정 수정이 통째로 실패하는 구간이 생긴다.
    if (mode === "update-sme") {
      const { profileId: updId, name: updName, company_id: updCompanyId, organization: updOrg, title: updTitle, employee_number: updEmpNum } = body;
      if (!updId) {
        return new Response(
          JSON.stringify({ error: "수정할 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updName !== undefined) updateFields.name = updName.trim();
      if (updCompanyId !== undefined) updateFields.company_id = updCompanyId || null;
      if (updOrg !== undefined) updateFields.organization = updOrg || "";
      if (updTitle !== undefined) updateFields.title = updTitle || "";
      if (updEmpNum !== undefined) updateFields.employee_number = updEmpNum || "";

      const { error: updErr } = await adminClient
        .from("profiles")
        .update(updateFields)
        .eq("id", updId);
      if (updErr) {
        return new Response(
          JSON.stringify({ error: "SME 계정 정보 수정 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "update") {
      // Update name only
      const { error: updateErr } = await adminClient
        .from("profiles")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", body.profileId);
      if (updateErr) {
        console.error("profile update failed:", updateErr);
        return new Response(
          JSON.stringify({ error: "이름 수정 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "toggle-active") {
      const { profileId, active } = body;
      // Prevent self-deactivation
      if (!active && profileId === callerUser.user.id) {
        return new Response(
          JSON.stringify({ error: "현재 로그인한 계정은 비활성화할 수 없습니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      /*
       * 마지막 활성 관리자 방어 — 대상이 관리자일 때만 건다.
       * 예전에는 대상 역할을 보지 않고 active=false 이기만 하면 관리자 수를 셌다. F6 으로
       * 이 모드를 SME 관리 모달에도 붙이면서, 관리자가 1명인 운영(파일럿이 그렇다)에서는
       * SME 비활성화 요청이 전부 "최소 1개의 활성 관리자 계정이 필요합니다"로 막혔다.
       * delete 모드는 처음부터 대상 프로필을 먼저 읽어 역할을 확인한다 — 같은 순서로 맞춘다.
       */
      if (!active) {
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("role, active")
          .eq("id", profileId)
          .maybeSingle();

        if (!targetProfile) {
          return new Response(
            JSON.stringify({ error: "계정을 찾을 수 없습니다." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (targetProfile.role === "admin" && targetProfile.active) {
          if ((await countActiveAdmins(adminClient)) <= 1) {
            return new Response(
              JSON.stringify({ error: "최소 1개의 활성 관리자 계정이 필요합니다." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }
      }
      const { error: toggleErr } = await adminClient
        .from("profiles")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", profileId);
      if (toggleErr) {
        console.error("toggle active failed:", toggleErr);
        return new Response(
          JSON.stringify({ error: "상태 변경 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "delete") {
      const { profileId } = body;
      if (!profileId) {
        return new Response(
          JSON.stringify({ error: "삭제할 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Prevent self-deletion
      if (profileId === callerUser.user.id) {
        return new Response(
          JSON.stringify({ error: "현재 로그인한 계정은 삭제할 수 없습니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Prevent deleting last active admin
      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("active, role")
        .eq("id", profileId)
        .maybeSingle();

      if (!targetProfile) {
        return new Response(
          JSON.stringify({ error: "계정을 찾을 수 없습니다." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (targetProfile.role === "admin" && targetProfile.active) {
        if ((await countActiveAdmins(adminClient)) <= 1) {
          return new Response(
            JSON.stringify({ error: "최소 1개의 활성 관리자 계정이 필요합니다." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // Delete auth user first (profiles row cascades via FK ON DELETE CASCADE)
      const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(profileId);
      if (authDeleteErr) {
        console.error("delete auth user failed:", authDeleteErr);
        // Auth user might not exist (orphan profile) — try deleting profile directly
      }

      // Delete profile row (in case auth user didn't exist, or cascade didn't trigger)
      const { error: profileDeleteErr } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", profileId);
      if (profileDeleteErr) {
        console.error("delete profile failed:", profileDeleteErr);
        return new Response(
          JSON.stringify({ error: "계정 삭제 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 비밀번호 재설정 (기획서 §2 · F1~F3) ───────────────────────
    //
    // 평문 열람은 만들지 않는다 — Supabase Auth 는 해시만 갖고 있고 앱도 평문을 저장하지 않는다.
    // 관리자가 실제로 필요했던 것("지금 당장 들어가게 해 준다")은 재발급으로 끝나므로
    // ⓐ 서버 생성 임시값(응답 1회 표시) ⓑ 관리자 지정값 두 갈래만 둔다.
    if (mode === "set-password") {
      const { profileId: pwProfileId, password: newPassword, forceChange } = body;
      if (!pwProfileId) {
        return new Response(
          JSON.stringify({ error: "비밀번호를 바꿀 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // 값을 넣었으면 그 값, 비웠으면 서버가 만든다. 넣은 값은 화면과 같은 정책으로 검사한다.
      const explicit = typeof newPassword === "string" && newPassword.length > 0;
      if (explicit) {
        const policyError = passwordPolicyError(newPassword);
        if (policyError) {
          return new Response(
            JSON.stringify({ error: policyError }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      const nextPassword = explicit ? (newPassword as string) : generateTempPassword();

      // 로그인 계정(auth)이 없는 프로필에서 updateUserById 는 실패한다. 그 실패를 삼키면
      // 관리자가 "존재하지 않는 계정의 비밀번호"를 사람에게 전달하게 되므로 먼저 확인해 사유를 가른다.
      const { data: pwTarget } = await adminClient.auth.admin.getUserById(pwProfileId);
      if (!pwTarget?.user) {
        return new Response(
          JSON.stringify({
            error:
              "이 계정에는 로그인 계정(auth)이 없어 비밀번호를 바꿀 수 없습니다. supabase/BOOTSTRAP_2026-09-02_admin.sql 절차로 복구해 주세요.",
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: pwErr } = await adminClient.auth.admin.updateUserById(pwProfileId, {
        password: nextPassword,
      });
      if (pwErr) {
        console.error("set-password failed:", pwErr);
        return new Response(
          JSON.stringify({ error: "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 기본은 "본인이 첫 로그인에서 다시 바꾸게" 한다(§8 S2). 관리자가 명시적으로 false 를 줄 때만 풀린다.
      const force = forceChange !== false;
      const { error: pwFlagErr } = await adminClient
        .from("profiles")
        .update({ must_change_password: force, updated_at: new Date().toISOString() })
        .eq("id", pwProfileId);
      if (pwFlagErr) console.error("set-password flag update failed:", pwFlagErr);

      // 보관고에 남긴다(§2 W2). 서버 생성값·관리자 지정값 두 갈래가 여기서 합류하므로 한 줄이면 된다.
      const pwVaulted = await saveVaultEntry(adminClient, pwProfileId as string, nextPassword, "set-password", callerUser.user.id);

      // 비밀번호는 이미 바뀌었다 — 플래그 갱신 실패를 오류로 뒤집지 않고 응답으로 알린다.
      // tempPassword 는 서버가 만든 경우에만 넣는다(관리자가 넣은 값을 되돌려줄 이유가 없다).
      return new Response(
        JSON.stringify({
          success: true,
          tempPassword: explicit ? null : nextPassword,
          mustChangePassword: force,
          forceChangeApplied: !pwFlagErr,
          vaulted: pwVaulted,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 로그인 ID(이메일) 변경 (기획서 §3 F4) ─────────────────────
    if (mode === "set-login-id") {
      const { profileId: idProfileId, email: nextEmailRaw } = body;
      if (!idProfileId) {
        return new Response(
          JSON.stringify({ error: "로그인 ID를 바꿀 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const nextEmail = resolveLoginEmail(nextEmailRaw, null, LOGIN_ID_DOMAIN);
      if (!nextEmail) {
        return new Response(
          JSON.stringify({ error: "로그인 ID에는 영문·숫자와 . _ - 만 쓸 수 있어요. 이메일 주소를 넣어도 됩니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: idCurrent } = await adminClient
        .from("profiles")
        .select("email")
        .eq("id", idProfileId)
        .maybeSingle();
      if (!idCurrent) {
        return new Response(
          JSON.stringify({ error: "계정을 찾을 수 없습니다." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // 같은 값이면 중복 검사에 자기 자신이 걸린다. 바꿀 것이 없으므로 그대로 성공으로 답한다.
      if (idCurrent.email === nextEmail) {
        return new Response(
          JSON.stringify({ success: true, email: nextEmail, unchanged: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: dupProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", nextEmail)
        .neq("id", idProfileId)
        .maybeSingle();
      if (dupProfile) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 로그인 ID입니다. (${nextEmail})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // auth.users 쪽 중복도 본다(프로필 없는 고아 auth 계정을 걸러낸다 — 전 페이지 순회, F2).
      const dupAuth = await findAuthUserByEmail(adminClient, nextEmail);
      if (dupAuth && dupAuth.id !== idProfileId) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 로그인 ID입니다. (${nextEmail})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Auth 를 먼저 바꾼다. 반대로 하면 목록에는 새 ID 가 보이는데 실제 로그인은 옛 ID 라
      // 화면이 거짓말을 한다("이 ID로 로그인하세요"가 통하지 않는다).
      const { error: authIdErr } = await adminClient.auth.admin.updateUserById(idProfileId, {
        email: nextEmail,
        email_confirm: true,
      });
      if (authIdErr) {
        console.error("set-login-id auth update failed:", authIdErr);
        const raw = authIdErr.message || "";
        const duplicate = raw.includes("already") || raw.includes("exists") || raw.includes("registered");
        return new Response(
          JSON.stringify({
            error: duplicate
              ? `이미 등록된 로그인 ID입니다. (${nextEmail})`
              : "로그인 ID를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          }),
          { status: duplicate ? 400 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: profIdErr } = await adminClient
        .from("profiles")
        .update({ email: nextEmail, updated_at: new Date().toISOString() })
        .eq("id", idProfileId);
      if (profIdErr) {
        console.error("set-login-id profile update failed:", profIdErr);
        // 실제 로그인 ID 는 이미 바뀌었다. 그 사실을 숨기면 관리자가 옛 ID 를 계속 전달한다.
        return new Response(
          JSON.stringify({
            error: `로그인 ID는 ${nextEmail} 로 바뀌었지만 목록 표시를 갱신하지 못했습니다. 새로고침 후 다시 확인해 주세요.`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, email: nextEmail }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 역할 변경 SME ↔ 관리자 (기획서 §3 F5) ─────────────────────
    //
    // DB 의 set_profile_role RPC 는 쓰지 않는다 — 그 함수에는 "마지막 관리자" 방어가 없다.
    // 같은 방어가 toggle-active·delete 와 함께 이 파일에서 읽히도록 여기서 처리한다.
    if (mode === "set-role") {
      const { profileId: roleProfileId, role: nextRole } = body;
      if (!roleProfileId) {
        return new Response(
          JSON.stringify({ error: "역할을 바꿀 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (nextRole !== "admin" && nextRole !== "sme") {
        return new Response(
          JSON.stringify({ error: "역할은 관리자 또는 SME 만 지정할 수 있습니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: roleTarget } = await adminClient
        .from("profiles")
        .select("role, active, company_id")
        .eq("id", roleProfileId)
        .maybeSingle();
      if (!roleTarget) {
        return new Response(
          JSON.stringify({ error: "계정을 찾을 수 없습니다." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (roleTarget.role === nextRole) {
        return new Response(
          JSON.stringify({ success: true, unchanged: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (nextRole === "sme") {
        // 자기 자신을 강등하면 그 즉시 이 화면에서 쫓겨나고 되돌릴 수도 없다.
        if (roleProfileId === callerUser.user.id) {
          return new Response(
            JSON.stringify({ error: "현재 로그인한 계정의 역할은 바꿀 수 없습니다." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (roleTarget.active && (await countActiveAdmins(adminClient)) <= 1) {
          return new Response(
            JSON.stringify({ error: "최소 1개의 활성 관리자 계정이 필요합니다." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        // 회사 없는 SME 는 배정이 만들어지지 않아 로그인해도 검토할 것이 없다.
        if (!roleTarget.company_id) {
          return new Response(
            JSON.stringify({
              error: "SME 로 바꾸려면 먼저 이 계정에 회사를 지정해 주세요. 회사가 없으면 검토 배정이 만들어지지 않습니다.",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const { error: roleErr } = await adminClient
        .from("profiles")
        .update({ role: nextRole, updated_at: new Date().toISOString() })
        .eq("id", roleProfileId);
      if (roleErr) {
        console.error("set-role failed:", roleErr);
        return new Response(
          JSON.stringify({ error: "역할을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 관리자 → SME 로 내렸으면 배정을 만들어 준다(계정 생성 경로와 같은 함수).
      // 실패해도 역할 변경을 되돌리지 않는다 — 배정은 /assignments-admin 에서 사후 조정할 수 있다.
      let assignmentsSynced: boolean | null = null;
      if (nextRole === "sme" && roleTarget.company_id) {
        const { error: roleSyncErr } = await adminClient.rpc("sync_sme_assignments", {
          p_sme_id: roleProfileId,
          p_company_id: roleTarget.company_id,
        });
        if (roleSyncErr) console.error("sync_sme_assignments after set-role failed:", roleSyncErr);
        assignmentsSynced = !roleSyncErr;
      }

      return new Response(
        JSON.stringify({ success: true, role: nextRole, assignmentsSynced }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 계정 게이트 플래그 (기획서 §3 F3·F7) ──────────────────────
    // must_change_password: 첫 로그인 비밀번호 변경 강제. reset_guide: 시작 가이드를 다시 보게 한다.
    if (mode === "set-flags") {
      const { profileId: flagProfileId, must_change_password: mustChange, reset_guide: resetGuide } = body;
      if (!flagProfileId) {
        return new Response(
          JSON.stringify({ error: "변경할 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const flagFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof mustChange === "boolean") flagFields.must_change_password = mustChange;
      if (resetGuide === true) flagFields.guide_completed_at = null;
      // 빈 호출을 성공으로 답하면 화면이 "적용했다"고 알리는데 아무것도 바뀌지 않는다.
      if (Object.keys(flagFields).length === 1) {
        return new Response(
          JSON.stringify({ error: "바꿀 항목이 없습니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: flagErr } = await adminClient.from("profiles").update(flagFields).eq("id", flagProfileId);
      if (flagErr) {
        console.error("set-flags failed:", flagErr);
        return new Response(
          JSON.stringify({ error: "계정 설정을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /*
     * ── 비밀번호 열람 (기획서 docs/PLAN_2026-09-04_IMPROVEMENT.md §2) ─────────
     *
     * 관리자가 "지금 이 계정의 비밀번호"를 다시 본다. 한 번에 한 계정만 받는다 — 목록 일괄
     * 열람을 만들면 화면 한 번에 전원 평문이 브라우저로 내려오고, 그 화면을 찍은 사진 한 장이
     * 전 계정 유출이 된다.
     *
     * 이 모드는 위의 관리자 검증(JWT → auth.getUser → profiles.role='admin' AND active)을
     * 이미 지난 자리에 있다. 그 위에 재인증을 한 겹 더 얹는다 — 자리를 비운 사이 열린 탭으로
     * 남의 비밀번호를 읽어 가는 것이 이 기능의 가장 현실적인 오용이다.
     *
     * 응답에는 값과 "언제 설정된 값인지"를 함께 보낸다. 앱을 지나지 않은 변경(재설정 메일 ·
     * 대시보드 · SQL 직접 UPDATE)이 확인되면 stale 이라 값 대신 사유를 보낸다.
     */
    if (mode === "reveal-password") {
      const { profileId: revealId, reauthPassword } = body;

      if (!revealId || typeof revealId !== "string") {
        return new Response(
          JSON.stringify({ error: "대상 계정을 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!VAULT_KEY_B64) {
        return new Response(
          JSON.stringify({
            error:
              "비밀번호 보관 기능이 아직 켜져 있지 않아요. Edge Function 시크릿에 PASSWORD_VAULT_KEY 를 등록해 주세요(docs/OPERATIONS.md).",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 재인증 — 호출자 본인의 비밀번호로 다시 로그인해 본다. 세션은 만들지 않는다.
      if (typeof reauthPassword !== "string" || !reauthPassword) {
        return new Response(
          JSON.stringify({ error: "본인 비밀번호를 입력해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const reauthClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: reauthErr } = await reauthClient.auth.signInWithPassword({
        email: callerUser.user.email as string,
        password: reauthPassword,
      });
      if (reauthErr) {
        return new Response(
          JSON.stringify({ error: "본인 비밀번호가 맞지 않아요." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: vaultRow, error: vaultErr } = await adminClient
        .from("account_password_vault")
        .select("ciphertext, source, stale, set_at")
        .eq("profile_id", revealId)
        .maybeSingle();

      if (vaultErr) {
        console.error("vault read failed:", vaultErr);
        return new Response(
          JSON.stringify({
            error:
              "보관된 비밀번호를 읽지 못했어요. APPLY_2026-09-04_password_vault.sql 이 적용됐는지 확인해 주세요.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!vaultRow) {
        return new Response(
          JSON.stringify({
            success: true,
            found: false,
            reason:
              "이 계정의 비밀번호는 보관 기능이 켜지기 전에 정해졌어요. 「임시 비밀번호 발급」으로 새 값을 만들면 그때부터 볼 수 있어요.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (vaultRow.stale) {
        return new Response(
          JSON.stringify({
            success: true,
            found: false,
            reason:
              "이 계정은 앱을 지나지 않은 경로로 비밀번호가 바뀌었어요(재설정 메일 · Supabase 대시보드 · SQL). 보관된 값은 더 이상 현재 비밀번호가 아니에요.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const plain = await decryptSecret(vaultRow.ciphertext as string);
      if (!plain) {
        return new Response(
          JSON.stringify({
            error: "보관된 값을 복호하지 못했어요. PASSWORD_VAULT_KEY 가 바뀌었을 수 있어요 — 비밀번호를 재발급해 주세요.",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          found: true,
          password: plain,
          source: vaultRow.source,
          setAt: vaultRow.set_at,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "check-auth") {
      // 프로필 id로 auth 사용자를 하나씩 확인한다(v2 F2 — listUsers 50건 상한 제거).
      // 이메일 일치는 판정에 쓰지 않는다: 앱의 로그인은 profiles.id = auth.uid()로만 프로필을 찾으므로
      // (App.tsx loadUser) 이메일만 같고 id가 다른 계정은 "로그인 가능"이 아니다(F3).
      const { data: allProfiles } = await adminClient
        .from("profiles")
        .select("id, email")
        .eq("role", "admin");
      const profiles = (allProfiles || []) as { id: string; email: string }[];
      const result = await Promise.all(
        profiles.map(async (p) => {
          const { data: found } = await adminClient.auth.admin.getUserById(p.id);
          return { id: p.id, email: p.email, hasAuth: Boolean(found?.user) };
        }),
      );
      return new Response(
        JSON.stringify({ success: true, profiles: result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /*
     * 모르는 모드는 여기서 끊는다.
     * 이 아래는 "관리자 계정 생성"이고, 모드 분기가 if 나열이라 예전에는 모르는 모드가
     * 전부 여기로 흘러내렸다. 구버전 함수가 배포된 채로 새 화면이 {mode:'set-password'} 를
     * 보내면 아는 모드가 없어 여기까지 오고, name·password 가 없으니 "이름, 이메일(또는
     * 로그인 ID), 비밀번호를 모두 입력해 주세요"를 400 으로 돌려준다 — 관리자는 비밀번호
     * 재발급을 눌렀는데 이름을 입력하라는 말을 듣고, 배포 문제라는 단서는 어디에도 없다.
     * 모드를 명시했는데 아는 모드가 아니면 그 사실을 그대로 알린다.
     */
    if (typeof mode === "string" && mode.trim()) {
      return new Response(
        JSON.stringify({
          error:
            `이 서버가 모르는 요청입니다(mode: ${mode}). 서버 기능이 최신 버전으로 배포되지 않았을 수 있어요. ` +
            `관리자에게 admin-create-user 재배포를 요청해 주세요.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Default mode: create new admin user
    // 이메일 칸은 로그인 ID 도 받는다('@' 없이 sme01 처럼 넣으면 도메인을 붙인다).
    if (!name || !password || !(typeof email === "string" && email.trim())) {
      return new Response(
        JSON.stringify({ error: "이름, 이메일(또는 로그인 ID), 비밀번호를 모두 입력해 주세요." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // 값은 있는데 로그인 ID 로 쓸 글자가 하나도 없는 경우(예: 한글만 입력)를 빈칸과 갈라 알린다.
    const normalizedEmail = resolveLoginEmail(email, null, LOGIN_ID_DOMAIN);
    if (!normalizedEmail) {
      return new Response(
        JSON.stringify({ error: "로그인 ID에는 영문·숫자와 . _ - 만 쓸 수 있어요. 이메일 주소를 넣어도 됩니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate password policy (정책은 passwordPolicyError 한 곳에만 있다 — 기획서 §3 F11)
    const createPolicyError = passwordPolicyError(password);
    if (createPolicyError) {
      return new Response(
        JSON.stringify({ error: createPolicyError }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check for duplicate email in profiles
    const { data: existing } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({ error: "이미 등록된 이메일입니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Also check auth.users for duplicate email (covers orphan auth users, 전 페이지 순회 — F2)
    const existingAuthUser = await findAuthUserByEmail(adminClient, normalizedEmail);
    if (existingAuthUser) {
      return new Response(
        JSON.stringify({ error: "이미 등록된 이메일입니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create auth user
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: name.trim() },
    });

    if (authErr || !authData?.user) {
      console.error("auth user creation failed:", authErr);
      const msg = authErr?.message || "관리자 계정 등록 중 오류가 발생했습니다.";
      // Check if it's a duplicate email error from auth
      if (msg.includes("already") || msg.includes("exists")) {
        return new Response(
          JSON.stringify({ error: "이미 등록된 이메일입니다." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "관리자 계정 등록 중 오류가 발생했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const newUserId = authData.user.id;

    // Insert profile with role = admin
    const { error: profileErr } = await adminClient.from("profiles").insert({
      id: newUserId,
      email: normalizedEmail,
      name: name.trim(),
      organization: "",
      title: "",
      role: "admin",
      active: true,
    });

    if (profileErr) {
      console.error("profile insert failed:", profileErr);
      // Rollback: delete the auth user
      await adminClient.auth.admin.deleteUser(newUserId);
      return new Response(
        JSON.stringify({ error: "관리자 계정 등록 중 오류가 발생했습니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 보관고에 남긴다(§2 W3). 관리자가 타이핑한 평문이 서버 지역변수로 들어오는 유일한 지점이다.
    const adminVaulted = await saveVaultEntry(adminClient, newUserId, password, "admin-create", callerUser.user.id);

    return new Response(
      JSON.stringify({ success: true, userId: newUserId, email: normalizedEmail, vaulted: adminVaulted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("admin-create-user exception:", err);
    return new Response(
      JSON.stringify({ error: "관리자 계정 등록 중 오류가 발생했습니다." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
