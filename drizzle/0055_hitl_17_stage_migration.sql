-- Migration: HITL 12→17 stage migration (v1.9 Pipeline Blueprint)
-- Updates pipeline_runs.totalStages default from 12 to 17
-- Greenfield: no production users, safe to reset gate_configs

-- 1. Update default totalStages on pipeline_runs
ALTER TABLE `pipeline_runs` MODIFY COLUMN `totalStages` int NOT NULL DEFAULT 17;

-- 2. Update any existing pipeline_runs that have totalStages=12 to 17
UPDATE `pipeline_runs` SET `totalStages` = 17 WHERE `totalStages` = 12;

-- 3. Delete old gate_configs (12-stage seeds) and reseed for 17 stages
-- Since there are no production users, this is safe
DELETE FROM `gate_configs`;

-- 4. Reseed gate_configs for all 5 tiers × 17 stages
-- Gate types per v1.9 Blueprint:
--   blocking: 1(script), 3(character_design), 4(color_script), 5(ekonte), 6(layout), 7(genga), 10(video_generation), 15(satsuei), 16(mastering_harness)
--   advisory: 2(anime_type), 8(sakuga_kantoku_review), 9(sakuga_tagging), 11(per_clip_continuity), 12(x_sheet), 13(ato_fuki), 14(fx_pass)
--   ambient: 17(continual_learning)

-- free_trial tier: all blocking gates active, advisory auto-approve, ambient pass-through
INSERT INTO `gate_configs` (`tierName`, `stageNumber`, `gateType`, `autoApproveThreshold`, `maxHoldTime`, `notifyOnHold`, `createdAt`, `updatedAt`) VALUES
('free_trial', 1, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 2, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 3, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 4, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 5, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 6, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 7, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 8, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 9, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 10, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 11, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 12, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 13, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 14, 'advisory', 7.0, 1800, 0, NOW(), NOW()),
('free_trial', 15, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 16, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('free_trial', 17, 'ambient', 9.0, 0, 0, NOW(), NOW()),
-- creator tier: fewer blocking gates (trust the pipeline more)
('creator', 1, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 2, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 3, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 4, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 5, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 6, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 7, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 8, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 9, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 10, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 11, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 12, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 13, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 14, 'advisory', 7.5, 1800, 0, NOW(), NOW()),
('creator', 15, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 16, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('creator', 17, 'ambient', 9.0, 0, 0, NOW(), NOW()),
-- pro tier: most gates advisory (high confidence threshold)
('pro', 1, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 2, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 3, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('pro', 4, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 5, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 6, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 7, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('pro', 8, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 9, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('pro', 10, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 11, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 12, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('pro', 13, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 14, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('pro', 15, 'advisory', 8.0, 1800, 0, NOW(), NOW()),
('pro', 16, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('pro', 17, 'ambient', 9.0, 0, 0, NOW(), NOW()),
-- studio tier: minimal blocking (only critical creative gates)
('studio', 1, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 2, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 3, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('studio', 4, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 5, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 6, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 7, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 8, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 9, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 10, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 11, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 12, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 13, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 14, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('studio', 15, 'advisory', 8.5, 1800, 0, NOW(), NOW()),
('studio', 16, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('studio', 17, 'ambient', 9.0, 0, 0, NOW(), NOW()),
-- enterprise tier: all ambient except mastering (final sign-off)
('enterprise', 1, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 2, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 3, 'advisory', 9.0, 1800, 0, NOW(), NOW()),
('enterprise', 4, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 5, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 6, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 7, 'advisory', 9.0, 1800, 0, NOW(), NOW()),
('enterprise', 8, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 9, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 10, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 11, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 12, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 13, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 14, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 15, 'ambient', 9.0, 0, 0, NOW(), NOW()),
('enterprise', 16, 'blocking', NULL, 3600, 1, NOW(), NOW()),
('enterprise', 17, 'ambient', 9.0, 0, 0, NOW(), NOW());
