-- Ensure one job_requirements row per job so upsert(onConflict: 'job_id') works
DELETE FROM job_requirements r1
  USING job_requirements r2
  WHERE r1.ctid < r2.ctid AND r1.job_id = r2.job_id;

CREATE UNIQUE INDEX IF NOT EXISTS job_requirements_job_id_key
  ON job_requirements (job_id);

ALTER TABLE job_requirements
  ALTER COLUMN education SET DEFAULT '',
  ALTER COLUMN major SET DEFAULT '',
  ALTER COLUMN certifications SET DEFAULT '';
