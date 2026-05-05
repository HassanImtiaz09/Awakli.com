-- Migration 0060: Sakufuu LoRA Training Tables
-- Wave 5B Item 3: LoRA training pipeline for creator style models

CREATE TABLE IF NOT EXISTS `sakufuu_lora_jobs` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `creator_id` int NOT NULL,
  `project_id` int,
  `provider` varchar(32) NOT NULL DEFAULT 'replicate',
  `external_job_id` varchar(255),
  `status` enum('pending','preparing','training','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `config` json,
  `sample_count` int NOT NULL DEFAULT 0,
  `training_steps` int NOT NULL DEFAULT 1000,
  `model_url` text,
  `model_file_key` varchar(512),
  `cost_cents` int NOT NULL DEFAULT 0,
  `duration_seconds` int,
  `error_message` text,
  `approved` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `metadata` json,
  `started_at` timestamp NULL,
  `completed_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `sakufuu_style_samples` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `training_job_id` int NOT NULL,
  `creator_id` int NOT NULL,
  `source_url` text NOT NULL,
  `processed_file_key` varchar(512),
  `processed_url` text,
  `caption` text,
  `source_type` enum('panel','character_sheet','cover','custom') NOT NULL DEFAULT 'panel',
  `quality_score` float,
  `auto_selected` int NOT NULL DEFAULT 1,
  `crop_region` json,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX `idx_sakufuu_lora_creator` ON `sakufuu_lora_jobs` (`creator_id`);
CREATE INDEX `idx_sakufuu_lora_status` ON `sakufuu_lora_jobs` (`status`);
CREATE INDEX `idx_sakufuu_lora_project` ON `sakufuu_lora_jobs` (`project_id`);
CREATE INDEX `idx_sakufuu_samples_job` ON `sakufuu_style_samples` (`training_job_id`);
CREATE INDEX `idx_sakufuu_samples_creator` ON `sakufuu_style_samples` (`creator_id`);
