# 오픈 이슈 정리 — PLAN §12 8건

**이 문서의 용도**: 개편(Phase 0~5)에서 §12의 오픈 이슈 8건에 대해 **코드가 무엇을 이미 처리했고, 무엇이 아직 사람의 결정으로 남았는지**를 한 곳에 모은 것입니다.

**이 문서가 하지 않는 것**: 결정을 대신하지 않습니다. §12는 각 이슈의 확인 주체를 지정하고 있고(파일럿 결과 / 고객 TF / PM(상무) / HCG IT / 사용자), 그 주체가 정할 값은 여기서도 빈칸으로 둡니다. 코드에 들어간 값이 있다면 그것은 **잠정 기본값**이며, 어느 파일 어느 줄에서 바꾸는지를 함께 적었습니다.

**근거 표기**: `파일:줄`은 이 저장소의 `revamp/phase-5` 브랜치 기준입니다. 코드가 바뀌면 줄 번호는 어긋날 수 있으니 함수·상수 이름을 함께 적었습니다.

**검증 상태**: 아래 "코드에서 실제로 처리한 것"은 전부 코드를 읽어 확인한 사실입니다. **실행해 본 것은 `npm run typecheck` / `npx eslint` / `npm run build` 세 가지뿐**이며, Supabase에 붙여 동작을 확인한 항목은 하나도 없습니다. 동작 확인은 `docs/PILOT.md`의 체크리스트에서 합니다.

---

## 한눈에 보기

| # | 이슈 | 확인 주체(§12) | 코드 상태 | 남은 것 |
|---|---|---|---|---|
| 1 | 직무당 예상 소요 ○○분 | 파일럿 결과 | 실측·표시·비교 안내까지 구현 | 실측값 자체(데이터 없음) → 파일럿 후 설정 반영 |
| 2 | 조직 마스터 입수 | 고객 TF | 업로드 시트·조직축 집계·Export + `profiles.org_unit_id` 연결 구현 | 조직도 입수 시점·형식(자료가 없음) |
| 3 | SME 배정 예외 처리 | PM(상무) | 1인 직무 = 자동 워크숍 후보 + 명부로 직무를 골라 배정(추가만) | **전 직무 자동 배정이 그대로 남아 R6(직무별 1~2명)이 여전히 통제되지 않음 — 배정 해제 화면 없음** |
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

이 함수는 SME 계정을 만들 때마다 Edge Function이 호출한다(`supabase/functions/admin-create-user/index.ts`의 `mode: "create-sme"` 분기). 즉 **R6("업무 조사는 직무별 최소 인원의 SME 1~2명을 대상으로 운영")은 지금 코드로 강제되지 않으며, 직무별 배정 인원을 조정하는 화면도 없다.** 회사에 직무가 40개면 SME 1명이 40개 직무를 배정받는다.

겸직 처리도 마찬가지로 별도 개념이 없다 — 전 직무 배정이 기본이므로 겸직이 "표현되지 않는" 것이 아니라 "구분되지 않는다".

**남은 결정 주체** — PM(상무). §12가 요구한 "배정 상한·기준 문서화"가 선행이다.

**남은 작업** (무엇을 택할지는 PM 결정 사항 — 이 문서가 고르지 않는다)

1. **파일럿에서 먼저 사실을 확인한다.** 계정 1개를 만들고 `review_assignments` 행 수를 세어 배정이 실제로 전 직무에 걸리는지 본다(`docs/PILOT.md` §0 경고 · §12 표에 같은 항목이 있다).
2. 배정 규칙을 문서로 확정한다(직무당 SME 수, 겸직 허용 여부, 상한).
3. 규칙이 확정되면 코드로 옮긴다. 손대야 할 곳은 `sync_sme_assignments`의 전 직무 배정 로직과 배정 관리 화면(현재 없음)이다. **Phase 5에서 「더하는」 쪽만 만들었고 「좁히는」 쪽은 하지 않았다** — 아래 블록 참조. 규칙이 정해지지 않은 상태에서 `sync_sme_assignments`를 먼저 좁히면 어떤 값이 맞는지 모른 채 새 SME의 배정이 0이 된다.
4. 잠정 운영으로 버틸 수는 있다: 전 직무 배정 상태로 두고 SME에게는 담당 직무만 안내하며, 응답이 없는 직무는 진행 매트릭스(`/progress`)에서 미시작으로 남는다. 이 경우 §9 E1의 "SME × 직무" 행 수가 실제 검토 인원보다 크게 부풀어 오르므로 검수 자료에 주석이 필요하다.

**Phase 5에서 더해진 것과, 그래도 남는 것**

SME 명부(시트 ④)의 「배정직무」가 이제 실제 배정이 된다 — `link_sme_roster`
(`supabase/migrations/20260902010000_p5_org_axis_and_defaults.sql`)가 명부의 (이메일, 직무명) 쌍을
`review_assignments`에 `ON CONFLICT DO NOTHING`으로 추가한다. 이것으로 "직무를 골라 배정하는" 경로는
생겼지만, R6 점검이 통과되지는 않는다. 남는 것 넷:

1. **전원 배정이 그대로 남는다.** `sync_sme_assignments`는 계정 생성 시 여전히 전 직무를 배정하고, 명부 배정은 거기에 더하기만 한다. 남는 배정을 지우는 화면이 없어 R6("직무별 1~2명") 점검은 통과하지 못한다. 지우는 쪽을 만들려면 위 2번(규칙 확정)이 먼저다.
2. **계정이 없는 사람은 두 번 작업해야 한다.** 명부는 계정을 만들지 않으므로, `/users`에서 계정을 만든 뒤 **같은 파일을 다시 올려야** 소속 조직·배정이 연결된다. 두 번 올려도 안전하다(멱등).
3. **관리자가 일부러 내린 배정(`active = false`)은 명부에 있어도 되살리지 않는다.** 파일 한 장이 관리자의 결정을 되돌리지 않게 한 의도적 선택이다(같은 마이그레이션 4항). 되살리려면 배정 관리 화면이 필요하다 — 1번과 같은 화면이다.
4. **같은 이름의 활성 직무가 둘 이상이면 모두 배정한다.** `jobs`의 유일 제약이 (회사, 직렬, 직무명, 버전)이라 이름만으로는 유일하지 않다. 업로드 검증도 이름만으로 대조하므로 화면 판정과 서버 반영의 기준은 일치한다.


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

§8 S5는 "제출·승인/반려·**계정 생성/삭제**·업로드·Export·메일 발송"을 감사 대상으로 못박는데, 계정 쪽에 기록이 없었다(계정만 빠져 있던 것은 아니다 — S5 전체의 이행 상태는 바로 아래 「§8 S5 미이행 — 남은 작업」에 있다). 원인은 계정을 만드는 주체가 Edge Function(service_role)인데 `log_audit` RPC가 `actor_id`를 `auth.uid()`로 강제하고 비로그인 호출을 42501로 거절하기 때문이다(`supabase/APPLY_2026-09-01_phase0.sql:231-238`).

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

### §8 S5 미이행 — 남은 작업

§8 S5가 감사 대상으로 못박은 것은 **제출 · 승인/반려 · 계정 생성/삭제 · 업로드 · Export · 메일 발송**
여섯이다. 저장소의 `logAudit` / `log_audit` 호출 지점을 전수 확인한 결과, 이 중 **둘이 아직 이행되지
않았다.** 문서가 코드보다 앞서 나가지 않도록 여기에 적어 둔다.

| S5 항목 | `audit_logs` 기록 | 근거 |
|---|---|---|
| 승인/반려 | ✅ `REVIEW_APPROVED` / `REVIEW_REJECTED` | `supabase/APPLY_2026-09-01_phase1.sql:1161` (`decide_review` 안) |
| 계정 생성/삭제 | ✅ 6종(위 절) | `src/components/modals/edgeApi.ts:57-96` · `:130` |
| Export | ✅ `EXPORT_DOWNLOADED` · `SNAPSHOT_EXPORTED` | `src/pages/ExportsPage.tsx:205` · `src/lib/snapshotApi.ts:240` |
| 메일 발송 | ✅ `MAIL_SENT` / `MAIL_SIMULATED` | `src/lib/mailApi.ts:279` |
| **제출** | ❌ **없다** | `submit_review`는 `review_history`에만 남긴다(`같은 파일:1052`). 그 함수 안에 `log_audit` 호출이 없다 |
| **업로드** | ⚠️ **일부만** | 조직 마스터(`src/lib/integratedJobApi.ts:129`)와 SME 명부 반영(`:207`)만 남는다. **직무정보 4시트 업로드**(`saveIntegratedJobData` · `src/lib/jobApi.ts:136` `saveStep1Data` · `:260` `saveStep2Data`)에는 기록이 없다 |

**오해를 막기 위해 함께 적는다.**

- **제출이 추적 불가능한 것은 아니다.** `submit_review`는 `review_history`에 한 줄(누가·언제·어떤 상태로)
  남기고, 그 이력은 Export E5 '상태 전이 이력' 시트로 그대로 나온다. 빠진 것은 "제출이 `audit_logs`에도
  남는가"이고, S5가 감사 기록을 한 표로 모으라는 요구였다면 그 요구가 아직 안 지켜진 것이다.
- **재검토 요청**(`request_rereview`)도 `audit_logs`에 남지 않는다(`같은 파일:1217`, `review_history`만).
  다만 관리자 화면의 반려 버튼은 이 RPC를 부르지 않고 `decide_review`를 부르므로
  (`src/components/JobDetailPage.tsx:460`) 화면에서 한 반려는 `REVIEW_REJECTED`로 남는다.
  즉 **호출부 없는 RPC가 감사 기록을 빠뜨린다**는 문제이지, 지금 화면의 반려가 안 남는다는 뜻이 아니다.
- **`upload_history` 표는 비어 있다.** 만들어만 두고(`supabase/migrations/20260812084909_create_job_review_system.sql:258`)
  쓰는 코드가 없다. 스냅샷 대상 목록에는 들어 있어(`src/lib/snapshotApi.ts:123`) "업로드 이력이 어딘가
  쌓이고 있다"고 오해하기 쉬우므로 적어 둔다.

**남은 작업**

1. 제출 감사 기록을 넣을지 정한다. 넣는다면 `submit_review` 안에 `PERFORM public.log_audit('REVIEW_SUBMITTED', 'reviews', …)`
   한 줄이면 되고(`decide_review`가 이미 같은 자리에서 그렇게 한다), 마이그레이션은 함수 재정의 하나다.
   **넣지 않기로 하면 §8 S5의 "제출"을 `review_history`로 갈음한다고 명시해 문서 쪽을 맞춘다.**
2. 직무정보 업로드 기록을 넣을지 정한다. 조직 마스터와 같은 자리(`saveIntegratedJobData` 성공 직후)에
   `JOBS_UPLOADED` 한 줄이면 되지만, 4시트 업로드는 관리자 한 번의 조작이므로 한 줄이 맞다.
3. `request_rereview`를 남길지 지울지 정한다. 지금은 호출부가 없는데 권한만 살아 있다
   (`GRANT EXECUTE … TO authenticated`). 남긴다면 `decide_review`와 같은 감사 기록을 넣고,
   지운다면 함수와 권한을 함께 거둔다.
4. `upload_history`를 쓸지 지울지 정한다. 스냅샷 대상 목록에도 함께 반영한다.

**결정 주체** — HCG IT(감사 요구 수준) · PM. 위 1~4는 전부 코드·마이그레이션 변경이라 이번 Phase 범위
밖이다. 파일럿 전에 감사 기록의 요구 수준을 확정하는 것이 먼저다.

### 화면 문구에 남아 있던 기획안 좌표 제거

관리자 화면 문구에 기획안 절 번호(`§6-1`, `§12 오픈이슈 1`, `§10 P5` 등)가 그대로 노출돼 있었다. 착수보고·계약 산출물 번호(11면, E2·E5)는 관리자에게 뜻이 통하므로 남기고, 이 저장소 안에서만 통하는 좌표만 걷어냈다 — `src/pages/SettingsPage.tsx`(페이지 부제, 마감일·예상 소요·가이드·FTE 게이트 안내), `src/pages/DashboardPage.tsx`(소요 카드 3곳).

이 과정에서 **문구 하나가 이미 사실과 달라져 있던 것**도 고쳤다: 운영 설정의 "대시보드 지표로 올리는 일은 §10 P5에서 정합니다"는 이번 Phase에서 대시보드 카드를 실제로 만들었으므로 틀린 문장이 됐다. 지금은 대시보드 카드와 Export E5 두 곳에서 볼 수 있다고 적었다.
