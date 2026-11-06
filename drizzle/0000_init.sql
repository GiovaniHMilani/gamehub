CREATE TABLE `game_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`label` text NOT NULL,
	`partition_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_accounts_partition_id_unique` ON `game_accounts` (`partition_id`);--> statement-breakpoint
CREATE INDEX `game_accounts_game_id_idx` ON `game_accounts` (`game_id`);--> statement-breakpoint
CREATE TABLE `game_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`restore_on_launch` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `game_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_instances_account_id_unique` ON `game_instances` (`account_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `partition_tombstones` (
	`partition_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL
);
