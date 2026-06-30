CREATE TABLE `participants` (
	`room_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`vote` text,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	PRIMARY KEY(`room_id`, `client_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`leader_client_id` text,
	`revealed` integer DEFAULT false NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
