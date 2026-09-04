/*
# 예시 직무 — 인사팀 「인사운영」을 만들고 김과장에게 배정한다 (2026-09-04)

## 무엇을 하는가
SME 가 검토 화면에서 실제로 무엇을 보게 되는지 확인할 수 있도록, **채워진 직무 한 건**을 만든다.
과업 6건 · 각 과업의 세부활동 3~4건 · Skill 8건 · 수행요건까지 들어 있어 5단계를 끝까지 돌려볼 수 있다.

- 직군 `경영지원` · 직렬 `인사` (없으면 만든다)
- 직무 `인사운영` — 인사팀 실무자 자리
- 김과장에게 배정한다. 김과장 계정이 없으면 **SME 계정을 함께 만든다**(로그인 ID·초기 비밀번호는 아래 확인 쿼리에 나온다)

## 실행 위치
Supabase 대시보드 → SQL Editor.

## 안전성 · 재실행
- 전부 "있으면 쓰고 없으면 만든다"라 여러 번 실행해도 직무가 늘어나지 않는다.
- 이미 있는 직무의 과업·Skill 을 지우거나 덮지 않는다. 처음 만들 때만 채운다.
- 다른 직무·다른 계정은 건드리지 않는다.

## 지우고 싶을 때
직무 목록 화면의 「목록에서 내리기」를 쓴다(active=false). 하드 삭제는 하지 않는다 —
검토 응답이 이 행을 참조한다.

## 주의
`v_password` 는 예시 계정용이다. 실제 조사에 쓸 계정이라면 발급 후 관리자 화면에서 재발급한다.
*/

DO $sample_hr$
DECLARE
  -- ▼▼▼ 필요할 때만 고친다 ▼▼▼
  v_sme_name   text := '김과장';
  v_emp_no     text := 'HR0001';           -- 로그인 ID 는 사번@seoyoneh.local 규칙을 따른다
  v_org        text := '인사팀';
  v_title      text := '과장';
  v_password   text := 'Sample1234';       -- 정책: 8자 이상 + 영문 + 숫자
  v_group_name text := '경영지원';
  v_series_name text := '인사';
  v_job_name   text := '인사운영';
  -- ▲▲▲ 여기까지 ▲▲▲

  v_company    uuid;
  v_group      uuid;
  v_series     uuid;
  v_job        uuid;
  v_sme        uuid;
  v_email      text;
  v_task       uuid;
  v_fresh_job  boolean := false;
  v_admin      uuid;
BEGIN
  v_email := lower(v_emp_no) || '@seoyoneh.local';

  -- 회사 — 활성 회사가 하나면 그것, 여럿이면 멈춘다(어디에 넣을지는 사람이 정한다).
  SELECT id INTO v_company FROM public.companies WHERE active ORDER BY created_at LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION '활성 회사가 없습니다. 운영 설정에서 계열사를 먼저 등록하세요.';
  END IF;
  IF (SELECT count(*) FROM public.companies WHERE active) > 1 THEN
    RAISE NOTICE '활성 회사가 여러 개입니다. 가장 먼저 만들어진 회사(%)에 넣습니다.', v_company;
  END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' AND active ORDER BY created_at LIMIT 1;

  -- 직군 · 직렬
  SELECT id INTO v_group FROM public.job_groups
   WHERE name = v_group_name AND active AND company_id = v_company;
  IF v_group IS NULL THEN
    INSERT INTO public.job_groups (name, company_id) VALUES (v_group_name, v_company) RETURNING id INTO v_group;
  END IF;

  SELECT id INTO v_series FROM public.job_series
   WHERE name = v_series_name AND group_id = v_group AND active;
  IF v_series IS NULL THEN
    INSERT INTO public.job_series (name, group_id, company_id)
    VALUES (v_series_name, v_group, v_company) RETURNING id INTO v_series;
  END IF;

  -- 직무
  SELECT id INTO v_job FROM public.jobs
   WHERE name = v_job_name AND group_id = v_group AND series_id = v_series AND company_id = v_company;
  IF v_job IS NULL THEN
    INSERT INTO public.jobs (company_id, group_id, series_id, name, definition, created_by)
    VALUES (
      v_company, v_group, v_series, v_job_name,
      '임직원의 입사부터 퇴사까지의 인사 기록과 제도 운영을 담당한다. 채용 진행, 인사발령과 근태·급여 기초자료 관리, '
      || '평가·보상 운영 지원, 노무 관련 문의 대응을 수행하여 인사 데이터의 정확성과 제도 운영의 일관성을 유지한다.',
      v_admin
    ) RETURNING id INTO v_job;
    v_fresh_job := true;
  END IF;

  -- 과업·세부활동·Skill·수행요건은 **직무를 이번에 처음 만들 때만** 채운다.
  -- 이미 있는 직무에 다시 넣으면 SME 가 검토 중인 항목이 중복된다.
  IF v_fresh_job THEN
    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T1', '채용 운영',
            '채용 요청 접수부터 입사 확정까지의 절차를 진행하고 관련 기록을 남긴다.', 1)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '부서 채용요청서 접수·요건 확인', 1),
      (v_task, '채용공고 게시 및 지원자 접수 관리', 2),
      (v_task, '면접 일정 조율과 면접 결과 취합', 3),
      (v_task, '처우 협의 지원 및 입사 확정 통보', 4);

    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T2', '인사발령·인사기록 관리',
            '입·퇴사와 이동·승진 발령을 처리하고 인사기록을 최신 상태로 유지한다.', 2)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '입사·퇴사 처리 및 4대보험 신고', 1),
      (v_task, '부서이동·승진 발령 기안과 통보', 2),
      (v_task, '인사기록카드·조직도 갱신', 3);

    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T3', '근태·급여 기초자료 관리',
            '근태 자료를 확정하고 급여 계산에 필요한 기초자료를 정리해 넘긴다.', 3)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '월 근태 마감 및 연장근로 확인', 1),
      (v_task, '연차 발생·사용 현황 관리', 2),
      (v_task, '급여 변동사항(수당·공제) 정리·전달', 3);

    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T4', '평가·보상 운영 지원',
            '평가 일정과 대상자를 관리하고 보상 반영에 필요한 자료를 준비한다.', 4)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '평가 대상자 확정 및 일정 안내', 1),
      (v_task, '평가 진행률 점검·미제출자 독려', 2),
      (v_task, '평가 결과 집계와 보상 반영 자료 작성', 3);

    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T5', '노무·인사제도 문의 대응',
            '임직원과 현업의 인사·노무 문의에 답하고 필요한 경우 규정을 확인해 안내한다.', 5)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '취업규칙·인사규정 해석 및 안내', 1),
      (v_task, '휴직·복직 절차 안내와 처리', 2),
      (v_task, '노무 이슈 발생 시 사실관계 정리·보고', 3);

    INSERT INTO public.job_tasks (job_id, task_id, name, description, sort_order)
    VALUES (v_job, 'HR-T6', '인사 데이터 집계·보고',
            '인원 현황과 인건비 등 정기 인사지표를 집계해 보고한다.', 6)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activities (job_task_id, activity_name, sort_order) VALUES
      (v_task, '월별 인원 현황·증감 집계', 1),
      (v_task, '이직률·평균 근속 등 지표 산출', 2),
      (v_task, '경영진 보고자료 작성', 3);

    INSERT INTO public.job_skills (job_id, skill_id, name, description, skill_type, sort_order) VALUES
      (v_job, 'HR-S1', '노동법규 이해',      '근로기준법·취업규칙을 실무 사안에 적용해 판단할 수 있다.', '직무지식', 1),
      (v_job, 'HR-S2', '인사제도 운영',      '채용·평가·보상 제도의 절차와 기준을 알고 운영할 수 있다.', '직무지식', 2),
      (v_job, 'HR-S3', '급여·4대보험 실무',  '근태·수당·공제 항목을 확인하고 신고 절차를 처리할 수 있다.', '직무지식', 3),
      (v_job, 'HR-S4', 'HR 시스템 활용',     '인사정보시스템에 기록을 정확히 입력·조회할 수 있다.',       '직무기술', 4),
      (v_job, 'HR-S5', '엑셀 데이터 처리',   '인사 데이터를 집계·검산해 보고자료를 만들 수 있다.',         '직무기술', 5),
      (v_job, 'HR-S6', '문서 작성',          '발령·공지·보고 문서를 규정에 맞게 작성할 수 있다.',          '직무기술', 6),
      (v_job, 'HR-S7', '커뮤니케이션',       '민감한 인사 사안을 상대가 이해하도록 설명할 수 있다.',       '공통역량', 7),
      (v_job, 'HR-S8', '기밀 유지',          '인사 정보의 취급 범위를 지키고 유출 위험을 관리한다.',       '공통역량', 8);

    INSERT INTO public.job_requirements (job_id, education, major, certifications)
    VALUES (v_job, '학사 이상', '경영학·행정학·법학 등 인문사회 계열',
            '공인노무사(우대), 경영지도사(우대), 컴퓨터활용능력 2급 이상(우대)');
  END IF;

  -- 김과장 — 이름으로 찾는다. 없으면 SME 계정을 만든다.
  SELECT id INTO v_sme FROM public.profiles
   WHERE role = 'sme' AND name = v_sme_name AND company_id = v_company
   ORDER BY created_at LIMIT 1;

  IF v_sme IS NULL THEN
    SELECT id INTO v_sme FROM public.profiles WHERE lower(email) = v_email;
  END IF;

  IF v_sme IS NULL THEN
    v_sme := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_sme, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_sme_name), now(), now(),
      '', '', '', '', '', '', '', ''
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_sme::text, v_sme,
      jsonb_build_object('sub', v_sme::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );

    INSERT INTO public.profiles (id, email, name, organization, title, employee_number, role, active, company_id)
    VALUES (v_sme, v_email, v_sme_name, v_org, v_title, v_emp_no, 'sme', true, v_company);

    RAISE NOTICE 'SME 계정을 새로 만들었습니다: % / % (초기 비밀번호 %)', v_sme_name, v_email, v_password;
  ELSE
    RAISE NOTICE 'SME 계정을 찾았습니다: % (id=%)', v_sme_name, v_sme;
  END IF;

  -- 배정 — 이미 있으면 다시 살린다(해제돼 있었을 수 있다).
  INSERT INTO public.review_assignments (sme_id, job_id, active, created_by)
  VALUES (v_sme, v_job, true, v_admin)
  ON CONFLICT (sme_id, job_id) DO UPDATE SET active = true;

  RAISE NOTICE '예시 직무 준비 완료: % (id=%) → %', v_job_name, v_job, v_sme_name;
END
$sample_hr$;

-- 확인 — 한 행이 나오고 과업 6 · 세부활동 20 · Skill 8 · 배정 true 면 그대로 검토를 시작할 수 있다.
SELECT
  j.name                                                             AS 직무,
  g.name                                                             AS 직군,
  s.name                                                             AS 직렬,
  (SELECT count(*) FROM public.job_tasks t WHERE t.job_id = j.id AND t.active)          AS 과업수,
  (SELECT count(*) FROM public.task_activities a
     JOIN public.job_tasks t2 ON t2.id = a.job_task_id
    WHERE t2.job_id = j.id AND a.active)                             AS 세부활동수,
  (SELECT count(*) FROM public.job_skills k WHERE k.job_id = j.id AND k.active)         AS Skill수,
  (SELECT count(*) FROM public.job_requirements r WHERE r.job_id = j.id)                AS 수행요건,
  p.name                                                             AS 담당SME,
  p.email                                                            AS 로그인ID,
  ra.active                                                          AS 배정활성
FROM public.jobs j
JOIN public.job_groups g ON g.id = j.group_id
JOIN public.job_series s ON s.id = j.series_id
LEFT JOIN public.review_assignments ra ON ra.job_id = j.id
LEFT JOIN public.profiles p ON p.id = ra.sme_id
WHERE j.name = '인사운영';
