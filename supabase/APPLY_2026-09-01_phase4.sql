/* =====================================================================
   Job Review — 2026-09-01 Phase 4 (운영·산출) 운영 DB 적용 SQL (한 벌)

   ▣ 무엇을 적용하나
     20260901050000_phase4_settings_columns.sql 한 벌이다. 실행 SQL 은 ALTER TABLE 두 줄뿐이다.
       - survey_settings 에 reminder_subject · reminder_body_md (둘 다 nullable text) 추가.
         §6-3 ⓒ 설정 항목의 "리마인더 템플릿"을 담을 자리다. Phase 1 스키마에는 이 컬럼이 없어
         /settings 화면이 리마인더 문구를 받아 둘 곳이 없었다.

     Phase 4 의 나머지(Export 5종 · FTE 분포 화면 · 리마인더 발송 · 수동 스냅샷)는 전부
     화면·Edge Function 이고 DDL 이 없다. 그래서 이 파일은 짧다.

   ▣ 실행 시점 — 화면 배포 앞뒤 어느 쪽이어도 안전하다
     Phase 2 적용 문서와 달리 순서 제약이 없다.
       · 이 SQL 을 먼저 적용하면 → 배포 즉시 리마인더 템플릿 입력이 열린다.
       · 화면을 먼저 배포하면 → src/lib/settingsApi.ts 가 첫 조회에서 42703("그런 컬럼 없음")을
         한 번 보고 컬럼이 없다고 판정한 뒤, 나머지 컬럼만 읽고 리마인더 입력을 비활성으로 둔다.
         마감일·예상 소요·가이드 문구·문의 담당·FTE 스위치는 그 상태에서도 정상 저장된다.
         (판정 결과는 브라우저 탭 단위로 기억한다. 이 SQL 을 적용한 뒤에는 화면을 새로고침해야
          입력이 열린다.)

   ▣ 실행 방법
     1. Supabase 대시보드 → 해당 프로젝트 → 왼쪽 메뉴 SQL Editor.
     2. New query 에 이 파일 전체를 붙여넣고 Run.
     3. ADD COLUMN IF NOT EXISTS / COMMENT ON 뿐이라 여러 번 실행해도 안전하다.
        행을 지우거나 바꾸지 않는다. 기존 행에는 NULL 이 들어가고, 그것이 "템플릿 미설정"이다.

   ▣ 적용 후 확인
     -- (1) 두 컬럼이 생겼나(2행이 나와야 한다)
     SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'survey_settings'
        AND column_name IN ('reminder_subject','reminder_body_md');

     -- (2) 기존 설정 값이 그대로인가(행 수가 적용 전과 같아야 한다)
     SELECT count(*) FROM public.survey_settings;

     -- (3) 회사별 설정 현황 — 템플릿은 아직 전부 NULL 이 정상이다
     SELECT c.name, s.due_date, s.expected_minutes, s.fte_required,
            (s.reminder_subject IS NOT NULL) AS has_subject,
            (s.reminder_body_md IS NOT NULL) AS has_body
       FROM public.companies c
       LEFT JOIN public.survey_settings s ON s.company_id = c.id
      ORDER BY c.name;

   ▣ 함께 확인할 것 — 리마인더 메일(§10 P4 DoD ③). SQL 이 아니라 대시보드 설정이다
     supabase/functions/send-reminder 를 배포해야 /progress 의 리마인더 발송이 동작한다.
       1. Edge Function 배포: supabase functions deploy send-reminder
       2. 시크릿(값은 대시보드에만 둔다. 이 저장소·코드에 절대 적지 않는다):
            RESEND_API_KEY     없어도 된다. 없으면 아무것도 보내지 않고 mail_logs 에
                               simulated = true 로만 기록한다 — 그것이 P4 DoD ③ 이다.
            RESEND_FROM        RESEND_API_KEY 를 넣었다면 반드시 함께 넣는다.
                               키만 있고 이 값이 없으면 함수가 조용히 시뮬레이션으로 내려가지 않고
                               설정 누락을 명시적 오류로 반환한다(무엇이 빠졌는지 알 수 있게).
            RESEND_REPLY_TO    선택.
          SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Edge Function 런타임이 자동으로 넣어 준다.
       3. mail_logs 기록 경로 — 정책이 아니라 권한으로 통한다.
          20260901020000 ⑦ 이 mail_logs 의 INSERT 정책을 만들지 않고(정책 없음 = 거부)
          anon·authenticated 의 INSERT/UPDATE/DELETE 를 회수했다. 기록은 Edge Function 의
          service_role 클라이언트로만 들어간다(admin-create-user 와 같은 방식). 확인:
            SELECT kind, simulated, sent_at FROM public.mail_logs ORDER BY sent_at DESC LIMIT 10;
          이 SELECT 는 ADMIN 만 된다(mail_logs_admin_select).

   ▣ 되돌리기
     ALTER TABLE public.survey_settings
       DROP COLUMN IF EXISTS reminder_subject,
       DROP COLUMN IF EXISTS reminder_body_md;
     저장해 둔 문구가 함께 사라진다. 화면은 다시 "저장 위치 준비 중"으로 돌아가고,
     리마인더는 발송 화면의 기본 문구로 나간다.
   ===================================================================== */

ALTER TABLE public.survey_settings
  ADD COLUMN IF NOT EXISTS reminder_subject text,
  ADD COLUMN IF NOT EXISTS reminder_body_md text;

COMMENT ON COLUMN public.survey_settings.reminder_subject IS
  '리마인더 메일 제목 템플릿(치환 토큰 포함 평문). NULL = 미설정 → mailApi.DEFAULT_TEMPLATES 사용.';
COMMENT ON COLUMN public.survey_settings.reminder_body_md IS
  '리마인더 메일 본문 템플릿(치환 토큰 포함 평문). 마크다운으로 렌더링하지 않는다. NULL = 미설정.';
