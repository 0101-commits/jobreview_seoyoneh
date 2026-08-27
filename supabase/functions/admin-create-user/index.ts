import { createClient } from "npm:@supabase/supabase-js@2";

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

    // ── Company Master CRUD ────────────────────────────────────
    if (mode === "companies-list") {
      const { data, error } = await adminClient
        .from("companies")
        .select("id, name, code, active, sort_order")
        .order("sort_order");
      if (error) {
        return new Response(
          JSON.stringify({ error: "회사 목록을 불러올 수 없습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true, companies: data || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "company-save") {
      const { id, name: compName, code, active: compActive, sortOrder } = body;
      if (!compName || !code) {
        return new Response(
          JSON.stringify({ error: "회사명과 코드를 입력해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (id) {
        const { error: updErr } = await adminClient
          .from("companies")
          .update({ name: compName.trim(), code: code.trim(), active: compActive, sort_order: sortOrder || 0, updated_at: new Date().toISOString() })
          .eq("id", id);
        if (updErr) {
          return new Response(
            JSON.stringify({ error: "회사 정보 수정 중 오류가 발생했습니다." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        const { error: insErr } = await adminClient
          .from("companies")
          .insert({ name: compName.trim(), code: code.trim(), active: compActive !== false, sort_order: sortOrder || 0 });
        if (insErr) {
          return new Response(
            JSON.stringify({ error: "회사 등록 중 오류가 발생했습니다." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "company-delete") {
      const { id: compId } = body;
      if (!compId) {
        return new Response(
          JSON.stringify({ error: "삭제할 회사를 지정해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { error: delErr } = await adminClient
        .from("companies")
        .delete()
        .eq("id", compId);
      if (delErr) {
        return new Response(
          JSON.stringify({ error: "회사 삭제 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SME batch creation from Excel upload ───────────────────
    if (mode === "create-sme") {
      const { sme: smeData } = body;
      // smeData: { name, email, password, company_id, organization, title, employee_number }
      if (!smeData || !smeData.email || !smeData.password || !smeData.name) {
        return new Response(
          JSON.stringify({ error: "이름, 이메일, 비밀번호를 모두 입력해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (smeData.password.length < 8 || !/[a-zA-Z]/.test(smeData.password) || !/[0-9]/.test(smeData.password)) {
        return new Response(
          JSON.stringify({ error: `비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요. (${smeData.email})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const normalizedSmeEmail = smeData.email.trim().toLowerCase();

      // Check for duplicate email in profiles
      const { data: existingSme } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", normalizedSmeEmail)
        .maybeSingle();
      if (existingSme) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 이메일입니다. (${smeData.email})` }),
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

      // Check auth.users for duplicate email
      const { data: existingSmeAuthList } = await adminClient.auth.admin.listUsers();
      const existingSmeAuth = (existingSmeAuthList?.users || []).find(
        (u) => u.email?.toLowerCase() === normalizedSmeEmail,
      );
      if (existingSmeAuth) {
        return new Response(
          JSON.stringify({ error: `이미 등록된 이메일입니다. (${smeData.email})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Create auth user
      const { data: smeAuthData, error: smeAuthErr } = await adminClient.auth.admin.createUser({
        email: normalizedSmeEmail,
        password: smeData.password,
        email_confirm: true,
        user_metadata: { name: smeData.name.trim() },
      });

      if (smeAuthErr || !smeAuthData?.user) {
        const msg = smeAuthErr?.message || "SME 계정 등록 중 오류가 발생했습니다.";
        if (msg.includes("already") || msg.includes("exists")) {
          return new Response(
            JSON.stringify({ error: `이미 등록된 이메일입니다. (${smeData.email})` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ error: `SME 계정 등록 중 오류가 발생했습니다. (${smeData.email})` }),
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
          JSON.stringify({ error: `SME 계정 등록 중 오류가 발생했습니다. (${smeData.email})` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Auto-create review assignments for all jobs in the SME's company
      if (smeData.company_id) {
        const { error: syncErr } = await adminClient.rpc("sync_sme_assignments", {
          p_sme_id: smeUserId,
          p_company_id: smeData.company_id,
        });
        if (syncErr) {
          console.error("sync_sme_assignments failed:", syncErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, userId: smeUserId }),
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
      // Return list of profile IDs that have a matching auth user
      const { data: allProfiles } = await adminClient
        .from("profiles")
        .select("id, email")
        .eq("role", "admin");
      const { data: authList } = await adminClient.auth.admin.listUsers();
      const authEmails = new Set((authList?.users || []).map((u) => u.email?.toLowerCase()));
      const authIds = new Set((authList?.users || []).map((u) => u.id));
      const result = (allProfiles || []).map((p: { id: string; email: string }) => ({
        id: p.id,
        email: p.email,
        hasAuth: authIds.has(p.id) || authEmails.has(p.email.toLowerCase()),
      }));
      return new Response(
        JSON.stringify({ success: true, profiles: result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "recreate-auth") {
      // Recreate auth user for an orphan profile (profile exists, auth user missing)
      const { profileId, email: pEmail, password: pPassword } = body;

      if (!pEmail || !pPassword) {
        return new Response(
          JSON.stringify({ error: "이메일과 비밀번호를 입력해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (pPassword.length < 8 || !/[a-zA-Z]/.test(pPassword) || !/[0-9]/.test(pPassword)) {
        return new Response(
          JSON.stringify({ error: "비밀번호는 8자 이상이며 영문과 숫자를 포함해 주세요." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const normalizedReEmail = pEmail.trim().toLowerCase();

      // Check if auth user already exists for this email
      const { data: existingList } = await adminClient.auth.admin.listUsers();
      const existingAuth = (existingList?.users || []).find(
        (u) => u.email?.toLowerCase() === normalizedReEmail,
      );

      let authId: string;

      if (existingAuth) {
        // Auth user exists — link it to the existing profile
        authId = existingAuth.id;
      } else {
        // Create new auth user
        const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
          email: normalizedReEmail,
          password: pPassword,
          email_confirm: true,
          user_metadata: { name: body.name || "" },
        });
        if (authErr || !authData?.user) {
          console.error("recreate-auth: createUser failed:", authErr);
          return new Response(
            JSON.stringify({ error: "로그인 계정 생성 중 오류가 발생했습니다." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        authId = authData.user.id;
      }

      // Update the existing profile to link to the auth user
      // If the profile ID matches the auth user ID, just update email
      // Otherwise we need to update the profile's id (which may conflict)
      // Simplest: update the profile row to have the correct email
      const { error: linkErr } = await adminClient
        .from("profiles")
        .update({ email: normalizedReEmail, updated_at: new Date().toISOString() })
        .eq("id", profileId);
      if (linkErr) {
        console.error("recreate-auth: profile update failed:", linkErr);
        return new Response(
          JSON.stringify({ error: "로그인 계정 연결 중 오류가 발생했습니다." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, authId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Default mode: create new admin user
    if (!name || !email || !password) {
      return new Response(
        JSON.stringify({ error: "이름, 이메일, 비밀번호를 모두 입력해 주세요." }),
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

    const normalizedEmail = email.trim().toLowerCase();

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

    // Also check auth.users for duplicate email (covers orphan auth users)
    const { data: existingAuthList } = await adminClient.auth.admin.listUsers();
    const existingAuthUser = (existingAuthList?.users || []).find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );
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
      JSON.stringify({ success: true, userId: newUserId }),
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
