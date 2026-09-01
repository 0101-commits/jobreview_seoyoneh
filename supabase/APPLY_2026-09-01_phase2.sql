/* =====================================================================
   Job Review — 2026-09-01 Phase 2 (FTE 입력 화면 배포 후) 운영 DB 적용 SQL

   ▣ 무엇을 적용하나
     20260901040000_phase2_enable_fte_required.sql 한 벌이다.
     survey_settings.fte_required 를 회사 단위로 true 로 올려, submit_review 의 FTE 합계 검증
     (§7-2 제출 게이트 ③)을 켠다. Phase 1 적용 문서(APPLY_2026-09-01_phase1.sql) 의 ★ 항목이
     "Phase 2 의 FTE 화면을 배포한 뒤 아래를 실행해 회사 단위로 켠다"고 남겨 둔 그 SQL 이다.

   ▣ 실행 시점 — 반드시 STEP 3(투입 비중 배분) 화면이 배포된 뒤다
     화면보다 먼저 켜면 배분 행이 하나도 없어 SME 는 아무도 제출할 수 없다
     ("FTE를 배분하지 않았습니다"). 배포 순서를 지키면 그런 상태가 생기지 않는다.

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트 → 왼쪽 메뉴 SQL Editor.
     2. New query 에 이 파일 전체를 붙여넣고 Run.
     3. 여러 번 실행해도 안전하다(ON CONFLICT DO UPDATE).

   ▣ 적용 후 확인
     -- 회사별 스위치 상태(전부 t 여야 한다)
     SELECT c.name, s.fte_required FROM public.companies c
       LEFT JOIN public.survey_settings s ON s.company_id = c.id ORDER BY c.name;

     -- 어느 회사에도 매이지 않아 게이트가 걸리지 않는 검토(0행이면 신경 쓸 것 없다)
     SELECT r.id FROM public.reviews r
       JOIN public.jobs j ON j.id = r.job_id
      WHERE j.company_id IS NULL;

   ▣ 되돌리기
     아래 INSERT 의 true 두 곳을 false 로 바꿔 다시 실행한다.
   ===================================================================== */

INSERT INTO public.survey_settings (company_id, fte_required)
SELECT c.id, true FROM public.companies c
ON CONFLICT (company_id) DO UPDATE SET fte_required = true, updated_at = now();
