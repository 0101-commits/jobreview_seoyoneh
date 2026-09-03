/*
 * 계열사 단일화(서연이화) 사전 점검 — 읽기 전용.
 *
 * 왜 필요한가.
 *   화면의 계열사 드롭다운은 회사가 1개면 그 회사를 자동으로 골라 놓고 칸을 감춘다
 *   (src/components/shared/CompanyFilterDropdown.tsx). 자동 선택 전에는 '전체 회사'라
 *   company_id 로 거르지 않았으므로 company_id IS NULL 인 옛 행도 목록에 보였다.
 *   자동 선택 뒤에는 모든 조회가 .eq('company_id', 서연이화) 로 좁혀지므로,
 *   company_id 가 비어 있는 행은 오류 없이 조용히 화면에서 사라진다.
 *
 *   그래서 순서가 있다. ①로 회사 수를 보고, ②로 미지정 행이 있는지 센다.
 *   ②가 모두 0이면 그대로 쓰면 된다. 0이 아니면 ③의 백필을 먼저 돌린다.
 *
 * 실행: Supabase SQL Editor 에 ①②를 붙여 넣고 결과를 본다. ③은 주석을 풀어야 실행된다.
 */

-- ① 등록된 계열사 --------------------------------------------------------
SELECT 'companies' AS "대상", count(*) AS "행수" FROM public.companies;
SELECT id, name, created_at FROM public.companies ORDER BY name;

-- ② company_id 가 비어 있는 행 수 (전부 0이어야 안전) ---------------------
SELECT 'profiles'           AS "테이블", count(*) AS "회사 미지정 행수" FROM public.profiles           WHERE company_id IS NULL
UNION ALL SELECT 'job_groups',         count(*) FROM public.job_groups         WHERE company_id IS NULL
UNION ALL SELECT 'job_series',         count(*) FROM public.job_series         WHERE company_id IS NULL
UNION ALL SELECT 'jobs',               count(*) FROM public.jobs               WHERE company_id IS NULL
UNION ALL SELECT 'review_assignments', count(*) FROM public.review_assignments WHERE company_id IS NULL
ORDER BY 1;

-- ③ 백필 — ②가 0이 아닐 때만. 회사가 정확히 1개일 때만 돈다. ---------------
--    회사가 2개 이상이면 어느 회사로 채울지 사람이 정해야 하므로 예외를 던져 멈춘다.
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

  UPDATE public.profiles           SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.job_groups         SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.job_series         SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.jobs               SET company_id = v_company_id WHERE company_id IS NULL;
  UPDATE public.review_assignments SET company_id = v_company_id WHERE company_id IS NULL;

  RAISE NOTICE '백필 완료: %', v_company_id;
END $$;
*/

-- ④ 서연이화 외 계열사가 남아 있으면 여기서 보인다. 지울지 남길지는 운영 판단이다.
--    (companies 삭제는 company_id 를 NULL 로 되돌린다 — ON DELETE SET NULL. 지우기 전에
--     그 회사에 매인 행이 있는지 아래로 확인한다.)
SELECT c.name AS "계열사",
       (SELECT count(*) FROM public.jobs     j WHERE j.company_id = c.id) AS "직무",
       (SELECT count(*) FROM public.profiles p WHERE p.company_id = c.id) AS "계정"
  FROM public.companies c
 ORDER BY c.name;
