
CREATE TABLE public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id TEXT NOT NULL UNIQUE,
  doc_type TEXT,
  doc_name TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  ai_summary TEXT,
  possible_missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC,
  image_url TEXT,
  initials TEXT,
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.cases TO anon, authenticated;
GRANT ALL ON public.cases TO service_role;

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view cases (demo)" ON public.cases FOR SELECT USING (true);
CREATE POLICY "Public can insert cases (demo)" ON public.cases FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update cases (demo)" ON public.cases FOR UPDATE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cases_updated_at BEFORE UPDATE ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.cases;
ALTER TABLE public.cases REPLICA IDENTITY FULL;
