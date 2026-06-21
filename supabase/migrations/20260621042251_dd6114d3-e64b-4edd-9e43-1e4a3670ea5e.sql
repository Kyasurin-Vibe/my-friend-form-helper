ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS original_image_url text,
  ADD COLUMN IF NOT EXISTS processed_image_url text,
  ADD COLUMN IF NOT EXISTS document_bounds jsonb;