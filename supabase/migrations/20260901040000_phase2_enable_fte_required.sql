/*
# Phase 2 — FTE 합계 게이트 켜기 (survey_settings.fte_required = true)

기준: docs/PLAN.txt §7-2 「제출 게이트」 ③, §10 P2 DoD ② "합계 100% 미만이면 다음·제출 모두 차단(클라+서버)".

1. 왜 이 파일이 따로 있나
- 20260901020000_phase1_survey_schema.sql 은 fte_required 의 기본값을 false(꺼짐)로 두었다.
  FTE 입력 화면(STEP 3)이 Phase 2 에 오기 때문이다 — 화면보다 게이트를 먼저 켜면 배분 행이
  0 인 채로 검사가 돌아 SME 전원의 제출이 막힌다. 그 파일의 3항이 "FTE 입력 화면이 배포되는
  Phase 2 에서 true 로 올리는 가산 마이그레이션을 그때 추가한다"고 인수인계를 적어 두었고,
  이 파일이 그 인계다.
- 켜지 않으면 submit_review 의 FTE 검증(FTE_EMPTY·FTE_SUM)이 통째로 건너뛰어진다.
  클라이언트(STEP 3 게이트·제출 전 재확인)만 막는 상태가 되고, RPC 를 직접 부르면
  합계 60% 도, 배분 0 행도 제출된다. DoD ② 의 "서버" 절반이 그 상태에서는 비어 있다.

2. 무엇을 하나
- companies 의 전 회사에 대해 survey_settings 행을 만들고 fte_required 를 true 로 올린다.
  나머지 설정(due_date·expected_minutes·guide_md·inquiry_contact)은 건드리지 않는다.
- 여러 번 실행해도 결과가 같다(ON CONFLICT DO UPDATE). 새로 만들어진 회사는 survey_settings
  행이 없어 꺼진 것으로 보이므로, 회사를 추가한 뒤에는 관리자 설정 화면이나 이 문장을
  다시 한 번 실행해 켠다.

3. 되돌리기
- 특정 회사만 끄려면:  UPDATE public.survey_settings SET fte_required = false, updated_at = now()
                       WHERE company_id = '<회사 id>';
- 전부 끄려면 아래 INSERT 의 true 두 곳을 false 로 바꿔 실행한다.
- 스위치는 회사 단위다. 직무(jobs.company_id)도 배정(review_assignments.company_id)도 비어 있는
  검토는 어느 회사 설정에도 걸리지 않아 언제나 꺼진 것으로 본다(Phase 1 적용 문서와 같다).
*/

INSERT INTO public.survey_settings (company_id, fte_required)
SELECT c.id, true FROM public.companies c
ON CONFLICT (company_id) DO UPDATE SET fte_required = true, updated_at = now();
