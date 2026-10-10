-- =============================================================================
-- Phase 8 — index HNSW sur document_chunks.embedding
-- =============================================================================
-- À appliquer APRÈS que les embeddings ont été générés pour les documents
-- existants (job de backfill). Un index HNSW construit sur une colonne vide
-- ou quasi-vide est inutile et ralentit les insertions pour rien.
--
-- En production, créer l'index en arrière-plan pour ne pas bloquer les requêtes :
--   CREATE INDEX CONCURRENTLY idx_chunks_embedding_hnsw ...
-- (retirer CONCURRENTLY pour dev/CI où il n'y a pas de trafic concurrent).
-- =============================================================================

-- Index HNSW (cosinus) sur les embeddings.
-- Paramètres :
--   m = 16      : nombre de voisins par couche (compromis vitesse/mémoire)
--   ef_construction = 64 : qualité de construction (augmenter en prod si RAM ok)
-- Ces valeurs sont conservatrices et adaptées à un dataset de taille moyenne
-- (< 10M chunks). À retuner en Phase 15 selon les métriques réelles.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index partiel complémentaire : uniquement les chunks avec embedding non NULL,
-- pour que les requêtes de recherche excluent automatiquement les chunks
-- en attente d'indexation sans scan séquentiel.
-- Postgresql utilise cet index avant l'HNSW lors du filtrage WHERE.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_chunks_embedding_not_null
  ON document_chunks (course_id, class_id)
  WHERE embedding IS NOT NULL;

-- Paramètre de recherche HNSW (ef_search) — peut être surchargé par session :
--   SET hnsw.ef_search = 40;  -- plus précis, plus lent
--   SET hnsw.ef_search = 20;  -- plus rapide (défaut pgvector = 40)
-- Valeur recommandée pour la Phase 8 : 40 (précision raisonnable).
-- À tuner en Phase 15 selon les benchmarks qualité/latence.
