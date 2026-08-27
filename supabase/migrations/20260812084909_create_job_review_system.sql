/*
# Create the job information review system

1. New tables
- `profiles`: signed-in user profile, role, organization and assigned job scope.
- `job_groups`, `job_series`, `jobs`: versioned job taxonomy and definitions.
- `job_tasks`, `job_skills`: task and skill details attached to jobs.
- `review_assignments`, `reviews`: SME-to-job assignments and review lifecycle.
- `job_feedback`, `task_feedback`, `skill_feedback`: section-level review responses.
- `new_task_suggestions`, `new_skill_suggestions`: proposed additions.
- `review_history`: submission and re-review audit trail.
- `upload_history`: administrator upload audit records.

2. Security
- Row level security is enabled on every table.
- Authenticated users can read shared job data.
- SMEs can access only their own profile, assignments, reviews and feedback.
- Administrators are identified by the immutable `app_metadata.role` claim and can manage all application records.

3. Data safety
- Job records are versioned with `source_version` and are not deleted by re-upload.
- Feedback references the original job/task/skill rows so historical submissions stay connected.
*/

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  organization text not null default '',
  title text not null default '',
  role text not null default 'SME' check (role in ('ADMIN','SME')),
  active boolean not null default true,
  assigned_group_id uuid,
  assigned_series_id uuid,
  assigned_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  source_version integer not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name, source_version)
);

create table if not exists public.job_series (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.job_groups(id),
  name text not null,
  active boolean not null default true,
  source_version integer not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, name, source_version)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.job_groups(id),
  series_id uuid not null references public.job_series(id),
  name text not null,
  definition text not null,
  active boolean not null default true,
  source_version integer not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, series_id, name, source_version)
);

create table if not exists public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  task_id text,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_skills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  skill_id text,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  sme_id uuid not null references public.profiles(id),
  job_id uuid not null references public.jobs(id),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(sme_id, job_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.review_assignments(id),
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED','IN_PROGRESS','SUBMITTED','REVIEW_REQUESTED','RESUBMITTED')),
  started_at timestamptz,
  submitted_at timestamptz,
  last_saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(assignment_id)
);

create table if not exists public.job_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  section text not null check(section in ('NAME','DEFINITION')),
  suitability text check(suitability in ('SUITABLE','NEEDS_EDIT','UNSUITABLE')),
  comment text not null default '',
  suggestion text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(review_id, section)
);

create table if not exists public.task_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  task_id uuid not null references public.job_tasks(id),
  suitability text check(suitability in ('SUITABLE','NEEDS_EDIT','UNSUITABLE')),
  comment text not null default '',
  suggestion text not null default '',
  delete_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(review_id, task_id)
);

create table if not exists public.skill_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  skill_id uuid not null references public.job_skills(id),
  suitability text check(suitability in ('SUITABLE','NEEDS_EDIT','UNSUITABLE')),
  comment text not null default '',
  suggestion text not null default '',
  delete_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(review_id, skill_id)
);

create table if not exists public.new_task_suggestions (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id), name text not null, description text not null default '', reason text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.new_skill_suggestions (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id), name text not null, description text not null default '', reason text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.review_history (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.reviews(id), actor_id uuid references auth.users(id), action text not null, note text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.upload_history (
  id uuid primary key default gen_random_uuid(), filename text not null, mode text not null check(mode in ('REPLACE','APPEND')), row_count integer not null default 0, error_count integer not null default 0, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.job_groups enable row level security;
alter table public.job_series enable row level security;
alter table public.jobs enable row level security;
alter table public.job_tasks enable row level security;
alter table public.job_skills enable row level security;
alter table public.review_assignments enable row level security;
alter table public.reviews enable row level security;
alter table public.job_feedback enable row level security;
alter table public.task_feedback enable row level security;
alter table public.skill_feedback enable row level security;
alter table public.new_task_suggestions enable row level security;
alter table public.new_skill_suggestions enable row level security;
alter table public.review_history enable row level security;
alter table public.upload_history enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((auth.jwt()->'app_metadata'->>'role') = 'ADMIN', false) $$;

-- Profiles
create policy "profile_self_or_admin_select" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profile_admin_insert" on public.profiles for insert to authenticated with check (public.is_admin());
create policy "profile_self_or_admin_update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profile_admin_delete" on public.profiles for delete to authenticated using (public.is_admin());

-- Shared job catalog
create policy "job_groups_authenticated_select" on public.job_groups for select to authenticated using (true);
create policy "job_groups_admin_insert" on public.job_groups for insert to authenticated with check (public.is_admin());
create policy "job_groups_admin_update" on public.job_groups for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_groups_admin_delete" on public.job_groups for delete to authenticated using (public.is_admin());
create policy "job_series_authenticated_select" on public.job_series for select to authenticated using (true);
create policy "job_series_admin_insert" on public.job_series for insert to authenticated with check (public.is_admin());
create policy "job_series_admin_update" on public.job_series for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_series_admin_delete" on public.job_series for delete to authenticated using (public.is_admin());
create policy "jobs_authenticated_select" on public.jobs for select to authenticated using (true);
create policy "jobs_admin_insert" on public.jobs for insert to authenticated with check (public.is_admin());
create policy "jobs_admin_update" on public.jobs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "jobs_admin_delete" on public.jobs for delete to authenticated using (public.is_admin());
create policy "job_tasks_authenticated_select" on public.job_tasks for select to authenticated using (true);
create policy "job_tasks_admin_insert" on public.job_tasks for insert to authenticated with check (public.is_admin());
create policy "job_tasks_admin_update" on public.job_tasks for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_tasks_admin_delete" on public.job_tasks for delete to authenticated using (public.is_admin());
create policy "job_skills_authenticated_select" on public.job_skills for select to authenticated using (true);
create policy "job_skills_admin_insert" on public.job_skills for insert to authenticated with check (public.is_admin());
create policy "job_skills_admin_update" on public.job_skills for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_skills_admin_delete" on public.job_skills for delete to authenticated using (public.is_admin());

-- Review data is visible to the assigned SME or an administrator.
create policy "assignments_owner_or_admin_select" on public.review_assignments for select to authenticated using (sme_id = auth.uid() or public.is_admin());
create policy "assignments_admin_insert" on public.review_assignments for insert to authenticated with check (public.is_admin());
create policy "assignments_admin_update" on public.review_assignments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "assignments_admin_delete" on public.review_assignments for delete to authenticated using (public.is_admin());
create policy "reviews_owner_or_admin_select" on public.reviews for select to authenticated using (public.is_admin() or exists(select 1 from public.review_assignments a where a.id = assignment_id and a.sme_id = auth.uid()));
create policy "reviews_owner_insert" on public.reviews for insert to authenticated with check (exists(select 1 from public.review_assignments a where a.id = assignment_id and a.sme_id = auth.uid()));
create policy "reviews_owner_or_admin_update" on public.reviews for update to authenticated using (public.is_admin() or exists(select 1 from public.review_assignments a where a.id = assignment_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.review_assignments a where a.id = assignment_id and a.sme_id = auth.uid()));
create policy "reviews_admin_delete" on public.reviews for delete to authenticated using (public.is_admin());

-- Feedback tables follow their review access.
create policy "job_feedback_access_select" on public.job_feedback for select to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "job_feedback_owner_insert" on public.job_feedback for insert to authenticated with check (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "job_feedback_owner_update" on public.job_feedback for update to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "job_feedback_admin_delete" on public.job_feedback for delete to authenticated using (public.is_admin());

create policy "task_feedback_access_select" on public.task_feedback for select to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "task_feedback_owner_insert" on public.task_feedback for insert to authenticated with check (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "task_feedback_owner_update" on public.task_feedback for update to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "task_feedback_admin_delete" on public.task_feedback for delete to authenticated using (public.is_admin());

create policy "skill_feedback_access_select" on public.skill_feedback for select to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_feedback_owner_insert" on public.skill_feedback for insert to authenticated with check (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_feedback_owner_update" on public.skill_feedback for update to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_feedback_admin_delete" on public.skill_feedback for delete to authenticated using (public.is_admin());

create policy "suggestions_access_select" on public.new_task_suggestions for select to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "suggestions_owner_insert" on public.new_task_suggestions for insert to authenticated with check (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "suggestions_owner_update" on public.new_task_suggestions for update to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "suggestions_admin_delete" on public.new_task_suggestions for delete to authenticated using (public.is_admin());
create policy "skill_suggestions_access_select" on public.new_skill_suggestions for select to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_suggestions_owner_insert" on public.new_skill_suggestions for insert to authenticated with check (exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_suggestions_owner_update" on public.new_skill_suggestions for update to authenticated using (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.reviews r join public.review_assignments a on a.id = r.assignment_id where r.id = review_id and a.sme_id = auth.uid()));
create policy "skill_suggestions_admin_delete" on public.new_skill_suggestions for delete to authenticated using (public.is_admin());

create policy "history_access" on public.review_history for select to authenticated using (public.is_admin() or actor_id = auth.uid());
create policy "history_insert" on public.review_history for insert to authenticated with check (actor_id = auth.uid() or public.is_admin());
create policy "upload_admin_select" on public.upload_history for select to authenticated using (public.is_admin());
create policy "upload_admin_insert" on public.upload_history for insert to authenticated with check (public.is_admin());

create index if not exists idx_jobs_taxonomy on public.jobs(group_id, series_id, active);
create index if not exists idx_assignments_sme on public.review_assignments(sme_id, active);
create index if not exists idx_reviews_status on public.reviews(status);
