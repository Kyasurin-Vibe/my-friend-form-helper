ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only staff/admin can receive realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'staff'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);