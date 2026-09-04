# 오픈 이슈 정리 — PLAN §12 8건

**이 문서의 용도**: 개편(Phase 0~5)과 그 뒤의 후속 작업에서 §12의 오픈 이슈 8건에 대해 **코드가 무엇을 이미 처리했고, 무엇이 아직 사람의 결정으로 남았는지**를 한 곳에 모은 것입니다. 후속 작업으로 달라진 두 곳(이슈 3의 배정 관리 화면, §8 S5의 감사 로그 보강)은 각 절에 「이번 후속에서」로 표시했습니다.

**이 문서가 하지 않는 것**: 결정을 대신하지 않습니다. §12는 각 이슈의 확인 주체를 지정하고 있고(파일럿 결과 / 고객 TF / PM(상무) / HCG IT / 사용자), 그 주체가 정할 값은 여기서도 빈칸으로 둡니다. 코드에 들어간 값이 있다면 그것은 **잠정 기본값**이며, 어느 파일 어느 줄에서 바꾸는지를 함께 적었습니다.

**근거 표기**: `파일:줄`은 이 저장소의 `revamp/followup` 브랜치 기준입니다. 코드가 바뀌면 줄 번호는 어긋날 수 있으니 함수·상수 이름을 함께 적었습니다.

**검증 상태**: 아래 "코드에서 실제로 처리한 것"은 전부 코드를 읽어 확인한 사실입니다. **실행해 본 것은 `npm run typecheck` / `npx eslint` / `npm run build` 세 가지뿐**이며, Supabase에 붙여 동작을 확인한 항목은 하나도 없습니다. 동작 확인은 `docs/PILOT.md`의 체크리스트에서 합니다.

---

## 한눈에 보기

| # | 이슈 | 확인 주체(§12) | 코드 상태 | 남은 것 |
|---|---|---|---|---|
| 1 | 직무당 예상 소요 ○○분 | 파일럿 결과 | 실측·표시·비교 안내까지 구현 | 실측값 자체(데이터 없음) → 파일럿 후 설정 반영 |
| 2 | 조직 마스터 입수 | 고객 TF | 업로드 시트·조직축 집계·Export + `profiles.org_unit_id` 연결 구현 | 조직도 입수 시점·형식(자료가 없음) |
| 3 | SME 배정 예외 처리 | PM(상무) | 1인 직무 = 자동 워크숍 후보 · 명부로 직무를 골라 배정 · **`/assignments-admin` 배정 관리 화면(R6 배지 · 추가 · 해제)** | 자동 전 직무 배정(`sync_sme_assignments`)은 그대로다 — 화면은 사후 정리만 한다. **배정 상한·겸직 원칙이 미확정이라 화면도 3명째를 막지 않고 경고만 한다** |
| 4 | 메일 발신 도메인 | HCG IT | 시뮬레이션 모드로 완결, 실발송 경로 구현 | 인증 도메인·SPF/DKIM·`RESEND_FROM` 값 |
| 5 | 워크숍 플래그 임계값 | PM(상무) | 4개 값 전부 상수 파일 1곳으로 분리 | 값 확정(현재는 기획안 가설값) |
| 6 | 데이터 보존·파기 | PM(상무)·TF | 없음(문서 항목) | 리전·보존 기간·파기 시점·이관 범위 전부 미정 |
| 7 | 참고 레포 AI 검토 보조 이식 | 사용자 | 없음(코드 0줄) | 도입 여부 판단 |
| 8 | 기존 응답 데이터 존재 여부 | 사용자 | 수동 스냅샷 Export 구현 | 운영 DB에 기존 응답이 있는지 확인 |

---

## 1. 직무당 예상 소요 ○○분

**기획안 원문 요약** — 착수보고 11면 "현업 SME 1인당 예상 소요: 직무당 약 ○○분 수준(착수 후 확정)". 파일럿(P5) 실측 중앙값으로 확정한 뒤 착수보고·가이드 문구에 반영한다. 확인 주체 = **파일럿 결과**.

**코드에서 실제로 처리한 것**

- 소요 실측 집계기 `src/lib/durationApi.ts` — `review_sessions`의 체류 구간을 검토별·(검토,단계)별로 합산하고(`sumSessions`, `src/lib/durationApi.ts:219`) 중앙값을 낸다(`median`, `:196`). 진입점은 `fetchDurationStats`(`:264`) 하나이고, 나머지는 모듈 내부 함수다.
- 집계 규칙 3가지를 상수·주석으로 고정: ① 열린 구간(`ended_at` 없음)은 세지 않고 전 구간이 열린 검토는 분모에서도 뺀다(0으로 세지 않고 `missingRecordCount`로 따로 보고) ② 한 구간 상한 `SESSION_CAP_MINUTES = 60`분(`src/lib/durationApi.ts:54`) ③ `ended_at < started_at`은 폐기.
- 관리자 대시보드에 카드 노출 — `DurationCard`(`src/pages/DashboardPage.tsx:99`), 배치는 `:529`. 옆칸에 운영 설정 `expected_minutes`와의 차이를 분 단위로 보여 주고 `/settings` 링크를 건다. 계열사 '전체'라 설정을 안 읽은 것과 설정 조회가 실패한 것은 다른 문구로 가른다(`ExpectedSource`, `src/lib/durationApi.ts:106`) — 조회 실패를 "설정이 비어 있음"으로 보여 주지 않기 위해서다.
- 표본이 `MIN_SAMPLE = 3`(`src/lib/durationApi.ts:63`) 미만이면 숫자를 내지 않고 "표본 부족"으로 표시한다. **이 3이라는 값은 기획안에 없다** — 이 저장소가 정한 잠정 기준이며 근거는 같은 파일 주석에 있다.
- SME에게는 보이지 않는다. `durationApi`가 `profiles.role`을 직접 확인해 관리자가 아니면 `data: null`을 돌려주고, 카드는 그리지 않는다(§6-1 "실측치는 관리자 화면에서만 노출 — SME 압박 방지").
- 같은 규칙의 수치가 Export E5 '소요 실측 요약' 시트에도 나간다(`src/lib/exportApi.ts:457` 이하 `loadDurations`, 시트 조립은 `:1310` 이하). **다만 두 곳의 표본 모집단이 완전히 같지는 않다 — 아래 「알려진 정합성 부채」 참고.**

**남은 결정 주체** — 파일럿 결과(값 자체). 설정 반영 조작은 PM·관리자.

**남은 작업**

1. 파일럿에서 제출 검토를 **3건 이상** 만든다. 그 미만이면 카드가 계속 "표본 부족"으로 뜬다 — 고장이 아니다.
2. 실측 중앙값을 `/settings`의 「직무당 예상 소요(분)」에 입력한다. 이 값이 시작 가이드 문장과 메일 템플릿 `{{예상소요}}`의 원천이다.
3. 착수보고 11면의 "○○분"을 같은 값으로 채운다(문서 작업 — 이 저장소 밖).
4. **미확인 — 파일럿에서 확인**: 실제 Supabase 조회 경로(관리자 RLS 하 `review_sessions` 조회, 청크·페이지 동작)와 화면 렌더는 실행해 보지 못했다. 실측 중앙값 자체는 데이터가 없어 값 없음 — "착수 후 확정".

**알려진 정합성 부채** — 같은 집계가 `src/lib/exportApi.ts`(`loadDurations` / `median` / `SESSION_CAP_MINUTES`)와 `src/lib/durationApi.ts` 두 곳에 있다. 규칙·상한·표본 기준을 같은 값으로 맞춰 두었으나 `exportApi` 쪽 심볼이 모듈 비공개라 import로 합치지 못했다. **후속 정리 권고**: `exportApi.ts`의 세 심볼에 `export`를 붙이고 `durationApi`가 그것을 import하게 한다. 지금 상태에서 한쪽만 고치면 대시보드 카드와 E5 파일이 서로 다른 수를 말하게 된다.

**같지 않은 것 — 표본 모집단**. 계산 규칙(①②③ · 60분 상한 · 검토별 합계 · 중앙값 정의 · `isComparableReview` 상태 기준)은 두 곳이 같지만, **어떤 검토를 세느냐가 다르다.** 두 값이 어긋났다고 곧바로 "계산이 갈라졌다"고 읽으면 안 된다.

| | 대시보드 카드 | Export E5 `전체` 행 |
|---|---|---|
| 검토 목록의 출처 | `get_review_status` RPC (`src/lib/jobApi.ts:494`) | `loadScope` (`src/lib/exportApi.ts:308-324`) |
| SME 계정이 비활성이면 | **빠진다** (`p.active = true`, `supabase/APPLY_2026-08-28.sql:467`) | **들어간다** (`review_assignments.active`·`jobs.active`만 본다) |
| 계열사 필터의 기준 | SME 프로필의 회사(`p.company_id`, `:468`) | 직무의 회사(`jobs.company_id`, `:322`) |
| 표본 판정 | `isComparableReview(status)` | `isComparableReview(status) \|\| approved_at 있음` (`:1419`) |

세 번째 줄은 `sync_sme_assignments`가 SME 회사의 직무만 배정하므로 실무상 같은 결과가 되고, 네 번째 줄은 `approved_at`이 `SUBMITTED`/`RESUBMITTED`에서만 찍히므로(승인은 상태를 바꾸지 않는다) 지금 코드에서는 결과가 같다. **실제로 갈라지는 것은 두 번째 줄이다** — SME 계정을 비활성화한 뒤에는 그 사람의 제출 검토가 E5에는 남고 대시보드에서는 빠져, 두 중앙값이 정당하게 달라진다.

**후속 정리 권고(2)**: 둘 중 하나를 기준으로 정한다. 감사·계약 산출물의 기준은 E5이므로 대시보드를 E5 모집단에 맞추는 편이 자연스럽다. 이번 Phase 범위 밖이라 문서로만 남긴다.

---

## 2. 조직 마스터 입수

**기획안 원문 요약** — 고객 조직도(조직코드 체계 포함)의 입수 시점·형식. 업로드 시트 ③의 선행 조건이며, 미입수 시 임시 코드로 개시한 뒤 매핑을 교체할 수 있으나 이중 작업이 발생한다. 확인 주체 = **고객 TF**.

**코드에서 실제로 처리한 것**

- 업로드 양식에 조직 마스터 시트가 있다 — 시트명 `조직 마스터`(`src/lib/integratedUploadUtils.ts:16`), 헤더 `조직코드 / 조직명 / 상위조직코드`(`:34`). **선택 시트**라 없어도 업로드는 진행된다(같은 파일 `:11` 주석).
- SME 명부 시트(`성명 / 이메일 / 조직코드 / 직급 / 배정직무`, `:36`)의 조직코드는 조직 마스터가 함께 올라와야만 검증된다. 명부만 올리면 "'조직 마스터' Sheet도 함께 넣어 주세요"로 막는다(`:299`) — 확인할 수 없는 조직코드를 통과시키지 않기 위해서다.
- `profiles.org_unit_id`를 채우는 경로가 Phase 5에서 생겼다 — SME 명부의 조직코드를 `org_units`로 풀어 연결한다(`link_sme_roster`, `src/lib/integratedJobApi.ts:207`). 그전까지 이 컬럼은 쓰는 코드가 없어 항상 NULL이었다.
- 조직축 집계·Export가 조직 마스터 없이도 깨지지 않는다. 조직 미지정 행은 버리지 않고 '조직 미지정'으로 모은다(`src/lib/exportApi.ts:292`, E1 조직 열은 `:606-608`).
- 조직 트리는 수동 스냅샷 대상에 들어 있다(`src/lib/snapshotApi.ts`의 `SNAPSHOT_TABLES` 중 `org_units`).

**남은 결정 주체** — 고객 TF.

**남은 작업**

1. 조직도(조직코드 체계 포함)의 **입수 시점과 형식**을 고객 TF와 확정한다. 이 저장소가 정할 수 없다.
2. 임시 코드로 먼저 개시할지 결정한다. 임시 코드로 시작하면 나중에 `org_units.code` 교체 + `profiles.org_unit_id` 재매핑이 필요하다(§12가 말한 이중 작업). **재매핑 쪽은 Phase 5에서 생겼다** — 조직코드를 고친 조직 마스터·SME 명부를 다시 올리면 `link_sme_roster`가 `org_unit_id`를 새 값으로 덮어쓴다(멱등). **`org_units.code` 자체를 갈아 끼우는 절차(옛 코드 행의 처리)는 여전히 없다** — 임시 코드로 개시하기로 정하면 그때 만들어야 한다.
3. §9 E2(직무×조직 피벗)가 계약 1-(4)의 검수 기준이므로, 조직 마스터가 비어 있으면 E2가 조직축 없이 산출된다는 점을 TF와 공유한다.

---

## 3. SME 배정 예외 처리 — ⚠️ 코드와 기획안이 어긋나는 항목

**기획안 원문 요약** — 겸직 직무(1인이 2개 직무 배정)와 SME 1인뿐인 직무의 취급. 후자는 자동 워크숍 후보 규칙에 이미 포함(§6-3ⓑ). 배정 상한·기준 문서화 권장. 확인 주체 = **PM(상무)**.

**코드에서 실제로 처리한 것**

- SME 1인뿐인 직무 → 자동 워크숍 후보. 규칙 ④ `minSmeForCrossCheck: 2`(`src/lib/workshopThresholds.ts`), 판정은 `src/lib/workshopRules.ts:171`의 `singleSme`. 사유가 `job_workshop_flags.reasons`에 쌓이고 Export E4로 나간다.
- 배정 기록 자체는 `review_assignments`에 남고 수동 스냅샷 대상이다(`src/lib/snapshotApi.ts:106`, 노트에 "R6 1~2명 규칙의 기록"으로 적혀 있다).

**⚠️ 확인된 불일치 — R6이 코드로 통제되지 않는다**

`sync_sme_assignments`(`supabase/APPLY_2026-08-28.sql:483` 이하)는 SME 한 명을 **그 회사의 활성 직무 전부**에 배정한다:

```sql
-- Insert new assignments for all active jobs in the company
INSERT INTO public.review_assignments (sme_id, job_id, active)
SELECT p_sme_id, j.id, true
FROM public.jobs j
WHERE j.company_id = p_company_id AND j.active = true ...
```

이 함수는 SME 계정을 만들 때마다 Edge Function이 호출한다(`supabase/functions/admin-create-user/index.ts`의 `mode: "create-sme"` 분기). 즉 **R6("업무 조사는 직무별 최소 인원의 SME 1~2명을 대상으로 운영")은 지금도 코드로 강제되지 않는다.** 회사에 직무가 40개면 SME 1명이 40개 직무를 배정받는다. 다만 **조정하는 화면은 이번 후속에서 생겼다**(`/assignments-admin` — 아래 「이번 후속에서 더해진 것」). 그 화면은 자동 배정을 막지 못하고 사후에 정리한다.

겸직 처리도 마찬가지로 별도 개념이 없다 — 전 직무 배정이 기본이므로 겸직이 "표현되지 않는" 것이 아니라 "구분되지 않는다".

**남은 결정 주체** — PM(상무). §12가 요구한 "배정 상한·기준 문서화"가 선행이다.

**남은 작업** (무엇을 택할지는 PM 결정 사항 — 이 문서가 고르지 않는다)

1. **파일럿에서 먼저 사실을 확인한다.** 계정 1개를 만들고 `review_assignments` 행 수를 세어 배정이 실제로 전 직무에 걸리는지 본다(`docs/PILOT.md` §0 경고 · §12 표에 같은 항목이 있다).
2. 배정 규칙을 문서로 확정한다(직무당 SME 수, 겸직 허용 여부, 상한).
3. 규칙이 확정되면 코드로 옮긴다. **「좁히는」 쪽(수동 해제)은 이번 후속의 `/assignments-admin` 화면으로 생겼다** — 아래 블록 참조. 남은 것은 `sync_sme_assignments`의 전 직무 배정 로직 자체와 상한의 강제다(화면은 3명째 추가를 경고만 하고 막지 않는다 — 상한은 PM이 정할 값이라 코드가 먼저 정하지 않았다). 규칙이 정해지지 않은 상태에서 `sync_sme_assignments`를 먼저 좁히면 어떤 값이 맞는지 모른 채 새 SME의 배정이 0이 된다.
4. 잠정 운영으로 버틸 수는 있다: 전 직무 배정 상태로 두고 SME에게는 담당 직무만 안내하며, 응답이 없는 직무는 진행 매트릭스(`/progress`)에서 미시작으로 남는다. 이 경우 §9 E1의 "SME × 직무" 행 수가 실제 검토 인원보다 크게 부풀어 오르므로 검수 자료에 주석이 필요하다.

**Phase 5에서 더해진 것과, 그래도 남는 것**

SME 명부(시트 ④)의 「배정직무」가 이제 실제 배정이 된다 — `link_sme_roster`
(`supabase/migrations/20260902010000_p5_org_axis_and_defaults.sql`)가 명부의 (이메일, 직무명) 쌍을
`review_assignments`에 `ON CONFLICT DO NOTHING`으로 추가한다. 이것으로 "직무를 골라 배정하는" 경로는
생겼지만, R6 점검이 통과되지는 않는다. 남는 것 넷:

1. **전원 배정이 그대로 남는다.** `sync_sme_assignments`는 계정 생성 시 여전히 전 직무를 배정하고, 명부 배정은 거기에 더하기만 한다. Phase 5 시점에는 남는 배정을 내리는 화면이 없었다 — **그 화면은 이번 후속에서 만들었다**(아래 블록). 자동 배정 자체를 좁히려면 여전히 위 2번(규칙 확정)이 먼저다.
2. **계정이 없는 사람은 두 번 작업해야 한다.** 명부는 계정을 만들지 않으므로, `/users`에서 계정을 만든 뒤 **같은 파일을 다시 올려야** 소속 조직·배정이 연결된다. 두 번 올려도 안전하다(멱등).
3. **관리자가 일부러 내린 배정(`active = false`)은 명부에 있어도 되살리지 않는다.** 파일 한 장이 관리자의 결정을 되돌리지 않게 한 의도적 선택이다(같은 마이그레이션 4항). 되살리는 경로는 이번 후속의 `/assignments-admin` 화면뿐이다(같은 (SME, 직무) 쌍을 다시 추가하면 `upsert`로 `active`가 다시 `true`가 된다).
4. **같은 이름의 활성 직무가 둘 이상이면 모두 배정한다.** `jobs`의 유일 제약이 (회사, 직렬, 직무명, 버전)이라 이름만으로는 유일하지 않다. 업로드 검증도 이름만으로 대조하므로 화면 판정과 서버 반영의 기준은 일치한다.


**이번 후속에서 더해진 것 — `/assignments-admin` (SME 배정 관리)**

`src/pages/AssignmentAdminPage.tsx` + `src/lib/assignmentApi.ts`. 관리자 전용 라우트이고
사이드바 「SME 배정 관리」로 들어간다(SME의 `/assignments`(내 검토 목록)와 다른 화면이다).

- **보여 주는 것** — 활성 직무 전부를 직군·직렬 순으로 나열하고, 각 행에 R6 배지
  (0명 = 미배정 / 1~2명 = 적정 / 3명 이상 = 과다)와 배정된 SME의 검토 상태를 함께 그린다.
  배정이 0명인 직무도 목록에 남긴다 — 배정 행에서 직무를 만들면 R6 위반 중 가장 심한
  「미배정」이 화면에서 통째로 사라진다. R6 판정은 진행 현황의 `r6Of`를 그대로 쓴다.
- **해제는 삭제가 아니다.** `review_assignments.active = false`로 내린다. 행을 지우면
  `reviews.assignment_id` FK가 딸려 있어 삭제가 실패하거나 이미 작성한 응답이 함께 사라진다.
  `review_assignments`를 읽는 곳 9개 중 8개가 `.eq('active', true)`로 거르므로(서버 쪽
  `get_review_status`도 같다) 내려간 배정은 SME 화면·진행 매트릭스·제출 큐·Export에서 함께 빠진다.
  거르지 않는 한 곳은 문의 인박스가 문의의 `assignment_id`로 직무 이름만 되찾는 조회
  (`src/lib/adminApi.ts:1187`)로, 배정을 내려도 그 문의는 남아야 하므로 필터가 없는 편이 맞다.
- **제출된 응답이 있으면 해제를 막는다.** 판정 기준을 `status`가 아니라 `submitted_at`으로 본다 —
  반려된 검토는 `status`가 `REVIEW_REQUESTED`로 돌아가지만 제출 시각과 응답 원본은 남기 때문에,
  `status`만 보면 "한 번 제출했다 반려된" 응답을 경고 없이 지운다. 작성 중인 검토는 막지 않고
  경고 모달로 한 번 더 확인한다. 같은 판정을 화면과 API가 같이 쓰고(`assignmentGuardOf`),
  해제 직전에 상태를 다시 조회한다(목록을 띄워 둔 사이에 SME가 제출했을 수 있다).
- **★ 그 판정이 클라이언트에만 있었고, 이번에 서버로 내렸다.** 처음 만들었을 때는 위 판정이 전부
  브라우저 안에 있어 두 갈래로 **아무 화면에도 보이지 않는 제출**이 만들어질 수 있었다.
  ① 관리자가 확인 모달을 보는 사이(해제 직전 조회와 `UPDATE` 사이)에 SME가 제출한다.
  ② 관리자가 작성 중 배정을 해제한 뒤, SME가 **이미 열어 둔** 마법사에서 제출한다(경합 없이 상시 재현) —
  `submit_review`는 배정 담당자만 보고 `review_assignments.active`는 보지 않았다.
  그렇게 찍힌 `SUBMITTED` 행은 진행 매트릭스·검토현황·워크벤치·Export E1·E2·E5·SME 본인 목록이
  전부 `active = true`로 걸러 **어디에도 나오지 않는다**(관리자에게는 "미제출", SME에게는 "제출 완료").
  `supabase/migrations/20260902030000_assignment_deactivate_guard.sql`이 그 둘을 닫는다 —
  `review_assignments_guard_deactivate` 트리거가 ①과 직접 `PATCH`를, `submit_review`의 배정 확인이
  ②를 막는다. 클라이언트 판정은 사유 문구·버튼 잠금 용도로 그대로 둔다.
  **운영 DB에 `supabase/APPLY_2026-09-02_assignment_guard.sql`을 적용해야 실제로 막힌다**(§8 S5 표의 ★와 같은 뜻).
  적용 전에 이미 생긴 행이 있는지는 그 파일의 확인 (4)로 본다. 소급 복구는 하지 않는다 —
  나오면 `/assignments-admin`에서 같은 (SME, 직무)를 다시 추가해 되살릴지 PM과 정한다.
- **목록을 한 번에 다 읽지 않는다.** 이 화면이 읽는 배정 행 수는 (활성 직무 수 × 회사 SME 수)로
  곱해진다(`sync_sme_assignments`가 계정마다 전 직무를 배정한다). PostgREST는 한 응답의 행 수에
  상한(`db-max-rows`, Supabase 기본 1,000)을 걸고 **잘린 응답을 오류 없이** 돌려주므로,
  직무 40 × SME 25 = 1,000이면 그때부터 잘린 목록이 "미배정 · SME 0명"이라는 거짓 R6 판정으로 그려진다.
  그래서 배정·SME 후보는 `fetchAllPages`로 끝까지 읽는다(`src/lib/exportApi.ts`의 `fetchAll`과 같은 규칙).
  직무 목록(`jobApi.fetchAllJobsResult`)은 아직 페이지를 나누지 않아, 행 수가 상한에 딱 맞아떨어지면
  잘린 것으로 보고 실패로 알린다(0건으로 위장하지 않는다). 근본 수정은 아래 「남은 작업」 5번이다.
- **감사 기록** — `ASSIGNMENT_ADDED` / `ASSIGNMENT_DEACTIVATED`. id만 남기고 이름·이메일은 넣지 않는다.
- **그래도 남는 것** — 이 화면은 `sync_sme_assignments`를 막지 못하고 **사후 정리만 한다.**
  새 SME 계정을 만들 때마다 전 직무 배정이 다시 생기므로, 계정 발급 뒤에 이 화면을 한 번 돌아야 한다.
  3명째 추가도 경고만 하고 막지 않는다 — 상한은 위 2번(PM 결정)이 정할 값이라 코드가 먼저 정하지 않았다.
  `sync_sme_assignments` 자체는 손대지 않았다.
  **제출된 응답이 있는 배정을 정말로 내려야 할 때의 경로도 없다.** 트리거에 우회 조건을 두지 않았기
  때문이다("제출된 응답을 어떻게 처리할지"가 PM 결정 사항이라 코드가 먼저 정하지 않았다).
  부득이하면 운영자가 SQL Editor에서 트리거를 잠시 끄고 작업한 뒤 되돌린다
  (`ALTER TABLE public.review_assignments DISABLE TRIGGER review_assignments_guard_deactivate;` → `ENABLE`).
  그 사이의 해제는 감사에 남지 않는다.

**남은 작업 5(페이지 나눔) — 같은 결함이 형제 호출부에 그대로 있다.**

`review_assignments`를 페이지 없이 한 번에 읽는 곳이 이 화면 말고도 셋이다 —
`src/lib/adminApi.ts`의 `fetchProgressMatrix`(:310) · `fetchSubmissionQueue`(:670) ·
`fetchDashboardStats`(:1297). 같은 필터·같은 행 집합이라 상한에 걸리는 조건도 같고,
`fetchProgressMatrix`는 잘린 직무 열을 "배정 없음"으로 그려 R6 판정을 같은 방식으로 뒤집는다.
직무 목록을 만드는 `src/lib/jobApi.ts`의 `fetchAllJobsResult`(:876)도 마찬가지다.
이번 후속에서는 **`/assignments-admin`이 쓰는 경로만** 고쳤다(그 파일들은 이번 변경 범위 밖이다).
넷이 함께 지나는 페이징 헬퍼 하나로 정리하는 것이 남은 일이고, 그 전까지는 회사 필터로 범위를
좁혀 쓰는 것이 안전하다. 발현 여부는 배포의 `db-max-rows` 설정에 달려 있다 —
저장소에 `supabase/config.toml`이 없어 값을 확인할 수 없고, Supabase 호스팅 기본값은 1,000이다.


---

## 4. 메일 발신 도메인

**기획안 원문 요약** — 초대·리마인더 실발송에는 SPF·DKIM 인증 도메인이 필요(HCG 또는 고객 도메인). 미확정 기간은 시뮬레이션 모드 + 관리자 수동 안내로 운영 가능. 확인 주체 = **HCG IT**.

**코드에서 실제로 처리한 것**

- 발송 경로 전체가 구현되어 있다 — Edge Function `supabase/functions/send-reminder/index.ts`, 클라이언트 래퍼 `src/lib/mailApi.ts`, 화면 `src/pages/admin/MailSendPanel.tsx`(진행 현황 `/progress` 안).
- 키가 없으면 아무것도 보내지 않고 `mail_logs`에 `simulated = true`로만 남긴다(§10 P4 DoD ③). 판정 근거는 `RESEND_API_KEY` 부재(`send-reminder/index.ts:183`).
- 발신 주소가 없으면 한국어 사유로 막는다 — "발신 주소(RESEND_FROM)가 설정되어 있지 않아 발송할 수 없습니다…"(`send-reminder/index.ts:194-195`).
- 시뮬레이션과 실발송을 감사 로그의 **행위 이름으로** 가른다(`MAIL_SIMULATED` / `MAIL_SENT`, `src/lib/mailApi.ts:279`). E5의 '행위' 열만 보고 구분된다.
- 템플릿 치환기는 하나뿐이다(`renderTemplate`) — 미리보기 문장과 실제 나가는 문장이 갈라지지 않게.
- 필요한 시크릿 3종과 등록 절차는 `docs/OPERATIONS.md` 2절에 있다(`RESEND_API_KEY` / `RESEND_FROM` / `RESEND_REPLY_TO`).

**남은 결정 주체** — HCG IT(도메인·DNS). 발신 표시명은 PM.

**남은 작업**

1. 발신 도메인을 정하고(HCG 또는 고객) SPF·DKIM을 등록한다.
2. Supabase 시크릿에 `RESEND_API_KEY` / `RESEND_FROM`(인증 도메인의 주소) / `RESEND_REPLY_TO`를 등록한다. **저장소·코드에는 남기지 않는다.**
3. 그전까지는 시뮬레이션으로 운영한다 — 관리자가 발송 이력을 보고 수동 안내한다. 이 경로는 코드가 이미 지원한다.
4. **미확인 — 파일럿에서 확인**: 실제 Resend 발송을 해 본 적이 없다. 시뮬레이션 판정과 `mail_logs` 기록도 실행 확인은 파일럿 항목이다.

---

## 5. 워크숍 플래그 임계값

**기획안 원문 요약** — 초기값(부적합 30% · FTE 차 20%p · 신규 3건)은 가설이므로 파일럿 후 조정. 상수 파일로 분리해 둘 것(§11-2 P3 제약). 확인 주체 = **PM(상무)**.

**코드에서 실제로 처리한 것**

- 값 4개가 `src/lib/workshopThresholds.ts`의 `WORKSHOP_THRESHOLDS` 한 곳에만 있다:
  - `unsuitableRatio: 0.3` — '부적합' 판정 비율 30%
  - `ftePointGap: 20` — SME 간 투입 비중 차 20%p(비교 뷰 하이라이트 기준과 같은 값)
  - `newTaskSuggestions: 3` — 신규 제안 Task 3건(같은 이름의 제안은 여러 SME가 냈어도 1건으로 셈)
  - `minSmeForCrossCheck: 2` — 교차 확인 최소 응답 수(못 미치면 워크숍 후보)
- 판정 로직 `src/lib/workshopRules.ts`가 이 상수만 읽는다. 화면(`src/pages/workbench/compare.tsx`, `src/pages/workbench/WorkshopFlagPanel.tsx`)도 숫자를 다시 적지 않는다.
- `minSmeForCrossCheck`는 이슈 3번(SME 1인 직무)의 판별 근거도 겸한다.

**남은 결정 주체** — PM(상무).

**남은 작업**

1. 파일럿 결과로 4개 값을 확정한다. 특히 `unsuitableRatio 0.3`은 과다·과소 검출이 갈리는 값이라 실제 플래그 목록을 보고 판단해야 한다.
2. 확정값을 `src/lib/workshopThresholds.ts` **한 파일에서만** 고친다.
3. **미확인**: 값을 바꾼 뒤 이미 쌓인 `job_workshop_flags.reasons`가 자동으로 다시 계산되는지는 확인하지 못했다. 재계산이 필요하다면 그 경로도 함께 정해야 한다.

---

## 6. 데이터 보존·파기

**기획안 원문 요약** — 프로젝트 종료 시 응답 데이터의 이관(고객 제공) 범위·파기 시점·Supabase 프로젝트 처리. 과업범위 합의서 또는 회의록에 1문장 반영 권장. §8 S6도 "데이터 위치(Supabase 리전) 명시"를 요구한다. 확인 주체 = **PM(상무)·TF**.

**코드에서 실제로 처리한 것**

- **코드로 처리한 것은 없다.** 이 이슈는 합의 문서 항목이다.
- 문서 자리만 만들어 두었다 — `docs/OPERATIONS.md` 4절(보존·파기)에 리전·보존 기간·파기 시점·이관 범위가 **빈칸 + "합의 필요"**로 있다. 값을 지어내지 않았다.
- 이관에 쓸 도구는 있다: Export 5종(`/exports`)과 수동 스냅샷(`src/lib/snapshotApi.ts`의 `downloadSnapshot`, `:231`). 스냅샷에 개인정보가 포함된다는 사실이 상수로 못박혀 있고(`SNAPSHOT_INCLUDES_PERSONAL_DATA`, `:60`) 화면 경고 문구도 그 상수에서 나온다.
- 개인정보 최소화 쪽은 지켜지고 있다 — 감사 로그 `meta`에 이름·이메일·사번을 넣지 않는다(메일 기록 `src/lib/mailApi.ts`, 계정 기록 `src/components/modals/edgeApi.ts` 모두 같은 규칙).

**남은 결정 주체** — PM(상무)·고객 TF.

**남은 작업**

1. Supabase 프로젝트의 **리전**을 확인해 기재한다(대시보드에서 읽는 값 — 이 저장소는 알 수 없다).
2. 보존 기간·파기 시점·이관 범위(어느 표를 고객에게 넘기는가)를 합의하고 `docs/OPERATIONS.md` 4절 빈칸을 채운다.
3. 합의 내용 1문장을 과업범위 합의서 또는 회의록에 반영한다.
4. §8 S6이 요구하는 **로그인 화면의 수집·이용 안내 1문장이 아직 없다**(`src/pages/LoginPage.tsx`에 해당 문구 없음). 개인정보 고지 문안이라 임의로 지어 쓰지 않았다 — 문안 확정 후 넣어야 한다. `docs/OPERATIONS.md` 4-1과 `docs/PILOT.md` §9-2에 같은 항목이 있다.

---

## 7. 참고 레포 AI 검토 보조 이식

**기획안 원문 요약** — 오타 검수·부실 응답 감지는 관리자 검토 품질에 유효하나 범위 확장 요인. P3 완료 후 잔여 일정 기준으로 판단(§4 판단표에도 "보류"로 올라 있다). 확인 주체 = **사용자**.

**코드에서 실제로 처리한 것**

- **없다.** 저장소 전체에 AI 호출 코드가 0줄이다(관련 문자열·의존성 없음, `package.json`에도 없음).
- 대신 사람이 판단할 근거는 갖춰 두었다: 검토 워크벤치의 SME 비교 뷰(`/workbench/:jobId`), 투입 비중 차 하이라이트, 워크숍 자동 플래그 4규칙, 문의 인박스(`/inbox`).

**남은 결정 주체** — 사용자.

**남은 작업**

1. 도입 여부를 판단한다. 도입하면 **새 외부 의존성·API 키·비용·개인정보 외부 전송**이 함께 들어온다 — §8 S6(개인정보 최소화)과 이슈 6(보존·파기)에 직접 걸리는 사안이라 그 두 건이 정리된 뒤에 판단하는 편이 안전하다.
2. 도입하지 않기로 하면 §4 판단표의 "보류"를 "미채택"으로 확정하고 이 항목을 닫는다.

---

## 8. 기존 응답 데이터 존재 여부

**기획안 원문 요약** — 현 배포본에 실제 응답이 이미 있다면 P1 마이그레이션 전 스냅샷 필수. 없다면 자유롭게 진행. 확인 주체 = **사용자**.

**코드에서 실제로 처리한 것**

- 수동 스냅샷 Export가 있다(§8 S7) — `src/lib/snapshotApi.ts`, 버튼은 `/exports` 화면 하단. 대상 표 목록은 `SNAPSHOT_TABLES`(`:92`), 형식 버전은 `SNAPSHOT_VERSION = '1.0'`(`:154`).
- 스냅샷 실행은 감사 로그에 남는다(`SNAPSHOT_EXPORTED`, `:240`) — "누가 언제 개인정보가 든 파일을 받아 갔는가"를 되짚기 위해서다.
- 마이그레이션은 가산적으로 작성되어 있다 — APPLY 스크립트가 `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE` 위주이고, 되돌리기 절차와 그 부작용(예: `audit_logs`를 DROP하면 쌓인 기록이 함께 사라진다)이 각 파일 머리 주석에 적혀 있다.
- 적용 순서와 순서를 지켜야 하는 이유는 `docs/OPERATIONS.md` 1절에 있다(Phase 1 두 파일은 한 짝이고, 앞만 적용하면 임시저장이 전면 차단된다).

**남은 결정 주체** — 사용자.

**남은 작업**

1. 운영 DB에 기존 응답이 있는지 확인한다(`reviews` / `job_feedback` 행 수 조회). **이 저장소는 확인할 수 없다 — 실제 DB에 붙어 본 적이 없다.**
2. 있으면 **P1 마이그레이션 적용 전에** 스냅샷을 받는다. 없으면 그대로 진행한다.
3. 스냅샷 파일의 보관 위치·기간은 이슈 6(보존·파기)의 합의를 따른다. 개인정보가 든 파일이다.

---

## 이 개편에서 함께 처리한 잔여 결함 (§12 항목은 아님)

### 계정 생성·삭제가 감사 로그에 남지 않던 문제

§8 S5는 "제출·승인/반려·**계정 생성/삭제**·업로드·Export·메일 발송"을 감사 대상으로 못박는데, 계정 쪽에 기록이 없었다(계정만 빠져 있던 것은 아니다 — S5 전체의 이행 상태는 바로 아래 「§8 S5 — 이번 후속으로 닫은 것과 남은 것」에 있다). 원인은 계정을 만드는 주체가 Edge Function(service_role)인데 `log_audit` RPC가 `actor_id`를 `auth.uid()`로 강제하고 비로그인 호출을 42501로 거절하기 때문이다(`supabase/APPLY_2026-09-01_phase0.sql:231-238`).

Phase 4의 `src/lib/mailApi.ts`가 같은 이유로 발송 기록을 클라이언트에서 남기고 있어 같은 방식을 택했다. 계정 조작이 전부 지나가는 한 곳(`callAdminFn`)에 기록을 붙였다 — `src/components/modals/edgeApi.ts:57`(`planAccountAudit`) · `:129-130`(기록 호출). 남기는 행위는 `ADMIN_CREATED` / `SME_CREATED` / `ACCOUNT_DELETED` / `ACCOUNT_DEACTIVATED` / `ACCOUNT_ACTIVATED` / `ACCOUNT_AUTH_RECREATED` 6종이고, 조회와 이름·소속 수정은 대상이 아니다(대상을 넓히면 감사 로그가 조회 기록에 묻힌다).

`actor_id`가 실제 행위자를 가리키는 근거: 이 기록은 Edge Function 호출이 **성공한 뒤에만** 남는데, 그 성공은 같은 JWT로 `auth.getUser` → `profiles.role='admin'` 검증을 통과했다는 뜻이다(`supabase/functions/admin-create-user/index.ts:40-55`). 즉 `auth.uid()`(= `log_audit`이 박는 `actor_id`) = Edge Function이 검증한 호출자 = 실제 행위자이며, `actor_id`는 인자로 받지 않으므로 사칭 경로도 없다. 같은 내용을 코드 주석에도 남겼다.

**알려진 비용**: 일괄 업로드·일괄 삭제는 계정 한 건마다 로그 RPC가 한 번 더 나간다(100명이면 100회). 계정별 추적이 감사 목적에 맞으므로 그대로 두되, 일괄 처리 체감 속도가 문제가 되면 서버 측 일괄 기록으로 옮기는 편이 낫다.

**미확인 — 파일럿에서 확인**: 실제로 `audit_logs`에 행이 쌓이는지는 실행해 보지 못했다. 확인 쿼리는 아래와 같다.

```sql
select action, entity, entity_id, actor_id, created_at
  from public.audit_logs
 where action in ('ADMIN_CREATED','SME_CREATED','ACCOUNT_DELETED',
                  'ACCOUNT_DEACTIVATED','ACCOUNT_ACTIVATED','ACCOUNT_AUTH_RECREATED')
 order by created_at desc limit 20;
```

### §8 S5 — 이번 후속으로 닫은 것과 남은 것

§8 S5가 감사 대상으로 못박은 것은 **제출 · 승인/반려 · 계정 생성/삭제 · 업로드 · Export · 메일 발송**
여섯이다. Phase 0~5가 끝난 시점에 이 중 둘(제출 · 업로드)이 이행되지 않은 채였다.
**이번 후속에서 그 둘을 채웠다.** 다만 **SQL을 적용해야 실제로 남는다** — 아래 표의 ★가 그 뜻이다.

| S5 항목 | `audit_logs` 기록 | 근거 |
|---|---|---|
| **제출** | ★ `REVIEW_SUBMITTED` / `REVIEW_RESUBMITTED` | `submit_review` 안. `supabase/migrations/20260902020000_followup_audit_coverage.sql` (운영 적용은 `supabase/APPLY_2026-09-02_followup.sql`) |
| 승인/반려 | ✅ `REVIEW_APPROVED` / `REVIEW_REJECTED` | `supabase/APPLY_2026-09-01_phase1.sql:1161` (`decide_review` 안) |
| 계정 생성/삭제 | ✅ 6종(위 절) | `src/components/modals/edgeApi.ts:57-96` · `:130` |
| **업로드** | ★ `JOB_DATA_UPLOADED` + ✅ `ORG_UNITS_UPLOADED` · `SME_ROSTER_LINKED` | 직무정보 4시트는 `save_integrated_job_data` 안(같은 마이그레이션), 조직 마스터·SME 명부는 `src/lib/integratedJobApi.ts:129` · `:207` |
| Export | ✅ `EXPORT_DOWNLOADED` · `SNAPSHOT_EXPORTED` | `src/pages/ExportsPage.tsx:205` · `src/lib/snapshotApi.ts:240` |
| 메일 발송 | ✅ `MAIL_SENT` / `MAIL_SIMULATED` | `src/lib/mailApi.ts:279` |
| (S5 밖) 재검토 요청 | ★ `REVIEW_REREVIEW_REQUESTED` | `request_rereview` 안(같은 마이그레이션). 화면 호출부는 여전히 없다 |
| (S5 밖) SME 배정 | ✅ `ASSIGNMENT_ADDED` / `ASSIGNMENT_DEACTIVATED` | `src/lib/assignmentApi.ts:291` · `:337` (`/assignments-admin` 화면) |

**★ = `supabase/APPLY_2026-09-02_followup.sql`을 운영 DB에 적용해야 남는다.**
적용 전까지는 제출·재제출·재검토 요청·직무정보 업로드가 `audit_logs`에 남지 않는다(코드는 들어와 있다).
적용 순서·확인 쿼리는 `docs/OPERATIONS.md` §1-8에 있다.

**어떻게 넣었는지 — 판단이 필요했던 자리 셋.**

- **클라이언트가 아니라 RPC 안에서 남긴다.** `decide_review`가 이미 그렇게 한다. 화면에서 남기면
  호출부가 여럿일 때 한 곳을 빠뜨리거나 임의의 `meta`를 넣을 수 있다. 이 셋은 첫머리에서
  `auth.uid()`·`is_admin()`으로 호출자를 확인하므로 `log_audit`의 42501 조건이 정상 경로에
  새 제약을 더하지 않는다.
  **행위자가 `service_role`(`auth.uid()` = NULL)이라 클라이언트에 남는 것은 계정 생성/삭제뿐이다**
  (Edge Function `admin-create-user`가 `service_role`로 붙는다 — `src/components/modals/edgeApi.ts:33`).
  조직 마스터 업로드(`ORG_UNITS_UPLOADED`)와 **SME 명부 반영**(`SME_ROSTER_LINKED`)은 그 사정이 아니다 —
  둘 다 로그인한 관리자의 브라우저에서만 불리고, `link_sme_roster`는 첫머리에서 `is_admin()`으로
  호출자를 막는다(`supabase/migrations/20260902010000_p5_org_axis_and_defaults.sql:91`).
  즉 위 기준에 그대로 해당하는데도 기록만 클라이언트에 남아 있다. 대가는 실재한다 —
  `link_sme_roster`는 `review_assignments`를 만드는(R6에 직접 영향을 주는) 쓰기인데, RPC가 성공한 뒤
  브라우저가 `logAudit`(`src/lib/integratedJobApi.ts:207`)에 닿기 전에 탭이 닫히거나 네트워크가 끊기면
  배정 생성이 `audit_logs`에 한 줄도 남지 않는다(`src/lib/auditApi.ts`는 실패를 삼킨다).
  옮길지 말지는 아래 「남은 작업」 5번으로 남긴다.
- **감사 기록 실패가 본래 작업을 되돌리지 않는다.** 세 호출을 전부
  `BEGIN … EXCEPTION WHEN OTHERS THEN NULL`로 감쌌다. plpgsql 함수 본문은 한 트랜잭션이라,
  감사 기록에서 난 예외가 밖으로 새면 SME가 방금 마친 제출이·관리자가 방금 올린 4시트 업로드가
  통째로 롤백된다. `src/lib/auditApi.ts`가 클라이언트에서 내린 것과 같은 판단이다.
  **대가는 정직하게 적어 둔다 — 감사 기록이 조용히 빠질 수 있고 화면에도 오류에도 뜨지 않는다.**
  그래서 건수 대조 쿼리(APPLY 파일 확인 (6))를 파일럿에서 반드시 돌린다.
- **자유 서술은 감사 로그에 복제하지 않는다.** 재검토 요청 사유는 `review_history.note`에 원문이 남고
  Export E5로 나온다. `audit_logs`에는 사유가 있었는지와 길이만 남긴다 —
  같은 개인 서술의 보관·삭제 통제 지점을 둘로 늘리지 않기 위해서다(§8 S6 최소 수집).
  SME 성명·이메일도 넣지 않는다. 행위자는 `actor_id`로 남는다.

**오해를 막기 위해 함께 적는다.**

- **소급 기록은 없다.** SQL 적용 **이전**의 제출·업로드는 `audit_logs`에 없다. 그 구간의 제출 이력은
  `review_history`(또는 Export E5 '상태 전이 이력' 시트)로만 확인한다.
- **`REVIEW_REJECTED`의 `meta.reason`에는 반려 사유 전문이 들어간다 — 바로 위 규칙의 예외다.**
  `decide_review`가 `jsonb_build_object('status', …, 'reason', v_reason)`로 관리자 입력 원문을 그대로
  넣고(`supabase/APPLY_2026-09-01_phase1.sql:1160`), 그 `meta`는 Export E5 '관리자 행위 로그' 시트의
  '상세' 열로 나간다(`src/lib/exportApi.ts:1408`). 즉 **반려 사유는 `review_history.note`와
  `audit_logs.meta` 두 곳에 있다.** 위 규칙("자유 서술은 복제하지 않는다")은 이번에 새로 넣은
  `request_rereview`에 적용한 것이고, 먼저 있던 `decide_review`는 그 규칙 밖에 있다.
  §8 S6의 보관·삭제·열람 통제 범위를 잡을 때 `audit_logs`를 빼면 안 된다.
  둘 중 하나로 맞추는 일은 아래 「남은 작업」 6번이다.
- **화면의 반려는 `REVIEW_REJECTED`다.** 관리자 화면의 반려 버튼은 `request_rereview`가 아니라
  `decide_review`를 부른다(`src/components/JobDetailPage.tsx:460`).
  `REVIEW_REREVIEW_REQUESTED`가 0건인 것이 정상이다. 그럼에도 감사 기록을 붙인 이유는
  그 RPC의 `GRANT EXECUTE … TO authenticated`가 살아 있어 화면 없이도 호출될 수 있기 때문이다 —
  기록 없이 검토 상태를 되돌릴 수 있는 경로를 남겨 두지 않는다.
- **`upload_history` 표는 여전히 비어 있다.** 만들어만 두고
  (`supabase/migrations/20260812084909_create_job_review_system.sql:258`) 쓰는 코드가 없다.
  스냅샷 대상 목록에는 들어 있어(`src/lib/snapshotApi.ts:123`) "업로드 이력이 어딘가 쌓이고 있다"고
  오해하기 쉽다. 업로드 감사는 `audit_logs` 세 행위로 충족했고, 이 표의 존폐만 남는다.

**남은 작업**

1. **`supabase/APPLY_2026-09-02_followup.sql`을 운영 DB에 적용한다.** 적용 전에는 위 ★ 넷이 남지 않는다.
   이어서 **`supabase/APPLY_2026-09-02_assignment_guard.sql`**(배정 해제 잠금 트리거 + `submit_review`의
   배정 확인)을 적용한다 — **순서를 뒤집으면 뒤에 실행된 파일이 앞의 것을 지운 정의로 되돌린다.**
   **이 SQL은 실행해 본 적이 없다** — 이 저장소 환경에 `psql`·`docker`가 없어 정적 확인
   (원본과의 `diff` 무차이 · `$fn$` 짝 · 괄호 균형)만 했다. 구문 오류 가능성이 남아 있고,
   APPLY 파일의 확인 (3)이 그것을 잡는다.
2. **감사 기록이 실제로 쌓이는지 실측한다.** 예외를 삼키는 구조라 "안 남았다"가 화면·오류 어디에도
   뜨지 않는다. 파일럿에서 제출 1건·직무정보 업로드 1건을 실제로 돌린 뒤 APPLY 파일의 확인 (4)(6)을 본다.
3. `upload_history`를 쓸지 지울지 정한다. 클라이언트가 파일명을 넘기지 않아 `filename`(NOT NULL)을
   채울 수 없다는 조건이 그대로다. 지우기로 하면 스냅샷 대상 목록에도 함께 반영한다.
4. `request_rereview`를 계속 남길지 정한다. 이번에는 **남기는 쪽**을 택해 감사 기록을 붙였다.
   지우기로 하면 함수와 실행 권한을 함께 거둔다.
5. `link_sme_roster`·`saveOrgUnits`의 감사 기록도 RPC 안으로 옮길지 정한다. 위 첫 번째 불릿의 기준
   (`auth.uid()`·`is_admin()`으로 호출자를 확인하는 함수는 안에서 남긴다)에 둘 다 해당하는데
   지금은 클라이언트에 남는다. 옮기면 같은 트랜잭션이라 "쓰기는 됐는데 기록이 없다"는 창이 사라지고,
   대가는 두 함수를 다시 정의하는 것(`CREATE OR REPLACE`)뿐이다. 계정 생성/삭제는 `service_role`이라
   옮길 수 없으므로 그대로 둔다.
6. **반려 사유의 보관처를 하나로 맞출지 정한다.** `decide_review`의 `meta.reason`을
   `has_note`/`note_length`로 바꾸면 위 규칙이 시스템 사실이 되고, 그대로 두기로 하면 예외를
   문서에 남긴 채(이 문서 · `docs/OPERATIONS.md` §7-3에는 적었다) **`src/lib/exportSchema.ts:481`의
   주석("개인정보는 이미 meta에 넣지 않는다(§8 S6)")도 함께 고쳐야 한다** — 그 한 줄은 지금 사실과
   반대이고, 이번 변경 범위 밖(그 파일은 손대지 않았다)이라 그대로 남아 있다.

**결정 주체** — HCG IT(감사 요구 수준) · PM. 1~2는 운영 적용·실측이고, 3~4는 여전히 결정 사항이다.

### 화면 문구에 남아 있던 기획안 좌표 제거

관리자 화면 문구에 기획안 절 번호(`§6-1`, `§12 오픈이슈 1`, `§10 P5` 등)가 그대로 노출돼 있었다. 착수보고·계약 산출물 번호(11면, E2·E5)는 관리자에게 뜻이 통하므로 남기고, 이 저장소 안에서만 통하는 좌표만 걷어냈다 — `src/pages/SettingsPage.tsx`(페이지 부제, 마감일·예상 소요·가이드·FTE 게이트 안내), `src/pages/DashboardPage.tsx`(소요 카드 3곳).

이 과정에서 **문구 하나가 이미 사실과 달라져 있던 것**도 고쳤다: 운영 설정의 "대시보드 지표로 올리는 일은 §10 P5에서 정합니다"는 이번 Phase에서 대시보드 카드를 실제로 만들었으므로 틀린 문장이 됐다. 지금은 대시보드 카드와 Export E5 두 곳에서 볼 수 있다고 적었다.


---

## v2.0 개편(2026-09-02) — Phase A~E 구현 기록

기획안: **아티팩트 dcab2660**(전수 감사 + 개편 기획안 v2.0). 브랜치 `revamp2`.
아래는 "무엇을 했는가"와 "무엇이 남았는가"만 적는다. 근거·선택지 비교는 기획안에 있다.

### 적용해야 하는 SQL (순서대로)

| 순서 | 파일 | 무엇 | 화면 배포와의 관계 |
| --- | --- | --- | --- |
| 1 | `supabase/APPLY_2026-09-02_v2_phaseA.sql` | profiles GRANT 축소(S1) · `request_rereview` REVOKE(F8) | 먼저 적용해도 무해 |
| 2 | `supabase/APPLY_2026-09-02_v2_phaseB.sql` | `client_key` · `save_review_draft(p_fte, p_activities)` · `submit_review` · `activity_feedback` · 구조 편집 잠금 트리거 | **함께 적용해야 한다**(함수 시그니처가 바뀐다 — 옛 화면은 6인자 호출을 찾지 못한다) |
| 3 | `supabase/APPLY_2026-09-02_v2_phaseD.sql` | `reviews.last_step` | **미적용이면 SME 배정 목록 자체가 실패한다.** `fetchMyAssignments` 의 select 에 `last_step` 이 들어 있어 PostgREST 가 요청 전체를 `42703` 으로 떨어뜨린다(`src/lib/reviewApi.ts:298-301`, 2026-09-03 실측 정정 — 「이어하기만 꺼짐」이 아니다) |
| 4 | `supabase/APPLY_2026-09-02_v2_phaseE.sql` | `save_org_units` · `link_sme_roster_audited` | **함께 적용해야 한다**(업로드 시트 ③④ 경로가 이 함수를 부른다) |

2·4를 적용하지 않은 채 새 화면을 배포하면 각각 SME 저장·제출과 조직/명부 업로드가 PGRST202로 실패한다.

### Phase별 요약

- **A 복구** — 비밀번호 재설정 경로 신설(`/reset-password` + 로그인 「비밀번호를 잊으셨나요」 + 관리자 메일 redirectTo 통일),
  Edge Function `listUsers()` 50건 상한 제거(이메일 조회는 전 페이지 순회, 존재 확인은 `getUserById`),
  로그인 계정 재생성 기능 제거(profile.id ≠ auth.uid 계정을 만들었다), 회사명 하드코딩 제거(업로드에 대상 회사 선택),
  SME 발급을 서버 생성 임시 비밀번호 1회 표시로 전환(양식에서 비밀번호 열 삭제), 로그인 화면 개인 이메일 제거,
  죽은 코드 삭제(`saveStep1Data`·`saveStep2Data`·`requestRereview`·회사 마스터 CRUD 모드).
- **B FTE 연동 v2** — `new_task_suggestions.client_key`로 화면·DB를 잇고, FTE 배분을 `save_review_draft(p_fte)`
  한 트랜잭션으로 합쳤다(delete만 성공한 중간 상태가 사라졌다). STEP 3에 판정 칩·「→ 제안명」·「다시 보기」 펼침·
  과업 추가·삭제 제안 되살리기. 세부활동 의견(`activity_feedback`)과 E3 「세부활동 의견」 열.
  진행 중 검토가 있는 직무의 구조 편집 잠금(트리거 3개 + 화면 비활성).
- **C 디자인 시스템** — 토큰 12종 + 다크 값 쌍, 타이포 8클래스, 공용 부품 12종(`src/components/ui/`).
  지표: hex 19→0 · Tailwind 원색 43→0 · `window.confirm` 9→0 · 상태 배지 3벌→1 · 단계 표시 2벌→1 ·
  필터 칩 5벌→1 · 반경 없는 카드 23→0 · 그림자 2단 고정.
- **D 화면·IA** — 사이드바 5그룹, 대시보드 KPI 모집단 단일화(카드 6장 → 도넛 범례), SME 홈(D-day·단계 진행·
  이어하기 = `reviews.last_step`), 검토 현황 상세 모달 제거 → `/jobs/:jobId?sme=`로 통합, 문의 담당 표기,
  비교 뷰 단건 조회.
- **E 품질** — `lib/paging.ts` 공용 페이징(관리자 조회 4곳 적용 — 1,000행 절단으로 "미배정"이 되던 자리),
  소요 실측 집계 상수·중앙값을 `exportApi`에서 공유(두 벌 제거), 유휴 30분 자동 로그아웃(1분 전 경고),
  meta CSP(빌드 시 Supabase 도메인 치환), 감사 기록 서버 이관.

### 아직 남은 것 (이번에 하지 않은 것)

1. **PILOT.md 251항목 실측** — 운영 계정이 없어 로그인 이후 경로를 이 저장소에서 실행하지 못했다.
   Phase A~E의 DoD 중 "실제로 해 본다"에 해당하는 항목은 전부 미검증이다(재설정 메일 1회, 계정 60개
   시드에서 check-auth, 두 회사 업로드, 42501 확인, 30명 동시 저장).
2. **대형 파일 분해(D5)** — `exportApi` 1,494줄 · `adminApi` 1,351줄 · `JobDetailPage` 1,308줄 ·
   `SmeReviewPage` 1,234줄 · `UploadPage` 1,206줄. 이번에는 손대지 않았다(회귀 위험이 이득보다 컸다).
   react-refresh 경고 20건도 같은 이유로 남았다.
3. **Playwright 스모크(D6)** — vitest는 도입했고(`npm test`, `buildFteTargets` 6케이스) 브라우저 스모크는
   의존성 추가가 커서 남겼다.
4. **표 모바일 스택** — 공용 `DataTable`(+`ListCell`)은 만들었고, 기존 표 8곳의 교체는 남았다.
   지금은 비교 뷰만 카드 스택이다.
5. **`SectionMessage`·`FallbackView`·`Skeleton` 전면 적용** — 부품은 만들었고 SME 홈·대시보드 도넛 등
   일부만 적용했다. 나머지 화면의 인라인 alert/빈 상태/「불러오는 중…」은 그대로다.
6. **결정 D6(배정 상한 강제)·D5(신규 제안 승격)** — 기획안 9절의 결정 사항이라 구현하지 않았다.


### 적용 런북 (2026-09-02)

SQL 4벌·Auth 설정·확인 쿼리를 순서대로 담은 실행 문서를 따로 만들었다 —
**아티팩트 `86f4c2cf`** (claude.ai/code/artifact/86f4c2cf-7338-4f59-bc36-ee5beedcfefc).
각 단계의 SQL 전문이 페이지에 담겨 있어 복사해 SQL Editor에 붙이면 되고, 단계별 확인 쿼리와
되돌리기 방법이 함께 있다. 오프라인용 사본은 바탕화면 `JobReview_v2_Supabase적용런북.html`.

이 문서(OPEN_ISSUES)가 "무엇이 왜 바뀌었나"이고, 런북이 "지금 무엇을 어떤 순서로 하나"다.

### 2026-09-02 추가 구현 — 미실행 항목 정리

기획안의 "남은 것" 중 계정 없이 할 수 있는 것을 모두 했다(커밋 `0a769d3`·`7949015`).

- **vitest 4종 29케이스** — `buildFteTargets` 6 · `evaluateStep` 9 · `computeJobSignals` 10 ·
  `assignmentGuardOf` 4. `npm test`로 돈다.
- **표 8곳 DataTable 교체** — 관리자 계정·직무정보 관리·SME 계정·검토 현황·제출 큐·대시보드 SME별·
  FTE 과업 순위·메일 발송 이력. 좁은 화면에서 줄 목록(ListCell)으로 쌓인다.
  피벗 표 2곳(진행 현황 조직×직무, FTE 조직 피벗)은 열이 조직 수만큼 늘어 스택이 성립하지 않아 예외다.
- **상태 부품 전면 적용** — 블록 단위 로딩은 Skeleton, 목록 오류·빈 상태는 FallbackView,
  페이지 경고는 SectionMessage로.
- **대형 파일 5개 분해** — exportApi 1,518→61(배럴)+6파일 · adminApi 1,409→35(배럴)+10파일 ·
  UploadPage 1,217→432 · JobDetailPage 1,379→982 · SmeReviewPage 1,182→980. 호출부는 무변경.

남은 것은 둘이다.
1. **PILOT 251항목 실측** — 운영 계정이 필요하다(런북의 「배포 직후 확인」이 그 첫 묶음이다).
2. **Playwright 스모크** — 계정과 브라우저 설치가 전제라 파일럿과 함께 한다.
   결정 D5(신규 제안 승격)·D6(배정 상한 강제)는 PM 결정 사항이라 그대로 남겼다.
