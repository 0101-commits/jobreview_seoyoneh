/*
# [미완] save_integrated_job_data RPC 정의 누락 — 계약 문서

이 파일에는 실행되는 SQL이 없다. 운영 DB에만 존재하고 저장소에는 없는 RPC의 계약을 적어 둔 문서다.

## 무엇이 문제인가
`src/lib/integratedJobApi.ts:53`이 `supabase.rpc('save_integrated_job_data', ...)`를 호출하는데,
supabase/migrations 10개 어디에도 이 함수의 CREATE FUNCTION이 없다(grep 0건).
운영 DB에는 있지만 저장소에는 없어, 새 환경으로 마이그레이션을 처음부터 적용하면
관리자 직무정보 업로드가 통째로 실패한다. 재현 불가능한 상태다.

## 어떻게 복구하는가 (반드시 이 순서로)
추측으로 새로 작성하면 운영 정의와 어긋나 데이터 사고가 된다. 반드시 운영 DB에서 덤프한다.

  SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_integrated_job_data';

덤프 결과를 새 마이그레이션 파일(예: 20260828011500_add_save_integrated_job_data.sql)에 그대로 넣고,
아래 계약과 일치하는지 대조한 뒤 이 TODO 파일을 지운다.
같은 방법으로 아래 항목도 함께 점검할 것(저장소에 정의가 있는지 확인되지 않음):
- admin-create-user 엣지 함수 (sync_sme_assignments를 호출하는 쪽)

## 호출부에서 확인된 계약

### 인자 (src/lib/integratedJobApi.ts:53-58)
- p_company_id uuid
    `fetchFixedCompanyId()`가 companies.name = '서연이화'로 조회한 id. 업로드는 이 한 회사로 고정돼 있다.
- p_mode text
    'append' = 기존 데이터에 추가(기존 검토 이력 유지)
    'replace' = 새 버전으로 전체 교체(기존 제출 피드백은 유지)
    화면 문구 기준(src/components/UploadPage.tsx:191-204)이며, 두 모드 모두 검토 이력(job/task/skill_feedback)을
    삭제하면 안 된다. 기존 jobApi.saveStep1Data가 하듯 active=false 로 내리는 방식이어야 한다.
- p_job_rows jsonb
    '직무 및 과업 정보' Sheet의 행 배열. 각 원소 키(IntegratedJobRow, 한글 키 그대로):
      직군, 직렬, 직무, 직무정의, 주요과업, 세부활동   — 6개 모두 필수(빈 값은 업로드 검증에서 이미 걸러진다)
- p_skill_rows jsonb
    'Skill 및 수행요건' Sheet의 행 배열. 각 원소 키(IntegratedSkillRow):
      직군, 직렬, 직무, Skill 구분, Skill, 요구 학력, 관련 전공, 관련 자격증/면허
      직군·직렬·직무·Skill 구분·Skill 은 필수. 'Skill 구분'은 'Hard Skill' 또는 'Soft Skill'만 허용.
      요구 학력/관련 전공/관련 자격증/면허 3개는 비어 있을 수 있다(경고만).

### 클라이언트가 이미 보장하는 것 (src/lib/integratedUploadUtils.ts, RPC가 다시 할 필요 없음)
- 두 Sheet 존재·헤더 순서 검증
- 필수값 누락 검증
- 같은 직무(직군|직렬|직무)에 서로 다른 직무정의가 오면 에러
- 중복 세부활동 행 / 중복 Skill 행 제거
- Skill Sheet의 직무가 직무 Sheet에 없으면 에러
- 직무별 수행요건 1건 정규화

### RPC가 해야 하는 일
p_company_id 범위 안에서 아래를 한 트랜잭션으로 적재한다.
- job_groups   : (company_id, name, source_version) 기준 upsert
- job_series   : (company_id, group_id, name, source_version) 기준 upsert
- jobs         : (company_id, series_id, name, source_version) 기준 upsert, definition = 직무정의
- job_tasks    : job별 주요과업, sort_order = 등장 순서
- task_activities : job_task별 세부활동, sort_order = 등장 순서
- job_skills   : job별 Skill, skill_type = 'Skill 구분', sort_order = 등장 순서
- job_requirements : job당 1행 upsert(onConflict job_id), education/major/certifications
- p_mode = 'replace'이면 해당 company의 기존 행을 active=false로 내린 뒤 새로 적재한다(삭제 금지).

주의: jobs에는 `CREATE UNIQUE INDEX idx_jobs_unique_active ON jobs(group_id, series_id, name) WHERE active = true`
(20260813035903 마이그레이션)가 걸려 있다. replace 시 비활성화보다 삽입이 먼저 오면 이 인덱스에서 충돌한다.

### 반환값 (src/lib/integratedJobApi.ts:62-69)
JSON 객체 하나. camelCase와 snake_case 둘 다 읽도록 되어 있다.
  { jobCount, taskCount, activityCount, skillCount, requirementCount }
  또는 { job_count, task_count, activity_count, skill_count, requirement_count }
누락된 키는 0으로 처리된다.

### 보안
호출 주체는 로그인한 관리자다. SECURITY DEFINER를 쓰지 말고 기본(INVOKER)으로 두면
job_groups/jobs/job_tasks/... 의 기존 `*_admin_insert` / `*_admin_update` 정책(public.is_admin())이 그대로 적용된다.
운영 정의가 SECURITY DEFINER라면 함수 첫머리에 `IF NOT public.is_admin() THEN RAISE EXCEPTION` 가드가 있는지 반드시 확인할 것.
*/
