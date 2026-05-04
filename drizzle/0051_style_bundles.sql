-- Wave 2 Item 1: Anime Type Style Bundles
-- Migration 0051: Create style_bundles table

CREATE TABLE IF NOT EXISTS `style_bundles` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `genre_key` varchar(64) NOT NULL UNIQUE,
  `name` varchar(128) NOT NULL,
  `description` text,
  `aesthetic_notes` text,
  `prompt_template` text NOT NULL,
  `negative_prompt` text NOT NULL,
  `color_palette` json NOT NULL,
  `frame_rate_default` int NOT NULL DEFAULT 12,
  `reference_image_urls` json,
  `music_mood_vector` json,
  `lora_config` json,
  `preview_image_url` text,
  `icon_identifier` varchar(32),
  `is_active` int NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
