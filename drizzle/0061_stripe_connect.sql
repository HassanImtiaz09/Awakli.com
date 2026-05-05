CREATE TABLE `stripe_connect_accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `stripe_account_id` varchar(255) NOT NULL,
  `account_type` enum('express','standard','custom') NOT NULL DEFAULT 'express',
  `onboarding_status` enum('pending','incomplete','complete') NOT NULL DEFAULT 'pending',
  `charges_enabled` int NOT NULL DEFAULT 0,
  `payouts_enabled` int NOT NULL DEFAULT 0,
  `country` varchar(2),
  `default_currency` varchar(3),
  `metadata` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `stripe_connect_accounts_id` PRIMARY KEY(`id`),
  CONSTRAINT `stripe_connect_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action
);
