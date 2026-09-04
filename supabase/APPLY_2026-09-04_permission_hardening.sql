/*
# APPLY — 권한 조이기 3건 (2026-09-04)

원본: `supabase/migrations/20260904020000_permission_hardening.sql`
기획서: `docs/PLAN_2026-09-04_IMPROVEMENT.md` P1-5 · P1-6 · P1-18

## 무엇을 막는가
| # | 지금 가능한 것 | 조치 |
|---|---|---|
| 1 | 관리자 세션 하나로 브라우저 콘솔에서 `set_profile_role` 을 불러 「마지막 관리자」 방어를 우회 | 그 RPC 의 실행 권한 회수(함수는 복구용으로 남긴다) |
| 2 | SME 계정 하나로 **남의 검토에** `APPROVED` 같은 상태 전이 이력을 위조 — E5 산출물에 그대로 실린다 | INSERT 정책에 본인 배정 검사 추가 |
| 3 | SME 계정 하나로 핵심 표를 통째로 비우기(TRUNCATE 는 RLS 를 거치지 않는다) | 기반 19표에 TRUNCATE 회수 |

## 화면 배포와의 순서
**제약 없다.** 이 셋을 부르는 클라이언트 코드가 없어서 화면 동작이 바뀌지 않는다.
앞서 적용해도, 나중에 적용해도 같다.

## 적용 후 되돌리기
1번을 되돌리려면 `GRANT EXECUTE ON FUNCTION public.set_profile_role(uuid, text) TO authenticated;`
2번은 이전 정책이 `WITH CHECK (actor_id = auth.uid() OR public.is_admin())` 이었다.

## 재실행 안전
REVOKE · DROP POLICY IF EXISTS · CREATE POLICY 로만 되어 있다.
*/

/* ── 1. set_profile_role RPC 를 브라우저에서 떼어 낸다 (P1-5) ──────────────
 *
 * 이 함수는 is_admin() 하나만 보고 임의 프로필의 role 을 바꾼다. 세 가지가 없다:
 *   · 마지막 활성 관리자 강등 방어  · 자기 자신 강등 방어  · 감사 기록
 * Edge Function 의 set-role 모드에는 셋 다 있다. 그런데 이 RPC 가 authenticated 에게
 * 열려 있어서, 관리자 세션 하나면 브라우저 콘솔의 supabase.rpc('set_profile_role', …)
 * 한 줄로 그 방어를 전부 지나칠 수 있었다. 관리자가 자기를 sme 로 내리면 로그인 가능한
 * 관리자가 0명이 되고, 그 상태는 UI 로 복구할 수 없다(BOOTSTRAP SQL 이 유일한 경로다).
 *
 * 함수는 지우지 않는다 — SQL Editor 에서 손으로 고치는 복구 경로로 남긴다.
 * 지금 이 RPC 를 부르는 클라이언트 코드는 0건이다(`grep -rn set_profile_role src/` → 0).
 */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_profile_role'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.set_profile_role(uuid, text) FROM authenticated, anon';
  END IF;
END $$;

/* ── 2. review_history 위조를 막는다 (P1-6) ───────────────────────────────
 *
 * 기존 정책은 `with check (actor_id = auth.uid() or public.is_admin())` 뿐이었다.
 * review_id 가 본인 것인지 보지 않으므로, SME 계정 하나로 **남의 검토에** 임의 행위
 * (예: action='APPROVED')를 끼워 넣을 수 있었다. 그 행은 E5 산출물의 '상태 전이 이력'
 * 시트와 검토 이력 화면에 그대로 실린다 — 반려 사유도 이 표의 note 다.
 * 관리자 분기는 더 넓어서 actor_id 검사가 아예 없었다(남의 이름으로 이력을 남길 수 있었다).
 *
 * 새 규칙: **actor_id 는 언제나 본인**이어야 하고, 그 위에
 *   · 관리자면 통과(승인·반려 이력은 관리자가 남긴다)
 *   · SME 면 그 검토가 자기 배정일 때만 통과
 * reviews 에는 소유자 컬럼이 없다 — 소유는 review_assignments.sme_id 로만 정해진다.
 *
 * 상태 전이 이력을 실제로 쓰는 것은 SECURITY DEFINER RPC 들(submit_review · decide_review ·
 * request_rereview)이고, 그것들은 소유자 권한으로 돌아 RLS 를 지나가므로 영향받지 않는다.
 * 클라이언트가 이 표에 INSERT 하는 코드는 0건이다(`grep -rn review_history src/` → 조회뿐).
 */
DROP POLICY IF EXISTS "history_insert" ON public.review_history;
CREATE POLICY "history_insert" ON public.review_history
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1
          FROM public.reviews r
          JOIN public.review_assignments a ON a.id = r.assignment_id
         WHERE r.id = review_history.review_id
           AND a.sme_id = auth.uid()
      )
    )
  );

/* ── 3. TRUNCATE 회수를 기반 표까지 넓힌다 (P1-18) ────────────────────────
 *
 * Phase 0 이 audit_logs 에, Phase 1 이 신규 7표에 이미 같은 회수를 걸었고 그 이유를
 * 이렇게 적었다 — "Supabase 기본 권한이 새 표에 TRUNCATE 까지 주고 TRUNCATE 는 RLS 를
 * 아예 거치지 않으므로, 회수하지 않으면 SME 계정 하나로 표 전체를 지울 수 있다."
 * 그런데 정작 기반 15표에는 그 회수가 걸리지 않았다. 같은 판단을 내려 놓고 적용 범위가
 * 표의 3분의 1이었다.
 *
 * INSERT·UPDATE·DELETE 는 회수하지 않는다 — 그쪽은 RLS 정책이 판정하고 있고, 회수하면
 * SME 의 정상 저장까지 막힌다. RLS 를 거치지 않는 TRUNCATE 만 떼어 낸다.
 */
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'companies', 'job_groups', 'job_series', 'jobs', 'job_tasks', 'job_skills',
    'job_requirements', 'task_activities', 'review_assignments', 'reviews', 'job_feedback',
    'task_feedback', 'skill_feedback', 'new_task_suggestions', 'new_skill_suggestions',
    'review_history', 'upload_history', 'activity_feedback'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- 확인 — 세 값이 모두 기대대로여야 한다.
SELECT
  -- 1) authenticated 에게 실행 권한이 없어야 한다 → false
  has_function_privilege('authenticated', 'public.set_profile_role(uuid, text)', 'EXECUTE') AS RPC실행가능_false여야함,
  -- 2) 새 정책의 조건에 review_assignments 검사가 들어 있어야 한다 → true
  (SELECT with_check LIKE '%review_assignments%'
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_history' AND policyname = 'history_insert')
    AS 이력정책_소유검사있음_true여야함,
  -- 3) TRUNCATE 권한이 남은 표가 없어야 한다 → 0
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
      AND grantee IN ('anon', 'authenticated')) AS TRUNCATE남은표수_0이어야함;
