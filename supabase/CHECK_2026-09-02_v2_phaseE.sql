-- Phase E (2026-09-02 v2, 감사 서버 이관 RPC) 적용 여부 판별 — 읽기 전용 단일 SELECT
WITH fn AS (
  SELECT p.oid,
         p.proname,
         p.pronargs,
         p.prosecdef,
         p.proconfig,
         p.prosrc,
         p.proacl,
         l.lanname,
         pg_get_function_identity_arguments(p.oid) AS ident_args,
         pg_get_function_arguments(p.oid)          AS named_args,
         pg_get_function_result(p.oid)             AS result_type,
         obj_description(p.oid, 'pg_proc')         AS fn_comment
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.proname IN ('save_org_units', 'link_sme_roster_audited')
),
sou AS (SELECT * FROM fn WHERE oid = to_regprocedure('public.save_org_units(uuid, jsonb)')::oid),
lsa AS (SELECT * FROM fn WHERE oid = to_regprocedure('public.link_sme_roster_audited(uuid, jsonb)')::oid),
tgt AS (SELECT * FROM sou UNION ALL SELECT * FROM lsa),
acl AS (
  SELECT t.proname, a.privilege_type, COALESCE(r.rolname, 'PUBLIC') AS grantee_name
    FROM tgt t
    CROSS JOIN LATERAL aclexplode(t.proacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
)
SELECT 'E01 FUNC public.save_org_units(uuid, jsonb) 존재'::text AS "항목",
       EXISTS (SELECT 1 FROM sou) AS "적용됨"
UNION ALL SELECT 'E02 save_org_units 오버로드가 1개뿐',
       (SELECT count(*) FROM fn WHERE proname = 'save_org_units') = 1
UNION ALL SELECT 'E03 save_org_units 인자 2개 · 이름 p_company_id/p_rows · 타입 uuid,jsonb',
       EXISTS (SELECT 1 FROM sou
                WHERE pronargs = 2
                  AND ident_args LIKE '%uuid%' AND ident_args LIKE '%jsonb%'
                  AND named_args LIKE '%p_company_id%' AND named_args LIKE '%p_rows%')
UNION ALL SELECT 'E04 save_org_units RETURNS jsonb · plpgsql · SECURITY DEFINER · SET search_path=public',
       EXISTS (SELECT 1 FROM sou
                WHERE result_type = 'jsonb' AND lanname = 'plpgsql'
                  AND prosecdef AND 'search_path=public' = ANY (proconfig))
UNION ALL SELECT 'E05 save_org_units 본문: 서버 감사 log_audit(ORG_UNITS_UPLOADED)',
       EXISTS (SELECT 1 FROM sou WHERE prosrc LIKE '%ORG_UNITS_UPLOADED%' AND prosrc LIKE '%log_audit%')
UNION ALL SELECT 'E06 save_org_units 본문: is_admin 검사 + org_units 2패스 업서트(ON CONFLICT → parent_id)',
       EXISTS (SELECT 1 FROM sou
                WHERE prosrc LIKE '%is_admin%' AND prosrc LIKE '%org_units%'
                  AND prosrc LIKE '%ON CONFLICT%' AND prosrc LIKE '%parent_id%')
UNION ALL SELECT 'E07 GRANT EXECUTE save_org_units → authenticated',
       EXISTS (SELECT 1 FROM acl
                WHERE proname = 'save_org_units' AND privilege_type = 'EXECUTE'
                  AND grantee_name = 'authenticated')
UNION ALL SELECT 'E08 REVOKE EXECUTE save_org_units ← PUBLIC/anon',
       EXISTS (SELECT 1 FROM sou WHERE proacl IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM acl
                        WHERE proname = 'save_org_units' AND privilege_type = 'EXECUTE'
                          AND grantee_name IN ('PUBLIC', 'anon'))
UNION ALL SELECT 'E09 COMMENT ON FUNCTION save_org_units (v2 S5)',
       EXISTS (SELECT 1 FROM sou WHERE fn_comment LIKE '%v2 S5%')
UNION ALL SELECT 'E10 FUNC public.link_sme_roster_audited(uuid, jsonb) 존재',
       EXISTS (SELECT 1 FROM lsa)
UNION ALL SELECT 'E11 link_sme_roster_audited 오버로드가 1개뿐',
       (SELECT count(*) FROM fn WHERE proname = 'link_sme_roster_audited') = 1
UNION ALL SELECT 'E12 link_sme_roster_audited 인자 2개 · 이름 p_company_id/p_rows · 타입 uuid,jsonb',
       EXISTS (SELECT 1 FROM lsa
                WHERE pronargs = 2
                  AND ident_args LIKE '%uuid%' AND ident_args LIKE '%jsonb%'
                  AND named_args LIKE '%p_company_id%' AND named_args LIKE '%p_rows%')
UNION ALL SELECT 'E13 link_sme_roster_audited RETURNS jsonb · plpgsql · SECURITY DEFINER · SET search_path=public',
       EXISTS (SELECT 1 FROM lsa
                WHERE result_type = 'jsonb' AND lanname = 'plpgsql'
                  AND prosecdef AND 'search_path=public' = ANY (proconfig))
UNION ALL SELECT 'E14 link_sme_roster_audited 본문: 기존 link_sme_roster 래핑 호출',
       EXISTS (SELECT 1 FROM lsa WHERE prosrc LIKE '%link_sme_roster(%')
UNION ALL SELECT 'E15 link_sme_roster_audited 본문: log_audit(SME_ROSTER_LINKED) + meta 키',
       EXISTS (SELECT 1 FROM lsa
                WHERE prosrc LIKE '%SME_ROSTER_LINKED%' AND prosrc LIKE '%log_audit%'
                  AND prosrc LIKE '%assignmentsCreated%' AND prosrc LIKE '%missingOrgCodes%')
UNION ALL SELECT 'E16 GRANT EXECUTE link_sme_roster_audited → authenticated',
       EXISTS (SELECT 1 FROM acl
                WHERE proname = 'link_sme_roster_audited' AND privilege_type = 'EXECUTE'
                  AND grantee_name = 'authenticated')
UNION ALL SELECT 'E17 REVOKE EXECUTE link_sme_roster_audited ← PUBLIC/anon',
       EXISTS (SELECT 1 FROM lsa WHERE proacl IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM acl
                        WHERE proname = 'link_sme_roster_audited' AND privilege_type = 'EXECUTE'
                          AND grantee_name IN ('PUBLIC', 'anon'))
UNION ALL SELECT 'E18 COMMENT ON FUNCTION link_sme_roster_audited (v2 S5)',
       EXISTS (SELECT 1 FROM lsa WHERE fn_comment LIKE '%v2 S5%')
UNION ALL SELECT 'E19 파일 헤더 확인문: pg_proc 내 두 이름 합계 = 2',
       (SELECT count(*) FROM fn) = 2
UNION ALL SELECT 'E20 [선행·이 Phase가 만들지 않음] public.link_sme_roster(uuid, jsonb) 존재',
       to_regprocedure('public.link_sme_roster(uuid, jsonb)') IS NOT NULL
UNION ALL SELECT 'E21 [선행] public.log_audit(text, text, text, jsonb) 존재',
       to_regprocedure('public.log_audit(text, text, text, jsonb)') IS NOT NULL
UNION ALL SELECT 'E22 [선행] public.is_admin() 존재',
       to_regprocedure('public.is_admin()') IS NOT NULL
UNION ALL SELECT 'E23 [선행] org_units UNIQUE (company_id, code) — ON CONFLICT 대상',
       EXISTS (SELECT 1
                 FROM pg_index x
                 JOIN pg_class t     ON t.oid = x.indrelid
                 JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public' AND t.relname = 'org_units'
                  AND x.indisunique AND x.indisvalid
                  AND x.indpred IS NULL AND x.indexprs IS NULL
                  AND x.indnkeyatts = 2
                  AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                         FROM unnest(x.indkey::int2[]) AS k(attnum)
                         JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum)
                      = ARRAY['code', 'company_id'])
UNION ALL SELECT 'E24 >>> 종합 — Phase E 적용 완료로 볼 수 있는가',
       EXISTS (SELECT 1 FROM sou
                WHERE prosecdef AND 'search_path=public' = ANY (proconfig)
                  AND prosrc LIKE '%ORG_UNITS_UPLOADED%')
       AND EXISTS (SELECT 1 FROM lsa
                    WHERE prosecdef AND 'search_path=public' = ANY (proconfig)
                      AND prosrc LIKE '%SME_ROSTER_LINKED%' AND prosrc LIKE '%link_sme_roster(%')
       AND EXISTS (SELECT 1 FROM acl
                    WHERE proname = 'save_org_units'
                      AND privilege_type = 'EXECUTE' AND grantee_name = 'authenticated')
       AND EXISTS (SELECT 1 FROM acl
                    WHERE proname = 'link_sme_roster_audited'
                      AND privilege_type = 'EXECUTE' AND grantee_name = 'authenticated')
       AND NOT EXISTS (SELECT 1 FROM acl
                        WHERE privilege_type = 'EXECUTE' AND grantee_name IN ('PUBLIC', 'anon'))
ORDER BY 1;
