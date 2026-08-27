-- Add unique constraint on job_skills to prevent duplicates (job_id + skill_type + name) among active rows
CREATE UNIQUE INDEX IF NOT EXISTS job_skills_unique_active
  ON job_skills (job_id, skill_type, name)
  WHERE active = true;
