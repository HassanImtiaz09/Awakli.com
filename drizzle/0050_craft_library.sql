-- D10 Craft Library: Sources and Chunks tables
-- Migration 0050

CREATE TABLE IF NOT EXISTS `craft_library_sources` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sub_sensei` enum('anime','manga','genga') NOT NULL,
  `source_type` enum('web_article','book_chapter','video_transcript','tutorial','interview','podcast_transcript','reference_image_set') NOT NULL,
  `title` varchar(500) NOT NULL,
  `url` text,
  `author` varchar(255),
  `description` text,
  `cross_tags` json,
  `source_status` enum('pending','ingesting','ingested','failed','archived') NOT NULL DEFAULT 'pending',
  `error_message` text,
  `chunk_count` int NOT NULL DEFAULT 0,
  `total_tokens` int NOT NULL DEFAULT 0,
  `last_fetched_at` timestamp,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `craft_library_sources_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `craft_library_chunks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `source_id` int NOT NULL,
  `chunk_sub_sensei` enum('anime','manga','genga') NOT NULL,
  `chunk_text` text NOT NULL,
  `chunk_index` int NOT NULL,
  `token_count` int NOT NULL DEFAULT 0,
  `embedding_ref` varchar(128),
  `chunk_metadata` json,
  `chunk_created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `craft_library_chunks_id` PRIMARY KEY(`id`),
  CONSTRAINT `craft_library_chunks_source_id_fk` FOREIGN KEY (`source_id`) REFERENCES `craft_library_sources`(`id`) ON DELETE CASCADE
);

-- Indexes for common query patterns
CREATE INDEX `idx_sources_sub_sensei` ON `craft_library_sources`(`sub_sensei`);
CREATE INDEX `idx_sources_status` ON `craft_library_sources`(`source_status`);
CREATE INDEX `idx_sources_type` ON `craft_library_sources`(`source_type`);
CREATE INDEX `idx_chunks_source_id` ON `craft_library_chunks`(`source_id`);
CREATE INDEX `idx_chunks_sub_sensei` ON `craft_library_chunks`(`chunk_sub_sensei`);
