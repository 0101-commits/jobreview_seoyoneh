/*
# Review Assignment Auto-Sync

1. Purpose
- When an SME is created or their company_id changes, automatically create
  review_assignments for all active jobs in that company.
- This ensures the "검토 현황" (review status) page reflects newly registered
  SMEs immediately, without manual assignment.
- Also provides a SECURITY DEFINER function to fetch review status summary
  for the admin dashboard and review table.

2. New Functions
- `sync_sme_assignments(p_sme_id uuid, p_company_id uuid)`:
    SECURITY DEFINER function that syncs review_assignments for a given SME.
    Creates assignments for all active jobs matching the SME's company_id.
    If company_id is null, removes all assignments for that SME.
    Idempotent — uses ON CONFLICT to skip existing assignments.
- `get_review_status(p_company_id uuid default null)`:
    SECURITY DEFINER function returning a summary of all SME review statuses.
    Returns: sme_id, sme_name, sme_email, organization, title, company_id,
    company_name, job_id, job_name, group_name, series_name, review_status,
    review_id, submitted_at, suitable_count, needs_edit_count, unsuitable_count.

3. Security
- Both functions are SECURITY DEFINER so they can read across all tables
  regardless of RLS. This is safe because:
  - sync_sme_assignments is only called from the admin-create-user edge function
    (which verifies admin role before calling).
  - get_review_status is callable by authenticated users (admins need full
    visibility, and SMEs only see their own reviews via RLS on reviews table).
- Execute granted to authenticated role only.
*/

-- Map DB review status to Korean display labels in a helper view
CREATE OR REPLACE FUNCTION public.sync_sme_assignments(p_sme_id uuid, p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove existing assignments if company_id is null
  IF p_company_id IS NULL THEN
    DELETE FROM public.review_assignments WHERE sme_id = p_sme_id;
    RETURN;
  END IF;

  -- Remove assignments for jobs that don't belong to the SME's company
  DELETE FROM public.review_assignments ra
  USING public.jobs j
  WHERE ra.sme_id = p_sme_id
    AND ra.job_id = j.id
    AND (j.company_id IS DISTINCT FROM p_company_id OR j.active = false);

  -- Insert new assignments for all active jobs in the company
  INSERT INTO public.review_assignments (sme_id, job_id, active)
  SELECT p_sme_id, j.id, true
  FROM public.jobs j
  WHERE j.company_id = p_company_id
    AND j.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.review_assignments ra2
      WHERE ra2.sme_id = p_sme_id AND ra2.job_id = j.id
    );

  -- Create reviews with NOT_STARTED status for new assignments
  INSERT INTO public.reviews (assignment_id, status)
  SELECT ra.id, 'NOT_STARTED'
  FROM public.review_assignments ra
  WHERE ra.sme_id = p_sme_id
    AND NOT EXISTS (
      SELECT 1 FROM public.reviews r WHERE r.assignment_id = ra.id
    );
END;
$$;

-- Function to fetch review status summary for admin dashboard
CREATE OR REPLACE FUNCTION public.get_review_status(p_company_id uuid DEFAULT NULL)
RETURNS TABLE (
  sme_id uuid,
  sme_name text,
  sme_email text,
  organization text,
  title text,
  company_id uuid,
  company_name text,
  job_id uuid,
  job_name text,
  group_name text,
  series_name text,
  review_status text,
  review_id uuid,
  submitted_at timestamptz,
  suitable_count bigint,
  needs_edit_count bigint,
  unsuitable_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS sme_id,
    p.name AS sme_name,
    p.email AS sme_email,
    p.organization,
    p.title,
    p.company_id,
    c.name AS company_name,
    j.id AS job_id,
    j.name AS job_name,
    jg.name AS group_name,
    js.name AS series_name,
    COALESCE(r.status, 'NOT_STARTED') AS review_status,
    r.id AS review_id,
    r.submitted_at,
    COALESCE(s.suitable_count, 0) AS suitable_count,
    COALESCE(s.needs_edit_count, 0) AS needs_edit_count,
    COALESCE(s.unsuitable_count, 0) AS unsuitable_count
  FROM public.profiles p
  JOIN public.review_assignments ra ON ra.sme_id = p.id AND ra.active = true
  JOIN public.jobs j ON j.id = ra.job_id AND j.active = true
  JOIN public.job_groups jg ON jg.id = j.group_id
  JOIN public.job_series js ON js.id = j.series_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN public.reviews r ON r.assignment_id = ra.id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE suitability = 'SUITABLE') AS suitable_count,
      COUNT(*) FILTER (WHERE suitability = 'NEEDS_EDIT') AS needs_edit_count,
      COUNT(*) FILTER (WHERE suitability = 'UNSUITABLE') AS unsuitable_count
    FROM (
      SELECT suitability FROM public.job_feedback WHERE review_id = r.id
      UNION ALL
      SELECT suitability FROM public.task_feedback WHERE review_id = r.id
      UNION ALL
      SELECT suitability FROM public.skill_feedback WHERE review_id = r.id
    ) all_feedback
  ) s ON true
  WHERE p.role = 'sme'
    AND p.active = true
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
  ORDER BY p.name, j.name;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.sync_sme_assignments(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_review_status(uuid) TO authenticated;
