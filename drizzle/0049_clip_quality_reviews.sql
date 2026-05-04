-- D5.5 Per-Clip Quality Gate: clip_quality_reviews table
CREATE TABLE IF NOT EXISTS `clip_quality_reviews` (
  `id` int AUTO_INCREMENT NOT NULL,
  `episode_id` int NOT NULL,
  `project_id` int NOT NULL,
  `slice_id` int NOT NULL,
  `pipeline_run_id` int,
  `attempt` int NOT NULL DEFAULT 1,
  `character_consistency` int NOT NULL,
  `style_score` int NOT NULL,
  `prompt_alignment` int NOT NULL,
  `motion_quality` int NOT NULL,
  `overall_score` int NOT NULL,
  `passed` int NOT NULL,
  `pass_threshold` int NOT NULL DEFAULT 3,
  `issues` json,
  `keyframe_urls` json,
  `clip_url` text,
  `character_bible_hash` varchar(64),
  `style_lock_hash` varchar(64),
  `routing_decision` enum('pass','retry_video','retry_prompt','retry_reference','escalate') NOT NULL DEFAULT 'pass',
  `cost_usd` decimal(8,4) NOT NULL DEFAULT '0.0000',
  `duration_ms` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `clip_quality_reviews_id` PRIMARY KEY(`id`),
  CONSTRAINT `fk_cqr_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cqr_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);

-- Index for fast lookups by episode + slice
CREATE INDEX `idx_cqr_episode_slice` ON `clip_quality_reviews` (`episode_id`, `slice_id`);

-- Index for finding failed reviews that need retry
CREATE INDEX `idx_cqr_routing` ON `clip_quality_reviews` (`routing_decision`, `episode_id`);
