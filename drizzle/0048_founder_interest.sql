CREATE TABLE `founder_interest` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int,
  `name` varchar(200) NOT NULL,
  `email` varchar(320) NOT NULL,
  `output_track` enum('manga','genga','full_anime') NOT NULL,
  `portfolio_url` text NOT NULL,
  `genre_focus` varchar(200),
  `pitch` text NOT NULL,
  `status` enum('new','reviewing','shortlisted','contacted','declined') NOT NULL DEFAULT 'new',
  `admin_notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `founder_interest_id` PRIMARY KEY(`id`)
);
