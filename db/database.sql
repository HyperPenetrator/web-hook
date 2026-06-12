-- Create extensions schema and move vector there
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create resources table
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id TEXT,
    name TEXT,
    embedding VECTOR(768)
);

-- Create match_resources function for similarity search
CREATE OR REPLACE FUNCTION match_resources (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id UUID,
  drive_id TEXT,
  name TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    resources.id,
    resources.drive_id,
    resources.name,
    1 - (resources.embedding <=> query_embedding) AS similarity
  FROM resources
  WHERE 1 - (resources.embedding <=> query_embedding) > match_threshold
  ORDER BY resources.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Enable Row Level Security
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.resources;
CREATE POLICY "Enable read access for all users" ON public.resources 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Enable insert access for all users" ON public.resources;
CREATE POLICY "Enable insert access for all users" ON public.resources 
    FOR INSERT TO public WITH CHECK (auth.role() IN ('anon', 'authenticated'));


-- Create whatsapp_auth table for database-backed session state
CREATE TABLE IF NOT EXISTS whatsapp_auth (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Enable Row Level Security
ALTER TABLE whatsapp_auth ENABLE ROW LEVEL SECURITY;

-- RLS Policies for whatsapp_auth
DROP POLICY IF EXISTS "Enable all access for anon" ON public.whatsapp_auth;
CREATE POLICY "Enable all access for anon" ON public.whatsapp_auth
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for authenticated" ON public.whatsapp_auth;
CREATE POLICY "Enable all access for authenticated" ON public.whatsapp_auth
    FOR ALL TO authenticated USING (true) WITH CHECK (true);


