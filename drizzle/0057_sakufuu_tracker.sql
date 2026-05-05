-- D9 Sakufuu Tracker — Episode Memory + Project Memory tables
-- Wave 4: Data-tracking MVP (no LoRA training, no prompt adapter)

-- Layer 1: Episode Memory — tracks per-episode style decisions
CREATE TABLE IF NOT EXISTS `sakufuu_episode_memories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `episode_id` INT NOT NULL,
  `episode_number` INT NOT NULL,
  -- FX decisions
  `fx_used` JSON NOT NULL DEFAULT ('[]'),          -- [{type: "hikaku", count: 3, avgIntensity: 75}, ...]
  `fx_signature` JSON NOT NULL DEFAULT ('[]'),     -- top 3 most-used FX types for this episode
  -- Color/visual decisions
  `dominant_colors` JSON NOT NULL DEFAULT ('[]'),  -- [{hex: "#FF4500", weight: 0.3}, ...]
  `color_temperature` ENUM('warm', 'neutral', 'cool') DEFAULT 'neutral',
  `contrast_level` ENUM('low', 'medium', 'high') DEFAULT 'medium',
  -- Voice/audio decisions
  `voice_patterns` JSON NOT NULL DEFAULT ('{}'),   -- {character: {avgStability, avgSimilarity, avgSpeed, emotion_dist}}
  `pacing_profile` ENUM('slow', 'normal', 'fast', 'variable') DEFAULT 'normal',
  `avg_panel_duration_ms` INT DEFAULT NULL,
  -- Camera/composition decisions
  `camera_distribution` JSON NOT NULL DEFAULT ('{}'),  -- {close_up: 0.3, medium: 0.4, wide: 0.2, ...}
  `transition_preferences` JSON NOT NULL DEFAULT ('{}'), -- {cut: 0.6, fade: 0.2, dissolve: 0.1, ...}
  -- Metadata
  `confidence` FLOAT DEFAULT 0.5,  -- how reliable this memory is (based on data completeness)
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `fk_sakufuu_ep_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sakufuu_ep_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uq_sakufuu_ep` (`project_id`, `episode_id`)
);

-- Layer 2: Project Memory — aggregated style tendencies across episodes
CREATE TABLE IF NOT EXISTS `sakufuu_project_profiles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  -- Aggregated FX profile
  `signature_fx` JSON NOT NULL DEFAULT ('[]'),       -- top 5 FX types across all episodes [{type, frequency, avgIntensity}]
  `fx_diversity_score` FLOAT DEFAULT 0.5,            -- 0=always same FX, 1=highly varied
  -- Aggregated color profile
  `palette_tendency` JSON NOT NULL DEFAULT ('[]'),   -- [{hex, weight}] — project-wide color tendencies
  `temperature_tendency` ENUM('warm', 'neutral', 'cool') DEFAULT 'neutral',
  -- Aggregated voice profile
  `voice_consistency` FLOAT DEFAULT 0.5,             -- 0=wildly different per episode, 1=very consistent
  `preferred_pacing` ENUM('slow', 'normal', 'fast', 'variable') DEFAULT 'normal',
  -- Aggregated camera profile
  `camera_style` JSON NOT NULL DEFAULT ('{}'),       -- aggregated camera distribution
  `transition_style` JSON NOT NULL DEFAULT ('{}'),   -- aggregated transition preferences
  -- Meta
  `episodes_analyzed` INT DEFAULT 0,
  `last_updated_episode` INT DEFAULT NULL,
  `confidence` FLOAT DEFAULT 0.0,  -- increases with more episodes
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `fk_sakufuu_proj_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uq_sakufuu_proj` (`project_id`)
);

-- Index for fast lookups
CREATE INDEX `idx_sakufuu_ep_project` ON `sakufuu_episode_memories`(`project_id`, `episode_number`);
