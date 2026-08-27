/*
# Enforce database-backed admin and SME roles

1. Purpose
- Use the authenticated user's `profiles.role` as the authoritative access role.
- Normalize role values to the requested lowercase values: `admin` and `sme`.

2. Data changes
- Existing `profiles.role` values `ADMIN` and `SME` are converted to `admin` and `sme`.
- The role check constraint is replaced with a lowercase-only constraint.

3. Security changes
- `is_admin()` now checks the authenticated user's role in `profiles`, not a client-controlled profile field or a stale JWT claim.
- Profile self-updates are limited to non-privileged profile fields so users cannot change their own role or active status.
- A restricted `set_profile_role` function is provided for authenticated administrators to change another profile's role.

4. Important notes
- No user, profile, or review rows are deleted.
- Existing row-level security remains enabled and policies continue to use `is_admin()` for administrator checks.
*/

UPDATE public.profiles
SET role = lower(role)
WHERE role IN ('ADMIN', 'SME');

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'sme'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND active = true
  )
$$;

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, email, organization, title) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.set_profile_role(p_profile_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_role NOT IN ('admin', 'sme') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE public.profiles
  SET role = p_role, updated_at = now()
  WHERE id = p_profile_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_profile_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_profile_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_profile_role(uuid, text) TO authenticated;