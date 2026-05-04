-- Migration: X-Sheet tables for Stage 12 (D4 Timing Director)
CREATE TABLE IF NOT EXISTS `x_sheets` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `episode_id` int NOT NULL,
  `project_id` int NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `source` enum('d4_auto','user_edit','user_override') NOT NULL DEFAULT 'd4_auto',
  `total_duration_ms` int DEFAULT NULL,
  `bpm` int DEFAULT NULL,
  `time_signature` varchar(10) DEFAULT NULL,
  `emotion_arc` json DEFAULT NULL,
  `generation_metadata` json DEFAULT NULL,
  `x_sheet_status` enum('draft','pending_review','approved','rejected','superseded') NOT NULL DEFAULT 'draft',
  `approved_at` timestamp NULL DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `x_sheets_episode_id_fk` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `x_sheets_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS `x_sheet_entries` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `x_sheet_id` int NOT NULL,
  `slice_number` int NOT NULL,
  `panel_id` int DEFAULT NULL,
  `start_ms` int NOT NULL,
  `end_ms` int NOT NULL,
  `duration_ms` int NOT NULL,
  `voice_start_ms` int DEFAULT NULL,
  `voice_end_ms` int DEFAULT NULL,
  `voice_character_id` int DEFAULT NULL,
  `voice_emotion` varchar(50) DEFAULT NULL,
  `voice_pacing` varchar(20) DEFAULT NULL,
  `music_cue_type` enum('none','start','stop','transition','crescendo','diminuendo','accent','stinger') DEFAULT 'none',
  `music_mood_shift` varchar(100) DEFAULT NULL,
  `music_intensity` int DEFAULT NULL,
  `sfx_triggers` json DEFAULT NULL,
  `entry_transition_type` enum('cut','crossfade','dip_to_black','soft_fade','audio_cross','wipe','none') DEFAULT 'cut',
  `transition_duration_ms` int DEFAULT 0,
  `scene_number` int DEFAULT NULL,
  `emotion` varchar(50) DEFAULT NULL,
  `energy_level` int DEFAULT NULL,
  `camera_note` varchar(200) DEFAULT NULL,
  `confidence` float DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `x_sheet_entries_x_sheet_id_fk` FOREIGN KEY (`x_sheet_id`) REFERENCES `x_sheets`(`id`) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS `x_sheet_overrides` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `x_sheet_id` int NOT NULL,
  `user_id` int NOT NULL,
  `slice_number` int NOT NULL,
  `override_data` json NOT NULL,
  `reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `x_sheet_overrides_x_sheet_id_fk` FOREIGN KEY (`x_sheet_id`) REFERENCES `x_sheets`(`id`) ON DELETE CASCADE,
  CONSTRAINT `x_sheet_overrides_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_x_sheets_episode` ON `x_sheets`(`episode_id`);
CREATE INDEX `idx_x_sheets_project_status` ON `x_sheets`(`project_id`, `x_sheet_status`);
CREATE INDEX `idx_x_sheet_entries_sheet` ON `x_sheet_entries`(`x_sheet_id`, `slice_number`);
CREATE INDEX `idx_x_sheet_overrides_sheet_user` ON `x_sheet_overrides`(`x_sheet_id`, `user_id`);
