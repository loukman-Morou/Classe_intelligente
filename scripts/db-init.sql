-- =============================================================================
-- Initialisation PostgreSQL — Classe Intelligente
-- Exécuté UNE SEULE FOIS à la création du conteneur.
-- =============================================================================

-- Extension pgvector (nécessaire pour les embeddings RAG — Phase 8)
CREATE EXTENSION IF NOT EXISTS vector;

-- Utilisateur applicatif aux privilèges minimaux.
-- L'application ne doit JAMAIS utiliser le compte superuser postgres.
-- ${APP_DB_USER} et ${APP_DB_PASSWORD} sont substitués par le shell d'init Docker.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'classe_intelligente_app') THEN
    CREATE ROLE classe_intelligente_app WITH LOGIN PASSWORD 'changeme_via_env';
  END IF;
END
$$;

-- Droits minimaux : SELECT, INSERT, UPDATE, DELETE sur toutes les tables présentes
-- et futures. PAS de DROP, ALTER, TRUNCATE, CREATE.
GRANT CONNECT ON DATABASE classe_intelligente TO classe_intelligente_app;
GRANT USAGE ON SCHEMA public TO classe_intelligente_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO classe_intelligente_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO classe_intelligente_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO classe_intelligente_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO classe_intelligente_app;

-- Note : les migrations (CREATE TABLE, ALTER TABLE…) doivent être exécutées
-- avec le user superuser (postgres) ou un user dédié aux migrations, pas
-- avec le compte applicatif. En CI/CD, utiliser DATABASE_URL_MIGRATE (superuser)
-- pour les migrations et DATABASE_URL (user applicatif) pour le runtime.
