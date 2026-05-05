-- Migration 0059: Resolution Flow (D2.5 Sakuga Kantoku)
-- Creates tables for the multi-round auto-regen consistency resolution system.

CREATE TABLE `resolution_issues` (
  `id` int AUTO_INCREMENT NOT NULL,
  `project_id` int NOT NULL,
  `episode_id` int NOT NULL,
  `panel_id` int NOT NULL,
  `issue_type` enum('proportion_drift','color_inconsistency','off_model_face','pose_break','bg_mismatch','style_deviation','line_weight_mismatch') NOT NULL,
  `severity` int NOT NULL,
  `description` text NOT NULL,
  `status` enum('open','in_progress','resolved','approved','escalated','wont_fix') NOT NULL DEFAULT 'open',
  `assigned_to_user_id` int,
  `reference_panel_url` text,
  `confidence_score` float,
  `metadata` json,
  `round_count` int NOT NULL DEFAULT 0,
  `resolved_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `resolution_issues_id` PRIMARY KEY(`id`),
  CONSTRAINT `fk_ri_assigned_to` FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users`(`id`)
);

CREATE TABLE `resolution_rounds` (
  `id` int AUTO_INCREMENT NOT NULL,
  `issue_id` int NOT NULL,
  `round_number` int NOT NULL,
  `regen_params` json NOT NULL,
  `result_url` text,
  `reviewer_verdict` enum('pending','approved','rejected','partial_improvement') NOT NULL DEFAULT 'pending',
  `improvement_score` float,
  `reviewer_notes` text,
  `reviewed_by_user_id` int,
  `triggered_at` timestamp NOT NULL DEFAULT (now()),
  `reviewed_at` timestamp,
  CONSTRAINT `resolution_rounds_id` PRIMARY KEY(`id`),
  CONSTRAINT `fk_rr_issue` FOREIGN KEY (`issue_id`) REFERENCES `resolution_issues`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rr_reviewed_by` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`)
);

CREATE TABLE `genga_consistency_scores` (
  `id` int AUTO_INCREMENT NOT NULL,
  `project_id` int NOT NULL,
  `episode_id` int NOT NULL,
  `consistency_score` float NOT NULL,
  `drift_panel_count` int NOT NULL DEFAULT 0,
  `total_panel_count` int NOT NULL,
  `issue_breakdown` json,
  `computed_at` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `genga_consistency_scores_id` PRIMARY KEY(`id`)
);

-- Indexes for common queries
CREATE INDEX `idx_ri_project_episode` ON `resolution_issues`(`project_id`, `episode_id`);
CREATE INDEX `idx_ri_status` ON `resolution_issues`(`status`);
CREATE INDEX `idx_ri_assigned` ON `resolution_issues`(`assigned_to_user_id`);
CREATE INDEX `idx_rr_issue` ON `resolution_rounds`(`issue_id`);
CREATE INDEX `idx_gcs_project_episode` ON `genga_consistency_scores`(`project_id`, `episode_id`);
