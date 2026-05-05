-- Wave 5A: Print Orders + Creator Payouts tables
-- Lulu POD integration — tracks print product orders and creator royalties

-- Print Orders — lifecycle: created → payment_pending → paid → submitted_to_lulu → production → shipped → delivered
CREATE TABLE IF NOT EXISTS `print_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `project_id` INT NOT NULL,
  `episode_id` INT DEFAULT NULL,
  `status` ENUM('created', 'payment_pending', 'paid', 'submitted_to_lulu', 'production', 'shipped', 'delivered', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'created',
  `trim_size` ENUM('b5', 'a5', 'tankobon', 'us_trade') NOT NULL DEFAULT 'b5',
  `page_count` INT NOT NULL,
  `interior_pdf_url` TEXT DEFAULT NULL,
  `cover_pdf_url` TEXT DEFAULT NULL,
  `lulu_package_id` VARCHAR(64) DEFAULT NULL,
  `lulu_print_job_id` VARCHAR(128) DEFAULT NULL,
  `lulu_line_item_id` VARCHAR(128) DEFAULT NULL,
  `stripe_checkout_session_id` VARCHAR(255) DEFAULT NULL,
  `stripe_payment_intent_id` VARCHAR(255) DEFAULT NULL,
  `total_price_cents` INT NOT NULL,
  `print_cost_cents` INT DEFAULT NULL,
  `platform_margin_cents` INT DEFAULT NULL,
  `creator_royalty_cents` INT DEFAULT NULL,
  `creator_user_id` INT DEFAULT NULL,
  `shipping_address` JSON DEFAULT NULL,
  `shipping_method` ENUM('MAIL', 'GROUND', 'EXPEDITED', 'EXPRESS') DEFAULT 'MAIL',
  `shipping_cost_cents` INT DEFAULT NULL,
  `tracking_number` VARCHAR(128) DEFAULT NULL,
  `tracking_url` TEXT DEFAULT NULL,
  `webhook_events` JSON DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  `paid_at` TIMESTAMP DEFAULT NULL,
  `submitted_at` TIMESTAMP DEFAULT NULL,
  `shipped_at` TIMESTAMP DEFAULT NULL,
  `delivered_at` TIMESTAMP DEFAULT NULL,
  CONSTRAINT `fk_print_order_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_print_order_project` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_print_order_creator` FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);

-- Creator Payouts — manual payout workflow (Wave 5A)
-- Admin views owed balances, triggers manual Stripe transfers
-- Automated Stripe Connect onboarding → Wave 5B
CREATE TABLE IF NOT EXISTS `creator_payouts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `creator_user_id` INT NOT NULL,
  `print_order_id` INT NOT NULL,
  `amount_cents` INT NOT NULL,
  `status` ENUM('pending', 'approved', 'paid', 'failed') NOT NULL DEFAULT 'pending',
  `processed_by_user_id` INT DEFAULT NULL,
  `stripe_transfer_id` VARCHAR(255) DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `approved_at` TIMESTAMP DEFAULT NULL,
  `paid_at` TIMESTAMP DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `fk_payout_creator` FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payout_order` FOREIGN KEY (`print_order_id`) REFERENCES `print_orders`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payout_processor` FOREIGN KEY (`processed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX `idx_print_orders_user` ON `print_orders`(`user_id`, `status`);
CREATE INDEX `idx_print_orders_project` ON `print_orders`(`project_id`);
CREATE INDEX `idx_print_orders_status` ON `print_orders`(`status`, `created_at`);
CREATE INDEX `idx_print_orders_lulu_job` ON `print_orders`(`lulu_print_job_id`);
CREATE INDEX `idx_creator_payouts_user` ON `creator_payouts`(`creator_user_id`, `status`);
CREATE INDEX `idx_creator_payouts_status` ON `creator_payouts`(`status`);
