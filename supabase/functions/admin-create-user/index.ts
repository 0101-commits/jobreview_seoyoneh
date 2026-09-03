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
 * 로그인 ID 도메인. .local 을 쓰는 이유 — 실제로 메일이 닿을 수 있는 도메인을 지어 쓰면
 * 리마인더 발송(send-reminder)이 남의 우편함으로 나간다. .local 은 인터넷으로 라우팅되지 않으므로
 * 그 사고가 구조적으로 막힌다. 운영 전환 때 바꿔야 하면 PILOT_LOGIN_DOMAIN 환경변수로 덮는다.
 */
const LOGIN_ID_DOMAIN = (Deno.env.get("PILOT_LOGIN_DOMAIN") || "seoyoneh.local").trim().toLowerCase();

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

    const body = await req.json();
    const { name, email, password, mode } = body;

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

      // tempPassword는 이 응답에만 있다. 화면은 관리자에게 1회 표시한 뒤 버린다(D1 ⓑ).
      return new Response(
        JSON.stringify({ success: true, userId: smeUserId, email: normalizedSmeEmail, tempPassword: smeTempPassword }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Update SME profile (including company assignment) ──────
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
      // Prevent deactivating last active admin
      if (!active) {
        const { count } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if ((count ?? 0) <= 1) {
          return new Response(
            JSON.stringify({ error: "최소 1개의 활성 관리자 계정이 필요합니다." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
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
        const { count } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);
        if ((count ?? 0) <= 1) {
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

    // Validate password policy
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return new Response(
        JSON.stringify({ error: "비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요." }),
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

    return new Response(
      JSON.stringify({ success: true, userId: newUserId, email: normalizedEmail }),
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
