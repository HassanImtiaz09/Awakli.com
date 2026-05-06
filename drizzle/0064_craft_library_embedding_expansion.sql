-- Migration 0064: Expand embedding_ref column for direct vector storage
-- Wave 6B Completion Sprint - RAG retrieval pool activation prerequisite
--
-- Context:
--   The craft_library_chunks.embedding_ref column was originally varchar(128)
--   designed to store Chroma document IDs (short string references).
--   Wave 6A's genre-retrieval-pool stores 64-dimensional embedding vectors
--   as JSON arrays directly in this column (~1300 chars per vector).
--   varchar(128) is insufficient; MEDIUMTEXT supports up to 16MB.
--
-- Risk: LOW - column expansion is non-destructive, no data loss possible.
-- Rollback: ALTER TABLE craft_library_chunks MODIFY COLUMN embedding_ref VARCHAR(128);
--
-- Applied: 2026-05-06 (runtime ALTER via seed-genre-retrieval-pool.mjs)
-- Formalized: 2026-05-06 (this migration file)

ALTER TABLE `craft_library_chunks`
  MODIFY COLUMN `embedding_ref` MEDIUMTEXT;
