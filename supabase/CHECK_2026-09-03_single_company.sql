/*
 * 계열사 단일화(서연이화) 점검 — 2026-09-03.
 *
 * 왜 필요한가.
 *   화면의 계열사 드롭다운은 회사가 1개면 그 회사를 자동으로 골라 놓고 칸을 감춘다
 *   (src/components/shared/CompanyFilterDropdown.tsx). 자동 선택 전에는 '전체 회사'라
 *   company_id 로 거르지 않았으므로 company_id IS NULL 인 옛 행도 목록에 보였다.
 *   자동 선택 뒤에는 모든 조회가 .eq('company_id', 서연이화) 로 좁혀지므로,
 *   company_id 가 비어 있는 행은 오류 없이 조용히 화면에서 사라진다.
 *
 * ── 2026-09-03 프로덕션(yktdlcpovntegiwfnied) 실측 결과 ──────────────
 *   ① companies = 6행 (서연 · 서연씨앤에프 · 서연오토비젼 · 서연이화 · 서연인테크 · 서연탑메탈)
 *      6개 전부 직무·직군·직렬·계정·배정이 0건. survey_settings 만 회사당 1행.
 *   ② company_id IS NULL 은 profiles 1건뿐이고 그 1건이 role='admin' 이었다.
 *      jobs·job_groups·job_series·review_assignments 는 0건.
 *
 *   그래서 ③ 백필은 이 시점에 할 일이 없다. 오히려 관리자 계정을 서연이화 소속으로
 *   잘못 묶는다 — 아래 ③이 role='admin' 을 제외하는 이유다(첫 판에는 이 제외가 없었다).
 *   실제로 남은 일은 ④ 계열사를 1개로 줄이는 것이다.
 *
 * 실행: ①②는 읽기 전용이므로 그대로 붙여 넣는다. ③④는 주석을 풀어야 실행된다.
 */

-- ① 등록된 계열사와 딸린 행 수 ------------------------------------------
SELECT c.id,
       c.name,
       (SELECT count(*) FROM public.jobs               j WHERE j.company_id = c.id) AS "직무",
       (SELECT count(*) FROM public.job_groups         g WHERE g.company_id = c.id) AS "직군",
       (SELECT count(*) FROM public.job_series         s WHERE s.company_id = c.id) AS "직렬",
       (SELECT count(*) FROM public.profiles           p WHERE p.company_id = c.id) AS "계정",
       (SELECT count(*) FROM public.review_assignments a WHERE a.company_id = c.id) AS "배정",
       (SELECT count(*) FROM public.survey_settings    v WHERE v.company_id = c.id) AS "운영설정"
  FROM public.companies c
 ORDER BY c.name;

-- ② company_id 가 비어 있는 행 수 ---------------------------------------
--    profiles 는 관리자를 따로 센다. 관리자는 회사에 매이지 않으므로 NULL 이 정상이고,
--    이 둘을 한 숫자로 합치면 "백필해야 할 행이 있다"고 잘못 읽힌다.
SELECT 'profiles (SME 등 비관리자)' AS "테이블", count(*) AS "회사 미지정 행수"
  FROM public.profiles WHERE company_id IS NULL AND lower(role) <> 'admin'
UNION ALL SELECT 'profiles (관리자 — 정상)', count(*)
  FROM public.profiles WHERE company_id IS NULL AND lower(role) =  'admin'
UNION ALL SELECT 'job_groups',         count(*) FROM public.job_groups         WHERE company_id IS NULL
UNION ALL SELECT 'job_series',         count(*) FROM public.job_series         WHERE company_id IS NULL
UNION ALL SELECT 'jobs',               count(*) FROM public.jobs               WHERE company_id IS NULL
UNION ALL SELECT 'review_assignments', count(*) FROM public.review_assignments WHERE company_id IS NULL
ORDER BY 1;

-- ③ 백필 — ②의 '관리자 — 정상' 을 뺀 나머지가 0이 아닐 때만. -------------
--    회사가 정확히 1개일 때만 돈다. 2개 이상이면 어느 회사로 채울지 사람이 정해야 하므로
--    예외를 던져 멈춘다. profiles 는 관리자를 건드리지 않는다.
/*
DO $$
DECLARE
  v_company_id uuid;
  v_count      int;
BEGIN
  SELECT count(*) INTO v_count FROM public.companies;
  IF v_count <> 1 THEN
    RAISE EXCEPTION '계열사가 % 개입니다. 1개일 때만 자동 백필합니다.', v_count;
  END IF;
  SELECT id INTO v_company_id FROM public.companies;

  UPDATE public.profiles           SET company_id = v_company_id
   WHERE company_id IS NULL AND lower(role) <> 'admin';
  UPDATE public.job_groups         SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.job_series         SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.jobs               SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.review_assignments SET company_id = v_company_id WHERE company_id IS NULL;

  RAISE NOTICE '백필 완료: %', v_company_id;
END $$;
*/

-- ④ 계열사를 서연이화 하나로 줄인다 --------------------------------------
--    ①에서 남길 회사의 id 를 확인해 아래 두 곳에 넣는다.
--    keep 가 1행이 아니면 조건이 깨져 0행이 지워진다 — id 를 잘못 적어도 전부 삭제되지 않는다.
--    companies 삭제는 딸린 행의 company_id 를 NULL 로 되돌린다(ON DELETE SET NULL).
--    그래서 ①의 직무·계정·배정이 0인지 먼저 확인한 뒤 지운다.
/*
WITH keep AS (
  SELECT id FROM public.companies
   WHERE id = '776963fe-07f4-4354-b0f0-5a1a7bcde64f'  -- 서연이화 (2026-09-03 실측)
)
DELETE FROM public.companies
 WHERE id NOT IN (SELECT id FROM keep)
   AND (SELECT count(*) FROM keep) = 1
RETURNING id, name;
*/

-- ⑤ ④ 뒤 검증 — 1행(서연이화)만 남아야 한다. ----------------------------
SELECT count(*) AS "계열사 수", string_agg(name, ' / ' ORDER BY name) AS "이름"
  FROM public.companies;
