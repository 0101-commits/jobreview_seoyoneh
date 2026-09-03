# 관리자 전권 기획서 — "관리자 페이지에서 모든 것을 설정할 수 있어야 한다"

**요구 원문(2026-09-03)**

> 관리자 페이지에서는 모든 것을 설정할 수 있어야 함. 예를 들면, SME 비밀번호도 볼 수 있다던지,
> 수정할 수 있다던지 등 모든 페이지 관리 권한이 있어야 함.

**이 문서의 확인 수준**

- 아래 「현황 감사」의 `파일:줄`은 전부 이 저장소의 실제 코드를 읽어 적었다(기준 커밋 `e52ffd5`).
- **Supabase 실물에 붙여 확인한 항목은 하나도 없다.** 이 문서가 정하는 것은 설계와 범위이고,
  동작 확인은 §7 점검표와 `docs/PILOT.md`에서 한다.
- 요구 중 **한 가지는 기술적으로 불가능하다**(§2 — 평문 비밀번호 열람). 판정 근거와 대체안을
  같은 절에 적었다. 나머지는 전부 이번 범위에 넣었다.

---

## 1. 현황 감사 — 관리자가 지금 못 하는 것

관리자 화면은 13개 메뉴가 있고(`src/App.tsx:84` `adminNav`), 운영 설정·업로드·승인/반려는 이미
관리자 전권이다. 못 하는 것만 모으면 아래와 같다.

| # | 관리자가 하고 싶은 것 | 지금 상태 | 근거 |
|---|---|---|---|
| A1 | SME 비밀번호 **열람** | **불가(기술적으로)** | 비밀번호는 Supabase Auth(`auth.users.encrypted_password`)에 해시로만 있다. 앱은 평문을 어디에도 저장하지 않는다 — 계정 생성 시 만든 임시 비밀번호도 응답 1회로만 흘리고 버린다(`supabase/functions/admin-create-user/index.ts:26` 주석, `src/components/modals/SmeSingleCreateModal.tsx:69`) |
| A2 | SME 비밀번호 **재설정** | **경로 자체가 없다** | `SmeManageButton`에 비밀번호 블록이 없다. Edge Function에도 비밀번호를 바꾸는 모드가 없다 — 모드는 `create-sme`·`update-sme`·`update`·`toggle-active`·`delete`·`check-auth` 6종뿐이다(`index.ts:117,249,280,299,339,410`) |
| A3 | 관리자 비밀번호 **재설정** | 반쪽 — 메일이 닿지 않는 계정에서는 실패한다 | `resetPasswordForEmail`만 있다(`src/components/AdminUsersPage.tsx:429`). 파일럿 계정의 로그인 ID는 `…@seoyoneh.local`이고 이 도메인은 **인터넷으로 라우팅되지 않는다**(`index.ts:52` `LOGIN_ID_DOMAIN`) — 재설정 메일이 영영 도착하지 않는다 |
| A4 | 로그인 ID(이메일) **변경** | 불가 | 두 화면 모두 "이메일은 변경할 수 없어요"로 잠가 놓았다(`AdminUsersPage.tsx:482`, `SmeManageButton.tsx:150`) |
| A5 | SME **활성/비활성** | 불가 | 서버 모드(`toggle-active`)는 있는데 부르는 화면이 관리자 계정 쪽뿐이다(`AdminUsersPage.tsx:413`). SME 관리 모달에는 삭제만 있다 |
| A6 | 역할 변경(SME ↔ 관리자) | 불가 | DB에 `set_profile_role` RPC가 있으나 **클라이언트에서 한 번도 부르지 않는다**(`grep -rn set_profile_role src/` → 0건). 게다가 이 RPC에는 "마지막 관리자" 방어가 없다(`20260813034113_20260813120000_secure_role_based_login.sql.sql:51-70`) |
| A7 | 첫 로그인 비밀번호 변경 강제(`must_change_password`) 조작 | 불가 | 계정 생성 때 `DEFAULT true`로 걸리고 본인이 풀면 끝이다. 관리자가 다시 걸 수 없다(`20260901010000_phase0_security_baseline.sql:66`) |
| A8 | 시작 가이드 이수(`guide_completed_at`) 초기화 | 불가 | SME 본인만 기록한다 — 컬럼 단위 GRANT가 본인 UPDATE만 열어 준다(`20260901020000_phase1_survey_schema.sql:368`). 관리자가 다시 보게 할 방법이 없다 |
| A9 | 관리자 계정의 회사·조직·직급·사번 수정 | 불가 | 관리자 관리 모달은 **이름만** 고친다(`AdminUsersPage.tsx` `handleSaveName` → `mode:'update'`, `index.ts:280`에서 `name`만 UPDATE) |
| A10 | 회사(계열사) 추가·수정·활성 | **화면이 아예 없다** | `companies`를 쓰는 코드는 조회 3곳뿐이다(`src/App.tsx:266`, `src/lib/jobApi.ts:82`, `src/pages/SmeUsersPage.tsx:115`). 삽입·수정은 seed SQL이 유일한 경로다(`20260812153755_create_companies_table.sql:51`) — 계열사를 하나 늘리려면 SQL Editor를 열어야 한다 |

### 왜 화면에서 직접 고칠 수 없나 — profiles의 컬럼 단위 권한

`profiles`는 `REVOKE UPDATE` 후 컬럼 단위로만 열려 있다. 지금 `authenticated`에게 열린 컬럼은
**`name`·`must_change_password`·`guide_completed_at` 셋뿐**이다
(`20260902040000_v2_phaseA_recovery.sql:32-39`). RLS 정책(`profile_self_or_admin_update`)이
관리자를 통과시켜도 `company_id`·`organization`·`title`·`active`·`employee_number`·`role`은
권한 층에서 막힌다.

**그래서 이번 변경도 화면에서 직접 UPDATE 하지 않는다.** 기존 설계와 같이 Edge Function
(service_role)을 거친다. 컬럼 GRANT를 넓히면 SME 계정 하나로 자기 회사·소속·활성 상태를 바꿀 수
있게 되므로(정책은 본인 행 UPDATE를 허용한다) **권한을 넓히는 방향은 채택하지 않는다.**

---

## 2. A1 판정 — 평문 비밀번호는 볼 수 없다

**결론: 열람 기능은 만들지 않는다. 만들 수 없다.**

- Supabase Auth는 비밀번호를 해시로만 보관한다. Admin API에도 평문을 돌려주는 호출이 없다
  (`auth.admin.getUserById`는 해시조차 주지 않는다).
- 앱이 따로 평문을 적어 두고 있지도 않다. 임시 비밀번호는 서버가 만들어 HTTP 응답 1회로만 넘기고
  DB에는 남기지 않는다(`index.ts:26-33` 주석의 설계 의도 그대로다).
- 평문을 볼 수 있게 만들려면 **비밀번호를 평문(또는 복호 가능한 형태)으로 따로 저장**해야 한다.
  그건 계정 탈취 1건이 전 사용자 비밀번호 유출로 번지는 구조이고, §8 S2·S6와 정면으로 어긋난다.
  이번 범위에서 하지 않는다.

**대체안 — "볼 수 있다"가 실제로 필요했던 일을 그대로 해결한다.**

관리자가 비밀번호를 보려는 이유는 사실상 하나다: *SME가 못 들어온다고 연락했을 때 지금 당장
들어가게 해 주는 것.* 그건 열람이 아니라 **재발급**으로 끝난다. 그래서 둘을 만든다.

- **임시 비밀번호 재발급** — 서버가 만들고, 그 화면에 한 번 보여 준다(계정 생성과 같은 방식·같은 UI).
- **비밀번호 직접 지정** — 관리자가 값을 입력해 그대로 넣는다. 전화로 읽어 줘야 할 때 쓴다.

둘 다 끝나면 대상 계정에 `must_change_password = true`가 걸려 **본인이 첫 로그인에서 다시 바꾼다**
(기본값. 관리자가 체크를 풀면 걸지 않는다). 즉 관리자가 아는 값은 "지금 한 번 들어갈 값"이고
그 이후의 비밀번호는 여전히 본인만 안다.

---

## 3. 만들 것 (F1~F11)

| 기능 | 무엇 | 어디 |
|---|---|---|
| **F1** | 비밀번호 임시 재발급 — 서버 생성값 1회 표시 | SME·관리자 관리 모달 |
| **F2** | 비밀번호 직접 지정 — 10자 이상 + 영문 + 숫자 | SME·관리자 관리 모달 |
| **F3** | 재발급/지정 시 `must_change_password` 걸기(기본 켬, 끌 수 있음) | 같은 블록의 체크박스 |
| **F4** | 로그인 ID(이메일) 변경 — Auth·profiles 동시 갱신, 중복 검사 | SME·관리자 관리 모달 |
| **F5** | 역할 변경 SME ↔ 관리자 — 마지막 관리자 방어 포함 | SME·관리자 관리 모달 |
| **F6** | 활성/비활성 토글을 SME에도 | SME 관리 모달 |
| **F7** | 시작 가이드 이수 초기화 | SME 관리 모달 |
| **F8** | 관리자 계정의 회사·조직·직급·사번 수정 | 관리자 관리 모달 |
| **F9** | 계열사 관리 — 추가 · 이름/코드/표시순서 수정 · 활성 토글 | 운영 설정(`/settings`) 안의 새 섹션 |
| **F10** | 위 조작 전부 `audit_logs`에 남긴다 | `src/lib/auditApi.ts` 경유 |
| **F11** | 비밀번호 정책을 서버 한 곳으로 통일(10자 이상 + 영문 + 숫자) | Edge Function |

### F11 — 정책 숫자가 지금 두 개다

`ChangePasswordPage`는 **10자**(`src/pages/ChangePasswordPage.tsx:15` `MIN_LENGTH = 10`),
Edge Function의 관리자 생성은 **8자**를 요구한다(`index.ts` 기본 분기). 관리자가 8자로 지정한
비밀번호는 본인이 바꾸려는 순간 "10자 이상" 요구를 받는다 — 같은 시스템이 같은 값을 두 기준으로
판정한다. **10자로 통일한다**(느슨한 쪽으로 맞추지 않는다). §8 S2의 "길이 10+ 권장"이 기준이다.
영향: 앞으로 관리자 계정을 8~9자 비밀번호로는 만들 수 없다. 기존 계정은 영향 없다.

### 화면 배치 — 새 메뉴를 만들지 않는다

계정 조작은 **이미 있는 두 관리 모달 안에서** 끝낸다(`SME 계정 관리` 행의 「관리」,
`관리자 계정 관리` 행의 「관리」). 새 메뉴를 만들면 "계정을 고치려면 어디로 가야 하나"가 두 곳으로
갈린다. 계열사만 화면이 없으므로 `/settings` 안에 섹션으로 붙인다 — 운영 설정 화면이 이미
"이 회사 하나"를 고르는 화면이라 계열사 목록이 같은 자리에 있는 편이 읽힌다.

두 모달이 같은 조작(비밀번호·로그인 ID·역할·상태·게이트)을 갖게 되므로 그 블록은 **공용 컴포넌트
하나**로 만든다(`src/components/modals/AccountAdminPanel.tsx`). 같은 UI를 두 파일에 복붙하면
한쪽만 고쳐지는 사고가 난다 — `edgeApi.ts`를 만든 이유와 같다.

---

## 4. 서버 변경 — Edge Function 새 모드 4개

`supabase/functions/admin-create-user/index.ts`에 아래를 더한다. 기존 6개 모드의 동작은 바꾸지 않는다
(`update-sme`만 **모든 역할에 쓸 수 있게** 쓰임을 넓힌다 — 코드는 이미 `role`을 보지 않는다).

| 모드 | 입력 | 하는 일 | 방어 |
|---|---|---|---|
| `set-password` | `profileId`, `password?`, `forceChange?` | `password`가 있으면 그 값으로, 없으면 서버가 임시값을 만들어 `auth.admin.updateUserById`. 그다음 `profiles.must_change_password = forceChange ?? true` | 정책 검사(10자 + 영문 + 숫자). 대상 auth 계정이 없으면 404로 명시한다 — 프로필만 있는 고아 계정(`check-auth`가 보여 주는 그 상태)에서 "성공"으로 답하면 관리자가 없는 비밀번호를 전달한다 |
| `set-login-id` | `profileId`, `email` | `resolveLoginEmail`로 정규화 → `profiles`·`auth.users` 중복 검사 → `auth.admin.updateUserById({email, email_confirm:true})` → `profiles.email` 갱신 | 정규화 결과가 비면 400, 중복이면 400. **Auth를 먼저 바꾸고 profiles를 나중에** 바꾼다 — 반대로 하면 profiles만 바뀌고 실제 로그인 ID는 그대로여서 화면이 거짓말을 한다 |
| `set-role` | `profileId`, `role` | `profiles.role` 갱신 | `admin`·`sme`만 허용. 자기 자신은 강등 불가. 마지막 활성 관리자 강등 불가(`toggle-active`·`delete`와 같은 카운트 방어). `sme`로 내릴 때 `company_id`가 없으면 400 — 회사 없는 SME는 배정이 만들어지지 않는다 |
| `set-flags` | `profileId`, `must_change_password?`, `reset_guide?` | 넘어온 것만 갱신. `reset_guide`면 `guide_completed_at = null` | 둘 다 안 넘어오면 400(빈 호출을 성공으로 답하지 않는다) |

**왜 `set_profile_role` RPC를 쓰지 않나** — 그 함수에는 마지막 관리자 방어가 없다(§1 A6).
Edge Function에는 이미 같은 방어가 두 곳에 있어(`index.ts:299` `toggle-active`, `:339` `delete`)
세 번째 조작도 같은 자리에 두면 방어를 한 파일에서 읽을 수 있다. RPC는 그대로 남겨 둔다 —
지우면 SQL로 직접 고치는 복구 경로가 사라진다.

**마이그레이션은 없다.** 위 조작은 전부 service_role로 도는 Edge Function이 하므로 RLS·컬럼 GRANT를
건드릴 필요가 없다. 계열사(F9)는 `companies`에 관리자용 INSERT/UPDATE 정책이 이미 있다
(`20260812153755_create_companies_table.sql:38-48`) — 화면에서 바로 쓴다.
**단, Edge Function은 재배포해야 한다** — `supabase functions deploy admin-create-user`.

---

## 5. 계열사 관리(F9) — 삭제는 넣지 않는다

`companies`를 참조하는 외래키가 여러 갈래다(`profiles.company_id`, `jobs.company_id`,
`survey_settings.company_id` …). 사람이 쓰는 화면에서 하드 삭제를 누르면 대부분 FK 위반으로 실패하고,
성공하는 경우가 오히려 위험하다(그 회사의 직무·계정·설정이 함께 사라진다).
그래서 **활성 토글(`active`)만 둔다.** 비활성 계열사는 `fetchCompaniesResult`가 이미 걸러 내므로
(`src/lib/jobApi.ts:85` `.eq('active', true)`) 선택 목록에서 사라진다. 실제 삭제가 필요하면
`supabase/CHECK_2026-09-03_single_company.sql` 계열의 SQL 절차로 한다.

구현 위치는 `src/components/settings/CompanyAdminSection.tsx`이고 `/settings` 화면의 **회사 선택
바깥**에 붙인다. 회사가 0건이면 운영 설정 폼 자체가 열리지 않으므로(「회사를 먼저 선택해 주세요」)
선택 안쪽에 두면 첫 회사를 만들 방법이 사라진다. 회사를 추가·비활성하면 같은 화면의 회사
드롭다운도 함께 다시 읽는다(`loadCompanies`). 고르고 있던 회사가 비활성으로 바뀌면 첫 활성 회사로
옮긴다 — 목록에 없는 회사를 붙들고 있으면 이름이 빈 채로 남의 설정을 고치는 것처럼 보인다.

---

## 6. 보안·감사

- **권한 검증은 그대로다.** 새 모드도 기존 진입부의 검증을 지난다 — JWT → `auth.getUser` →
  `profiles.role='admin' AND active`(`index.ts:87-110`). 이 검증 앞에는 모드 분기가 없다.
- **감사 로그**(§8 S5 · F10) — `edgeApi.ts`의 `planAccountAudit`에 새 행위를 더한다:
  `PASSWORD_RESET_BY_ADMIN` · `LOGIN_ID_CHANGED` · `ROLE_CHANGED` · `ACCOUNT_FLAGS_CHANGED`.
  `actor_id`는 `log_audit`이 `auth.uid()`로 강제하므로 사칭이 불가능하다(기존 주석 그대로).
- **meta에 개인정보를 넣지 않는다**(§8 S6). 비밀번호 값은 물론이고 새 로그인 ID도 넣지 않는다 —
  대상 `entity_id`(profile id)와 "무엇이 바뀌었는지"만 남긴다. 역할 변경만 `to`를 남긴다
  (권한 변동은 값 자체가 감사 대상이다).
- **비밀번호 값의 수명** — 임시 재발급값은 응답 → 화면 상태 → 모달 닫힘까지다. 저장·로그·감사에 없다.
  직접 지정값은 전송 후 화면 상태에서만 살고 제출 뒤 비운다.
- **자기 자신 방어** — 자기 계정의 강등·비활성·삭제는 계속 막는다. 다만 **자기 비밀번호 지정·로그인 ID
  변경은 막지 않는다**(자기 계정 위생이며 권한 상승이 아니다).

---

## 7. 점검(DoD)

- [x] `npm run typecheck` · `npx eslint .`(오류 0, 경고 23건은 전부 기존 파일의 react-refresh 경고) ·
      `npm run build` · `npm test`(35 tests) 통과 — 2026-09-03 실행
- [ ] **Edge Function 재배포** `supabase functions deploy admin-create-user` — 이걸 빼면 새 모드가
      404로 떨어지고 화면에는 "서버 기능을 찾을 수 없어요"만 뜬다
- 아래 항목은 **실제 Supabase에 붙여 확인해야 하는 것들이다. 아직 하나도 확인하지 않았다.**
- [ ] SME 관리 모달에서 임시 비밀번호 재발급 → 표시된 값으로 그 SME 로그인 → 비밀번호 변경 화면이 뜬다
- [ ] 비밀번호 직접 지정 9자 입력 → 저장 거절 + 사유 표기, 10자 → 통과
- [ ] `must_change_password` 체크를 풀고 재발급 → 그 값으로 로그인해 바로 검토 화면에 들어간다
- [ ] 로그인 ID를 이미 있는 값으로 변경 → 거절 + "이미 등록된 로그인 ID" 문구
- [ ] 로그인 ID 변경 후 **새 ID로 로그인된다**(기존 ID로는 안 된다)
- [ ] 관리자 1명뿐인 상태에서 그 관리자를 SME로 강등 → 거절 + "최소 1개의 활성 관리자" 문구
- [ ] SME → 관리자 승격 후 그 계정으로 관리자 메뉴가 보인다
- [ ] 가이드 이수 초기화 후 그 SME 로그인 → 가이드 화면이 다시 뜬다
- [ ] 계열사 추가 → SME 개별 추가 모달의 회사 목록에 나온다 / 비활성 → 사라진다
- [ ] `audit_logs`에 위 조작이 행위별로 한 줄씩 남는다

---

## 8. 이번 범위에 넣지 않은 것 (그리고 왜)

- **SME 응답 데이터의 관리자 직접 편집** — 관리자는 응답 행을 UPDATE 할 수는 있지만 INSERT는
  못 하고(`reviews_owner_insert`·`job_feedback_owner_insert` … 소유자 전용),
  `task_fte_allocations`는 SELECT만 있다(`20260901020000_phase1_survey_schema.sql:155-175`).
  즉 "관리자가 SME 대신 응답을 채운다"는 정책 4~5개와 제출 게이트·잠금 트리거를 함께 풀어야 한다.
  그리고 그렇게 채운 값은 **SME의 응답이 아니다** — E1~E5 산출물과 워크숍 판정의 근거가 흐려진다.
  필요하다면 별건으로, "관리자 대행 입력"을 응답 원본과 구분해 기록하는 설계부터 정해야 한다.
  지금 쓰는 경로는 승인/반려·재검토 요청이다.
- **비밀번호 평문 열람** — §2. 저장 구조를 바꿔야 하고 그 방향은 채택하지 않는다.
- **조직 트리(`org_units`) 화면 편집** — 통합 업로드 시트 ③이 유일한 입력 경로다
  (`src/lib/integratedJobApi.ts:85` `save_org_units`). 조직도는 고객 TF 입수분을 그대로 싣는
  자료라(§12 이슈 2) 화면에서 한 줄씩 고치는 것이 맞는지가 먼저 결정될 문제다.
- **계열사 하드 삭제** — §5.
