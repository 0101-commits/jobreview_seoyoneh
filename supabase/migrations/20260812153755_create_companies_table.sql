/*
# Create companies table

1. New Tables
- `companies`: 회사(계열사) 마스터 테이블. SME가 로그인 후 첫 화면에서 선택한다.
  - `id` (uuid, PK)
  - `name` (text, not null) — 회사명 (예: 서연, 서연이화, 서연탑메탈, …)
  - `code` (text, unique, not null) — 회사 식별 코드
  - `active` (boolean, default true)
  - `sort_order` (integer, default 0) — 표시 순서
  - `created_at`, `updated_at` (timestamptz)

2. Security
- RLS enabled on `companies`.
- 모든 인증 사용자가 회사 목록을 읽을 수 있다 (SELECT true).
- 관리자만 INSERT/UPDATE/DELETE 가능 (is_admin() 체크).

3. Seed data
- 서연, 서연이화, 서연탑메탈, 서연씨엔에프, 서연인테크, 서연오토비전 6개 회사 삽입.
*/

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_authenticated_select" ON public.companies;
CREATE POLICY "companies_authenticated_select" ON public.companies FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "companies_admin_insert" ON public.companies;
CREATE POLICY "companies_admin_insert" ON public.companies FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "companies_admin_update" ON public.companies;
CREATE POLICY "companies_admin_update" ON public.companies FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "companies_admin_delete" ON public.companies;
CREATE POLICY "companies_admin_delete" ON public.companies FOR DELETE
  TO authenticated USING (public.is_admin());

-- Seed the 6 companies
INSERT INTO public.companies (name, code, sort_order)
VALUES
  ('서연', 'seoyeon', 1),
  ('서연이화', 'seoyeon-ehwa', 2),
  ('서연탑메탈', 'seoyeon-topmetal', 3),
  ('서연씨엔에프', 'seoyeon-cnf', 4),
  ('서연인테크', 'seoyeon-intech', 5),
  ('서연오토비전', 'seoyeon-autovision', 6)
ON CONFLICT (code) DO NOTHING;
