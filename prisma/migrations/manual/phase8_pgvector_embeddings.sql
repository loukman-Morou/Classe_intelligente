-- =============================================================================
-- Phase 8 — pgvector : extension + colonne embedding
-- =============================================================================
-- À appliquer APRÈS `npx prisma migrate dev --name init_schema`
-- Requiert un compte PostgreSQL avec CREATE EXTENSION ou superuser.
-- =============================================================================

-- 1. Activer l'extension pgvector (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Ajouter la colonne embedding sur document_chunks
--    Nullable initialement : les chunks existants seront indexés en Phase 8 via
--    un job de backfill. Les nouveaux chunks reçoivent leur embedding immédiatement
--    dans le pipeline OCR → Embedding (ajout au worker OcrWorker en Phase 8).
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Commentaire documentaire sur la dimension
COMMENT ON COLUMN document_chunks.embedding IS
  'Embedding OpenAI text-embedding-3-small (1536 dimensions). '
  'NULL = chunk en attente d''indexation ou reindexation.';
