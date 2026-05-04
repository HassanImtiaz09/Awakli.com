CREATE TABLE IF NOT EXISTS `color_scripts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `project_id` int NOT NULL,
  `episode_id` int,
  `character_palettes` json,
  `scene_palettes` json,
  `mood_progression` json,
  `palette_lock` json,
  `style_bundle_key` varchar(50),
  `generation_prompt` text,
  `generation_cost_usd` decimal(8,4) DEFAULT '0',
  `status` enum('pending','generating','generated','approved','rejected','locked') NOT NULL DEFAULT 'pending',
  `approved_at` timestamp,
  `approved_by` int,
  `rejected_reason` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `color_scripts_id` PRIMARY KEY(`id`),
  CONSTRAINT `fk_color_scripts_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_color_scripts_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_color_scripts_project` ON `color_scripts` (`project_id`);
CREATE INDEX `idx_color_scripts_episode` ON `color_scripts` (`episode_id`);
CREATE INDEX `idx_color_scripts_status` ON `color_scripts` (`status`);
