-- Wave 2 Item 2: D0 Character Designer — Multi-View Reference Sheets
-- Migration 0052: Create character_views table for two-pass multi-view generation

CREATE TABLE IF NOT EXISTS `character_views` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `character_id` int NOT NULL,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `view_angle` enum('front','three_quarter','side','back') NOT NULL,
  `generation_pass` int NOT NULL DEFAULT 1,
  `image_url` text,
  `clip_score` decimal(5,4),
  `status` enum('pending','generating','generated','approved','rejected','failed') NOT NULL DEFAULT 'pending',
  `prompt_used` text,
  `conditioning_image_url` text,
  `style_bundle_key` varchar(64),
  `attempt_number` int NOT NULL DEFAULT 1,
  `generation_cost_usd` decimal(8,4) DEFAULT 0,
  `error_message` text,
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_char_view` (`character_id`, `view_angle`)
);

-- Reference sheet approval tracking
CREATE TABLE IF NOT EXISTS `reference_sheet_gates` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `character_id` int NOT NULL UNIQUE,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `status` enum('pending','all_views_generated','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  `front_view_id` int,
  `three_quarter_view_id` int,
  `side_view_id` int,
  `back_view_id` int,
  `overall_clip_score` decimal(5,4),
  `style_bundle_key` varchar(64),
  `total_cost_usd` decimal(8,4) DEFAULT 0,
  `total_attempts` int NOT NULL DEFAULT 0,
  `approved_at` timestamp NULL,
  `rejected_reason` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
