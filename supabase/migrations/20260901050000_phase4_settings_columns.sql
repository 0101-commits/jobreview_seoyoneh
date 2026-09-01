/*
# Phase 4 — 운영 설정에 리마인더 템플릿 컬럼 추가 (survey_settings)

기준: docs/PLAN.txt §6-3 ⓒ 「설정 — 마감일(D-day 계산 원점), 예상 소요 N분, 가이드 문구(마크다운),
      문의 담당 표기, 리마인더 템플릿」, §11-2 Phase 4 2번.

1. 문제
- §6-3 ⓒ 와 Phase 4 지시가 설정 항목에 "리마인더 템플릿"을 넣었으나,
  20260901020000_phase1_survey_schema.sql 의 survey_settings 에는 그것을 담을 컬럼이 없다
  (due_date · expected_minutes · guide_md · inquiry_contact · fte_required · updated_at 뿐이다).
- 컬럼이 없으면 /settings 화면은 리마인더 문구를 받아 둘 곳이 없고, /progress 의 리마인더 발송은
  매번 기본 문구에서 다시 고쳐 써야 한다. 회차마다 문구가 달라지면 "무엇을 보냈는가"가 남지 않는다.

2. 조치
- survey_settings 에 nullable text 두 컬럼을 더한다.
    reminder_subject   메일 제목 템플릿
    reminder_body_md   메일 본문 템플릿
  치환 토큰({{이름}} · {{직무}} · {{마감일}} · {{남은일수}} · {{예상소요}} · {{문의담당}} · {{링크}})이 든
  평문을 그대로 담는다. 치환은 브라우저의 src/lib/mailApi.ts renderTemplate 한 곳에서만 한다
  (미리보기와 실제 발송이 같은 함수를 통과해야 "미리보기에 보인 문장 = 나간 문장"이 성립한다).
- 기본값(DEFAULT)을 두지 않는다. NULL·빈 문자열 = "저장된 템플릿 없음"이고, 그때 화면이
  mailApi.DEFAULT_TEMPLATES 를 쓴다. 기본 문구를 DB 에도 박아 두면 문구를 고칠 때 고쳐야 할 곳이
  두 군데가 되고, 둘이 어긋나면 어느 쪽이 나갔는지 알 수 없게 된다.
- 이름이 _md 로 끝나지만 마크다운으로 렌더링하지 않는다. guide_md 와 짝을 맞춘 이름일 뿐이고,
  메일 본문은 평문 그대로 나간다(렌더러를 새로 들이지 않는다).

3. 결과
- 적용 후 /settings 의 리마인더 템플릿 입력이 열린다. 적용 전에도 화면은 죽지 않는다 —
  src/lib/settingsApi.ts 가 첫 조회에서 42703(그런 컬럼 없음)을 한 번 보고 컬럼 유무를 판정한 뒤,
  없으면 나머지 컬럼만 읽고 리마인더 입력을 비활성으로 둔다(사유도 화면에 적는다).
  그래서 이 SQL 을 적용하지 않은 DB 에서도 마감일·예상 소요·문의 담당은 그대로 저장된다.

4. 데이터 안전
- 가산적이다. ADD COLUMN IF NOT EXISTS 두 줄뿐이고 기존 행·정책·권한을 건드리지 않는다.
  기존 행에는 NULL 이 들어가며, 그것이 "템플릿 미설정"의 올바른 표현이다.
- 멱등이다. 여러 번 실행해도 결과가 같고 값이 지워지지 않는다.
- RLS·권한은 그대로다. survey_settings 의 쓰기 정책은 public.is_admin() 이므로
  (20260901020000 ⑦) 이 두 컬럼도 관리자만 쓸 수 있다. 컬럼 단위 GRANT 가 걸린 표가 아니라
  별도 GRANT 가 필요 없다(profiles 와 다른 점이다).

5. 되돌리기
- ALTER TABLE public.survey_settings DROP COLUMN IF EXISTS reminder_subject, DROP COLUMN IF EXISTS reminder_body_md;
  저장해 둔 문구가 함께 사라진다. 화면은 다시 "저장 위치 준비 중"으로 돌아간다.
*/

ALTER TABLE public.survey_settings
  ADD COLUMN IF NOT EXISTS reminder_subject text,
  ADD COLUMN IF NOT EXISTS reminder_body_md text;

COMMENT ON COLUMN public.survey_settings.reminder_subject IS
  '리마인더 메일 제목 템플릿(치환 토큰 포함 평문). NULL = 미설정 → mailApi.DEFAULT_TEMPLATES 사용.';
COMMENT ON COLUMN public.survey_settings.reminder_body_md IS
  '리마인더 메일 본문 템플릿(치환 토큰 포함 평문). 마크다운으로 렌더링하지 않는다. NULL = 미설정.';
