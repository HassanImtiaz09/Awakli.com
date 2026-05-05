-- Migration 0063: Add admin gate to character LoRA training jobs
-- Adds pending_admin_approval and cancelled statuses, admin approval columns

ALTER TABLE `lora_training_jobs`
  MODIFY COLUMN `trainingJobStatus` ENUM('pending_admin_approval', 'queued', 'preprocessing', 'training', 'validating', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending_admin_approval';

ALTER TABLE `lora_training_jobs`
  ADD COLUMN `estimatedCostCents` INT NULL AFTER `costCredits`,
  ADD COLUMN `rejectionReason` TEXT NULL AFTER `errorMessage`,
  ADD COLUMN `adminApprovedBy` INT NULL AFTER `batchId`,
  ADD COLUMN `adminApprovedAt` TIMESTAMP NULL AFTER `adminApprovedBy`;

-- Update existing queued jobs to pending_admin_approval
UPDATE `lora_training_jobs` SET `trainingJobStatus` = 'pending_admin_approval' WHERE `trainingJobStatus` = 'queued';
