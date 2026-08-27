/*
# Add company_id to core tables for multi-company support

1. Purpose
   - 서연그룹 6개 회사가 각각 독립적으로 SME, 직무정보, Skill, 검토이력을 관리할 수 있도록
     모든 핵심 테이블에 company_id 컬럼을 추가합니다.
   - 기존 데이터는 삭제하지 않고 company_id가 NULL인 상태로 유지합니다 (관리자가 추후 매핑).

2. Modified Tables
   - `profiles`: company_id (uuid, nullable), employee_number (text, nullable) 추가
     - company_id → companies(id) FK, ON DELETE SET NULL
     - employee_number: SME 사번
   - `job_groups`: company_id (uuid, nullable) 추가
     - company_id → companies(id) FK, ON DELETE SET NULL
   - `job_series`: company_id (uuid, nullable) 추가
     - company_id → companies(id) FK, ON DELETE SET NULL
   - `jobs`: company_id (uuid, nullable) 추가
     - company_id → companies(id) FK, ON DELETE SET NULL
   - `review_assignments`: company_id (uuid, nullable) 추가
     - company_id → companies(id) FK, ON DELETE SET NULL

3. Unique Constraints (company-scoped)
   - profiles: (company_id, employee_number) unique — 회사별 사번 중복 방지
   - job_groups: (company_id, name, source_version) unique — 회사 내 직군명 중복 방지
   - job_series: (company_id, group_id, name, source_version) unique
   - jobs: (company_id, series_id, name, source_version) unique

4. Notes
   - 모든 company_id는 nullable이며 기존 데이터는 NULL로 유지됩니다.
   - 기존 데이터에 company_id가 NULL인 경우 "회사 미지정" 상태로 표시됩니다.
   - Unique constraint는 NULL 값을 여러 개 허용하므로 기존 데이터와 충돌하지 않습니다.
*/

-- Add company_id to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_number text DEFAULT '';

-- Add company_id to job_groups
ALTER TABLE public.job_groups
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Add company_id to job_series
ALTER TABLE public.job_series
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Add company_id to jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Add company_id to review_assignments
ALTER TABLE public.review_assignments
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Unique constraints (NULLs are allowed, so existing data won't conflict)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_company_employee_unique_idx
  ON public.profiles (company_id, employee_number)
  WHERE company_id IS NOT NULL AND employee_number IS NOT NULL AND employee_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS job_groups_company_name_version_unique_idx
  ON public.job_groups (company_id, name, source_version)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_series_company_group_name_version_unique_idx
  ON public.job_series (company_id, group_id, name, source_version)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_series_name_version_unique_idx
  ON public.jobs (company_id, series_id, name, source_version)
  WHERE company_id IS NOT NULL;

-- Index for faster company-scoped queries
CREATE INDEX IF NOT EXISTS profiles_company_id_idx ON public.profiles(company_id);
CREATE INDEX IF NOT EXISTS job_groups_company_id_idx ON public.job_groups(company_id);
CREATE INDEX IF NOT EXISTS job_series_company_id_idx ON public.job_series(company_id);
CREATE INDEX IF NOT EXISTS jobs_company_id_idx ON public.jobs(company_id);
CREATE INDEX IF NOT EXISTS review_assignments_company_id_idx ON public.review_assignments(company_id);
