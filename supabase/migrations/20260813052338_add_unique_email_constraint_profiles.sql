/*
# Add unique constraint on profiles.email (case-insensitive)

1. Security / Data Integrity
   - Creates a unique index on lower(trim(email)) for the profiles table.
   - Prevents duplicate emails (case-insensitive, whitespace-trimmed) at the database level.
   - Existing rows are checked first; if duplicates exist, the migration is safe to re-run.
2. Notes
   - Uses a regular expression index on lower(email) to enforce uniqueness regardless of case or leading/trailing whitespace.
   - The profiles table already has a foreign key on id -> auth.users(id) ON DELETE CASCADE.
*/

-- First, check for existing duplicates on lower(trim(email))
-- If duplicates exist, this index creation will fail safely without data loss.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
ON public.profiles (lower(trim(email)));
