
CREATE POLICY "Public can upload case images" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'case-images');

CREATE POLICY "Public can view case images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'case-images');
