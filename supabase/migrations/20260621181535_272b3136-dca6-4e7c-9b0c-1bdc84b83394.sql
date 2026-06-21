
-- 1. Create app_role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. Security-definer role check function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3. Replace permissive cases policies with role-based access.
--    Kiosk submissions remain public (anon INSERT), but reads and updates
--    are limited to authenticated staff. Sensitive AI summaries and legal
--    details are no longer exposed to the public internet.
DROP POLICY IF EXISTS "Public can insert cases (demo)" ON public.cases;
DROP POLICY IF EXISTS "Public can update cases (demo)" ON public.cases;
DROP POLICY IF EXISTS "Public can view cases (demo)" ON public.cases;

-- Anyone (kiosk visitors, not signed in) may submit a new case
CREATE POLICY "Anyone can submit a case"
  ON public.cases FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only staff/admin may read cases
CREATE POLICY "Staff can view cases"
  ON public.cases FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'admin')
  );

-- Only staff/admin may update cases
CREATE POLICY "Staff can update cases"
  ON public.cases FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'admin')
  );

-- Tighten Data API grants on cases: anon only needs INSERT
REVOKE ALL ON public.cases FROM anon;
GRANT INSERT ON public.cases TO anon;
GRANT SELECT, INSERT, UPDATE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;

-- 4. Storage: kiosk uploads must stay public (no auth on kiosk), but
--    SELECT on case-images is restricted to staff. URLs in cases.image_url
--    use short-lived signed URLs from the edge function, so staff fetches
--    keep working; raw bucket browsing by the public stops.
DROP POLICY IF EXISTS "Public can view case images" ON storage.objects;

CREATE POLICY "Staff can view case images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'case-images'
    AND (
      public.has_role(auth.uid(), 'staff')
      OR public.has_role(auth.uid(), 'admin')
    )
  );
