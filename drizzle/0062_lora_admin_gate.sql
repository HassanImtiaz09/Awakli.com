-- Migration 0062: Add pending_admin_approval status to sakufuu_lora_jobs
-- This adds an admin approval gate BEFORE training submission to prevent arbitrary spend.

ALTER TABLE `sakufuu_lora_jobs`
  MODIFY COLUMN `status` ENUM('pending_admin_approval','pending','preparing','training','completed','failed','cancelled') NOT NULL DEFAULT 'pending_admin_approval';

-- Add estimated_cost_cents column for pre-submission cost estimation
ALTER TABLE `sakufuu_lora_jobs`
  ADD COLUMN `estimated_cost_cents` INT NOT NULL DEFAULT 0 AFTER `cost_cents`;

-- Add admin_approved_by and admin_approved_at for audit trail
ALTER TABLE `sakufuu_lora_jobs`
  ADD COLUMN `admin_approved_by` INT NULL AFTER `approved`,
  ADD COLUMN `admin_approved_at` TIMESTAMP NULL AFTER `admin_approved_by`;
