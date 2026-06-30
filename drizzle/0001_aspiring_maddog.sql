CREATE TABLE `removed_participants` (
	`room_id` text NOT NULL,
	`client_id` text NOT NULL,
	`kicked_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `client_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
