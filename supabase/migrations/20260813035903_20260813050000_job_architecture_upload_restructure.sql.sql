/*
# Job Architecture Upload Restructure

1. Purpose
- Restructure the job data model to support a two-step upload flow:
  STEP 1: 직무 및 과업 정보 (job groups → series → jobs → tasks → activities)
  STEP 2: 필요 Skill 및 수행요건 (skills + requirements matched to jobs)
- Add task_activities (세부활동) as a child of job_tasks (주요과업).
- Add job_requirements (수행요건) table for education, major, certifications per job.
- Add skill_type (Soft/Hard) and sort_order to job_skills.
- Add sort_order to job_tasks.
- Enforce unique constraint on jobs (group_id, series_id, name) for active jobs only.
- Remove legacy task_id / skill_id text columns (kept but unused — no data loss).

2. New Tables
- `task_activities` (세부활동)
  - id (uuid PK)
  - job_task_id (uuid FK → job_tasks.id ON DELETE CASCADE)
  - activity_name (text, not null)
  - sort_order (integer, default 0)
  - active (boolean, default true)
  - created_at, updated_at (timestamptz)

- `job_requirements` (수행요건)
  - id (uuid PK)
  - job_id (uuid FK → jobs.id ON DELETE CASCADE)
  - education (text) — 요구 학력
  - major (text) — 관련 전공
  - certifications (text) — 관련 자격증/면허
  - created_at, updated_at (timestamptz)
  - unique(job_id) — one requirement row per job

3. Modified Tables
- `job_skills`: add `skill_type` text CHECK in ('Soft Skill','Hard Skill'), `sort_order` integer default 0
- `job_tasks`: add `sort_order` integer default 0

4. Indexes
- unique index on jobs(group_id, series_id, name) WHERE active = true — enforces one active job per group+series+name
- index on task_activities(job_task_id)
- index on job_skills(job_id)
- index on job_requirements(job_id)

5. Security
- RLS enabled on task_activities and job_requirements.
- All authenticated users can SELECT (shared job catalog).
- Only admins can INSERT/UPDATE/DELETE.
- Follows the same pattern as existing job_* tables.

6. Important notes
- No existing data is deleted or modified.
- Legacy task_id/skill_id text columns remain but are not used by the new upload flow.
- The unique index on jobs uses a partial index (WHERE active = true) so old inactive versions don't conflict.
*/

-- task_activities table
CREATE TABLE IF NOT EXISTS public.task_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_task_id uuid NOT NULL REFERENCES public.job_tasks(id) ON DELETE CASCADE,
  activity_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_activities_authenticated_select" ON public.task_activities;
CREATE POLICY "task_activities_authenticated_select" ON public.task_activities FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "task_activities_admin_insert" ON public.task_activities;
CREATE POLICY "task_activities_admin_insert" ON public.task_activities FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "task_activities_admin_update" ON public.task_activities;
CREATE POLICY "task_activities_admin_update" ON public.task_activities FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "task_activities_admin_delete" ON public.task_activities;
CREATE POLICY "task_activities_admin_delete" ON public.task_activities FOR DELETE
  TO authenticated USING (public.is_admin());

-- job_requirements table
CREATE TABLE IF NOT EXISTS public.job_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  education text NOT NULL DEFAULT '',
  major text NOT NULL DEFAULT '',
  certifications text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_requirements_authenticated_select" ON public.job_requirements;
CREATE POLICY "job_requirements_authenticated_select" ON public.job_requirements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "job_requirements_admin_insert" ON public.job_requirements;
CREATE POLICY "job_requirements_admin_insert" ON public.job_requirements FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "job_requirements_admin_update" ON public.job_requirements;
CREATE POLICY "job_requirements_admin_update" ON public.job_requirements FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "job_requirements_admin_delete" ON public.job_requirements;
CREATE POLICY "job_requirements_admin_delete" ON public.job_requirements FOR DELETE
  TO authenticated USING (public.is_admin());

-- Add skill_type and sort_order to job_skills (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_skills' AND column_name='skill_type') THEN
    ALTER TABLE public.job_skills ADD COLUMN skill_type text;
    ALTER TABLE public.job_skills ADD CONSTRAINT job_skills_skill_type_check CHECK (skill_type IS NULL OR skill_type IN ('Soft Skill','Hard Skill'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_skills' AND column_name='sort_order') THEN
    ALTER TABLE public.job_skills ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add sort_order to job_tasks (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='job_tasks' AND column_name='sort_order') THEN
    ALTER TABLE public.job_tasks ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_active ON public.jobs(group_id, series_id, name) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_task_activities_task ON public.task_activities(job_task_id);
CREATE INDEX IF NOT EXISTS idx_job_skills_job ON public.job_skills(job_id);
CREATE INDEX IF NOT EXISTS idx_job_requirements_job ON public.job_requirements(job_id);
