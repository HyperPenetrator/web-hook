-- 1. Create admins table
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add admin_id column to resources table
ALTER TABLE resources ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id) ON DELETE CASCADE;

-- 3. Create match_resources_v2 similarity search function (supports p_admin_id filter, falls back to all resources if NULL)
CREATE OR REPLACE FUNCTION match_resources_v2 (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT,
  p_admin_id UUID DEFAULT NULL
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
  WHERE (p_admin_id IS NULL OR resources.admin_id = p_admin_id)
    AND 1 - (resources.embedding <=> query_embedding) > match_threshold
  ORDER BY resources.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
