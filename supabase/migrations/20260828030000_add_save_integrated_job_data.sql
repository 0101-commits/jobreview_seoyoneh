/*
# save_integrated_job_data — 관리자 직무정보 통합 업로드 RPC

이 파일은 `20260828011000_TODO_save_integrated_job_data_contract.sql`(주석뿐인 계약 문서)을 구현한다.
그 TODO는 "운영 DB에서 덤프하라"고 적혀 있었으나, anon 키로 PostgREST를 직접 확인한 결과
`save_integrated_job_data`는 운영 DB에도 존재하지 않는다(PGRST202 Could not find the function).
같은 방법으로 확인한 `sync_sme_assignments` / `get_review_status`는 200을 돌려준다 = 스키마 캐시는 정상이다.
즉 덤프할 원본이 없고, 관리자 직무정보 업로드는 지금껏 한 번도 성공한 적이 없다.
따라서 클라이언트 계약(src/lib/integratedJobApi.ts, src/lib/integratedUploadUtils.ts)에 맞춰 새로 작성한다.
TODO 파일은 계약 근거로 그대로 남겨 둔다.

1. 계약
- 인자: p_company_id uuid, p_mode text('append'|'replace'), p_job_rows jsonb, p_skill_rows jsonb
  jsonb 원소의 키는 엑셀 헤더 한글 그대로다(integratedUploadUtils.ts의 JOB_HEADERS / SKILL_HEADERS).
- 반환: jsonb 객체 하나
  { jobCount, taskCount, activityCount, skillCount, requirementCount }
  (integratedJobApi.ts가 camelCase를 먼저 읽고 snake_case로 폴백한다. camelCase로 돌려준다.)

2. 트랜잭션
- 함수 본문 전체가 한 트랜잭션이다. 중간에 예외가 나면 전부 롤백된다.
  구 경로(jobApi.saveStep1Data/saveStep2Data)는 supabase-js 호출을 순차로 날려서
  중간 실패 시 "절반만 반영"되는 문제가 있었다. 그 구조를 반복하지 않는다.

3. 권한
- SECURITY INVOKER(기본값)다. DEFINER를 쓰지 않는다.
  적재 대상 테이블(job_groups/job_series/jobs/job_tasks/task_activities/job_skills/job_requirements)의
  RLS insert/update 정책이 이미 전부 `public.is_admin()` 기준이므로, INVOKER로 두면 RLS가 그대로 적용된다.
  DEFINER로 만들면 이 함수 하나가 RLS를 통째로 우회하는 구멍이 된다(20260828010500에서 실제로 겪은 문제다).
- 그래도 첫머리에서 is_admin()을 직접 확인한다. RLS 위반의 영어 메시지 대신 한국어 안내를 주기 위해서다.
- search_path를 public으로 고정한다.
- EXECUTE는 authenticated에만 준다. anon에는 주지 않는다.

4. replace 전략 — 삭제하지 않는다
- 검토 데이터가 적재 대상을 FK로 참조한다(task_feedback.task_id → job_tasks.id,
  skill_feedback.skill_id → job_skills.id, review_assignments.job_id → jobs.id).
  물리 삭제하면 FK 위반으로 실패하거나(다행) 검토 이력이 사라진다(사고).
- 그래서 replace는 "해당 회사 범위의 기존 행을 active=false로 내린 뒤, 파일에 있는 행을 되살린다".
  되살릴 때 새 행을 넣지 않고 **기존 행의 id를 그대로 재사용**한다(이름 기준 매칭 후 active=true).
  id가 유지되므로 배정·검토·피드백이 그대로 붙어 있다.
  파일에서 빠진 직무/과업/Skill만 active=false로 남는다 = 화면에서는 사라지고 이력은 보존된다.
- append는 위에서 비활성화 단계만 건너뛴다. 그 외 적재 로직은 완전히 동일하다.

5. 멱등성
- 같은 파일을 두 번 올려도 행이 늘지 않는다. 모든 단계가 "이름으로 찾아 UPDATE, 없으면 INSERT"다.
- ON CONFLICT은 유일하게 타깃이 명확한 job_requirements(job_id)에서만 쓴다.
  job_tasks / task_activities에는 unique 제약이 아예 없고,
  jobs·job_groups·job_series는 unique 인덱스가 두 갈래(전역 + company 부분 인덱스)로 공존해
  ON CONFLICT 추론이 불안정하다. 존재하지 않는 타깃을 쓰면 런타임 오류이므로 NOT EXISTS로 간다.

6. company_id
- company_id는 nullable이고 레거시 행은 NULL로 남아 있다(20260813053114).
- job_groups에는 전역 제약 unique(name, source_version)이 있어, 같은 직군명을 회사만 바꿔 새로 INSERT하면
  중복 키 오류가 난다. 그래서 이름이 일치하는 NULL 회사 행은 새로 만들지 않고 이 회사로 편입(adopt)한다.
- 편입은 replace 비활성화보다 **먼저** 한다. 비활성화 범위가 company_id 기준이라서,
  순서가 뒤바뀌면 편입 직전의 레거시 행이 비활성화 대상에서 빠져 "절반만 교체"된다.
- 다른 회사가 이미 쓰고 있는 직군명은 전역 제약상 공존이 불가능하므로 미리 검사해 한국어로 알린다.

7. source_version
- 이 앱이 쓰는 값은 1뿐이다(구 jobApi도 1로 하드코딩). 조회·삽입·되살리기를 source_version = 1로 고정한다.
- replace의 비활성화만 버전을 가리지 않고 회사 범위 전체를 내린다. 의도한 비대칭이다.
  비활성화에도 source_version = 1 조건을 넣으면, v≠1 활성 행이 남은 채 5-3이 v=1 행을 active=true로 올리는 순간
  부분 유니크 인덱스 idx_jobs_unique_active(group_id, series_id, name) WHERE active(20260813035903:134)를
  위반해 업로드 전체가 실패한다. "조용히 내려가는 것"보다 "업로드가 통째로 막히는 것"이 더 나쁘다.
  대신 적용 전 실측 쿼리를 supabase/APPLY_2026-08-28.sql 머리에 적어 둔다.

8. 검토 이력 보존 — "되살릴 한 행"을 어떻게 고르는가
- 같은 (job_id, name) job_tasks 행이 여러 개일 수 있다. 구 경로(src/lib/jobApi.ts:227)가 대조 없는 plain INSERT였고
  job_tasks에는 unique 제약이 아예 없기 때문이다(20260812084909). 그중 하나만 되살아나므로
  "어느 행을 고르느냐"가 곧 SME 검토 이력의 생존 여부다(task_feedback.task_id가 특정 행을 가리킨다).
- replace는 4단계에서 회사 범위를 전부 active=false로 내린 뒤 되살린다. 그래서 `active DESC`는 전부 동률이 되어
  tie-break 역할을 하지 못하고 created_at 오름차순 = 가장 오래된 행이 뽑힌다.
  SME가 나중 행에 의견을 남겼다면 그 의견은 비활성 행에 붙은 채 화면에서 영구히 사라진다.
  → `active DESC` 다음에 "피드백이 달린 행 우선"을 넣어 해결한다(5-4 job_tasks, 6-2 job_skills).
- `active DESC`를 앞에 두는 순서는 유지한다. append에서 비활성 행을 우선 되살리면 이미 활성인 중복 행과 함께
  active가 되어 job_skills_unique_active(20260813045848) 부분 유니크 인덱스를 위반한다.
- task_activities에는 이 처리를 하지 않는다. 검토 데이터가 task_activities를 참조하지 않으므로 잃을 이력이 없다.
- 이름이 바뀐 과업·Skill은 이 방법으로도 못 살린다. 이름 말고 안정적인 키가 없다. 남은 위험으로 기록한다.

9. 하지 않은 것
- 테이블·컬럼·제약 변경 없음. 조회 인덱스 2개만 추가한다(5-4/5-5의 매칭 스캔에 쓸 인덱스가 없었다).
- statement_timeout은 함수 안에서 손대지 않는다. SET LOCAL은 이미 시작된 바깥 문장의 타이머를 다시 걸지 못해
  효과가 없다. 실제로 8초를 넘기면 APPLY 파일에 적어 둔 `ALTER ROLE authenticated SET statement_timeout` 로 푼다.
- upload_history 기록 없음. 클라이언트가 파일명을 넘기지 않아 filename(NOT NULL)을 채울 수 없다.
- 업로드 후 review_assignments 재동기화 없음. sync_sme_assignments는 SME 신규 생성 때만 호출되므로
  새 직무가 기존 SME에게 자동 배정되지 않는다. 이 함수의 범위 밖이다(sync의 DELETE가 reviews FK RESTRICT에
  걸리는 문제를 먼저 풀어야 한다).
*/

CREATE OR REPLACE FUNCTION public.save_integrated_job_data(
  p_company_id uuid,
  p_mode text,
  p_job_rows jsonb,
  p_skill_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_bad_name text;
  v_job_count bigint := 0;
  v_task_count bigint := 0;
  v_activity_count bigint := 0;
  v_skill_count bigint := 0;
  v_requirement_count bigint := 0;
BEGIN
  ------------------------------------------------------------------
  -- 1. 권한·인자 검증
  ------------------------------------------------------------------
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '직무정보를 업로드할 권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('append', 'replace') THEN
    RAISE EXCEPTION '업로드 방식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION '회사 정보를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  -- 호출자 소속 검사. 20260828010500(get_review_status)이 세운 회사 스코프 패턴과 같다.
  -- 관리자 프로필의 company_id가 NULL이면 전사 권한(현재 관리자 계정이 전부 이 상태라 동작은 바뀌지 않는다).
  -- 회사별 관리자를 만드는 순간부터 이 다섯 줄이 "남의 회사 직무를 통째로 교체"를 막는다.
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.id = auth.uid()
          AND (me.company_id IS NULL OR me.company_id = p_company_id)) THEN
    RAISE EXCEPTION '이 회사의 직무정보를 업로드할 권한이 없습니다. 관리자에게 문의해 주세요.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_job_rows) <> 'array' OR jsonb_array_length(p_job_rows) = 0 THEN
    RAISE EXCEPTION '‘직무 및 과업 정보’ 시트에 저장할 데이터가 없습니다.'
      USING ERRCODE = '22023';
  END IF;

  -- 길이 0도 막는다. 빈 배열이 replace로 들어오면 4단계가 회사 전체 Skill을 내린 뒤 6단계가 아무것도 되살리지
  -- 못해 Skill이 통째로 사라지는데, 반환값은 skillCount 0이고 화면은 "저장 완료"로 표시된다.
  -- 클라이언트는 skillRows.length > 0을 이미 요구하므로(integratedUploadUtils.ts:370) 정상 경로를 막지 않는다.
  IF jsonb_typeof(p_skill_rows) <> 'array' OR jsonb_array_length(p_skill_rows) = 0 THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트에 저장할 데이터가 없습니다. 파일을 다시 선택해 주세요.'
      USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------
  -- 2. 값 검증
  --    클라이언트(integratedUploadUtils.ts)가 이미 검증하지만, RPC는 아무 관리자나
  --    임의의 payload로 부를 수 있는 경계다. 여기서 막지 않으면 빈 문자열이 그대로 적재된다.
  --
  --    행 번호는 쓰지 않는다. 클라이언트가 완전 공백 행(integratedUploadUtils.ts:114)과 중복 행(260·351행)을
  --    빼고 배열을 만들기 때문에, 배열 인덱스 + 1은 실제 엑셀 행과 어긋난다. 대신 값으로 지목한다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT concat_ws(' > ', nullif(src.grp, ''), nullif(src.ser, ''), nullif(src.job, '')) INTO v_bad_name
    FROM src
   WHERE src.grp = '' OR src.ser = '' OR src.job = ''
      OR src.definition = '' OR src.task = '' OR src.activity = ''
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘직무 및 과업 정보’ 시트의 % 행에 비어 있는 값이 있습니다. 직군·직렬·직무·직무정의·주요과업·세부활동은 모두 입력해 주세요.',
      coalesce(nullif(v_bad_name, ''), '직군·직렬·직무가 모두 빈') USING ERRCODE = '22023';
  END IF;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT concat_ws(' > ', nullif(src.grp, ''), nullif(src.ser, ''), nullif(src.job, '')) INTO v_bad_name
    FROM src
   WHERE src.grp = '' OR src.ser = '' OR src.job = ''
      OR src.skill_type = '' OR src.skill_name = ''
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 % 행에 비어 있는 값이 있습니다. 직군·직렬·직무·Skill 구분·Skill은 모두 입력해 주세요.',
      coalesce(nullif(v_bad_name, ''), '직군·직렬·직무가 모두 빈') USING ERRCODE = '22023';
  END IF;

  -- job_skills.skill_type CHECK 제약과 같은 값만 허용한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type, t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  )
  SELECT src.skill_type INTO v_bad_name
    FROM src
   WHERE src.skill_type NOT IN ('Hard Skill', 'Soft Skill')
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 Skill 구분 값 ‘%’은(는) 사용할 수 없습니다. Hard Skill 또는 Soft Skill로 입력해 주세요.',
      v_bad_name USING ERRCODE = '22023';
  END IF;

  -- job_groups는 전역 unique(name, source_version)이라 같은 직군명을 회사끼리 나눠 가질 수 없다.
  -- 다른 회사가 이미 등록한 이름이면 삽입 시 중복 키 오류가 나므로, 먼저 한국어로 알린다.
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  SELECT string_agg(DISTINCT jg.name, ', ' ORDER BY jg.name) INTO v_bad_name
    FROM public.job_groups jg
    JOIN src ON src.grp = jg.name
   WHERE jg.source_version = 1
     AND jg.company_id IS NOT NULL
     AND jg.company_id <> p_company_id;

  IF v_bad_name IS NOT NULL THEN
    RAISE EXCEPTION '직군 ‘%’은(는) 다른 회사에 이미 등록되어 있어 저장할 수 없습니다. 관리자에게 문의해 주세요.',
      v_bad_name USING ERRCODE = '23505';
  END IF;

  ------------------------------------------------------------------
  -- 3. 레거시 편입 — company_id가 NULL인 기존 행을 이 회사로 끌어온다.
  --    replace의 비활성화 범위가 company_id 기준이므로 반드시 비활성화보다 먼저 한다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_groups jg
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
   WHERE jg.name = src.grp
     AND jg.source_version = 1
     AND jg.company_id IS NULL;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_series js
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE js.group_id = jg.id
     AND js.name = src.ser
     AND js.source_version = 1
     AND js.company_id IS NULL;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser,
                    btrim(coalesce(t.e->>'직무', '')) AS job
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.jobs j
     SET company_id = p_company_id,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = src.ser AND js.source_version = 1
   WHERE j.group_id = jg.id
     AND j.series_id = js.id
     AND j.name = src.job
     AND j.source_version = 1
     AND j.company_id IS NULL;

  ------------------------------------------------------------------
  -- 4. replace: 이 회사 범위를 전부 active=false로 내린다. 삭제하지 않는다.
  --    파일에 있는 행은 5단계에서 같은 id 그대로 다시 살아난다.
  ------------------------------------------------------------------
  IF p_mode = 'replace' THEN
    UPDATE public.task_activities ta
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE ta.active
       AND ta.job_task_id IN (
             SELECT jt.id FROM public.job_tasks jt
              JOIN public.jobs j ON j.id = jt.job_id
             WHERE j.company_id = p_company_id);

    UPDATE public.job_tasks jt
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE jt.active
       AND jt.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = p_company_id);

    UPDATE public.job_skills sk
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE sk.active
       AND sk.job_id IN (SELECT j.id FROM public.jobs j WHERE j.company_id = p_company_id);

    UPDATE public.jobs j
       SET active = false, updated_at = now(), updated_by = v_actor
     WHERE j.active AND j.company_id = p_company_id;

    UPDATE public.job_series js
       SET active = false, updated_at = now()
     WHERE js.active AND js.company_id = p_company_id;

    UPDATE public.job_groups jg
       SET active = false, updated_at = now()
     WHERE jg.active AND jg.company_id = p_company_id;
  END IF;

  ------------------------------------------------------------------
  -- 5-1. 직군(job_groups)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_groups jg
     SET company_id = p_company_id,
         active = true,
         updated_at = now()
    FROM src
   WHERE jg.name = src.grp
     AND jg.source_version = 1
     AND jg.company_id = p_company_id;

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  INSERT INTO public.job_groups (company_id, name, active, source_version, created_by)
  SELECT p_company_id, src.grp, true, 1, v_actor
    FROM src
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_groups jg
            WHERE jg.name = src.grp AND jg.source_version = 1);

  ------------------------------------------------------------------
  -- 5-2. 직렬(job_series) — 키는 (group_id, name, source_version)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  UPDATE public.job_series js
     SET company_id = p_company_id,
         active = true,
         updated_at = now()
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE js.group_id = jg.id
     AND js.name = src.ser
     AND js.source_version = 1
     -- 타 회사 소유로 표시된 직렬은 흡수하지 않는다. 3단계에서 NULL은 이미 편입했다.
     AND (js.company_id IS NULL OR js.company_id = p_company_id);

  WITH src AS (
    SELECT DISTINCT btrim(coalesce(t.e->>'직군', '')) AS grp,
                    btrim(coalesce(t.e->>'직렬', '')) AS ser
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  INSERT INTO public.job_series (company_id, group_id, name, active, source_version, created_by)
  SELECT p_company_id, jg.id, src.ser, true, 1, v_actor
    FROM src
    JOIN public.job_groups jg
      ON jg.name = src.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_series js
            WHERE js.group_id = jg.id AND js.name = src.ser AND js.source_version = 1);

  ------------------------------------------------------------------
  -- 5-3. 직무(jobs) — 키는 (group_id, series_id, name, source_version)
  --      직무정의는 같은 직무의 첫 등장 행 값을 쓴다(클라이언트가 불일치를 이미 막는다).
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  def AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.definition
      FROM src
     ORDER BY src.grp, src.ser, src.job, src.ord
  )
  UPDATE public.jobs j
     -- 직무정의는 replace에서만 덮어쓴다. append 모드의 화면 문구는 "새로운 직무정보를 추가하고 기존 검토 이력을
     -- 유지합니다"(UploadPage.tsx:285)이고 확인 모달도 없다. 그런 경로가 구버전 마스터 파일 하나로
     -- SME가 이미 검토한 직무정의를 조용히 되돌리면 안 된다. job_feedback은 검토 대상 원문을 보존하지 않아
     -- 무엇에 대해 '적합'이라고 답했는지 복원할 수 없다. 새로 만들어지는 직무는 INSERT 경로라 영향이 없다.
     SET company_id = p_company_id,
         definition = CASE WHEN p_mode = 'replace' THEN def.definition ELSE j.definition END,
         active = true,
         updated_at = now(),
         updated_by = v_actor
    FROM def
    JOIN public.job_groups jg
      ON jg.name = def.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = def.ser AND js.source_version = 1
   WHERE j.group_id = jg.id
     AND j.series_id = js.id
     AND j.name = def.job
     AND j.source_version = 1
     AND (j.company_id IS NULL OR j.company_id = p_company_id);

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'직무정의', '')) AS definition,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  def AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.definition
      FROM src
     ORDER BY src.grp, src.ser, src.job, src.ord
  )
  INSERT INTO public.jobs (company_id, group_id, series_id, name, definition, active, source_version, created_by, updated_by)
  SELECT p_company_id, jg.id, js.id, def.job, def.definition, true, 1, v_actor, v_actor
    FROM def
    JOIN public.job_groups jg
      ON jg.name = def.grp AND jg.source_version = 1 AND jg.company_id = p_company_id
    JOIN public.job_series js
      ON js.group_id = jg.id AND js.name = def.ser AND js.source_version = 1
   WHERE NOT EXISTS (
           SELECT 1 FROM public.jobs j
            WHERE j.group_id = jg.id AND j.series_id = js.id
              AND j.name = def.job AND j.source_version = 1);

  ------------------------------------------------------------------
  -- 5-4. 주요과업(job_tasks) — unique 제약이 없으므로 (job_id, name)으로 찾아 UPDATE, 없으면 INSERT.
  --      기존에 같은 (job_id, name) 행이 여러 개 있으면(구 업로드 경로가 중복 삽입했다)
  --      한 행만 되살린다. 어느 행을 고르는지는 머리 주석 §8 참고 — SME 피드백이 달린 행이 우선이다.
  --      나머지는 replace에서 내려간 채로 둔다 = 자연스러운 중복 정리.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  -- 되살릴 한 행을 고르는 기준(머리 주석 §8). replace는 4단계에서 전부 inactive로 만들어 놓기 때문에
  -- active DESC가 동률이 된다. 그 다음 기준으로 "SME 피드백이 달린 행"을 먼저 되살려 검토 이력을 지킨다.
  fb AS (SELECT DISTINCT tf.task_id FROM public.task_feedback tf),
  target AS (
    SELECT DISTINCT ON (jt.job_id, jt.name) jt.id, jt.job_id, jt.name
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
      LEFT JOIN fb ON fb.task_id = jt.id
     ORDER BY jt.job_id, jt.name, jt.active DESC, (fb.task_id IS NOT NULL) DESC, jt.created_at
  )
  UPDATE public.job_tasks upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
    JOIN target ON target.job_id = ji.job_id AND target.name = ranked.task
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_tasks (job_id, name, active, sort_order, updated_by)
  SELECT ji.job_id, ranked.task, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_tasks jt
            WHERE jt.job_id = ji.job_id AND jt.name = ranked.task);

  ------------------------------------------------------------------
  -- 5-5. 세부활동(task_activities) — 키는 (job_task_id, activity_name)
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task, activity,
           (row_number() OVER (PARTITION BY grp, ser, job, task ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, activity, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task, activity) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  task_ids AS (
    SELECT DISTINCT ON (ji.grp, ji.ser, ji.job, jt.name)
           ji.grp, ji.ser, ji.job, jt.name AS task, jt.id AS task_id
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
     ORDER BY ji.grp, ji.ser, ji.job, jt.name, jt.active DESC, jt.created_at
  ),
  target AS (
    SELECT DISTINCT ON (ta.job_task_id, ta.activity_name) ta.id, ta.job_task_id, ta.activity_name
      FROM public.task_activities ta
      JOIN task_ids ti ON ti.task_id = ta.job_task_id
     ORDER BY ta.job_task_id, ta.activity_name, ta.active DESC, ta.created_at
  )
  UPDATE public.task_activities upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN task_ids ti
      ON ti.grp = ranked.grp AND ti.ser = ranked.ser AND ti.job = ranked.job AND ti.task = ranked.task
    JOIN target ON target.job_task_id = ti.task_id AND target.activity_name = ranked.activity
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity,
           t.ord
      FROM jsonb_array_elements(p_job_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, task, activity,
           (row_number() OVER (PARTITION BY grp, ser, job, task ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, task, activity, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, task, activity) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  task_ids AS (
    SELECT DISTINCT ON (ji.grp, ji.ser, ji.job, jt.name)
           ji.grp, ji.ser, ji.job, jt.name AS task, jt.id AS task_id
      FROM public.job_tasks jt
      JOIN job_ids ji ON ji.job_id = jt.job_id
     ORDER BY ji.grp, ji.ser, ji.job, jt.name, jt.active DESC, jt.created_at
  )
  INSERT INTO public.task_activities (job_task_id, activity_name, active, sort_order, updated_by)
  SELECT ti.task_id, ranked.activity, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN task_ids ti
      ON ti.grp = ranked.grp AND ti.ser = ranked.ser AND ti.job = ranked.job AND ti.task = ranked.task
   WHERE NOT EXISTS (
           SELECT 1 FROM public.task_activities ta
            WHERE ta.job_task_id = ti.task_id AND ta.activity_name = ranked.activity);

  ------------------------------------------------------------------
  -- 6. Skill 시트
  ------------------------------------------------------------------
  -- 6-1. 직무 시트에 없는 직무를 참조하면(클라이언트가 이미 막지만) INNER JOIN에서 조용히 사라진다.
  --      조용한 누락 대신 트랜잭션을 되돌리고 알린다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', '')) AS grp,
           btrim(coalesce(t.e->>'직렬', '')) AS ser,
           btrim(coalesce(t.e->>'직무', '')) AS job,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  SELECT concat_ws(' > ', src.grp, src.ser, src.job) INTO v_bad_name
    FROM src
   WHERE NOT EXISTS (
           SELECT 1 FROM job_ids ji
            WHERE ji.grp = src.grp AND ji.ser = src.ser AND ji.job = src.job)
   ORDER BY src.ord
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '‘Skill 및 수행요건’ 시트의 ‘%’ 직무를 ‘직무 및 과업 정보’ 시트에서 찾을 수 없습니다.',
      v_bad_name USING ERRCODE = '22023';
  END IF;

  -- 6-2. Skill(job_skills) — 키는 (job_id, skill_type, name).
  --      job_skills_unique_active 부분 unique 인덱스(WHERE active)와 같은 키다.
  --      되살릴 대상을 한 행으로 좁히지 않으면 중복 행을 동시에 active로 올려 인덱스를 위반한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, skill_type, skill_name,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, skill_type, skill_name, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, skill_type, skill_name) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  ),
  fb AS (SELECT DISTINCT sf.skill_id FROM public.skill_feedback sf),
  target AS (
    SELECT DISTINCT ON (sk.job_id, sk.skill_type, sk.name) sk.id, sk.job_id, sk.skill_type, sk.name
      FROM public.job_skills sk
      JOIN job_ids ji ON ji.job_id = sk.job_id
      LEFT JOIN fb ON fb.skill_id = sk.id
     ORDER BY sk.job_id, sk.skill_type, sk.name, sk.active DESC, (fb.skill_id IS NOT NULL) DESC, sk.created_at
  )
  UPDATE public.job_skills upd
     SET active = true,
         sort_order = ranked.sort_order,
         updated_at = now(),
         updated_by = v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
    JOIN target ON target.job_id = ji.job_id
               AND target.skill_type = ranked.skill_type
               AND target.name = ranked.skill_name
   WHERE upd.id = target.id;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))       AS grp,
           btrim(coalesce(t.e->>'직렬', ''))       AS ser,
           btrim(coalesce(t.e->>'직무', ''))       AS job,
           btrim(coalesce(t.e->>'Skill 구분', '')) AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))      AS skill_name,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  ranked AS (
    SELECT grp, ser, job, skill_type, skill_name,
           (row_number() OVER (PARTITION BY grp, ser, job ORDER BY first_ord))::int - 1 AS sort_order
      FROM (SELECT grp, ser, job, skill_type, skill_name, min(ord) AS first_ord
              FROM src GROUP BY grp, ser, job, skill_type, skill_name) g
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_skills (job_id, name, skill_type, active, sort_order, updated_by)
  SELECT ji.job_id, ranked.skill_name, ranked.skill_type, true, ranked.sort_order, v_actor
    FROM ranked
    JOIN job_ids ji ON ji.grp = ranked.grp AND ji.ser = ranked.ser AND ji.job = ranked.job
   WHERE NOT EXISTS (
           SELECT 1 FROM public.job_skills sk
            WHERE sk.job_id = ji.job_id
              AND sk.skill_type = ranked.skill_type
              AND sk.name = ranked.skill_name);

  -- 6-3. 수행요건(job_requirements) — 직무당 1행. unique 인덱스 job_requirements_job_id_key(job_id)를
  --      ON CONFLICT 타깃으로 쓴다(이 테이블만 타깃이 명확하다).
  --      같은 직무가 두 번 들어오면 "cannot affect row a second time"이 나므로 DISTINCT ON으로 1행만 남긴다.
  --      active 컬럼이 없고 jobs 삭제 시 CASCADE라, replace에서도 지우지 않고 덮어쓰기만 한다.
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))              AS grp,
           btrim(coalesce(t.e->>'직렬', ''))              AS ser,
           btrim(coalesce(t.e->>'직무', ''))              AS job,
           btrim(coalesce(t.e->>'요구 학력', ''))          AS education,
           btrim(coalesce(t.e->>'관련 전공', ''))          AS major,
           btrim(coalesce(t.e->>'관련 자격증/면허', ''))   AS certifications,
           t.ord
      FROM jsonb_array_elements(p_skill_rows) WITH ORDINALITY AS t(e, ord)
  ),
  req AS (
    SELECT DISTINCT ON (src.grp, src.ser, src.job)
           src.grp, src.ser, src.job, src.education, src.major, src.certifications
      FROM src
     -- replace는 파일이 진실이므로 세 항목이 모두 빈 직무도 빈 문자열로 덮어쓴다. 그래야 "지웠다"가 반영된다.
     -- (job_requirements에는 active 컬럼이 없어 4단계 비활성화 대상이 아니고, 세 컬럼은 NOT NULL DEFAULT ''다.)
     -- append는 빈 칸을 "손대지 말라"로 읽어 기존 값을 유지한다. 화면 문구가 "추가"이고 확인 모달이 없기 때문이다.
     WHERE p_mode = 'replace'
        OR src.education <> '' OR src.major <> '' OR src.certifications <> ''
     ORDER BY src.grp, src.ser, src.job, src.ord
  ),
  job_ids AS (
    SELECT DISTINCT ON (jg.name, js.name, j.name)
           jg.name AS grp, js.name AS ser, j.name AS job, j.id AS job_id
      FROM public.jobs j
      JOIN public.job_series js ON js.id = j.series_id
      JOIN public.job_groups jg ON jg.id = j.group_id
     WHERE j.company_id = p_company_id AND j.source_version = 1 AND j.active
     ORDER BY jg.name, js.name, j.name, j.updated_at DESC
  )
  INSERT INTO public.job_requirements (job_id, education, major, certifications, updated_by)
  SELECT ji.job_id, req.education, req.major, req.certifications, v_actor
    FROM req
    JOIN job_ids ji ON ji.grp = req.grp AND ji.ser = req.ser AND ji.job = req.job
  ON CONFLICT (job_id) DO UPDATE
    SET education = EXCLUDED.education,
        major = EXCLUDED.major,
        certifications = EXCLUDED.certifications,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  ------------------------------------------------------------------
  -- 7. 건수 집계
  --    한 트랜잭션 안에서 위 단계가 모두 성공했으므로, 입력 기준 건수 = 반영된 건수다.
  --    화면 검증 단계에서 보여 준 숫자(integratedUploadUtils.ts)와 같은 정의를 쓴다.
  ------------------------------------------------------------------
  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))     AS grp,
           btrim(coalesce(t.e->>'직렬', ''))     AS ser,
           btrim(coalesce(t.e->>'직무', ''))     AS job,
           btrim(coalesce(t.e->>'주요과업', '')) AS task,
           btrim(coalesce(t.e->>'세부활동', '')) AS activity
      FROM jsonb_array_elements(p_job_rows) AS t(e)
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job FROM src) a),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, task FROM src) b),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, task, activity FROM src) c)
    INTO v_job_count, v_task_count, v_activity_count;

  WITH src AS (
    SELECT btrim(coalesce(t.e->>'직군', ''))              AS grp,
           btrim(coalesce(t.e->>'직렬', ''))              AS ser,
           btrim(coalesce(t.e->>'직무', ''))              AS job,
           btrim(coalesce(t.e->>'Skill 구분', ''))        AS skill_type,
           btrim(coalesce(t.e->>'Skill', ''))             AS skill_name,
           btrim(coalesce(t.e->>'요구 학력', ''))          AS education,
           btrim(coalesce(t.e->>'관련 전공', ''))          AS major,
           btrim(coalesce(t.e->>'관련 자격증/면허', ''))   AS certifications
      FROM jsonb_array_elements(p_skill_rows) AS t(e)
  )
  SELECT (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job, skill_type, skill_name FROM src) a),
         (SELECT count(*) FROM (SELECT DISTINCT grp, ser, job FROM src
                                 WHERE education <> '' OR major <> '' OR certifications <> '') b)
    INTO v_skill_count, v_requirement_count;

  RETURN jsonb_build_object(
    'jobCount', v_job_count,
    'taskCount', v_task_count,
    'activityCount', v_activity_count,
    'skillCount', v_skill_count,
    'requirementCount', v_requirement_count
  );
END;
$fn$;

-- 5-4 / 5-5의 매칭 스캔에 쓸 인덱스. job_tasks에는 인덱스가 하나도 없었고(20260812084909),
-- task_activities에는 job_task_id 단독 인덱스만 있었다(idx_task_activities_task).
-- 전사 직무 파일(세부활동 수천 행)에서 8초(authenticated 기본 statement_timeout)를 넘길 위험을 줄인다.
CREATE INDEX IF NOT EXISTS idx_job_tasks_job_name ON public.job_tasks (job_id, name);
CREATE INDEX IF NOT EXISTS idx_task_activities_task_name ON public.task_activities (job_task_id, activity_name);

REVOKE EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_integrated_job_data(uuid, text, jsonb, jsonb) IS
  '관리자 직무정보 통합 업로드. 한 트랜잭션으로 직군·직렬·직무·주요과업·세부활동·Skill·수행요건을 적재한다. replace는 삭제 대신 active=false로 내리고 파일에 있는 행을 같은 id로 되살려 검토 이력을 보존한다.';
