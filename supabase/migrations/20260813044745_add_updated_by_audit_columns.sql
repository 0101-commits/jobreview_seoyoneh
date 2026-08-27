-- Add updated_by audit columns for job architecture tables
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE job_tasks ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE task_activities ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE job_requirements ADD COLUMN IF NOT EXISTS updated_by uuid;
